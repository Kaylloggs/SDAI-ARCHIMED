//! Moteurs vocaux locaux, gardés chargés entre deux phrases pour répondre vite :
//! - reconnaissance : serveur `whisper-server` (whisper.cpp) sur 127.0.0.1, modèle en mémoire ;
//! - synthèse : processus Piper nourri ligne par ligne (`--json-input`), une voix à la fois.
//!
//! Priorité basse possible (gestion des ressources) : le moteur cède alors le processeur aux
//! autres programmes (jeu, compilation). Aucune donnée ne sort de la machine.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::cloud::Multipart;

/// Priorité des moteurs locaux (réglage « Performance »).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    #[default]
    Normal,
    High,
}

/// Commande de lancement d'un moteur, sans console et à la priorité voulue.
fn engine_command(exe: &Path, priority: Priority) -> tokio::process::Command {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        const ABOVE_NORMAL_PRIORITY_CLASS: u32 = 0x0000_8000;
        let mut command = tokio::process::Command::new(exe);
        let class = match priority {
            Priority::Low => BELOW_NORMAL_PRIORITY_CLASS,
            Priority::Normal => 0,
            Priority::High => ABOVE_NORMAL_PRIORITY_CLASS,
        };
        command.creation_flags(CREATE_NO_WINDOW | class);
        command
    }
    #[cfg(not(windows))]
    {
        let mut command = if priority == Priority::Low && which::which("nice").is_ok() {
            let mut nice = crate::core::process::async_command("nice");
            nice.args(["-n", "10"]).arg(exe);
            nice
        } else {
            crate::core::process::async_command(exe)
        };
        // Bibliothèques livrées à côté de l'exécutable (whisper.cpp, Piper).
        if let Some(dir) = exe.parent() {
            command.env("LD_LIBRARY_PATH", dir);
            command.env("DYLD_LIBRARY_PATH", dir);
        }
        command
    }
}

fn free_port() -> AppResult<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
    Ok(listener.local_addr().map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?.port())
}

// ── Reconnaissance : whisper-server ──────────────────────────────────────────────────

struct WhisperProcess {
    child: Child,
    port: u16,
    model: PathBuf,
    language: String,
}

#[derive(Default)]
pub struct WhisperServer {
    inner: Mutex<Option<WhisperProcess>>,
}

/// Arguments de `whisper-server` (tests).
pub fn whisper_args(model: &Path, port: u16, language: &str, threads: u32) -> Vec<String> {
    vec![
        "-m".into(),
        model.display().to_string(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "-l".into(),
        if language.is_empty() { "auto".into() } else { language.to_string() },
        "-t".into(),
        threads.max(1).to_string(),
        "-nt".into(),
    ]
}

impl WhisperServer {
    /// Démarre le serveur (ou garde celui qui tourne avec le même modèle et la même langue).
    pub async fn ensure(
        &self,
        http: &reqwest::Client,
        exe: &Path,
        model: &Path,
        language: &str,
        threads: u32,
        priority: Priority,
    ) -> AppResult<u16> {
        let mut guard = self.inner.lock().await;
        if let Some(running) = guard.as_mut() {
            let alive = matches!(running.child.try_wait(), Ok(None));
            if alive && running.model == model && running.language == language {
                return Ok(running.port);
            }
            let _ = running.child.kill().await;
        }
        *guard = None;

        let port = free_port()?;
        let mut command = engine_command(exe, priority);
        command
            .args(whisper_args(model, port, language, threads))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(dir) = exe.parent() {
            command.current_dir(dir);
        }
        let mut child = command
            .spawn()
            .map_err(|e| AppError::new(AppErrorCode::ProcessCrashed, format!("whisper.cpp ne démarre pas : {e}")))?;

        // Le modèle se charge en mémoire : quelques secondes pour les gros.
        let started = Instant::now();
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                return Err(AppError::new(
                    AppErrorCode::ProcessCrashed,
                    format!("whisper.cpp s'est arrêté au démarrage ({status}) : modèle abîmé ? Vérifiez-le dans Voice › Modèles locaux."),
                ));
            }
            let ready = http
                .get(format!("http://127.0.0.1:{port}/"))
                .timeout(Duration::from_millis(500))
                .send()
                .await
                .is_ok();
            if ready {
                break;
            }
            if started.elapsed() > Duration::from_secs(90) {
                let _ = child.kill().await;
                return Err(AppError::new(AppErrorCode::ProcessCrashed, "whisper.cpp ne répond pas après 90 s."));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        *guard = Some(WhisperProcess { child, port, model: model.to_path_buf(), language: language.to_string() });
        Ok(port)
    }

    pub async fn transcribe(&self, http: &reqwest::Client, port: u16, wav: Vec<u8>, language: &str) -> AppResult<String> {
        let mut form = Multipart::new();
        form.file("file", "audio.wav", "audio/wav", &wav);
        form.text("response_format", "json");
        form.text("temperature", "0.0");
        if !language.is_empty() && language != "auto" {
            form.text("language", language);
        }
        let (content_type, body) = form.finish();
        let response = http
            .post(format!("http://127.0.0.1:{port}/inference"))
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(body)
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| AppError::new(AppErrorCode::ProcessCrashed, format!("whisper.cpp ne répond pas ({e}).")))?;
        let value: serde_json::Value = super::cloud::read_json(response)
            .await
            .map_err(|e| AppError::new(AppErrorCode::ProcessCrashed, format!("Réponse de whisper.cpp illisible ({e}).")))?;
        if let Some(error) = value["error"].as_str() {
            return Err(AppError::new(AppErrorCode::ProcessCrashed, format!("whisper.cpp : {error}")));
        }
        Ok(clean_transcript(value["text"].as_str().unwrap_or("")))
    }

    pub async fn stop(&self) {
        if let Some(mut running) = self.inner.lock().await.take() {
            let _ = running.child.kill().await;
        }
    }
}

/// Retire les marques que Whisper ajoute au silence (« [BLANK_AUDIO] », « (musique) »…).
pub fn clean_transcript(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0i32;
    for c in text.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ── Synthèse : Piper ─────────────────────────────────────────────────────────────────

struct PiperProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    key: (PathBuf, u32),
}

#[derive(Default)]
pub struct PiperEngine {
    inner: Mutex<Option<PiperProcess>>,
}

/// Arguments de Piper (tests). `length_scale` < 1 accélère, > 1 ralentit.
pub fn piper_args(model: &Path, length_scale: f32, out_dir: &Path) -> Vec<String> {
    vec![
        "-m".into(),
        model.display().to_string(),
        "--json-input".into(),
        "-q".into(),
        "--length_scale".into(),
        format!("{length_scale:.2}"),
        "--sentence_silence".into(),
        "0.15".into(),
        "--output_dir".into(),
        out_dir.display().to_string(),
    ]
}

/// Ligne JSON envoyée à Piper pour une phrase.
pub fn piper_line(text: &str, output: &Path, speaker: Option<u32>) -> String {
    let mut line = json!({ "text": text.replace(['\r', '\n'], " "), "output_file": output.display().to_string() });
    if let Some(speaker) = speaker {
        line["speaker_id"] = json!(speaker);
    }
    format!("{line}\n")
}

impl PiperEngine {
    #[allow(clippy::too_many_arguments)]
    pub async fn synthesize(
        &self,
        exe: &Path,
        model: &Path,
        speaker: Option<u32>,
        speed: f32,
        text: &str,
        tmp: &Path,
        priority: Priority,
    ) -> AppResult<Vec<u8>> {
        // Vitesse 1,5 → phonèmes 1,5 fois plus courts.
        let length_scale = (1.0 / speed.clamp(0.5, 2.0)).clamp(0.5, 2.0);
        let key = (model.to_path_buf(), (length_scale * 100.0).round() as u32);
        let mut guard = self.inner.lock().await;
        let restart = match guard.as_mut() {
            Some(p) => p.key != key || !matches!(p.child.try_wait(), Ok(None)),
            None => true,
        };
        if restart {
            if let Some(mut old) = guard.take() {
                let _ = old.child.kill().await;
            }
            let mut command = engine_command(exe, priority);
            command
                .args(piper_args(model, length_scale, tmp))
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            if let Some(dir) = exe.parent() {
                command.current_dir(dir);
            }
            let mut child = command
                .spawn()
                .map_err(|e| AppError::new(AppErrorCode::ProcessCrashed, format!("Piper ne démarre pas : {e}")))?;
            let stdin = child.stdin.take().ok_or_else(|| AppError::internal("entrée de Piper indisponible"))?;
            let stdout = child.stdout.take().ok_or_else(|| AppError::internal("sortie de Piper indisponible"))?;
            *guard = Some(PiperProcess { child, stdin, stdout: BufReader::new(stdout).lines(), key });
        }
        let process = guard.as_mut().ok_or_else(|| AppError::internal("Piper indisponible"))?;
        let output = tmp.join(format!("piper-{}.wav", uuid::Uuid::new_v4()));
        let line = piper_line(text, &output, speaker);
        process
            .stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| AppError::new(AppErrorCode::ProcessCrashed, format!("Piper ne répond plus : {e}")))?;
        process.stdin.flush().await.map_err(|e| AppError::new(AppErrorCode::ProcessCrashed, e.to_string()))?;
        let answered = tokio::time::timeout(Duration::from_secs(60), process.stdout.next_line()).await;
        let path = match answered {
            Ok(Ok(Some(path))) => PathBuf::from(path.trim()),
            _ => {
                if let Some(mut dead) = guard.take() {
                    let _ = dead.child.kill().await;
                }
                return Err(AppError::new(AppErrorCode::ProcessCrashed, "Piper n'a pas produit de son : voix abîmée ou incompatible."));
            }
        };
        let path = if path.as_os_str().is_empty() { output } else { path };
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| AppError::new(AppErrorCode::Io, format!("Son de Piper illisible : {e}")))?;
        let _ = tokio::fs::remove_file(&path).await;
        Ok(bytes)
    }

    pub async fn stop(&self) {
        if let Some(mut process) = self.inner.lock().await.take() {
            let _ = process.child.kill().await;
        }
    }
}

/// Nombre de fils pour whisper.cpp : la moitié des cœurs, au moins 2, au plus 8.
pub fn whisper_threads(priority: Priority) -> u32 {
    let cores = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(4);
    let base = (cores / 2).clamp(2, 8);
    match priority {
        Priority::Low => (base / 2).max(1),
        Priority::Normal => base,
        Priority::High => (cores.saturating_sub(1)).clamp(2, 12),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_is_started_on_loopback_with_the_model() {
        let args = whisper_args(Path::new("/m/ggml-base.bin"), 5555, "fr", 4);
        assert_eq!(args[..2], ["-m", "/m/ggml-base.bin"]);
        assert!(args.windows(2).any(|w| w == ["--host", "127.0.0.1"]));
        assert!(args.windows(2).any(|w| w == ["-l", "fr"]));
        assert!(whisper_args(Path::new("m"), 1, "", 1).windows(2).any(|w| w == ["-l", "auto"]));
    }

    #[test]
    fn piper_lines_are_single_json_lines() {
        let line = piper_line("Bonjour\ntoi « là »", Path::new("/tmp/a.wav"), Some(1));
        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1);
        let value: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(value["text"], "Bonjour toi « là »");
        assert_eq!(value["speaker_id"], 1);
        let args = piper_args(Path::new("v.onnx"), 0.8, Path::new("/tmp"));
        assert!(args.windows(2).any(|w| w == ["--length_scale", "0.80"]));
    }

    #[test]
    fn whisper_markers_are_removed() {
        assert_eq!(clean_transcript(" [BLANK_AUDIO] "), "");
        assert_eq!(clean_transcript(" Ouvre le module code. (musique)"), "Ouvre le module code.");
    }

    #[test]
    fn thread_counts_stay_reasonable() {
        assert!(whisper_threads(Priority::Low) >= 1);
        assert!(whisper_threads(Priority::Normal) >= 2);
        assert!(whisper_threads(Priority::High) >= 2);
    }
}
