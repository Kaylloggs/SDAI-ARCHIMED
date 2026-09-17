use tauri::ipc::Channel;
use tauri::State;

use crate::core::config::ConfigStore;
use crate::core::{AppError, AppResult};

use super::adapters::{self, CliAdapter};
use super::event::{AdapterInfo, AutoMode, EngineEvent, PromptAnswer, SessionId};
use super::manager::SessionManager;
use super::session::{self, SessionCommand};

fn find_adapter(id: &str) -> AppResult<Box<dyn CliAdapter>> {
    adapters::build_all()
        .into_iter()
        .find(|adapter| adapter.id() == id)
        .ok_or_else(|| AppError::not_found(format!("adaptateur {id} inconnu")))
}

/// Résultat de la dernière détection des CLI : chaque sondage lance plusieurs processus
/// (`--version`, `agy models` qui interroge le réseau…). On ne le refait pas à chaque écran.
static ADAPTER_CACHE: std::sync::Mutex<Option<(std::time::Instant, Vec<AdapterInfo>)>> =
    std::sync::Mutex::new(None);
const ADAPTER_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(600);

fn invalidate_adapter_cache() {
    if let Ok(mut cache) = ADAPTER_CACHE.lock() {
        *cache = None;
    }
}

#[tauri::command]
pub async fn engine_list_adapters(
    config: State<'_, ConfigStore>,
    force: Option<bool>,
) -> AppResult<Vec<AdapterInfo>> {
    if !force.unwrap_or(false) {
        if let Ok(cache) = ADAPTER_CACHE.lock() {
            if let Some((at, adapters)) = cache.as_ref() {
                if at.elapsed() < ADAPTER_CACHE_TTL {
                    return Ok(adapters.clone());
                }
            }
        }
    }

    let overrides = config.snapshot().await.binary_overrides;
    // Sondage du système (which, --version, models) : hors du thread async.
    let adapters: Vec<AdapterInfo> = tokio::task::spawn_blocking(move || {
        adapters::build_all()
            .iter()
            .map(|adapter| adapters::describe(adapter.as_ref(), &overrides))
            .collect()
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?;

    if let Ok(mut cache) = ADAPTER_CACHE.lock() {
        *cache = Some((std::time::Instant::now(), adapters.clone()));
    }
    Ok(adapters)
}

/// Force le chemin d'une CLI installée hors PATH (`null` efface le réglage).
#[tauri::command]
pub async fn engine_set_binary_override(
    config: State<'_, ConfigStore>,
    adapter: String,
    path: Option<String>,
) -> AppResult<()> {
    find_adapter(&adapter)?;
    invalidate_adapter_cache();
    config.set_binary_override(&adapter, path).await
}

// Paramètres plats : c'est le contrat IPC lu par le frontend (`engine.api.ts`).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn engine_start_session(
    manager: State<'_, SessionManager>,
    config: State<'_, ConfigStore>,
    adapter: String,
    model: Option<String>,
    cwd: Option<String>,
    auto_mode: AutoMode,
    resume: Option<String>,
    tuning: Option<crate::engine::event::EngineTuning>,
    on_event: Channel<EngineEvent>,
) -> AppResult<SessionId> {
    let adapter = find_adapter(&adapter)?;
    let overrides = config.snapshot().await.binary_overrides;
    let id = uuid::Uuid::new_v4().to_string();
    let handle = session::spawn(
        session::SpawnRequest {
            id: id.clone(),
            adapter,
            model,
            cwd,
            auto_mode,
            resume,
            tuning: tuning.unwrap_or_default(),
        },
        on_event,
        &overrides,
    )?;
    manager.insert(handle).await;
    Ok(id)
}

#[tauri::command]
pub async fn engine_send_message(
    manager: State<'_, SessionManager>,
    session_id: String,
    text: String,
) -> AppResult<()> {
    if text.trim().is_empty() {
        return Err(AppError::invalid("message vide"));
    }
    manager.send(&session_id, SessionCommand::Send(text)).await
}

#[tauri::command]
pub async fn engine_answer_prompt(
    manager: State<'_, SessionManager>,
    session_id: String,
    prompt_id: String,
    answer: PromptAnswer,
) -> AppResult<()> {
    manager
        .send(&session_id, SessionCommand::Answer { prompt_id, answer })
        .await
}

#[tauri::command]
pub async fn engine_set_auto_mode(
    manager: State<'_, SessionManager>,
    session_id: String,
    mode: AutoMode,
) -> AppResult<()> {
    manager
        .send(&session_id, SessionCommand::SetAutoMode(mode))
        .await
}

#[tauri::command]
pub async fn engine_stop_session(
    manager: State<'_, SessionManager>,
    session_id: String,
) -> AppResult<()> {
    let result = manager.send(&session_id, SessionCommand::Stop).await;
    manager.remove(&session_id).await;
    result
}

fn conversations_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<std::path::PathBuf> {
    let paths = crate::core::paths::Paths::resolve(app)?;
    std::fs::create_dir_all(paths.sessions())?;
    Ok(paths.sessions().join("conversations.json"))
}

/// Conversations persistées (état zustand sérialisé, opaque pour le backend).
/// `None` si rien n'a encore été enregistré sur disque.
#[tauri::command]
pub async fn engine_load_conversations<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> AppResult<Option<String>> {
    let file = conversations_file(&app)?;
    tokio::task::spawn_blocking(move || match std::fs::read_to_string(&file) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

/// Écriture atomique (fichier temporaire puis renommage) : un arrêt brutal
/// ne corrompt jamais l'historique.
#[tauri::command]
pub async fn engine_save_conversations<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: String,
) -> AppResult<()> {
    serde_json::from_str::<serde_json::Value>(&state)
        .map_err(|e| AppError::invalid(format!("état de conversations invalide : {e}")))?;
    let file = conversations_file(&app)?;
    tokio::task::spawn_blocking(move || {
        let temp = file.with_extension("json.tmp");
        std::fs::write(&temp, state)?;
        std::fs::rename(&temp, &file)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

/// Ouvre le dossier des adaptateurs TOML (ajout d'une CLI sans code).
#[tauri::command]
pub async fn engine_open_adapters_dir<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = super::adapters::declarative::user_dir()
        .ok_or_else(|| AppError::internal("dossier des adaptateurs non initialisé"))?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| AppError::internal(e.to_string()))
}

#[tauri::command]
pub async fn engine_default_cwd() -> AppResult<String> {
    let dir = crate::core::paths::dirs_home()
        .ok_or_else(|| AppError::internal("dossier utilisateur introuvable"))?;
    Ok(dir.display().to_string())
}

/// Chemin cité par une IA, résolu sur le disque.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPath {
    pub path: String,
    pub is_dir: bool,
}

/// Résout les chemins cités dans une réponse : absolus tels quels, relatifs d'abord
/// dans les dossiers cités par le même message (`hints`), puis dans le dossier de travail.
/// `None` si rien n'existe : le texte reste affiché sans lien.
#[tauri::command]
pub async fn engine_resolve_paths(
    candidates: Vec<String>,
    cwd: Option<String>,
    hints: Vec<String>,
) -> AppResult<Vec<Option<ResolvedPath>>> {
    tauri::async_runtime::spawn_blocking(move || {
        let bases = path_bases(&hints, cwd.as_deref());
        candidates
            .iter()
            .map(|candidate| resolve_path(candidate, &bases))
            .collect()
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))
}

fn path_bases(hints: &[String], cwd: Option<&str>) -> Vec<std::path::PathBuf> {
    let mut bases: Vec<std::path::PathBuf> = Vec::new();
    for hint in hints {
        let path = expand_home(hint);
        let dir = if path.is_dir() {
            Some(path)
        } else if path.is_file() {
            path.parent().map(std::path::Path::to_path_buf)
        } else {
            None
        };
        if let Some(dir) = dir.filter(|d| d.is_absolute() && !bases.contains(d)) {
            bases.push(dir);
        }
    }
    if let Some(cwd) = cwd.map(std::path::PathBuf::from) {
        if !bases.contains(&cwd) {
            bases.push(cwd);
        }
    }
    bases
}

fn expand_home(text: &str) -> std::path::PathBuf {
    match text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        Some(rest) => crate::core::paths::dirs_home()
            .map(|home| home.join(rest))
            .unwrap_or_else(|| std::path::PathBuf::from(text)),
        None => std::path::PathBuf::from(text),
    }
}

fn resolve_path(candidate: &str, bases: &[std::path::PathBuf]) -> Option<ResolvedPath> {
    let trimmed = candidate.trim().trim_matches(|c| c == '"' || c == '\'');
    if trimmed.is_empty() || trimmed.contains("://") || trimmed.len() > 1024 {
        return None;
    }
    let path = expand_home(trimmed);
    let found = if path.is_absolute() {
        path.exists().then_some(path)
    } else {
        bases.iter().map(|base| base.join(&path)).find(|p| p.exists())
    }?;
    let found = std::fs::canonicalize(&found)
        .map(|p| strip_verbatim(&p))
        .unwrap_or(found);
    Some(ResolvedPath {
        is_dir: found.is_dir(),
        path: found.display().to_string(),
    })
}

/// `\\?\C:\…` (forme canonique Windows) → `C:\…`.
fn strip_verbatim(path: &std::path::Path) -> std::path::PathBuf {
    let text = path.display().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => std::path::PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// Ouvre un fichier ou dossier avec l'application par défaut du système.
#[tauri::command]
pub async fn engine_open_path<R: tauri::Runtime>(app: tauri::AppHandle<R>, path: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if !std::path::Path::new(&path).exists() {
        return Err(AppError::not_found(format!("{path} introuvable")));
    }
    // Un lien cité par une IA ne doit jamais lancer un programme d'un clic.
    if is_executable(&path) {
        return Err(AppError::invalid(format!(
            "{path} est un programme : ouverture directe refusée, utilisez « Afficher dans l'Explorateur »"
        )));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| AppError::internal(e.to_string()))
}

const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp",
    "scr", "pif", "lnk", "url", "hta", "cpl", "jar", "reg", "appref-ms", "application", "gadget",
];

fn is_executable(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| EXECUTABLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// Affiche un fichier sélectionné dans l'Explorateur.
#[tauri::command]
pub async fn engine_reveal_path<R: tauri::Runtime>(app: tauri::AppHandle<R>, path: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if !std::path::Path::new(&path).exists() {
        return Err(AppError::not_found(format!("{path} introuvable")));
    }
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| AppError::internal(e.to_string()))
}

/// Ports locaux qui acceptent une connexion (serveurs de test lancés par un agent).
/// Chaque port est sondé en IPv4 puis IPv6, 300 ms max, en parallèle.
#[tauri::command]
pub async fn engine_probe_ports(ports: Vec<u16>) -> AppResult<Vec<u16>> {
    use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
    use std::time::Duration;

    async fn listening(port: u16) -> bool {
        for address in [
            SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
        ] {
            let attempt = tokio::time::timeout(Duration::from_millis(300), tokio::net::TcpStream::connect(address));
            if matches!(attempt.await, Ok(Ok(_))) {
                return true;
            }
        }
        false
    }

    let mut unique = ports;
    unique.sort_unstable();
    unique.dedup();
    unique.truncate(64);
    let checks = unique.into_iter().map(|port| async move { listening(port).await.then_some(port) });
    Ok(futures_join_all(checks).await.into_iter().flatten().collect())
}

/// `join_all` minimal (évite une dépendance) : lance toutes les sondes puis attend chacune.
async fn futures_join_all<F>(futures: impl IntoIterator<Item = F>) -> Vec<F::Output>
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    let handles: Vec<_> = futures.into_iter().map(tokio::spawn).collect();
    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(output) = handle.await {
            results.push(output);
        }
    }
    results
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn resolves_relative_names_against_cited_folders_then_cwd() {
        let root = std::env::temp_dir().join(format!("archimed-paths-{}", uuid::Uuid::new_v4()));
        let cited = root.join("scratch");
        std::fs::create_dir_all(&cited).unwrap();
        std::fs::write(cited.join("popup.bat"), "@echo off").unwrap();
        std::fs::write(root.join("main.rs"), "fn main() {}").unwrap();

        let bases = path_bases(&[cited.display().to_string()], Some(&root.display().to_string()));
        let bat = resolve_path("popup.bat", &bases).unwrap();
        assert!(bat.path.ends_with("popup.bat") && !bat.is_dir);
        assert!(!bat.path.starts_with(r"\\?\"));
        assert!(resolve_path("main.rs", &bases).is_some());
        assert!(resolve_path(&cited.display().to_string(), &bases).unwrap().is_dir);
        assert!(resolve_path("absent.txt", &bases).is_none());
        assert!(resolve_path("https://example.com/a.txt", &bases).is_none());
        assert!(is_executable("C:/x/popup.BAT") && !is_executable("C:/x/notes.md"));

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn probes_only_listening_ports() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let open = listener.local_addr().unwrap().port();
        let closed = {
            let temp = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            temp.local_addr().unwrap().port()
        };
        let live = engine_probe_ports(vec![open, closed, open]).await.unwrap();
        assert_eq!(live, vec![open]);
    }
}
