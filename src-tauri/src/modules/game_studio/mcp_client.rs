//! Serveurs MCP de la machine (§62 à §65) : ceux déjà configurés dans les outils de la personne
//! (Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, Antigravity, `.mcp.json` du projet)
//! et ceux ajoutés dans Game Studio. Un serveur n'est dit « prêt » qu'après un vrai échange
//! (`initialize` puis `tools/list`), lancé par la personne : rien n'est supposé.
//!
//! Les secrets restent où ils sont : les valeurs des variables d'environnement et des en-têtes
//! ne sont jamais renvoyées à l'interface ni recopiées ; les arguments et adresses qui en
//! contiennent sont masqués. Seuls les serveurs ajoutés ici (commande ou adresse, sans secret)
//! sont déclarés aux agents d'ARCHIMED (`<données>/mcp/game-studio.json`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use ts_rs::TS;

use crate::core::{AppError, AppResult};

use super::catalog::fold;
use super::store::write_atomic;

const PROTOCOL: &str = "2025-06-18";
/// Premier lancement d'un serveur `npx` : téléchargement du paquet compris.
const STDIO_TIMEOUT: Duration = Duration::from_secs(60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
/// Nom du fichier de déclaration lu par le moteur des agents (`core::mcp`).
const DECLARATION: &str = "game-studio.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameMcpSource {
    ClaudeCode,
    Project,
    ClaudeDesktop,
    Cursor,
    Codex,
    Gemini,
    Antigravity,
    GameStudio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameMcpTransport {
    Stdio,
    Http,
    /// Ancien transport HTTP+SSE.
    Sse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameMcpState {
    Ok,
    Error,
    Timeout,
    /// Programme introuvable sur la machine.
    Missing,
    /// Le serveur demande une authentification.
    AuthRequired,
    /// Transport que Game Studio ne sait pas tester.
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameMcpTool {
    pub name: String,
    pub description: Option<String>,
}

/// Résultat du dernier test d'un serveur.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameMcpHealth {
    pub state: GameMcpState,
    pub message: String,
    pub server: Option<String>,
    pub version: Option<String>,
    pub tools: Vec<GameMcpTool>,
    pub checked_at: String,
}

/// Serveur MCP connu, sans aucun secret.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameMcpServer {
    /// `source:nom`, stable.
    pub key: String,
    pub name: String,
    pub source: GameMcpSource,
    pub transport: GameMcpTransport,
    pub command: Option<String>,
    /// Arguments, secrets masqués.
    pub args: Vec<String>,
    /// Adresse, paramètres masqués.
    pub url: Option<String>,
    /// Noms des variables d'environnement et des en-têtes (jamais leurs valeurs).
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
    /// Outil piloté, deviné du nom et de la commande (`godot`, `unity`, `unreal`, `blender`).
    pub target: Option<String>,
    /// Fichier de configuration d'où il vient.
    pub origin: String,
    /// Agents qui le reçoivent.
    pub agents: Vec<String>,
    /// Ajouté dans Game Studio (on peut le retirer ici).
    pub removable: bool,
    pub health: Option<GameMcpHealth>,
}

/// Serveur ajouté dans Game Studio.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameMcpOwnServer {
    pub name: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
}

/// Serveur trouvé : sa fiche sans secret, et sa configuration brute (gardée en mémoire pour
/// le test, jamais renvoyée).
pub struct Entry {
    pub server: GameMcpServer,
    raw: Value,
}

/// Où chercher.
pub struct Locations {
    pub home: PathBuf,
    /// `%APPDATA%` (Windows).
    pub appdata: Option<PathBuf>,
    pub project: Option<PathBuf>,
    /// Serveurs ajoutés dans Game Studio.
    pub own: Vec<GameMcpOwnServer>,
    /// Noms inscrits par ARCHIMED lui-même (à ne pas présenter comme ceux de la personne).
    pub managed: Vec<String>,
}

impl Locations {
    pub fn system(project: Option<PathBuf>, own: Vec<GameMcpOwnServer>) -> Option<Self> {
        let home = crate::core::paths::dirs_home()?;
        let managed = crate::core::mcp::dir()
            .and_then(|dir| std::fs::read_to_string(dir.join("_antigravity.managed.json")).ok())
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Some(Self {
            appdata: std::env::var_os("APPDATA").map(PathBuf::from),
            home,
            project,
            own,
            managed,
        })
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Tous les serveurs trouvés, dans l'ordre des sources.
pub fn discover(loc: &Locations) -> Vec<Entry> {
    let mut out = Vec::new();
    let home = &loc.home;

    // Claude Code : portée utilisateur et portée locale (par dossier de projet).
    let claude = home.join(".claude.json");
    if let Some(config) = read_json(&claude) {
        if let Some(servers) = config.get("mcpServers").and_then(Value::as_object) {
            out.extend(from_map(
                servers,
                GameMcpSource::ClaudeCode,
                &claude,
                &["Claude Code"],
                loc,
            ));
        }
        if let (Some(project), Some(projects)) = (
            &loc.project,
            config.get("projects").and_then(Value::as_object),
        ) {
            let wanted = project.display().to_string();
            for (path, entry) in projects {
                if super::store::same_path(path, &wanted) {
                    if let Some(servers) = entry.get("mcpServers").and_then(Value::as_object) {
                        out.extend(from_map(
                            servers,
                            GameMcpSource::ClaudeCode,
                            &claude,
                            &["Claude Code"],
                            loc,
                        ));
                    }
                }
            }
        }
    }
    if let Some(project) = &loc.project {
        let file = project.join(".mcp.json");
        if let Some(servers) =
            read_json(&file).and_then(|c| c.get("mcpServers").and_then(Value::as_object).cloned())
        {
            out.extend(from_map(
                &servers,
                GameMcpSource::Project,
                &file,
                &["Claude Code"],
                loc,
            ));
        }
        let cursor = project.join(".cursor").join("mcp.json");
        if let Some(servers) =
            read_json(&cursor).and_then(|c| c.get("mcpServers").and_then(Value::as_object).cloned())
        {
            out.extend(from_map(
                &servers,
                GameMcpSource::Cursor,
                &cursor,
                &["Cursor"],
                loc,
            ));
        }
    }

    let desktop = [
        loc.appdata
            .as_ref()
            .map(|a| a.join("Claude").join("claude_desktop_config.json")),
        Some(home.join("Library/Application Support/Claude/claude_desktop_config.json")),
        Some(home.join(".config/Claude/claude_desktop_config.json")),
    ];
    for file in desktop.into_iter().flatten() {
        if let Some(servers) =
            read_json(&file).and_then(|c| c.get("mcpServers").and_then(Value::as_object).cloned())
        {
            out.extend(from_map(
                &servers,
                GameMcpSource::ClaudeDesktop,
                &file,
                &["Claude Desktop"],
                loc,
            ));
        }
    }

    let cursor = home.join(".cursor").join("mcp.json");
    if let Some(servers) =
        read_json(&cursor).and_then(|c| c.get("mcpServers").and_then(Value::as_object).cloned())
    {
        out.extend(from_map(
            &servers,
            GameMcpSource::Cursor,
            &cursor,
            &["Cursor"],
            loc,
        ));
    }

    let codex = home.join(".codex").join("config.toml");
    if let Some(servers) = std::fs::read_to_string(&codex)
        .ok()
        .and_then(|raw| toml::from_str::<Value>(&raw).ok())
        .and_then(|c| c.get("mcp_servers").and_then(Value::as_object).cloned())
    {
        out.extend(from_map(
            &servers,
            GameMcpSource::Codex,
            &codex,
            &["Codex"],
            loc,
        ));
    }

    let gemini = home.join(".gemini").join("settings.json");
    if let Some(servers) =
        read_json(&gemini).and_then(|c| c.get("mcpServers").and_then(Value::as_object).cloned())
    {
        out.extend(from_map(
            &servers,
            GameMcpSource::Gemini,
            &gemini,
            &["Gemini CLI"],
            loc,
        ));
    }
    let antigravity = home.join(".gemini").join("config").join("mcp_config.json");
    if let Some(servers) = read_json(&antigravity)
        .and_then(|c| c.get("mcpServers").and_then(Value::as_object).cloned())
    {
        out.extend(from_map(
            &servers,
            GameMcpSource::Antigravity,
            &antigravity,
            &["Antigravity"],
            loc,
        ));
    }

    for own in &loc.own {
        let raw = own_config(own);
        let mut entry = entry(
            &own.name,
            &raw,
            GameMcpSource::GameStudio,
            Path::new(DECLARATION),
            &["Claude Code", "Antigravity"],
        );
        entry.server.removable = true;
        out.push(entry);
    }
    out
}

fn from_map(
    servers: &Map<String, Value>,
    source: GameMcpSource,
    origin: &Path,
    agents: &[&str],
    loc: &Locations,
) -> Vec<Entry> {
    servers
        .iter()
        // Serveurs inscrits par ARCHIMED lui-même (jeton de session) : pas ceux de la personne.
        .filter(|(name, _)| {
            !name.to_lowercase().starts_with("archimed") && !loc.managed.contains(name)
        })
        .filter(|(_, config)| config.is_object())
        .map(|(name, config)| entry(name, config, source, origin, agents))
        .collect()
}

fn entry(name: &str, raw: &Value, source: GameMcpSource, origin: &Path, agents: &[&str]) -> Entry {
    let command = raw
        .get("command")
        .and_then(Value::as_str)
        .map(str::to_string);
    let args: Vec<String> = raw
        .get("args")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let url = ["url", "httpUrl", "serverUrl"]
        .iter()
        .find_map(|k| raw.get(*k).and_then(Value::as_str))
        .map(str::to_string);
    let kind = raw.get("type").and_then(Value::as_str).unwrap_or("");
    let transport = if command.is_some() {
        GameMcpTransport::Stdio
    } else if kind == "sse"
        || (source == GameMcpSource::Gemini
            && raw.get("url").is_some()
            && raw.get("httpUrl").is_none())
    {
        GameMcpTransport::Sse
    } else {
        GameMcpTransport::Http
    };
    let keys = |field: &str| -> Vec<String> {
        raw.get(field)
            .and_then(Value::as_object)
            .map(|o| o.keys().cloned().collect())
            .unwrap_or_default()
    };
    let target = target_of(name, command.as_deref(), &args, url.as_deref());
    Entry {
        server: GameMcpServer {
            key: format!("{}:{name}", source_slug(source)),
            name: name.to_string(),
            source,
            transport,
            command: command.clone(),
            args: redact_args(&args),
            url: url.as_deref().map(redact_url),
            env_keys: keys("env"),
            header_keys: keys("headers"),
            target,
            origin: origin.display().to_string(),
            agents: agents.iter().map(|a| a.to_string()).collect(),
            removable: false,
            health: None,
        },
        raw: raw.clone(),
    }
}

fn source_slug(source: GameMcpSource) -> &'static str {
    match source {
        GameMcpSource::ClaudeCode => "claude-code",
        GameMcpSource::Project => "project",
        GameMcpSource::ClaudeDesktop => "claude-desktop",
        GameMcpSource::Cursor => "cursor",
        GameMcpSource::Codex => "codex",
        GameMcpSource::Gemini => "gemini",
        GameMcpSource::Antigravity => "antigravity",
        GameMcpSource::GameStudio => "game-studio",
    }
}

/// Outil piloté par le serveur, d'après son nom, sa commande et ses arguments.
pub fn target_of(
    name: &str,
    command: Option<&str>,
    args: &[String],
    url: Option<&str>,
) -> Option<String> {
    let text = fold(&format!(
        "{name} {} {} {}",
        command.unwrap_or(""),
        args.join(" "),
        url.unwrap_or("")
    ));
    ["godot", "unity", "unreal", "blender"]
        .into_iter()
        .find(|t| text.contains(t))
        .map(str::to_string)
}

/// Arguments sans secret : valeur masquée après une option qui en annonce un, et motifs connus.
pub fn redact_args(args: &[String]) -> Vec<String> {
    let secretive = |s: &str| {
        let lower = s.to_lowercase();
        [
            "key",
            "token",
            "secret",
            "password",
            "passwd",
            "auth",
            "credential",
        ]
        .iter()
        .any(|w| lower.contains(w))
    };
    let mut out = Vec::with_capacity(args.len());
    let mut hide_next = false;
    for arg in args {
        if hide_next {
            out.push("•••".to_string());
            hide_next = false;
            continue;
        }
        if let Some((flag, _)) = arg.split_once('=') {
            if secretive(flag) && (flag.starts_with('-') || !flag.contains('/')) {
                out.push(format!("{flag}=•••"));
                continue;
            }
        }
        if arg.starts_with('-') && secretive(arg) {
            hide_next = true;
        }
        out.push(super::journal::redact(arg));
    }
    out
}

/// Adresse sans identifiants ni paramètres.
pub fn redact_url(url: &str) -> String {
    let (base, query) = url
        .split_once('?')
        .map_or((url, None), |(b, q)| (b, Some(q)));
    let base = match base.split_once("://") {
        Some((scheme, rest)) => {
            let authority = &rest[..rest.find('/').unwrap_or(rest.len())];
            match authority.rfind('@') {
                Some(at) => format!("{scheme}://•••@{}", &rest[at + 1..]),
                None => base.to_string(),
            }
        }
        None => base.to_string(),
    };
    match query {
        Some(q) if !q.is_empty() => {
            let masked: Vec<String> = q
                .split('&')
                .map(|pair| {
                    pair.split_once('=')
                        .map_or(pair.to_string(), |(k, _)| format!("{k}=•••"))
                })
                .collect();
            format!("{base}?{}", masked.join("&"))
        }
        _ => base,
    }
}

// ── Serveurs ajoutés dans Game Studio ───────────────────────────────────────────────────

pub fn own_path(module_dir: &Path) -> PathBuf {
    module_dir.join("mcp_servers.json")
}

pub fn load_own(module_dir: &Path) -> Vec<GameMcpOwnServer> {
    read_json(&own_path(module_dir))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn own_config(own: &GameMcpOwnServer) -> Value {
    match (&own.command, &own.url) {
        (Some(command), _) => json!({ "type": "stdio", "command": command, "args": own.args }),
        (None, Some(url)) => json!({ "type": "http", "url": url }),
        _ => json!({}),
    }
}

/// Vérifie un serveur saisi à la main (ni secret, ni caractère de contrôle).
pub fn validate(own: &GameMcpOwnServer) -> AppResult<GameMcpOwnServer> {
    let name = own.name.trim().to_string();
    let valid_name = !name.is_empty()
        && name.len() <= 40
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !name.to_lowercase().starts_with("archimed");
    if !valid_name {
        return Err(AppError::invalid(
            "Nom : lettres, chiffres, - et _ (40 au plus), sans commencer par « archimed ».",
        ));
    }
    let clean = |s: &str| !s.chars().any(char::is_control);
    let command = own
        .command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_string);
    let url = own
        .url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(str::to_string);
    match (&command, &url) {
        (Some(c), None) if clean(c) => {}
        (None, Some(u)) if clean(u) && (u.starts_with("http://") || u.starts_with("https://")) => {
            if redact_url(u) != *u {
                return Err(AppError::invalid("Pas d'identifiant ni de paramètre dans l'adresse : gardez les secrets dans la configuration du serveur."));
            }
        }
        _ => {
            return Err(AppError::invalid(
                "Donnez soit une commande (serveur local), soit une adresse http(s)://.",
            ))
        }
    }
    let args: Vec<String> = own
        .args
        .iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
        .collect();
    if args.iter().any(|a| !clean(a)) {
        return Err(AppError::invalid("Argument invalide."));
    }
    if redact_args(&args) != args {
        return Err(AppError::invalid("Un argument ressemble à un secret : gardez-le dans la configuration du serveur, pas ici."));
    }
    Ok(GameMcpOwnServer {
        name,
        command,
        args,
        url,
    })
}

/// Enregistre les serveurs ajoutés et les déclare aux agents d'ARCHIMED.
pub fn save_own(
    module_dir: &Path,
    mcp_dir: Option<&Path>,
    servers: &[GameMcpOwnServer],
) -> AppResult<()> {
    let body =
        serde_json::to_string_pretty(servers).map_err(|e| AppError::internal(e.to_string()))?;
    write_atomic(&own_path(module_dir), body.as_bytes())?;
    let Some(dir) = mcp_dir else { return Ok(()) };
    let file = dir.join(DECLARATION);
    if servers.is_empty() {
        match std::fs::remove_file(&file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        return Ok(());
    }
    let map: Map<String, Value> = servers
        .iter()
        .map(|s| (s.name.clone(), own_config(s)))
        .collect();
    let body = serde_json::to_string_pretty(&json!({ "mcpServers": map }))
        .map_err(|e| AppError::internal(e.to_string()))?;
    std::fs::create_dir_all(dir)?;
    write_atomic(&file, body.as_bytes())
}

// ── Résultats des tests ─────────────────────────────────────────────────────────────────

pub fn load_health(module_dir: &Path) -> HashMap<String, GameMcpHealth> {
    read_json(&module_dir.join("mcp_health.json"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

pub fn save_health(module_dir: &Path, health: &HashMap<String, GameMcpHealth>) {
    if let Ok(body) = serde_json::to_string_pretty(health) {
        let _ = write_atomic(&module_dir.join("mcp_health.json"), body.as_bytes());
    }
}

fn health(state: GameMcpState, message: impl Into<String>) -> GameMcpHealth {
    GameMcpHealth {
        state,
        message: message.into(),
        server: None,
        version: None,
        tools: Vec::new(),
        checked_at: chrono::Utc::now().to_rfc3339(),
    }
}

fn initialize_request() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": { "name": "archimed-game-studio", "version": env!("CARGO_PKG_VERSION") }
        }
    })
}

/// Compte rendu d'un échange réussi : nom, version et outils du serveur.
fn healthy(init: &Value, tools: &Value) -> GameMcpHealth {
    let info = &init["result"]["serverInfo"];
    let list: Vec<GameMcpTool> = tools["result"]["tools"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|t| {
                    Some(GameMcpTool {
                        name: t.get("name")?.as_str()?.to_string(),
                        description: t
                            .get("description")
                            .and_then(Value::as_str)
                            .map(|d| d.chars().take(240).collect()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let mut out = health(GameMcpState::Ok, format!("Prêt : {} outil(s).", list.len()));
    out.server = info.get("name").and_then(Value::as_str).map(str::to_string);
    out.version = info
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string);
    out.tools = list;
    out
}

fn rpc_error(response: &Value) -> Option<String> {
    response.get("error").map(|e| {
        e.get("message")
            .and_then(Value::as_str)
            .unwrap_or("erreur")
            .to_string()
    })
}

/// Chemin d'un programme : absolu, ou cherché dans le PATH (extensions de Windows comprises :
/// `npx` y est `npx.cmd`).
pub fn resolve_program(command: &str) -> Option<PathBuf> {
    let path = Path::new(command);
    if path.components().count() > 1 || path.is_absolute() {
        return path.is_file().then(|| path.to_path_buf());
    }
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
            .split(';')
            .map(|e| e.to_lowercase())
            .chain(std::iter::once(String::new()))
            .collect()
    } else {
        vec![String::new()]
    };
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        for ext in &extensions {
            let candidate = dir.join(format!("{command}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Teste un serveur local : lancement, `initialize`, `tools/list`, arrêt.
pub fn check_stdio(raw: &Value) -> GameMcpHealth {
    let Some(command) = raw.get("command").and_then(Value::as_str) else {
        return health(
            GameMcpState::Error,
            "Pas de commande dans la configuration.",
        );
    };
    let Some(program) = resolve_program(command) else {
        return health(
            GameMcpState::Missing,
            format!("« {command} » introuvable sur cette machine (Node.js pour npx, Python pour uvx : onglet Outils)."),
        );
    };
    let args: Vec<String> = raw
        .get("args")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut cmd = crate::core::process::command(&program);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = raw.get("cwd").and_then(Value::as_str) {
        cmd.current_dir(cwd);
    }
    if let Some(env) = raw.get("env").and_then(Value::as_object) {
        for (k, v) in env {
            if let Some(v) = v.as_str() {
                cmd.env(k, v);
            }
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => return health(GameMcpState::Error, format!("Lancement impossible : {e}")),
    };
    let pid = child.id();
    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let tail = stderr_tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut t) = tail.lock() {
                    t.push(line);
                    let excess = t.len().saturating_sub(8);
                    t.drain(..excess);
                }
            }
        });
    }
    let deadline = Instant::now() + STDIO_TIMEOUT;
    let mut stdin = child.stdin.take();
    let mut send = |message: &Value| -> bool {
        stdin
            .as_mut()
            .is_some_and(|s| writeln!(s, "{message}").and_then(|_| s.flush()).is_ok())
    };
    let wait_for = |id: u64| -> Result<Value, GameMcpState> {
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(GameMcpState::Timeout);
            }
            match rx.recv_timeout(left) {
                Ok(line) => {
                    if let Ok(value) = serde_json::from_str::<Value>(line.trim()) {
                        if value.get("id").and_then(Value::as_u64) == Some(id) {
                            return Ok(value);
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => return Err(GameMcpState::Timeout),
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err(GameMcpState::Error),
            }
        }
    };

    let result = (|| {
        if !send(&initialize_request()) {
            return Err(GameMcpState::Error);
        }
        let init = wait_for(1)?;
        if rpc_error(&init).is_some() {
            return Ok((init, Value::Null));
        }
        send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        send(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }));
        let tools = wait_for(2)?;
        Ok((init, tools))
    })();

    let _ = child.kill();
    super::runner::kill_tree(pid);
    let _ = child.wait();
    let tail = stderr_tail
        .lock()
        .map(|t| t.join(" · "))
        .unwrap_or_default();
    let tail = super::journal::redact(&tail);
    match result {
        Ok((init, tools)) => match rpc_error(&init).or_else(|| rpc_error(&tools)) {
            Some(error) => health(GameMcpState::Error, format!("Le serveur refuse : {error}")),
            None => healthy(&init, &tools),
        },
        Err(GameMcpState::Timeout) => health(
            GameMcpState::Timeout,
            format!(
                "Pas de réponse en {} s. Au premier lancement, npx ou uvx télécharge le serveur : réessayez.{}",
                STDIO_TIMEOUT.as_secs(),
                if tail.is_empty() { String::new() } else { format!(" Sortie : {tail}") }
            ),
        ),
        Err(state) => health(
            state,
            if tail.is_empty() {
                "Le serveur s'est arrêté sans répondre.".to_string()
            } else {
                format!("Le serveur s'est arrêté : {tail}")
            },
        ),
    }
}

/// Réponse JSON-RPC d'un corps HTTP (JSON direct ou flux SSE `data: …`).
pub fn parse_body(body: &str, id: u64) -> Option<Value> {
    let direct = serde_json::from_str::<Value>(body.trim()).ok();
    let from_sse = || {
        body.lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .filter_map(|d| serde_json::from_str::<Value>(d.trim()).ok())
            .find(|v| v.get("id").and_then(Value::as_u64) == Some(id))
    };
    match direct {
        Some(Value::Array(items)) => items
            .into_iter()
            .find(|v| v.get("id").and_then(Value::as_u64) == Some(id)),
        Some(value) => Some(value),
        None => from_sse(),
    }
}

/// Teste un serveur HTTP (« streamable HTTP ») : `initialize` puis `tools/list`.
pub async fn check_http(raw: &Value) -> GameMcpHealth {
    let Some(url) = ["url", "httpUrl", "serverUrl"]
        .iter()
        .find_map(|k| raw.get(*k).and_then(Value::as_str))
    else {
        return health(GameMcpState::Error, "Pas d'adresse dans la configuration.");
    };
    let client = match reqwest::Client::builder().timeout(HTTP_TIMEOUT).build() {
        Ok(c) => c,
        Err(e) => return health(GameMcpState::Error, e.to_string()),
    };
    let headers: Vec<(String, String)> = raw
        .get("headers")
        .and_then(Value::as_object)
        .map(|h| {
            h.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let post = |body: Value, session: Option<String>| {
        let mut request = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL)
            .body(body.to_string());
        for (k, v) in &headers {
            request = request.header(k.as_str(), v.as_str());
        }
        if let Some(s) = session {
            request = request.header("Mcp-Session-Id", s);
        }
        request.send()
    };
    let response = match post(initialize_request(), None).await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return health(
                GameMcpState::Timeout,
                format!("Pas de réponse en {} s.", HTTP_TIMEOUT.as_secs()),
            )
        }
        Err(e) => {
            return health(
                GameMcpState::Error,
                format!(
                    "Connexion impossible : {}",
                    super::journal::redact(&e.to_string())
                ),
            )
        }
    };
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return health(GameMcpState::AuthRequired, "Le serveur demande une connexion (jeton ou compte) : configurez-la dans l'outil qui le déclare.");
    }
    if !status.is_success() {
        return health(GameMcpState::Error, format!("Le serveur répond {status}."));
    }
    let session = response
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let Some(init) = response.text().await.ok().and_then(|b| parse_body(&b, 1)) else {
        return health(GameMcpState::Error, "Réponse illisible à « initialize ».");
    };
    if let Some(error) = rpc_error(&init) {
        return health(GameMcpState::Error, format!("Le serveur refuse : {error}"));
    }
    let _ = post(
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        session.clone(),
    )
    .await;
    let tools = match post(
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
        session,
    )
    .await
    {
        Ok(r) => r
            .text()
            .await
            .ok()
            .and_then(|b| parse_body(&b, 2))
            .unwrap_or(Value::Null),
        Err(e) => {
            return health(
                GameMcpState::Error,
                format!("tools/list : {}", super::journal::redact(&e.to_string())),
            )
        }
    };
    if let Some(error) = rpc_error(&tools) {
        return health(GameMcpState::Error, format!("tools/list refusé : {error}"));
    }
    healthy(&init, &tools)
}

/// Teste le serveur selon son transport.
pub async fn check(entry: &Entry) -> GameMcpHealth {
    match entry.server.transport {
        GameMcpTransport::Stdio => {
            let raw = entry.raw.clone();
            tauri::async_runtime::spawn_blocking(move || check_stdio(&raw))
                .await
                .unwrap_or_else(|e| health(GameMcpState::Error, e.to_string()))
        }
        GameMcpTransport::Http => check_http(&entry.raw).await,
        GameMcpTransport::Sse => health(
            GameMcpState::Unsupported,
            "Ancien transport HTTP+SSE : Game Studio ne le teste pas ; l'agent qui le déclare peut quand même s'y connecter.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gs-mcp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn discovers_servers_without_leaking_secrets() {
        let home = temp("home");
        let project = home.join("jeu");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(
            home.join(".claude.json"),
            json!({
                "mcpServers": {
                    "godot": { "type": "stdio", "command": "npx", "args": ["-y", "godot-mcp", "--api-key", "sk-ant-abcdefghijklmnopqrstuvwx"], "env": { "GODOT_PATH": "/opt/godot" } },
                    "archimed": { "type": "http", "url": "http://127.0.0.1:1/mcp" }
                },
                "projects": { project.display().to_string(): { "mcpServers": { "local-tool": { "command": "uvx", "args": ["tool"] } } } }
            })
            .to_string(),
        )
        .unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(home.join(".codex/config.toml"), "[mcp_servers.blender]\ncommand = \"uvx\"\nargs = [\"blender-mcp\"]\n[mcp_servers.blender.env]\nTOKEN = \"secret\"\n").unwrap();
        std::fs::create_dir_all(home.join(".gemini/config")).unwrap();
        std::fs::write(
            home.join(".gemini/config/mcp_config.json"),
            json!({ "mcpServers": { "unity": { "serverUrl": "https://user:pw@example.com/mcp?token=abc", "headers": { "Authorization": "Bearer x" } } } }).to_string(),
        )
        .unwrap();
        std::fs::write(project.join(".mcp.json"), json!({ "mcpServers": { "unreal-editor": { "type": "http", "url": "http://localhost:30010/mcp" } } }).to_string()).unwrap();

        let loc = Locations {
            home: home.clone(),
            appdata: None,
            project: Some(project.clone()),
            own: vec![GameMcpOwnServer {
                name: "mon-outil".into(),
                command: Some("node".into()),
                args: vec!["serveur.js".into()],
                url: None,
            }],
            managed: vec![],
        };
        let found = discover(&loc);
        let names: Vec<&str> = found.iter().map(|e| e.server.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "godot",
                "local-tool",
                "unreal-editor",
                "blender",
                "unity",
                "mon-outil"
            ],
            "le serveur d'ARCHIMED est exclu"
        );

        let godot = &found[0].server;
        assert_eq!(godot.target.as_deref(), Some("godot"));
        assert_eq!(godot.args, vec!["-y", "godot-mcp", "--api-key", "•••"]);
        assert_eq!(godot.env_keys, vec!["GODOT_PATH"]);
        let blender = found.iter().find(|e| e.server.name == "blender").unwrap();
        assert_eq!(blender.server.source, GameMcpSource::Codex);
        assert_eq!(blender.server.env_keys, vec!["TOKEN"]);
        let unity = &found
            .iter()
            .find(|e| e.server.name == "unity")
            .unwrap()
            .server;
        assert_eq!(
            unity.url.as_deref(),
            Some("https://•••@example.com/mcp?token=•••")
        );
        assert_eq!(unity.header_keys, vec!["Authorization"]);
        let everything =
            serde_json::to_string(&found.iter().map(|e| &e.server).collect::<Vec<_>>()).unwrap();
        for secret in ["sk-ant-", "secret", "Bearer x", "pw@", "abc", "/opt/godot"] {
            assert!(!everything.contains(secret), "secret exposé : {secret}");
        }
        assert!(found.last().unwrap().server.removable);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn own_servers_are_validated_and_declared() {
        let dir = temp("own");
        let mcp = dir.join("mcp");
        let bad = |name: &str, command: Option<&str>, args: &[&str], url: Option<&str>| {
            validate(&GameMcpOwnServer {
                name: name.into(),
                command: command.map(Into::into),
                args: args.iter().map(|a| a.to_string()).collect(),
                url: url.map(Into::into),
            })
            .is_err()
        };
        assert!(bad("archimed-x", Some("node"), &[], None));
        assert!(bad("a b", Some("node"), &[], None));
        assert!(bad("x", None, &[], None));
        assert!(bad("x", None, &[], Some("ftp://x")));
        assert!(bad("x", None, &[], Some("https://h/mcp?key=1")));
        assert!(bad("x", Some("node"), &["--token", "abc"], None));
        let ok = validate(&GameMcpOwnServer {
            name: " godot-local ".into(),
            command: Some("node".into()),
            args: vec!["srv.js".into(), " ".into()],
            url: None,
        })
        .unwrap();
        assert_eq!(ok.name, "godot-local");
        assert_eq!(ok.args, vec!["srv.js"]);

        save_own(&dir, Some(&mcp), std::slice::from_ref(&ok)).unwrap();
        assert_eq!(load_own(&dir).len(), 1);
        let declared: Value =
            serde_json::from_str(&std::fs::read_to_string(mcp.join(DECLARATION)).unwrap()).unwrap();
        assert_eq!(declared["mcpServers"]["godot-local"]["command"], "node");
        save_own(&dir, Some(&mcp), &[]).unwrap();
        assert!(
            !mcp.join(DECLARATION).exists(),
            "plus de serveur : plus de déclaration"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_json_and_sse_bodies() {
        assert_eq!(
            parse_body(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#, 1).unwrap()["id"],
            1
        );
        let sse =
            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\n\n";
        assert_eq!(parse_body(sse, 2).unwrap()["id"], 2);
        assert!(parse_body("n'importe quoi", 1).is_none());
    }

    #[test]
    fn missing_program_is_reported_before_anything_runs() {
        let h = check_stdio(&json!({ "command": "programme-mcp-absent-xyz" }));
        assert_eq!(h.state, GameMcpState::Missing);
    }

    #[cfg(unix)]
    #[test]
    fn real_handshake_with_a_local_server() {
        // Petit serveur MCP en shell : répond à initialize et tools/list.
        let dir = temp("stdio");
        let script = dir.join("serveur.sh");
        std::fs::write(
            &script,
            "#!/bin/sh\nwhile read line; do\n  case \"$line\" in\n    *'\"initialize\"'*) echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"godot-test\",\"version\":\"1.2\"}}}' ;;\n    *'\"tools/list\"'*) echo '{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"run_scene\",\"description\":\"Lance une scène\"},{\"name\":\"get_nodes\"}]}}' ;;\n  esac\ndone\n",
        )
        .unwrap();
        let h = check_stdio(&json!({ "command": "sh", "args": [script.display().to_string()] }));
        assert_eq!(h.state, GameMcpState::Ok, "{}", h.message);
        assert_eq!(h.server.as_deref(), Some("godot-test"));
        assert_eq!(h.tools.len(), 2);
        assert_eq!(h.tools[0].name, "run_scene");

        let silent =
            check_stdio(&json!({ "command": "sh", "args": ["-c", "echo 'oups' 1>&2; exit 1"] }));
        assert_eq!(silent.state, GameMcpState::Error);
        assert!(silent.message.contains("oups"), "{}", silent.message);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn real_handshake_over_http() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    // En-têtes puis corps, parfois en plusieurs morceaux.
                    let mut data = Vec::new();
                    let mut buf = vec![0u8; 8192];
                    loop {
                        let n = stream.read(&mut buf).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        data.extend_from_slice(&buf[..n]);
                        let text = String::from_utf8_lossy(&data).to_string();
                        if let Some(end) = text.find("\r\n\r\n") {
                            let length = text[..end]
                                .lines()
                                .find_map(|l| {
                                    l.to_lowercase()
                                        .strip_prefix("content-length:")
                                        .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                                })
                                .unwrap_or(0);
                            if data.len() >= end + 4 + length {
                                break;
                            }
                        }
                    }
                    let request = String::from_utf8_lossy(&data).to_string();
                    let (status, body) = if !request
                        .to_lowercase()
                        .contains("authorization: bearer bon")
                    {
                        ("401 Unauthorized", String::new())
                    } else if request.contains("\"initialize\"") {
                        ("200 OK", r#"{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"unity-mcp","version":"3"}}}"#.to_string())
                    } else if request.contains("tools/list") {
                        ("200 OK", "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_gameobject\"}]}}\n\n".to_string())
                    } else {
                        ("202 Accepted", String::new())
                    };
                    let reply = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nMcp-Session-Id: s1\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = stream.write_all(reply.as_bytes()).await;
                });
            }
        });
        let url = format!("http://127.0.0.1:{port}/mcp");
        let ok =
            check_http(&json!({ "url": url, "headers": { "Authorization": "Bearer bon" } })).await;
        assert_eq!(ok.state, GameMcpState::Ok, "{}", ok.message);
        assert_eq!(ok.server.as_deref(), Some("unity-mcp"));
        assert_eq!(ok.tools[0].name, "create_gameobject");
        let denied = check_http(&json!({ "url": url })).await;
        assert_eq!(denied.state, GameMcpState::AuthRequired);
    }

    #[test]
    fn redaction() {
        assert_eq!(
            redact_url("http://localhost:3000/mcp"),
            "http://localhost:3000/mcp"
        );
        assert_eq!(
            redact_args(&[
                "--token=abc".to_string(),
                "--port".to_string(),
                "3000".to_string()
            ]),
            vec!["--token=•••", "--port", "3000"]
        );
        assert_eq!(
            target_of(
                "editor",
                Some("npx"),
                &["@acme/unity-mcp".to_string()],
                None
            )
            .as_deref(),
            Some("unity")
        );
    }
}
