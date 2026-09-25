//! Ctrl+V dans les zones de saisie : fichiers copiés dans l'Explorateur (leurs vrais chemins)
//! et images copiées ailleurs (enregistrées ici, puis jointes par leur chemin).
//!
//! Le navigateur intégré ne donne jamais le chemin d'un fichier collé : sous Windows, on le lit
//! dans le presse-papiers (format CF_HDROP, celui de l'Explorateur). Une image sans fichier
//! (capture d'écran, image copiée d'un site) est écrite dans `<données>/pasted/`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine;
use tauri::{AppHandle, Runtime};

use super::error::{AppError, AppResult};
use super::paths::Paths;

/// Au-delà, le collage est refusé : un fichier aussi lourd se joint depuis l'Explorateur.
const MAX_PASTE_BYTES: usize = 50 * 1024 * 1024;
/// Les copies collées plus anciennes sont retirées du dossier `pasted/` (copies de l'application,
/// jamais les fichiers de la personne).
const KEEP_PASTED: Duration = Duration::from_secs(30 * 24 * 3600);

/// Chemins des fichiers copiés dans l'Explorateur (vide s'il n'y en a pas, ou hors Windows).
#[tauri::command]
pub fn clipboard_file_paths() -> Vec<String> {
    platform::file_paths()
}

/// Enregistre un fichier collé (données `base64` ou adresse `data:`) et renvoie son chemin.
#[tauri::command]
pub fn clipboard_save_file<R: Runtime>(app: AppHandle<R>, name: String, data: String) -> AppResult<String> {
    let dir = Paths::resolve(&app)?.data.join("pasted");
    save_pasted(&dir, &name, &data, SystemTime::now()).map(|p| p.to_string_lossy().into_owned())
}

fn save_pasted(dir: &Path, name: &str, data: &str, now: SystemTime) -> AppResult<PathBuf> {
    let (mime, encoded) = match data.strip_prefix("data:") {
        Some(rest) => {
            let (head, body) = rest
                .split_once(',')
                .ok_or_else(|| AppError::invalid("Données collées illisibles."))?;
            (head.split(';').next().unwrap_or_default().to_string(), body)
        }
        None => (String::new(), data),
    };
    if encoded.len() / 4 * 3 > MAX_PASTE_BYTES {
        return Err(too_big());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|_| AppError::invalid("Données collées illisibles."))?;
    if bytes.len() > MAX_PASTE_BYTES {
        return Err(too_big());
    }
    std::fs::create_dir_all(dir)?;
    prune(dir, now);
    let stamp = chrono::DateTime::<chrono::Local>::from(now).format("%Y%m%d-%H%M%S");
    let file = file_name(name, &mime);
    let mut target = dir.join(format!("{stamp}-{file}"));
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stamp}-{n}-{file}"));
        n += 1;
    }
    std::fs::write(&target, bytes)?;
    Ok(target)
}

fn too_big() -> AppError {
    AppError::invalid("Fichier collé trop lourd (50 Mo au plus) : joignez-le depuis l'Explorateur.")
}

/// Nom sûr pour Windows : sans dossier ni caractère interdit, avec une extension.
fn file_name(name: &str, mime: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let mut clean: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    clean = clean.trim().trim_matches('.').chars().take(80).collect();
    // « image.png » est le nom générique donné par le navigateur à une image copiée.
    if clean.is_empty() || clean.eq_ignore_ascii_case("image.png") {
        clean = "image-collee".into();
    }
    if Path::new(&clean).extension().is_none() {
        let ext = match mime {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            "image/bmp" => "bmp",
            "text/plain" => "txt",
            "application/pdf" => "pdf",
            _ if name.to_ascii_lowercase().ends_with(".png") => "png",
            _ => "bin",
        };
        clean = format!("{clean}.{ext}");
    }
    clean
}

/// Retire les copies collées de plus de 30 jours (les erreurs sont sans conséquence).
fn prune(dir: &Path, now: SystemTime) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| now.duration_since(at).ok())
            .is_some_and(|age| age > KEEP_PASTED);
        if old && entry.path().is_file() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(windows)]
mod platform {
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard};
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    /// Format standard de l'Explorateur pour une liste de fichiers.
    const CF_HDROP: u32 = 15;

    pub fn file_paths() -> Vec<String> {
        // SAFETY : le presse-papiers est ouvert puis refermé ici ; le handle reste valable tant
        // qu'il est ouvert, et DragQueryFileW écrit dans un tampon de la taille annoncée.
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP).is_err() {
                return Vec::new();
            }
            // Une autre application peut tenir le presse-papiers un court instant.
            let mut opened = false;
            for _ in 0..5 {
                if OpenClipboard(None).is_ok() {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            if !opened {
                return Vec::new();
            }
            let mut paths = Vec::new();
            if let Ok(handle) = GetClipboardData(CF_HDROP) {
                let drop = HDROP(handle.0);
                let count = DragQueryFileW(drop, u32::MAX, None);
                for index in 0..count {
                    let len = DragQueryFileW(drop, index, None) as usize;
                    let mut buffer = vec![0u16; len + 1];
                    let written = DragQueryFileW(drop, index, Some(&mut buffer)) as usize;
                    if written > 0 {
                        paths.push(String::from_utf16_lossy(&buffer[..written]));
                    }
                }
            }
            let _ = CloseClipboard();
            paths
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn file_paths() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_1PX: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    #[test]
    fn names_are_safe_and_have_an_extension() {
        assert_eq!(file_name("image.png", "image/png"), "image-collee.png");
        assert_eq!(file_name("", "image/jpeg"), "image-collee.jpg");
        assert_eq!(file_name("..\\..\\evil:name?.txt", ""), "evil_name_.txt");
        assert_eq!(file_name("capture", "image/webp"), "capture.webp");
        assert_eq!(file_name("notes", "application/x-unknown"), "notes.bin");
    }

    #[test]
    fn saves_data_urls_without_overwriting() {
        let dir = std::env::temp_dir().join(format!("archimed-paste-{}", uuid::Uuid::new_v4()));
        let now = SystemTime::now();
        let url = format!("data:image/png;base64,{PNG_1PX}");
        let first = save_pasted(&dir, "image.png", &url, now).unwrap();
        let second = save_pasted(&dir, "image.png", &url, now).unwrap();
        assert_ne!(first, second);
        assert!(first.starts_with(&dir));
        assert!(first.to_string_lossy().ends_with("image-collee.png"));
        assert!(std::fs::read(&first).unwrap().starts_with(b"\x89PNG"));
        assert!(save_pasted(&dir, "x.png", "data:image/png;base64,%%%", now).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prunes_old_copies_only() {
        let dir = std::env::temp_dir().join(format!("archimed-prune-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.png");
        std::fs::write(&old, b"x").unwrap();
        prune(&dir, SystemTime::now() + KEEP_PASTED + Duration::from_secs(60));
        assert!(!old.exists());
        let fresh = dir.join("fresh.png");
        std::fs::write(&fresh, b"x").unwrap();
        prune(&dir, SystemTime::now());
        assert!(fresh.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
