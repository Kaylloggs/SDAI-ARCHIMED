//! Exécution des commandes moteur (§25, §29) : une action à la fois par projet, sortie lue en
//! direct et transmise à l'interface, délai maximal, arrêt à la demande (tout l'arbre de
//! processus), signal quand un outil ne dit plus rien depuis longtemps. Aucune commande n'est
//! passée par un shell : programme et arguments sont donnés tels quels.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::mpsc;
use ts_rs::TS;

use crate::core::{AppError, AppResult};

use super::engines::{CommandSpec, GameAction};
use super::types::{GameBuildRecord, GameLogLevel, GamePlatform};

/// Lignes gardées pour l'analyse et le journal complet.
pub const MAX_LOG_LINES: usize = 20_000;
/// Silence au-delà duquel l'interface le signale (l'outil n'est pas arrêté pour autant).
const QUIET_AFTER: Duration = Duration::from_secs(120);
const TICK: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameLogStream {
    Stdout,
    Stderr,
}

/// Événements d'une action en cours, transmis par un `Channel`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GameJobEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        job_id: String,
        action: GameAction,
        command: String,
        cwd: String,
        #[ts(type = "number | null")]
        timeout_secs: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Line {
        stream: GameLogStream,
        level: GameLogLevel,
        text: String,
    },
    /// Rien lu depuis `seconds` secondes.
    #[serde(rename_all = "camelCase")]
    Quiet {
        #[ts(type = "number")]
        seconds: u64,
    },
    #[serde(rename_all = "camelCase")]
    Finished { record: GameBuildRecord },
}

/// Action en cours d'un projet.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameRunningJob {
    pub job_id: String,
    pub action: GameAction,
    pub started_at: String,
    pub command: String,
}

struct Running {
    job: GameRunningJob,
    pid: Option<u32>,
    cancelled: Arc<AtomicBool>,
}

/// Actions en cours, par projet.
#[derive(Default)]
pub struct Jobs {
    running: Mutex<HashMap<String, Running>>,
}

impl Jobs {
    /// Réserve le projet pour une action ; refusé si une autre tourne déjà.
    pub fn claim(&self, project_id: &str, job: GameRunningJob) -> AppResult<Arc<AtomicBool>> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| AppError::internal("registre des actions verrouillé"))?;
        if let Some(current) = running.get(project_id) {
            return Err(AppError::invalid(format!(
                "Une action est déjà en cours sur ce projet ({}) : attendez sa fin ou arrêtez-la.",
                current.job.action.label()
            )));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        running.insert(
            project_id.to_string(),
            Running {
                job,
                pid: None,
                cancelled: cancelled.clone(),
            },
        );
        Ok(cancelled)
    }

    fn set_pid(&self, project_id: &str, job_id: &str, pid: Option<u32>) {
        if let Ok(mut running) = self.running.lock() {
            if let Some(entry) = running
                .get_mut(project_id)
                .filter(|e| e.job.job_id == job_id)
            {
                entry.pid = pid;
            }
        }
    }

    pub fn release(&self, project_id: &str, job_id: &str) {
        if let Ok(mut running) = self.running.lock() {
            if running
                .get(project_id)
                .is_some_and(|e| e.job.job_id == job_id)
            {
                running.remove(project_id);
            }
        }
    }

    pub fn current(&self, project_id: &str) -> Option<GameRunningJob> {
        self.running
            .lock()
            .ok()
            .and_then(|r| r.get(project_id).map(|e| e.job.clone()))
    }

    /// Arrête l'action en cours du projet (et les programmes qu'elle a lancés).
    pub fn cancel(&self, project_id: &str) -> AppResult<()> {
        let pid = {
            let running = self
                .running
                .lock()
                .map_err(|_| AppError::internal("registre des actions verrouillé"))?;
            let entry = running
                .get(project_id)
                .ok_or_else(|| AppError::not_found("Aucune action en cours sur ce projet."))?;
            entry.cancelled.store(true, Ordering::SeqCst);
            entry.pid
        };
        if let Some(pid) = pid {
            kill_tree(pid);
        }
        Ok(())
    }
}

/// Action préparée : commande vérifiée, projet réservé.
pub struct PreparedJob {
    pub project_id: String,
    pub job_id: String,
    pub root: PathBuf,
    pub action: GameAction,
    pub platform: Option<GamePlatform>,
    pub development: bool,
    pub spec: CommandSpec,
    pub started_at: String,
    pub cancelled: Arc<AtomicBool>,
}

/// Ce que l'exécution a donné.
pub struct RunOutcome {
    pub exit_code: Option<i32>,
    pub log: Vec<String>,
    pub timed_out: bool,
    pub cancelled: bool,
    /// Le programme n'a pas pu être lancé.
    pub start_error: Option<String>,
    pub duration: Duration,
}

/// Ligne de commande lisible (journal, interface) : guillemets autour des espaces.
pub fn command_line(spec: &CommandSpec) -> String {
    std::iter::once(spec.program.display().to_string())
        .chain(spec.args.iter().cloned())
        .map(|part| {
            if part.contains(' ') {
                format!("\"{part}\"")
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Lance un programme graphique sans l'attendre (éditeur du moteur).
pub fn spawn_detached(spec: &CommandSpec) -> AppResult<()> {
    let mut command = crate::core::process::command(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.spawn().map(|_| ()).map_err(|e| {
        AppError::internal(format!(
            "{} n'a pas pu être lancé : {e}",
            spec.program.display()
        ))
    })
}

/// Exécute l'action préparée ; chaque ligne lue est transmise à `emit` puis gardée.
pub async fn run(
    jobs: &Jobs,
    job: &PreparedJob,
    redact: impl Fn(&str) -> String + Send + Sync,
    emit: &(impl Fn(GameJobEvent) + Send + Sync),
) -> RunOutcome {
    let started = Instant::now();
    let mut outcome = RunOutcome {
        exit_code: None,
        log: Vec::new(),
        timed_out: false,
        cancelled: false,
        start_error: None,
        duration: Duration::ZERO,
    };
    let spec = &job.spec;

    let mut command = crate::core::process::async_command(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Groupe à part : l'arrêt atteint aussi les programmes lancés par l'outil.
    #[cfg(unix)]
    command.process_group(0);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            outcome.start_error = Some(format!(
                "{} n'a pas pu être lancé : {e}",
                spec.program.display()
            ));
            outcome.duration = started.elapsed();
            return outcome;
        }
    };
    let pid = child.id();
    jobs.set_pid(&job.project_id, &job.job_id, pid);
    if job.cancelled.load(Ordering::SeqCst) {
        if let Some(pid) = pid {
            kill_tree(pid);
        }
    }

    let (tx, mut rx) = mpsc::channel::<(GameLogStream, String)>(1024);
    if let Some(stdout) = child.stdout.take() {
        pump(stdout, GameLogStream::Stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        pump(stderr, GameLogStream::Stderr, tx.clone());
    }
    drop(tx);

    let deadline = spec.timeout.map(|t| started + t);
    let mut last_output = Instant::now();
    let mut last_quiet = Instant::now();
    let mut status = None;

    let take =
        |stream: GameLogStream, text: String, log: &mut Vec<String>, last_output: &mut Instant| {
            let text = redact(&text);
            emit(GameJobEvent::Line {
                stream,
                level: super::diagnostics::line_level(&text),
                text: text.clone(),
            });
            if log.len() < MAX_LOG_LINES {
                log.push(text);
            }
            *last_output = Instant::now();
        };

    loop {
        tokio::select! {
            line = rx.recv() => match line {
                Some((stream, text)) => take(stream, text, &mut outcome.log, &mut last_output),
                None => break,
            },
            exited = child.wait(), if status.is_none() => {
                status = Some(exited);
                // Des programmes lancés par l'outil peuvent garder la sortie ouverte : on lit
                // ce qui reste un court instant, sans les attendre.
                let until = tokio::time::Instant::now() + Duration::from_secs(2);
                while let Ok(Some((stream, text))) = tokio::time::timeout_at(until, rx.recv()).await {
                    take(stream, text, &mut outcome.log, &mut last_output);
                }
                break;
            }
            _ = tokio::time::sleep(TICK) => {
                if deadline.is_some_and(|d| Instant::now() >= d) && !outcome.timed_out {
                    outcome.timed_out = true;
                    if let Some(pid) = pid {
                        kill_tree(pid);
                    }
                }
                let silent = last_output.elapsed();
                if spec.timeout.is_some() && silent >= QUIET_AFTER && last_quiet.elapsed() >= Duration::from_secs(60) {
                    last_quiet = Instant::now();
                    emit(GameJobEvent::Quiet { seconds: silent.as_secs() });
                }
            }
        }
    }
    let status = match status {
        Some(status) => status,
        None => child.wait().await,
    };
    outcome.exit_code = status.ok().and_then(|s| s.code());
    outcome.cancelled = job.cancelled.load(Ordering::SeqCst);
    outcome.duration = started.elapsed();
    outcome
}

fn pump<R: AsyncRead + Unpin + Send + 'static>(
    reader: R,
    stream: GameLogStream,
    tx: mpsc::Sender<(GameLogStream, String)>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
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

/// Arrête un processus et ceux qu'il a lancés.
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    let result = crate::core::process::command("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    #[cfg(not(windows))]
    let result = crate::core::process::command("kill")
        .args(["-s", "TERM", "--", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if let Err(error) = result {
        tracing::warn!("arrêt du processus {pid} impossible : {error}");
    }
}

/// Le build attendu existe et a été écrit pendant l'action.
pub fn output_written(output: &Path, since: std::time::SystemTime) -> bool {
    let modified = |p: &Path| p.metadata().and_then(|m| m.modified()).ok();
    if output.is_file() {
        return modified(output).is_some_and(|m| m >= since);
    }
    if output.is_dir() {
        // Dossier d'archive (Unreal) ou paquet (.app) : un fichier récent suffit.
        return walk_recent(output, since, 4);
    }
    false
}

fn walk_recent(dir: &Path, since: std::time::SystemTime, depth: u32) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path
                .metadata()
                .and_then(|m| m.modified())
                .is_ok_and(|m| m >= since)
            {
                return true;
            }
        } else if depth > 0 && path.is_dir() && walk_recent(&path, since, depth - 1) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(spec: CommandSpec, jobs: &Jobs) -> PreparedJob {
        let running = GameRunningJob {
            job_id: "j1".into(),
            action: GameAction::Check,
            started_at: String::new(),
            command: command_line(&spec),
        };
        let cancelled = jobs.claim("p", running).unwrap();
        PreparedJob {
            project_id: "p".into(),
            job_id: "j1".into(),
            root: std::env::temp_dir(),
            action: GameAction::Check,
            platform: None,
            development: false,
            spec,
            started_at: String::new(),
            cancelled,
        }
    }

    fn sh(script: &str, timeout: Option<u64>) -> CommandSpec {
        CommandSpec {
            program: PathBuf::from(if cfg!(windows) { "cmd" } else { "sh" }),
            args: if cfg!(windows) {
                vec!["/C".into(), script.into()]
            } else {
                vec!["-c".into(), script.into()]
            },
            cwd: std::env::temp_dir(),
            timeout: timeout.map(Duration::from_secs),
            ..CommandSpec::default()
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn streams_lines_and_exit_code() {
        let jobs = Jobs::default();
        let j = job(
            sh("echo un; echo 'SCRIPT ERROR: deux' 1>&2; exit 3", None),
            &jobs,
        );
        let seen = Mutex::new(Vec::new());
        let out = run(&jobs, &j, |t| t.replace("un", "UN"), &|e| {
            if let GameJobEvent::Line { level, text, .. } = e {
                seen.lock().unwrap().push((level, text));
            }
        })
        .await;
        assert_eq!(out.exit_code, Some(3));
        assert_eq!(out.log.len(), 2);
        assert!(
            out.log.contains(&"UN".to_string()),
            "sortie passée par le masquage"
        );
        assert!(seen
            .lock()
            .unwrap()
            .iter()
            .any(|(l, t)| *l == GameLogLevel::Error && t.contains("deux")));
        // Une seule action à la fois.
        assert!(jobs
            .claim(
                "p",
                GameRunningJob {
                    job_id: "j2".into(),
                    action: GameAction::Test,
                    started_at: String::new(),
                    command: String::new()
                }
            )
            .is_err());
        jobs.release("p", "j1");
        assert!(jobs.current("p").is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancel_stops_the_whole_tree() {
        let jobs = Arc::new(Jobs::default());
        let j = job(sh("sleep 30 & sleep 30; echo fin", None), &jobs);
        let stopper = jobs.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            stopper.cancel("p").unwrap();
        });
        let started = Instant::now();
        let out = run(&jobs, &j, |t| t.to_string(), &|_| {}).await;
        assert!(out.cancelled);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(!out.log.iter().any(|l| l == "fin"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_kills() {
        let jobs = Jobs::default();
        let j = job(sh("sleep 30", Some(1)), &jobs);
        let out = run(&jobs, &j, |t| t.to_string(), &|_| {}).await;
        assert!(out.timed_out);
        assert!(out.duration < Duration::from_secs(15));
    }

    #[tokio::test]
    async fn missing_program_is_reported() {
        let jobs = Jobs::default();
        let mut spec = sh("", None);
        spec.program = PathBuf::from("/nulle/part/godot-absent");
        let j = job(spec, &jobs);
        let out = run(&jobs, &j, |t| t.to_string(), &|_| {}).await;
        assert!(out.start_error.is_some());
    }

    #[test]
    fn readable_command_line() {
        let spec = CommandSpec {
            program: PathBuf::from("C:/Program Files/Godot/godot.exe"),
            args: vec!["--path".into(), "C:/Jeux/Mon jeu".into()],
            ..CommandSpec::default()
        };
        assert_eq!(
            command_line(&spec),
            "\"C:/Program Files/Godot/godot.exe\" --path \"C:/Jeux/Mon jeu\""
        );
    }
}
