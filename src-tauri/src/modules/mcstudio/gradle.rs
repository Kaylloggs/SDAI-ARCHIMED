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

use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
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

struct Running {
    pid: Option<u32>,
    cancelled: Arc<AtomicBool>,
}

/// Compilations en cours, une au plus par projet.
#[derive(Default)]
pub struct BuildRegistry {
    running: Mutex<HashMap<String, Running>>,
}

impl BuildRegistry {
    fn claim(&self, project_id: &str) -> AppResult<Arc<AtomicBool>> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| AppError::internal("registre des builds verrouillé"))?;
        if running.contains_key(project_id) {
            return Err(AppError::invalid(
                "Une compilation est déjà en cours pour ce projet.",
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        running.insert(
            project_id.to_string(),
            Running {
                pid: None,
                cancelled: cancelled.clone(),
            },
        );
        Ok(cancelled)
    }

    fn set_pid(&self, project_id: &str, pid: Option<u32>) {
        if let Ok(mut running) = self.running.lock() {
            if let Some(entry) = running.get_mut(project_id) {
                entry.pid = pid;
            }
        }
    }

    fn release(&self, project_id: &str) {
        if let Ok(mut running) = self.running.lock() {
            running.remove(project_id);
        }
    }

    pub fn is_running(&self, project_id: &str) -> bool {
        self.running
            .lock()
            .map(|r| r.contains_key(project_id))
            .unwrap_or(false)
    }

    /// Arrête Gradle et ses processus enfants.
    pub fn cancel(&self, project_id: &str) -> AppResult<()> {
        let pid = {
            let running = self
                .running
                .lock()
                .map_err(|_| AppError::internal("registre des builds verrouillé"))?;
            let entry = running.get(project_id).ok_or_else(|| {
                AppError::not_found("Aucune compilation en cours pour ce projet.")
            })?;
            entry.cancelled.store(true, Ordering::SeqCst);
            entry.pid
        };
        if let Some(pid) = pid {
            kill_tree(pid);
        }
        Ok(())
    }
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
    let mut args = vec!["--console=plain".to_string(), task.to_string()];
    if params.offline {
        args.push("--offline".to_string());
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

    let cancelled = match registry.claim(&params.project_id) {
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
    registry.release(&params.project_id);

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
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Gradle n'a pas pu être lancé : {e}"))?;
    registry.set_pid(&params.project_id, child.id());
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
        assert!(!registry.is_running("p"));
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
