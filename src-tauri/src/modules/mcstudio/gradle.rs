//! Compilation réelle : lance le Gradle Wrapper du projet avec le JDK choisi, diffuse
//! chaque ligne en direct, puis range le jar produit dans `dist/`.
//!
//! Rien n'est simulé : le statut vient du code de sortie de Gradle, le jar est celui que
//! Gradle a écrit dans `build/libs/`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::mpsc;

use crate::core::{AppError, AppResult};

use super::diagnostics;
use super::fsutil::write_atomic;
use super::types::{
    BuildEvent, BuildRecord, BuildStatus, BuildTask, JavaInstall, LoaderId, LogLevel, LogStream,
};

/// Lignes gardées en mémoire (le journal complet reste sur disque).
const MAX_LOG_LINES: usize = 200_000;
/// Compilations conservées dans `builds.json`.
const MAX_RECORDS: usize = 30;

/// Délai laissé au serveur pour enregistrer le monde après `stop` avant de tout arrêter.
const SERVER_STOP_GRACE: std::time::Duration = std::time::Duration::from_secs(20);
/// Longueur maximale d'une commande envoyée à la console du serveur.
const MAX_COMMAND_LEN: usize = 1_000;

/// Script d'initialisation Gradle passé au serveur de test (`--init-script`) : Gradle ne
/// transmet pas son entrée standard aux tâches `JavaExec`, la console du serveur resterait
/// sourde. Aucun fichier du projet n'est modifié.
const SERVER_CONSOLE_SCRIPT: &str = "\
// Écrit par Mod Studio avant chaque serveur de test (ne pas modifier) : la console du
// serveur reçoit les commandes tapées dans l'application.
allprojects {
    tasks.withType(JavaExec).configureEach { task ->
        if (task.name == 'runServer') {
            task.doFirst { t -> t.standardInput = System.in }
        }
    }
}
";

/// Emplacements d'un projet : une compilation ou une partie à la fois, et à côté le serveur
/// de test (pour le rejoindre depuis « Tester en jeu »).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Slot {
    Main,
    Server,
}

impl Slot {
    pub fn of(task: BuildTask) -> Self {
        if task == BuildTask::RunServer {
            Slot::Server
        } else {
            Slot::Main
        }
    }
}

struct Running {
    pid: Option<u32>,
    cancelled: Arc<AtomicBool>,
    /// Entrée de Gradle, relayée à la console du serveur de test.
    stdin: Option<Arc<tokio::sync::Mutex<ChildStdin>>>,
}

/// Tâches Gradle en cours : au plus une par emplacement et par projet.
#[derive(Default)]
pub struct BuildRegistry {
    running: Mutex<HashMap<(String, Slot), Running>>,
}

impl BuildRegistry {
    fn claim(&self, project_id: &str, slot: Slot) -> AppResult<Arc<AtomicBool>> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| AppError::internal("registre des builds verrouillé"))?;
        let key = (project_id.to_string(), slot);
        if running.contains_key(&key) {
            return Err(AppError::invalid(match slot {
                Slot::Main => "Une compilation ou une partie est déjà en cours pour ce projet.",
                Slot::Server => "Le serveur de test de ce projet tourne déjà.",
            }));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        running.insert(
            key,
            Running {
                pid: None,
                cancelled: cancelled.clone(),
                stdin: None,
            },
        );
        Ok(cancelled)
    }

    fn set_process(
        &self,
        project_id: &str,
        slot: Slot,
        pid: Option<u32>,
        stdin: Option<ChildStdin>,
    ) {
        if let Ok(mut running) = self.running.lock() {
            if let Some(entry) = running.get_mut(&(project_id.to_string(), slot)) {
                entry.pid = pid;
                entry.stdin = stdin.map(|s| Arc::new(tokio::sync::Mutex::new(s)));
            }
        }
    }

    fn release(&self, project_id: &str, slot: Slot) {
        if let Ok(mut running) = self.running.lock() {
            running.remove(&(project_id.to_string(), slot));
        }
    }

    pub fn is_running(&self, project_id: &str, slot: Slot) -> bool {
        self.running
            .lock()
            .map(|r| r.contains_key(&(project_id.to_string(), slot)))
            .unwrap_or(false)
    }

    fn entry<T>(
        &self,
        project_id: &str,
        slot: Slot,
        read: impl FnOnce(&Running) -> T,
    ) -> AppResult<T> {
        let running = self
            .running
            .lock()
            .map_err(|_| AppError::internal("registre des builds verrouillé"))?;
        running
            .get(&(project_id.to_string(), slot))
            .map(read)
            .ok_or_else(|| {
                AppError::not_found(match slot {
                    Slot::Main => "Aucune compilation en cours pour ce projet.",
                    Slot::Server => "Aucun serveur de test en cours pour ce projet.",
                })
            })
    }

    /// Arrête la compilation ou la partie en cours (Gradle et ses processus enfants).
    pub fn cancel(&self, project_id: &str) -> AppResult<()> {
        let pid = self.entry(project_id, Slot::Main, |entry| {
            entry.cancelled.store(true, Ordering::SeqCst);
            entry.pid
        })?;
        if let Some(pid) = pid {
            kill_tree(pid);
        }
        Ok(())
    }

    /// Envoie une ligne à la console du serveur de test (sans le `/` de tête).
    pub async fn send_server_command(&self, project_id: &str, command: &str) -> AppResult<()> {
        let command = command.trim();
        let command = command.strip_prefix('/').unwrap_or(command).trim();
        if command.is_empty() {
            return Err(AppError::invalid("Commande vide."));
        }
        if command.len() > MAX_COMMAND_LEN || command.contains(['\n', '\r']) {
            return Err(AppError::invalid(
                "Une commande tient sur une ligne de 1 000 caractères au plus.",
            ));
        }
        let stdin = self
            .entry(project_id, Slot::Server, |entry| entry.stdin.clone())?
            .ok_or_else(|| AppError::invalid("Le serveur de test démarre encore."))?;
        write_line(&stdin, command)
            .await
            .map_err(|e| AppError::internal(format!("console du serveur injoignable : {e}")))
    }

    /// Arrête le serveur de test : `stop` d'abord (le monde est enregistré), puis tout
    /// l'arbre de processus s'il ne s'est pas arrêté à temps, ou tout de suite si `force`.
    pub async fn stop_server(self: &Arc<Self>, project_id: &str, force: bool) -> AppResult<()> {
        let (pid, stdin) = self.entry(project_id, Slot::Server, |entry| {
            entry.cancelled.store(true, Ordering::SeqCst);
            (entry.pid, entry.stdin.clone())
        })?;
        let asked = match (&stdin, force) {
            (Some(stdin), false) => write_line(stdin, "stop").await.is_ok(),
            _ => false,
        };
        let Some(pid) = pid else {
            return Ok(());
        };
        if !asked {
            kill_tree(pid);
            return Ok(());
        }
        let registry = self.clone();
        let project_id = project_id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(SERVER_STOP_GRACE).await;
            // Toujours le même serveur (pas un nouveau lancé entre-temps) : arrêt forcé.
            if registry
                .entry(&project_id, Slot::Server, |entry| entry.pid)
                .ok()
                .flatten()
                == Some(pid)
            {
                kill_tree(pid);
            }
        });
        Ok(())
    }
}

async fn write_line(stdin: &tokio::sync::Mutex<ChildStdin>, line: &str) -> std::io::Result<()> {
    let mut stdin = stdin.lock().await;
    stdin.write_all(format!("{line}\n").as_bytes()).await?;
    stdin.flush().await
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    let result = crate::core::process::command("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    // Le wrapper est lancé dans son propre groupe : on arrête tout le groupe.
    #[cfg(not(windows))]
    let result = crate::core::process::command("kill")
        .args(["-TERM", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if let Err(error) = result {
        tracing::warn!("arrêt de Gradle (pid {pid}) impossible : {error}");
    }
}

/// Ce qu'il faut pour lancer une compilation.
pub struct BuildParams {
    pub project_id: String,
    pub root: PathBuf,
    pub java: JavaInstall,
    pub task: BuildTask,
    pub offline: bool,
    pub mod_id: String,
    pub mod_version: String,
    pub loader: LoaderId,
    pub minecraft: String,
}

fn wrapper(root: &Path) -> PathBuf {
    root.join(if cfg!(windows) {
        "gradlew.bat"
    } else {
        "gradlew"
    })
}

pub fn check_wrapper(root: &Path) -> AppResult<()> {
    let script = wrapper(root);
    let jar = root
        .join("gradle")
        .join("wrapper")
        .join("gradle-wrapper.jar");
    if !script.is_file() || !jar.is_file() {
        return Err(AppError::not_found(
            "Le Gradle Wrapper du projet manque (gradlew et gradle/wrapper/gradle-wrapper.jar). Sans lui, Mod Studio ne peut pas compiler.",
        ));
    }
    Ok(())
}

fn classify(text: &str) -> LogLevel {
    let lower = text.to_ascii_lowercase();
    if text.contains("FAILED")
        || lower.contains("error:")
        || text.contains("ERROR")
        || text.starts_with("FAILURE")
        || text.starts_with("e: ")
    {
        LogLevel::Error
    } else if lower.contains("warning:")
        || text.contains("WARN")
        || text.starts_with("w: ")
        || text.contains("deprecat")
    {
        LogLevel::Warning
    } else if text.contains("DEBUG") || text.starts_with("[DEBUG]") {
        LogLevel::Debug
    } else {
        LogLevel::Info
    }
}

fn pump<R: AsyncRead + Unpin + Send + 'static>(
    reader: R,
    stream: LogStream,
    tx: mpsc::Sender<(LogStream, String)>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    // Console Windows : pas forcément de l'UTF-8.
                    let text = String::from_utf8_lossy(&buffer)
                        .trim_end_matches(['\r', '\n'])
                        .to_string();
                    if tx.send((stream, text)).await.is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// Jar principal écrit par Gradle pendant cette compilation.
fn find_jar(root: &Path, since: SystemTime) -> Option<PathBuf> {
    let libs = root.join("build").join("libs");
    let entries = std::fs::read_dir(libs).ok()?;
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            name.ends_with(".jar")
                && ![
                    "-sources.jar",
                    "-javadoc.jar",
                    "-dev.jar",
                    "-dev-shadow.jar",
                    "-slim.jar",
                ]
                .iter()
                .any(|suffix| name.ends_with(suffix))
        })
        .filter_map(|path| {
            let modified = path.metadata().and_then(|m| m.modified()).ok()?;
            (modified >= since).then_some((modified, path))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

fn display(path: &Path) -> String {
    let text = path.display().to_string();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

fn builds_file(root: &Path) -> PathBuf {
    root.join(".mcstudio").join("builds.json")
}

/// Le CLUF de Minecraft est accepté pour le serveur de test (`run/eula.txt`).
pub fn eula_accepted(root: &Path) -> bool {
    std::fs::read_to_string(root.join("run/eula.txt"))
        .map(|text| text.lines().any(|line| line.trim() == "eula=true"))
        .unwrap_or(false)
}

/// Accepte le CLUF de Minecraft (geste explicite de la personne, jamais par défaut). Un
/// `server.properties` neuf met le serveur de test hors ligne (`online-mode=false`) pour
/// accueillir le compte de développement de « Tester en jeu ».
pub fn accept_eula(root: &Path) -> AppResult<()> {
    let run = root.join("run");
    std::fs::create_dir_all(&run)?;
    let stamp = chrono::Utc::now().format("%Y-%m-%d %H:%M UTC");
    write_atomic(
        &run.join("eula.txt"),
        format!(
            "# CLUF de Minecraft (https://aka.ms/MinecraftEULA) accepté dans Mod Studio le {stamp}.\neula=true\n"
        )
        .as_bytes(),
    )?;
    let properties = run.join("server.properties");
    if !properties.exists() {
        write_atomic(
            &properties,
            "# Serveur de test de Mod Studio : hors ligne pour le compte de développement.\nonline-mode=false\n"
                .as_bytes(),
        )?;
    }
    crate::core::audit::record(
        "mcstudio.server_eula",
        &run.display().to_string(),
        "accepted",
        "user",
    );
    Ok(())
}

/// `.mcstudio/gradle/server-console.gradle`, réécrit à chaque lancement du serveur.
fn server_console_script(root: &Path) -> AppResult<PathBuf> {
    let path = root
        .join(".mcstudio")
        .join("gradle")
        .join("server-console.gradle");
    write_atomic(&path, SERVER_CONSOLE_SCRIPT.as_bytes())?;
    Ok(path)
}

pub fn history(root: &Path) -> Vec<BuildRecord> {
    std::fs::read_to_string(builds_file(root))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_record(root: &Path, record: &BuildRecord, log: &[String]) {
    let mut records = history(root);
    records.push(record.clone());
    if records.len() > MAX_RECORDS {
        let excess = records.len() - MAX_RECORDS;
        for old in records.drain(..excess) {
            let _ = std::fs::remove_file(log_path(root, &old.id));
        }
    }
    if let Ok(body) = serde_json::to_string_pretty(&records) {
        if let Err(error) = write_atomic(&builds_file(root), body.as_bytes()) {
            tracing::warn!("historique des builds non enregistré : {}", error.message);
        }
    }
    let mut text = log.join("\n");
    text.push('\n');
    if let Err(error) = write_atomic(&log_path(root, &record.id), text.as_bytes()) {
        tracing::warn!("journal de build non enregistré : {}", error.message);
    }
}

pub fn log_path(root: &Path, build_id: &str) -> PathBuf {
    root.join(".mcstudio")
        .join("builds")
        .join(format!("{build_id}.log"))
}

fn seconds(ms: u64) -> String {
    if ms < 60_000 {
        format!("{} s", ms.div_ceil(1000))
    } else {
        format!("{} min {:02} s", ms / 60_000, (ms % 60_000) / 1000)
    }
}

/// Lance Gradle et attend sa fin. `emit` reçoit chaque événement dans l'ordre.
pub async fn run(
    registry: Arc<BuildRegistry>,
    params: BuildParams,
    build_id: String,
    emit: impl Fn(BuildEvent) + Send + Sync + 'static,
) -> BuildRecord {
    let started_at = chrono::Utc::now().to_rfc3339();
    let started = Instant::now();
    let since = SystemTime::now();
    let task = params.task.gradle_task();
    let slot = Slot::of(params.task);
    let mut args = vec!["--console=plain".to_string(), task.to_string()];
    if params.offline {
        args.push("--offline".to_string());
    }
    if slot == Slot::Server {
        match server_console_script(&params.root) {
            Ok(script) => args.extend(["--init-script".to_string(), display(&script)]),
            Err(error) => tracing::warn!("console du serveur non branchée : {}", error.message),
        }
    }
    let command_line = format!(
        "{} {}",
        if cfg!(windows) {
            "gradlew.bat"
        } else {
            "./gradlew"
        },
        args.join(" ")
    );

    let finish = |status: BuildStatus,
                  exit_code: Option<i32>,
                  log: Vec<String>,
                  jar: Option<PathBuf>,
                  dist: Option<PathBuf>| {
        let duration_ms = started.elapsed().as_millis() as u64;
        let issues = if status == BuildStatus::Failed {
            diagnostics::analyze(&log, &params.root)
        } else {
            Vec::new()
        };
        let playing = params.task == BuildTask::RunClient;
        let serving = params.task == BuildTask::RunServer;
        let summary = match status {
            BuildStatus::Success if serving => format!(
                "Serveur de test arrêté normalement après {}.",
                seconds(duration_ms)
            ),
            BuildStatus::Cancelled if serving => "Serveur de test arrêté à votre demande.".to_string(),
            BuildStatus::Failed if serving => match issues.first() {
                Some(first) => format!(
                    "Le serveur dédié n'a pas pu démarrer ou s'est arrêté sur une erreur. Cause probable : {}.",
                    first.title.to_lowercase()
                ),
                None => "Le serveur dédié n'a pas pu démarrer ou s'est arrêté sur une erreur.".to_string(),
            },
            BuildStatus::Success if playing => format!(
                "Partie de test terminée : Minecraft s'est fermé normalement après {}.",
                seconds(duration_ms)
            ),
            BuildStatus::Cancelled if playing => "Partie de test arrêtée à votre demande.".to_string(),
            BuildStatus::Failed if playing => match issues.first() {
                Some(first) => format!(
                    "Minecraft n'a pas pu démarrer ou s'est arrêté sur une erreur. Cause probable : {}.",
                    first.title.to_lowercase()
                ),
                None => "Minecraft n'a pas pu démarrer ou s'est arrêté sur une erreur.".to_string(),
            },
            BuildStatus::Success => format!("Compilation réussie en {}.", seconds(duration_ms)),
            BuildStatus::Cancelled => "Compilation interrompue à votre demande.".to_string(),
            BuildStatus::Failed => match issues.first() {
                Some(first) => format!(
                    "Gradle n'a pas réussi à compiler le projet. Cause probable : {}.",
                    first.title.to_lowercase()
                ),
                None => "Gradle n'a pas réussi à compiler le projet.".to_string(),
            },
        };
        let record = BuildRecord {
            id: build_id.clone(),
            task: params.task,
            status,
            started_at: started_at.clone(),
            duration_ms,
            exit_code,
            command: command_line.clone(),
            jar: jar.as_deref().map(display),
            dist: dist.as_deref().map(display),
            issues,
            summary,
        };
        save_record(&params.root, &record, &log);
        record
    };

    emit(BuildEvent::Started {
        build_id: build_id.clone(),
        command: command_line.clone(),
        cwd: display(&params.root),
        java_home: params.java.path.clone(),
        java_version: params.java.version.clone(),
    });

    let cancelled = match registry.claim(&params.project_id, slot) {
        Ok(flag) => flag,
        Err(error) => {
            let record = finish(BuildStatus::Failed, None, vec![error.message], None, None);
            emit(BuildEvent::Finished {
                record: record.clone(),
            });
            return record;
        }
    };

    let record = execute(&registry, &params, &args, &cancelled, &emit).await;
    registry.release(&params.project_id, slot);

    let record = match record {
        Err(message) => finish(BuildStatus::Failed, None, vec![message], None, None),
        Ok((exit_code, log)) => {
            if cancelled.load(Ordering::SeqCst) {
                finish(BuildStatus::Cancelled, exit_code, log, None, None)
            } else if exit_code == Some(0) {
                let jar = (params.task == BuildTask::Build)
                    .then(|| find_jar(&params.root, since))
                    .flatten();
                let dist = jar.as_ref().and_then(|jar| copy_to_dist(&params, jar));
                finish(BuildStatus::Success, exit_code, log, jar, dist)
            } else {
                finish(BuildStatus::Failed, exit_code, log, None, None)
            }
        }
    };
    emit(BuildEvent::Finished {
        record: record.clone(),
    });
    record
}

async fn execute(
    registry: &BuildRegistry,
    params: &BuildParams,
    args: &[String],
    cancelled: &AtomicBool,
    emit: &(impl Fn(BuildEvent) + Send + Sync),
) -> Result<(Option<i32>, Vec<String>), String> {
    check_wrapper(&params.root).map_err(|e| e.message)?;
    let script = wrapper(&params.root);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
    }

    let java_bin = Path::new(&params.java.path).join("bin");
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    let path_var =
        std::env::join_paths(std::iter::once(java_bin).chain(std::env::split_paths(&path_var)))
            .map_err(|e| format!("PATH invalide : {e}"))?;

    let mut command = crate::core::process::async_command(&script);
    command
        .current_dir(&params.root)
        .args(args)
        .env("JAVA_HOME", &params.java.path)
        .env("PATH", path_var)
        .stdin(if params.task == BuildTask::RunServer {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Gradle n'a pas pu être lancé : {e}"))?;
    registry.set_process(
        &params.project_id,
        Slot::of(params.task),
        child.id(),
        child.stdin.take(),
    );
    if cancelled.load(Ordering::SeqCst) {
        if let Some(pid) = child.id() {
            kill_tree(pid);
        }
    }

    let (tx, mut rx) = mpsc::channel::<(LogStream, String)>(512);
    if let Some(stdout) = child.stdout.take() {
        pump(stdout, LogStream::Stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        pump(stderr, LogStream::Stderr, tx.clone());
    }
    drop(tx);

    let mut log = Vec::new();
    while let Some((stream, text)) = rx.recv().await {
        if let Some(name) = text.strip_prefix("> Task ") {
            emit(BuildEvent::Task {
                name: name.split_whitespace().next().unwrap_or(name).to_string(),
            });
        }
        emit(BuildEvent::Line {
            stream,
            level: classify(&text),
            text: text.clone(),
        });
        if log.len() < MAX_LOG_LINES {
            log.push(text);
        }
    }
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Attente de Gradle impossible : {e}"))?;
    Ok((status.code(), log))
}

/// `dist/<modid>-<version>-<loader>-<minecraft>.jar`
fn copy_to_dist(params: &BuildParams, jar: &Path) -> Option<PathBuf> {
    let dist = params.root.join("dist");
    let name = format!(
        "{}-{}-{}-{}.jar",
        params.mod_id,
        params.mod_version,
        params.loader.label().to_lowercase(),
        params.minecraft
    );
    let target = dist.join(name);
    let copied = std::fs::create_dir_all(&dist).and_then(|_| std::fs::copy(jar, &target));
    match copied {
        Ok(_) => Some(target),
        Err(error) => {
            tracing::warn!("copie du jar dans dist/ impossible : {error}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_eula_is_accepted_only_on_request_and_keeps_server_settings() {
        let root = std::env::temp_dir().join(format!("mcstudio-eula-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("run")).unwrap();
        assert!(!eula_accepted(&root));
        std::fs::write(root.join("run/eula.txt"), "eula=false\n").unwrap();
        assert!(!eula_accepted(&root));
        accept_eula(&root).unwrap();
        assert!(eula_accepted(&root));
        let properties = std::fs::read_to_string(root.join("run/server.properties")).unwrap();
        assert!(properties.contains("online-mode=false"));
        // Réglages existants gardés.
        std::fs::write(root.join("run/server.properties"), "online-mode=true\n").unwrap();
        accept_eula(&root).unwrap();
        let properties = std::fs::read_to_string(root.join("run/server.properties")).unwrap();
        assert_eq!(properties, "online-mode=true\n");
        assert_eq!(BuildTask::RunServer.gradle_task(), "runServer");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn log_levels_are_classified() {
        assert_eq!(classify("> Task :compileJava FAILED"), LogLevel::Error);
        assert_eq!(classify("A.java:3: error: ';' expected"), LogLevel::Error);
        assert_eq!(classify("warning: [removal] x"), LogLevel::Warning);
        assert_eq!(classify("> Task :processResources"), LogLevel::Info);
    }

    #[test]
    fn only_fresh_main_jars_are_picked() {
        let root = std::env::temp_dir().join(format!("mcstudio-jar-{}", std::process::id()));
        let libs = root.join("build/libs");
        std::fs::create_dir_all(&libs).unwrap();
        let before = SystemTime::now() - std::time::Duration::from_secs(5);
        std::fs::write(libs.join("m-1.0.0-sources.jar"), "x").unwrap();
        assert!(find_jar(&root, before).is_none());
        std::fs::write(libs.join("m-1.0.0.jar"), "x").unwrap();
        assert!(find_jar(&root, before).unwrap().ends_with("m-1.0.0.jar"));
        let later = SystemTime::now() + std::time::Duration::from_secs(60);
        assert!(find_jar(&root, later).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Vrai Gradle (8.14.3) et vrai Java : le serveur de test reçoit les commandes, s'arrête
    /// proprement sur `stop`, et une partie se lance pendant qu'il tourne. Sans réseau si la
    /// distribution Gradle est en cache :
    /// `JAVA_HOME=… cargo test server_console -- --ignored --nocapture`
    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "lance Gradle et Java (quelques dizaines de secondes)"]
    async fn server_console_takes_commands_while_the_game_runs() {
        use tokio::sync::mpsc::unbounded_channel;
        use tokio::time::{timeout, Duration};

        let java_home = std::env::var("JAVA_HOME").expect("JAVA_HOME vers un JDK 17+");
        let root = std::env::temp_dir().join(format!("mcstudio-console-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let files: [(&str, &[u8]); 7] = [
            ("gradlew", include_bytes!("templates/files/common/gradlew")),
            (
                "gradle/wrapper/gradle-wrapper.jar",
                include_bytes!("templates/files/common/gradle-wrapper.jar"),
            ),
            (
                "gradle/wrapper/gradle-wrapper.properties",
                b"distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip\n",
            ),
            ("settings.gradle", b"rootProject.name = 'console'\n"),
            (
                "build.gradle",
                b"plugins { id 'java' }\n\
                  tasks.register('runServer', JavaExec) { classpath = sourceSets.main.runtimeClasspath; mainClass = 'Server' }\n\
                  tasks.register('runClient', JavaExec) { classpath = sourceSets.main.runtimeClasspath; mainClass = 'Client' }\n",
            ),
            (
                "src/main/java/Server.java",
                b"public class Server { public static void main(String[] a) throws Exception {\n\
                  var in = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));\n\
                  System.out.println(\"Done (0.1s)! For help, type help\");\n\
                  String line;\n\
                  while ((line = in.readLine()) != null) {\n\
                  System.out.println(\"[Server] \" + line);\n\
                  if (line.equals(\"stop\")) return;\n\
                  }\n\
                  System.out.println(\"stdin closed\");\n\
                  } }\n",
            ),
            (
                "src/main/java/Client.java",
                b"public class Client { public static void main(String[] a) throws Exception {\n\
                  System.out.println(\"Client started\"); Thread.sleep(500); } }\n",
            ),
        ];
        for (path, body) in files {
            let target = root.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, body).unwrap();
        }
        let params = |task| BuildParams {
            project_id: "p".into(),
            root: root.clone(),
            java: JavaInstall {
                path: java_home.clone(),
                version: "21".into(),
                major: 21,
                vendor: None,
            },
            task,
            offline: true,
            mod_id: "m".into(),
            mod_version: "1.0.0".into(),
            loader: LoaderId::Fabric,
            minecraft: "1.21.1".into(),
        };
        let registry = Arc::new(BuildRegistry::default());
        let (tx, mut lines) = unbounded_channel::<String>();
        let server = tokio::spawn(run(
            registry.clone(),
            params(BuildTask::RunServer),
            "s1".into(),
            move |event| {
                if let BuildEvent::Line { text, .. } = event {
                    println!("serveur | {text}");
                    let _ = tx.send(text);
                }
            },
        ));
        let mut wait_for = async |needle: &str| {
            timeout(Duration::from_secs(300), async {
                while let Some(line) = lines.recv().await {
                    if line.contains(needle) {
                        return;
                    }
                }
                panic!("fin du journal sans « {needle} »");
            })
            .await
            .unwrap_or_else(|_| panic!("« {needle} » attendu"))
        };
        wait_for("Done (").await;
        assert!(registry.is_running("p", Slot::Server));

        // Une partie se lance pendant que le serveur tourne.
        let client = run(
            registry.clone(),
            params(BuildTask::RunClient),
            "c1".into(),
            |_| (),
        )
        .await;
        assert_eq!(client.status, BuildStatus::Success, "{}", client.summary);

        registry
            .send_server_command("p", "/say bonjour")
            .await
            .unwrap();
        wait_for("[Server] say bonjour").await;
        assert!(registry.send_server_command("p", "a\nb").await.is_err());

        let asked = Instant::now();
        registry.stop_server("p", false).await.unwrap();
        wait_for("[Server] stop").await;
        let record = timeout(Duration::from_secs(60), server)
            .await
            .unwrap()
            .unwrap();
        assert!(
            asked.elapsed() < SERVER_STOP_GRACE,
            "arrêt propre, sans attendre l'arrêt forcé"
        );
        assert_eq!(record.status, BuildStatus::Cancelled);
        assert_eq!(record.exit_code, Some(0));
        assert!(!registry.is_running("p", Slot::Server));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_real_process_is_run_and_its_failure_reported() {
        // Faux wrapper : prouve le lancement, le flux de lignes et le code de sortie réel.
        let root = std::env::temp_dir().join(format!("mcstudio-run-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("gradle/wrapper")).unwrap();
        std::fs::write(root.join("gradle/wrapper/gradle-wrapper.jar"), "x").unwrap();
        std::fs::write(
            root.join("gradlew"),
            "#!/bin/sh\necho \"> Task :compileJava FAILED\"\necho \"$PWD/src/A.java:2: error: ';' expected\" >&2\nexit 1\n",
        )
        .unwrap();
        let registry = Arc::new(BuildRegistry::default());
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let params = BuildParams {
            project_id: "p".into(),
            root: root.clone(),
            java: JavaInstall {
                path: "/nonexistent".into(),
                version: "21".into(),
                major: 21,
                vendor: None,
            },
            task: BuildTask::Build,
            offline: false,
            mod_id: "m".into(),
            mod_version: "1.0.0".into(),
            loader: LoaderId::Fabric,
            minecraft: "1.21.1".into(),
        };
        let record = run(registry.clone(), params, "b1".into(), move |e| {
            sink.lock().unwrap().push(e)
        })
        .await;
        assert_eq!(record.status, BuildStatus::Failed);
        assert_eq!(record.exit_code, Some(1));
        assert_eq!(record.issues[0].file.as_deref(), Some("src/A.java"));
        assert!(record.summary.starts_with("Gradle n'a pas réussi"));
        assert!(!registry.is_running("p", Slot::Main));
        let events = events.lock().unwrap();
        assert!(matches!(events.first(), Some(BuildEvent::Started { .. })));
        assert!(events
            .iter()
            .any(|e| matches!(e, BuildEvent::Task { name } if name == ":compileJava")));
        assert!(matches!(events.last(), Some(BuildEvent::Finished { .. })));
        assert_eq!(history(&root).len(), 1);
        assert!(log_path(&root, "b1").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }
}
