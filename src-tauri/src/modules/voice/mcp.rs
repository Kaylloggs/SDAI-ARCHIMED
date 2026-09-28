//! Serveur MCP d'ARCHIMED (transport HTTP « streamable », réponses JSON), sur 127.0.0.1
//! uniquement, protégé par un jeton tiré au hasard à chaque lancement.
//!
//! Il donne aux agents (Claude Code lancé par ARCHIMED, ou un agent externe configuré à la
//! main) des outils pour agir dans l'application : parler (`speak`), prévenir (`notify`),
//! lire le contexte, ouvrir un module, lancer une action d'un module, confier une tâche à
//! un autre agent. Les outils sont exécutés par l'interface (module Voice) : la demande lui
//! est transmise (`voice:mcp-call`), la réponse revient par `mcp_respond`.
//!
//! Déclaration : `<données>/mcp/voice.json`, fusionnée par le moteur et passée à la CLI
//! (`core::mcp`). Retirer le module retire le fichier, donc les outils.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::types::{McpCall, McpInfo};

pub const CALL_EVENT: &str = "voice:mcp-call";
pub const SERVER_NAME: &str = "archimed";
/// Fichier de déclaration dans le dossier MCP des modules.
const DECLARATION: &str = "voice.json";
const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_HEADERS: usize = 16 * 1024;
const MAX_BODY: usize = 1024 * 1024;

/// Réponse de l'interface à un appel d'outil.
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpReply {
    pub ok: bool,
    pub text: String,
    #[serde(default)]
    pub data: Option<Value>,
}

type Emit = Arc<dyn Fn(McpCall) + Send + Sync>;

pub struct McpServer {
    port: u16,
    token: String,
    calls: AtomicU64,
    ready: AtomicBool,
    pending: Mutex<HashMap<String, oneshot::Sender<McpReply>>>,
    emit: Emit,
    /// Dossier des déclarations MCP lues par le moteur des agents.
    mcp_dir: PathBuf,
}

/// Outils proposés aux agents (schéma JSON des arguments).
pub fn tools() -> Vec<Value> {
    let priority = json!({ "type": "string", "enum": ["low", "normal", "high", "critical"], "description": "low : sans interrompre ; critical : coupe la parole." });
    vec![
        json!({
            "name": "speak",
            "description": "Dit une phrase à voix haute à la personne dans ARCHIMED. Phrases courtes, sans Markdown ni emoji.",
            "inputSchema": { "type": "object", "properties": {
                "text": { "type": "string" },
                "priority": priority,
                "voice": { "type": "string", "description": "Identifiant de voix (facultatif)." },
                "emotion": { "type": "string", "description": "Ton souhaité (calme, joyeux…), appliqué si le moteur le permet." }
            }, "required": ["text"] }
        }),
        json!({
            "name": "notify",
            "description": "Prévient la personne (texte à l'écran, voix selon la priorité). Une notification basse n'interrompt jamais une conversation.",
            "inputSchema": { "type": "object", "properties": { "text": { "type": "string" }, "priority": priority }, "required": ["text"] }
        }),
        json!({
            "name": "get_voice_state",
            "description": "État de la voix d'ARCHIMED : écoute, parle, moteurs utilisés.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_context",
            "description": "Ce que la personne a sous les yeux dans ARCHIMED : module ouvert, projet, fichier, image ou objet sélectionné, tâche en cours.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "list_modules",
            "description": "Modules d'ARCHIMED, leurs capacités et les actions appelables avec run_action (paramètres, niveau de risque).",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "open_module",
            "description": "Affiche un module d'ARCHIMED (ex. code, image-maker, planner), avec des paramètres facultatifs. Code : { \"cwd\": dossier du projet, \"file\": fichier } ; sans paramètres, Code s'ouvre sur le dossier où tu viens d'écrire des fichiers.",
            "inputSchema": { "type": "object", "properties": {
                "module": { "type": "string" },
                "params": { "type": "object" }
            }, "required": ["module"] }
        }),
        json!({
            "name": "run_action",
            "description": "Exécute une action d'un module (voir list_modules). Les actions qui suppriment ou envoient quelque chose demandent confirmation à la personne.",
            "inputSchema": { "type": "object", "properties": {
                "module": { "type": "string" },
                "action": { "type": "string" },
                "arguments": { "type": "object" }
            }, "required": ["module", "action"] }
        }),
        json!({
            "name": "start_task",
            "description": "Confie un travail (de code surtout) à un agent (Claude Code, Antigravity, Codex) dans une conversation du module Chat, suivie par ARCHIMED. Indique sa complexité : ARCHIMED choisit alors le modèle (léger pour une tâche simple, le plus puissant pour une tâche complexe). Renvoie l'identifiant de la tâche et le modèle choisi.",
            "inputSchema": { "type": "object", "properties": {
                "prompt": { "type": "string" },
                "complexity": { "type": "string", "enum": ["simple", "standard", "complex"], "description": "simple : petite modification, script ou page courte ; standard : fonctionnalité de taille moyenne ; complex : architecture, plusieurs fichiers ou modules, bug difficile, performances." },
                "agent": { "type": "string", "enum": ["claude", "antigravity", "codex"], "description": "Seulement si la personne demande un agent précis." },
                "cwd": { "type": "string", "description": "Dossier de travail (sinon le projet ouvert)." },
                "title": { "type": "string" }
            }, "required": ["prompt"] }
        }),
        json!({
            "name": "task_status",
            "description": "État des tâches confiées (toutes, ou une seule par identifiant) et leur dernier résultat.",
            "inputSchema": { "type": "object", "properties": { "taskId": { "type": "string" } } }
        }),
    ]
}

pub fn tool_names() -> Vec<String> {
    tools().iter().filter_map(|t| t["name"].as_str().map(str::to_string)).collect()
}

impl McpServer {
    /// Démarre le serveur ; `shared` : sa déclaration est écrite pour les CLI lancées par ARCHIMED.
    pub async fn start(emit: Emit, mcp_dir: &Path, shared: bool) -> AppResult<Arc<Self>> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AppError::new(AppErrorCode::Io, format!("Serveur MCP impossible : {e}")))?;
        let port = listener.local_addr().map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?.port();
        let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        let server = Arc::new(Self {
            port,
            token,
            calls: AtomicU64::new(0),
            ready: AtomicBool::new(false),
            pending: Mutex::new(HashMap::new()),
            emit,
            mcp_dir: mcp_dir.to_path_buf(),
        });
        server.set_shared(shared)?;
        let accept = server.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((stream, peer)) = listener.accept().await else { continue };
                if !peer.ip().is_loopback() {
                    continue;
                }
                let server = accept.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = handle(stream, &server).await {
                        tracing::debug!("connexion MCP : {e}");
                    }
                });
            }
        });
        Ok(server)
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }

    /// Bloc `mcpServers` (format Claude Code / .mcp.json).
    pub fn config(&self) -> Value {
        json!({ "mcpServers": { SERVER_NAME: {
            "type": "http",
            "url": self.url(),
            "headers": { "Authorization": format!("Bearer {}", self.token) }
        } } })
    }

    pub fn info(&self) -> McpInfo {
        McpInfo {
            running: true,
            url: Some(self.url()),
            config: serde_json::to_string_pretty(&self.config()).ok(),
            tools: tool_names(),
            calls: self.calls.load(Ordering::Relaxed),
        }
    }

    /// Donne (ou retire) les outils aux agents lancés par ARCHIMED : la déclaration est écrite
    /// ou supprimée ; le moteur la lit au lancement de chaque conversation.
    pub fn set_shared(&self, shared: bool) -> AppResult<()> {
        if shared {
            write_declaration(&self.mcp_dir, &self.config()).map(|_| ())
        } else {
            match std::fs::remove_file(self.mcp_dir.join(DECLARATION)) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(AppError::new(AppErrorCode::Io, e.to_string())),
            }
        }
    }

    /// L'interface du module Voice est prête à exécuter les outils.
    pub fn set_ready(&self, ready: bool) {
        self.ready.store(ready, Ordering::Relaxed);
    }

    pub fn respond(&self, call_id: &str, reply: McpReply) {
        if let Some(sender) = self.pending.lock().ok().and_then(|mut p| p.remove(call_id)) {
            let _ = sender.send(reply);
        }
    }

    fn authorized(&self, header: Option<&str>) -> bool {
        let expected = format!("Bearer {}", self.token);
        header.is_some_and(|h| constant_time_eq(h.trim().as_bytes(), expected.as_bytes()))
    }

    /// Transmet l'appel à l'interface et attend sa réponse.
    async fn call(&self, tool: &str, arguments: Value) -> McpReply {
        self.calls.fetch_add(1, Ordering::Relaxed);
        if !self.ready.load(Ordering::Relaxed) {
            return McpReply {
                ok: false,
                text: "ARCHIMED ne peut pas exécuter cet outil : le module Voice est désactivé ou la fenêtre n'est pas prête.".into(),
                data: None,
            };
        }
        let call_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(call_id.clone(), sender);
        }
        (self.emit)(McpCall { call_id: call_id.clone(), tool: tool.to_string(), arguments });
        // Génération d'image, compilation : jusqu'à trois minutes.
        match tokio::time::timeout(Duration::from_secs(180), receiver).await {
            Ok(Ok(reply)) => reply,
            _ => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&call_id);
                }
                McpReply { ok: false, text: "ARCHIMED n'a pas répondu à temps (3 min).".into(), data: None }
            }
        }
    }

    /// Traite un message JSON-RPC ; `None` pour une notification.
    pub async fn rpc(&self, message: &Value) -> Option<Value> {
        let id = message.get("id").cloned();
        let method = message["method"].as_str().unwrap_or("");
        let id = id?;
        let result = match method {
            "initialize" => {
                let asked = message["params"]["protocolVersion"].as_str().unwrap_or("");
                let version = if PROTOCOL_VERSIONS.contains(&asked) { asked } else { PROTOCOL_VERSIONS[0] };
                Ok(json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": SERVER_NAME, "title": "SDAI ARCHIMED", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Outils pour agir dans l'application ARCHIMED de la personne : lire le contexte, ouvrir un module, lancer une action d'un module (list_modules d'abord), confier une tâche à un agent, parler à voix haute."
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools() })),
            "tools/call" => {
                let name = message["params"]["name"].as_str().unwrap_or("").to_string();
                if !tool_names().contains(&name) {
                    Err((-32602, format!("Outil inconnu : {name}")))
                } else {
                    let arguments = message["params"]["arguments"].clone();
                    let arguments = if arguments.is_object() { arguments } else { json!({}) };
                    let reply = self.call(&name, arguments).await;
                    let mut result = json!({ "content": [{ "type": "text", "text": reply.text }], "isError": !reply.ok });
                    if let Some(data) = reply.data.filter(Value::is_object) {
                        result["structuredContent"] = data;
                    }
                    Ok(result)
                }
            }
            _ => Err((-32601, format!("Méthode inconnue : {method}"))),
        };
        Some(match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
        })
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn write_declaration(dir: &Path, config: &Value) -> AppResult<PathBuf> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
    let path = dir.join(DECLARATION);
    let body = serde_json::to_string_pretty(config).map_err(|e| AppError::internal(e.to_string()))?;
    std::fs::write(&path, body).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
    Ok(path)
}

/// Requête HTTP réduite à ce dont MCP a besoin.
#[derive(Debug, Default)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// Début de requête lu : méthode, chemin, en-têtes, longueur du corps.
pub type Head = (String, String, Vec<(String, String)>, usize);

/// En-têtes → (méthode, chemin, en-têtes, longueur du corps).
pub fn parse_head(head: &str) -> Option<Head> {
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_string();
    let path = first.next()?.split('?').next()?.to_string();
    let mut headers = Vec::new();
    let mut length = 0usize;
    for line in lines.filter(|l| !l.is_empty()) {
        let (name, value) = line.split_once(':')?;
        let (name, value) = (name.trim().to_string(), value.trim().to_string());
        if name.eq_ignore_ascii_case("content-length") {
            length = value.parse().ok()?;
        }
        headers.push((name, value));
    }
    Some((method, path, headers, length))
}

async fn read_request(stream: &mut TcpStream) -> AppResult<Request> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        let read = stream.read(&mut chunk).await.map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
        if read == 0 {
            return Err(AppError::invalid("connexion fermée"));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(pos) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buffer.len() > MAX_HEADERS {
            return Err(AppError::invalid("en-têtes trop longs"));
        }
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
    let (method, path, headers, length) = parse_head(&head).ok_or_else(|| AppError::invalid("requête illisible"))?;
    if length > MAX_BODY {
        return Err(AppError::invalid("corps trop long"));
    }
    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk).await.map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);
    Ok(Request { method, path, headers, body })
}

async fn reply(stream: &mut TcpStream, status: &str, body: Option<&Value>, extra: &[(&str, &str)]) -> AppResult<()> {
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let mut head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n", payload.len());
    if body.is_some() {
        head.push_str("Content-Type: application/json\r\n");
    }
    for (name, value) in extra {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await.map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
    stream.write_all(payload.as_bytes()).await.map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
    stream.flush().await.map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))
}

/// Une page web ne doit pas pouvoir appeler le serveur (protection DNS rebinding).
pub fn origin_allowed(origin: Option<&str>) -> bool {
    match origin {
        None | Some("null") => true,
        Some(origin) => super::cloud::is_local_url(origin),
    }
}

async fn handle(mut stream: TcpStream, server: &McpServer) -> AppResult<()> {
    let request = tokio::time::timeout(Duration::from_secs(30), read_request(&mut stream))
        .await
        .map_err(|_| AppError::invalid("délai dépassé"))??;
    if request.path != "/mcp" {
        return reply(&mut stream, "404 Not Found", None, &[]).await;
    }
    if !origin_allowed(request.header("origin")) {
        return reply(&mut stream, "403 Forbidden", None, &[]).await;
    }
    if !server.authorized(request.header("authorization")) {
        return reply(&mut stream, "401 Unauthorized", None, &[]).await;
    }
    match request.method.as_str() {
        "POST" => {}
        "DELETE" => return reply(&mut stream, "200 OK", None, &[]).await,
        // Pas de flux SSE ouvert par le client : autorisé par la spécification.
        _ => return reply(&mut stream, "405 Method Not Allowed", None, &[("Allow", "POST, DELETE")]).await,
    }
    let Ok(message) = serde_json::from_slice::<Value>(&request.body) else {
        let error = json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "JSON illisible" } });
        return reply(&mut stream, "400 Bad Request", Some(&error), &[]).await;
    };
    let responses: Vec<Value> = match &message {
        Value::Array(batch) => {
            let mut out = Vec::new();
            for item in batch {
                if let Some(response) = server.rpc(item).await {
                    out.push(response);
                }
            }
            out
        }
        single => server.rpc(single).await.into_iter().collect(),
    };
    match (message.is_array(), responses.len()) {
        (_, 0) => reply(&mut stream, "202 Accepted", None, &[]).await,
        (false, _) => reply(&mut stream, "200 OK", Some(&responses[0]), &[]).await,
        (true, _) => reply(&mut stream, "200 OK", Some(&Value::Array(responses)), &[]).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncBufReadExt;

    #[test]
    fn requests_are_parsed() {
        let head = "POST /mcp?x=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 12\r\nAuthorization: Bearer abc";
        let (method, path, headers, length) = parse_head(head).unwrap();
        assert_eq!((method.as_str(), path.as_str(), length), ("POST", "/mcp", 12));
        let request = Request { method, path, headers, body: vec![] };
        assert_eq!(request.header("authorization"), Some("Bearer abc"));
    }

    #[test]
    fn web_pages_cannot_reach_the_server() {
        assert!(origin_allowed(None));
        assert!(origin_allowed(Some("http://localhost:1420")));
        assert!(!origin_allowed(Some("https://evil.example")));
    }

    #[test]
    fn every_tool_has_a_schema() {
        for tool in tools() {
            assert!(tool["name"].is_string());
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
        assert!(tool_names().contains(&"speak".to_string()));
    }

    /// Dialogue complet sur une vraie socket : initialisation, liste, appel, jeton refusé.
    #[tokio::test]
    async fn speaks_mcp_over_http() {
        let dir = std::env::temp_dir().join(format!("archimed-mcp-{}", std::process::id()));
        let replies: Arc<Mutex<Option<Arc<McpServer>>>> = Arc::new(Mutex::new(None));
        let holder = replies.clone();
        // L'« interface » répond tout de suite à chaque appel.
        let emit: Emit = Arc::new(move |call: McpCall| {
            if let Some(server) = holder.lock().unwrap().clone() {
                server.respond(&call.call_id, McpReply { ok: true, text: format!("dit : {}", call.arguments["text"]), data: None });
            }
        });
        let server = McpServer::start(emit, &dir, true).await.unwrap();
        *replies.lock().unwrap() = Some(server.clone());
        server.set_ready(true);
        let declaration: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("voice.json")).unwrap()).unwrap();
        assert_eq!(declaration["mcpServers"]["archimed"]["type"], "http");
        server.set_shared(false).unwrap();
        assert!(!dir.join("voice.json").exists());
        server.set_shared(false).unwrap();
        server.set_shared(true).unwrap();
        assert!(dir.join("voice.json").exists());

        let auth = format!("Bearer {}", server.token);
        let post = |body: Value, auth: String| {
            let url = server.url();
            async move {
                let mut stream = TcpStream::connect(url.trim_start_matches("http://").trim_end_matches("/mcp")).await.unwrap();
                let body = body.to_string();
                let request = format!(
                    "POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: {auth}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(request.as_bytes()).await.unwrap();
                let mut reader = tokio::io::BufReader::new(stream);
                let mut status = String::new();
                reader.read_line(&mut status).await.unwrap();
                let mut rest = String::new();
                reader.read_to_string(&mut rest).await.unwrap();
                let body = rest.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
                (status, body)
            }
        };

        let (status, body) = post(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } }), auth.clone()).await;
        assert!(status.contains("200"));
        let init: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");

        let (status, _) = post(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), auth.clone()).await;
        assert!(status.contains("202"));

        let (_, body) = post(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }), auth.clone()).await;
        let list: Value = serde_json::from_str(&body).unwrap();
        assert!(list["result"]["tools"].as_array().unwrap().len() >= 5);

        let (_, body) = post(
            json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "speak", "arguments": { "text": "Bonjour" } } }),
            auth.clone(),
        )
        .await;
        let call: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(call["result"]["isError"], false);
        assert_eq!(call["result"]["content"][0]["text"], "dit : \"Bonjour\"");

        let (status, _) = post(json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/list" }), "Bearer faux".into()).await;
        assert!(status.contains("401"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
