//! Terminal intégré du module Code : un shell dans un pseudo-terminal (ConPTY sous Windows),
//! ouvert dans le dossier du projet.
//!
//! ```text
//! shell ─► thread lecteur ─► UTF-8 ─► Channel (TerminalEvent::Output) ─► xterm.js
//! frappe ─► commande terminal_write ─► thread écrivain ─► shell
//! fin du shell ─► thread d'attente ─► TerminalEvent::Exit
//! ```
//! Ce qui s'exécute ici est tapé par la personne, comme dans PowerShell : aucune IA ni aucun
//! autre module n'écrit dans ce terminal (ADR 0011). Aucune I/O bloquante sur le runtime async
//! (guidelines.md §10) : lecture, écriture et attente ont chacune leur thread.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};

use crate::core::{AppError, AppResult};

/// Ce que le terminal envoie à l'interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output { data: String },
    Exit { code: Option<i32> },
}

/// Destination des événements : le `Channel` Tauri, ou un canal en test. `false` : plus
/// personne n'écoute.
pub trait TerminalSink: Send + Sync + 'static {
    fn emit(&self, event: TerminalEvent) -> bool;
}

impl TerminalSink for tauri::ipc::Channel<TerminalEvent> {
    fn emit(&self, event: TerminalEvent) -> bool {
        self.send(event).is_ok()
    }
}

impl TerminalSink for std::sync::mpsc::Sender<TerminalEvent> {
    fn emit(&self, event: TerminalEvent) -> bool {
        self.send(event).is_ok()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    /// Nom du shell lancé (« PowerShell 7 », « Windows PowerShell »…).
    pub shell: String,
    pub cwd: String,
}

struct Session {
    writer: std::sync::mpsc::Sender<Vec<u8>>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    exited: Arc<AtomicBool>,
}

impl Drop for Session {
    fn drop(&mut self) {
        // Le shell et ce qu'il a lancé (serveur de dev…) s'arrêtent avec le terminal. Pas
        // d'arrêt par PID une fois le shell terminé : le numéro a pu être réattribué.
        if self.exited.load(Ordering::SeqCst) {
            return;
        }
        kill_tree(self.pid);
        let _ = self.killer.kill();
    }
}

/// Terminaux ouverts, par identifiant.
#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<String, Session>>,
    next: AtomicU64,
}

impl Terminals {
    pub fn open<S: TerminalSink>(&self, cwd: &Path, cols: u16, rows: u16, sink: S) -> AppResult<TerminalInfo> {
        if !cwd.is_dir() {
            return Err(AppError::not_found(format!("Dossier introuvable : {}", cwd.display())));
        }
        let shell = default_shell();
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|e| AppError::internal(format!("ouverture du terminal : {e}")))?;

        let mut command = CommandBuilder::new(&shell.program);
        command.args(&shell.args);
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| AppError::internal(format!("lancement de {} : {e}", shell.label)))?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::internal(format!("lecture du terminal : {e}")))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::internal(format!("écriture du terminal : {e}")))?;
        let killer = child.clone_killer();
        let pid = child.process_id();
        let exited = Arc::new(AtomicBool::new(false));
        let sink = Arc::new(sink);

        // Sortie du shell → interface, en UTF-8 (un caractère peut être coupé entre deux lectures).
        let output = Arc::clone(&sink);
        std::thread::spawn(move || {
            let mut decoder = Utf8Stream::default();
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        let data = decoder.push(&buffer[..read]);
                        if !data.is_empty() && !output.emit(TerminalEvent::Output { data }) {
                            break;
                        }
                    }
                }
            }
        });

        // Frappe → shell.
        let (keys_tx, keys_rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            while let Ok(keys) = keys_rx.recv() {
                if writer.write_all(&keys).and_then(|_| writer.flush()).is_err() {
                    break;
                }
            }
        });

        // Fin du shell (commande `exit`, fermeture de la fenêtre…).
        let done = Arc::clone(&exited);
        std::thread::spawn(move || {
            let code = child.wait().ok().and_then(|status| i32::try_from(status.exit_code()).ok());
            done.store(true, Ordering::SeqCst);
            // La dernière sortie passe avant l'annonce de fin.
            std::thread::sleep(Duration::from_millis(60));
            sink.emit(TerminalEvent::Exit { code });
        });

        let id = format!("term-{}", self.next.fetch_add(1, Ordering::SeqCst) + 1);
        let session = Session {
            writer: keys_tx,
            master: pair.master,
            killer,
            pid,
            exited,
        };
        self.lock()?.insert(id.clone(), session);
        tracing::info!(terminal = %id, shell = %shell.label, "terminal ouvert");
        Ok(TerminalInfo {
            id,
            shell: shell.label,
            cwd: cwd.display().to_string(),
        })
    }

    pub fn write(&self, id: &str, data: &str) -> AppResult<()> {
        let sessions = self.lock()?;
        let session = sessions.get(id).ok_or_else(|| AppError::not_found("Ce terminal est fermé."))?;
        session
            .writer
            .send(data.as_bytes().to_vec())
            .map_err(|_| AppError::invalid("Le shell de ce terminal est arrêté."))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let sessions = self.lock()?;
        let session = sessions.get(id).ok_or_else(|| AppError::not_found("Ce terminal est fermé."))?;
        session
            .master
            .resize(size(cols, rows))
            .map_err(|e| AppError::internal(format!("redimensionnement du terminal : {e}")))
    }

    /// Ferme le terminal et arrête ce qui y tourne encore.
    pub fn close(&self, id: &str) -> AppResult<()> {
        let session = self.lock()?.remove(id);
        drop(session);
        Ok(())
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, Session>>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::internal("état des terminaux indisponible"))
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 500),
        cols: cols.clamp(10, 1000),
        pixel_width: 0,
        pixel_height: 0,
    }
}

struct Shell {
    program: PathBuf,
    args: Vec<String>,
    label: String,
}

/// PowerShell 7 s'il est installé, sinon Windows PowerShell (toujours présent), sinon cmd.
#[cfg(windows)]
fn default_shell() -> Shell {
    let candidates = [
        ("pwsh.exe", "PowerShell 7", vec!["-NoLogo".to_string()]),
        ("powershell.exe", "Windows PowerShell", vec!["-NoLogo".to_string()]),
    ];
    for (name, label, args) in candidates {
        if let Ok(program) = which::which(name) {
            return Shell { program, args, label: label.into() };
        }
    }
    Shell {
        program: PathBuf::from("cmd.exe"),
        args: Vec::new(),
        label: "Invite de commandes".into(),
    }
}

/// Hors Windows (développement) : le shell de la session.
#[cfg(not(windows))]
fn default_shell() -> Shell {
    let program = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from("/bin/sh"));
    let label = program
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "sh".into());
    Shell {
        program,
        args: Vec::new(),
        label,
    }
}

/// Arrête le shell et ses descendants.
fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        let _ = crate::core::process::command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = crate::core::process::command("kill").arg(pid.to_string()).output();
    }
}

/// Décodage UTF-8 d'un flux découpé : la fin incomplète d'un morceau attend le suivant, un
/// octet invalide devient `�`.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    out.push_str(text);
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match error.error_len() {
                        Some(invalid) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + invalid);
                        }
                        None => {
                            self.pending.drain(..valid);
                            break;
                        }
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_stream_keeps_split_characters_whole() {
        let mut stream = Utf8Stream::default();
        let bytes = "é€😀".as_bytes();
        let mut out = String::new();
        for byte in bytes {
            out.push_str(&stream.push(std::slice::from_ref(byte)));
        }
        assert_eq!(out, "é€😀");
        assert_eq!(stream.push(&[b'a', 0xFF, b'b']), "a\u{FFFD}b");
    }

    #[test]
    fn size_is_clamped() {
        let small = size(0, 0);
        assert_eq!((small.cols, small.rows), (10, 2));
        let big = size(u16::MAX, u16::MAX);
        assert_eq!((big.cols, big.rows), (1000, 500));
    }

    #[cfg(unix)]
    #[test]
    fn runs_a_shell_in_the_project_folder() {
        let dir = std::env::temp_dir().join(format!("archimed-term-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let terminals = Terminals::default();
        let (tx, rx) = std::sync::mpsc::channel();
        let info = terminals.open(&dir, 80, 24, tx).unwrap();
        terminals.write(&info.id, "echo archimed-$((40+2)); pwd; exit 3\n").unwrap();

        let mut output = String::new();
        let mut code = None;
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(TerminalEvent::Output { data }) => output.push_str(&data),
                Ok(TerminalEvent::Exit { code: exit }) => {
                    code = exit;
                    break;
                }
                Err(_) => {}
            }
        }
        assert!(output.contains("archimed-42"), "{output}");
        assert!(output.contains(dir.file_name().unwrap().to_str().unwrap()), "{output}");
        assert_eq!(code, Some(3));
        terminals.close(&info.id).unwrap();
        assert!(terminals.write(&info.id, "x").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
