//! Higgsfield avec le **compte** de la personne, par la CLI officielle `higgsfield`
//! (github.com/higgsfield-ai/cli, paquet npm `@higgsfield/cli`) :
//! - `higgsfield auth login` : connexion OAuth 2.0 (PKCE) dans le navigateur de la personne,
//!   retour sur un port local ; aucun mot de passe ne passe par l'application, et le jeton
//!   reste dans les fichiers de la CLI ;
//! - `higgsfield account status --json` : e-mail, formule, crédits disponibles ;
//! - `higgsfield model list --image --json` : modèles ouverts au compte ;
//! - `higgsfield generate create <modèle> --prompt … --aspect_ratio … --image <fichier> --wait --json`.
//!
//! Les réglages de chaque modèle viennent du fichier MODELS.md du dépôt officiel (généré par
//! `higgsfield model get`) ; un modèle listé par la CLI mais absent de ce fichier est proposé
//! avec le seul texte. La CLI n'est jamais installée sans l'accord explicite de la personne.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::Value;

use crate::core::error::AppErrorCode;
use crate::core::process::async_command;
use crate::core::{AppError, AppResult};

use super::http;
use super::types::*;
use super::{wait_or_cancel, Cancel, ImageProvider};

const NAME: &str = "Higgsfield (compte)";
/// Paquet officiel ; son script d'installation télécharge le binaire `hf` depuis les
/// versions GitHub de higgsfield-ai/cli et vérifie son empreinte SHA-256.
pub const NPM_PACKAGE: &str = "@higgsfield/cli";
pub const CLI_PAGE: &str = "https://github.com/higgsfield-ai/cli";
const STATUS_TTL: Duration = Duration::from_secs(60);
const LOGIN_LIMIT: Duration = Duration::from_secs(5 * 60);
const GENERATION_LIMIT: &str = "15m";

/// Réglages d'un modèle d'image, tels que publiés dans MODELS.md (CLI 1.1.26, septembre 2026).
struct Documented {
    id: &'static str,
    name: &'static str,
    ratios: &'static [&'static str],
    resolutions: &'static [&'static str],
    qualities: &'static [&'static str],
    /// Images de référence : `None` = aucune, `Some(0)` = plusieurs (nombre non publié).
    images: Option<u32>,
    transparent: bool,
    note: &'static str,
}

const R5: &[&str] = &["1:1", "4:3", "3:4", "16:9", "9:16"];
const R10: &[&str] = &["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"];

/// Modèles d'image généralistes. Écartés : `outpaint` et `image_background_remover` (une image,
/// sans consigne) et `marketing_studio_image` (propre au parcours Marketing Studio).
const CATALOG: &[Documented] = &[
    Documented { id: "gpt_image_2_5", name: "GPT Image 2.5", ratios: &["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "27:16", "16:27", "9:8", "8:9", "4:5", "5:4"], resolutions: &["1k", "2k", "4k"], qualities: &["low", "medium", "high", "xhigh", "max"], images: Some(16), transparent: true, note: "Texte dans l'image, graphisme, retouche guidée par références." },
    Documented { id: "gpt_image_2", name: "GPT Image 2", ratios: &["1:1", "4:3", "3:4", "16:9", "21:9", "9:16", "3:2", "2:3", "4:5", "5:4"], resolutions: &["1k", "2k", "4k"], qualities: &["low", "medium", "high"], images: Some(0), transparent: true, note: "Photo produit, graphisme, texte dans l'image." },
    Documented { id: "nano_banana_2", name: "Nano Banana Pro", ratios: R10, resolutions: &["1k", "2k", "4k"], qualities: &[], images: Some(14), transparent: false, note: "Personnages, retouches guidées par références." },
    Documented { id: "nano_banana_flash", name: "Nano Banana 2", ratios: R10, resolutions: &["1k", "2k", "4k"], qualities: &[], images: Some(0), transparent: false, note: "" },
    Documented { id: "nano_banana_2_lite", name: "Nano Banana 2 Lite", ratios: R10, resolutions: &["1k"], qualities: &[], images: Some(14), transparent: false, note: "Retouches rapides guidées par références." },
    Documented { id: "nano_banana", name: "Nano Banana", ratios: R10, resolutions: &[], qualities: &[], images: Some(8), transparent: false, note: "" },
    Documented { id: "seedream_v4_5", name: "Seedream 4.5", ratios: &["1:1", "4:3", "16:9", "3:2", "21:9", "3:4", "9:16", "2:3"], resolutions: &[], qualities: &["basic", "high"], images: Some(14), transparent: false, note: "Retouches de scènes complexes avec des visages." },
    Documented { id: "seedream_v5_lite", name: "Seedream V5 Lite", ratios: R5, resolutions: &[], qualities: &["basic", "high"], images: Some(0), transparent: false, note: "" },
    Documented { id: "flux_2", name: "FLUX.2", ratios: R5, resolutions: &["1k", "2k"], qualities: &[], images: Some(0), transparent: false, note: "" },
    Documented { id: "flux_kontext", name: "Flux Kontext", ratios: R5, resolutions: &[], qualities: &[], images: Some(4), transparent: false, note: "Retouche guidée, transfert de style." },
    Documented { id: "kling_omni_image", name: "Kling O1 Image", ratios: &["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], resolutions: &["1k", "2k"], qualities: &[], images: Some(10), transparent: false, note: "" },
    Documented { id: "grok_image", name: "Grok Image", ratios: &["1:1", "1:2", "2:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"], resolutions: &["1k", "2k"], qualities: &[], images: Some(0), transparent: false, note: "" },
    Documented { id: "openai_hazel", name: "OpenAI Hazel", ratios: &["1:1", "3:2", "2:3"], resolutions: &[], qualities: &["low", "medium", "high"], images: Some(16), transparent: false, note: "" },
    Documented { id: "cinematic_studio_2_5", name: "Cinematic Studio 2.5", ratios: R10, resolutions: &["1k", "2k", "4k"], qualities: &[], images: Some(14), transparent: false, note: "Images au rendu cinéma." },
    Documented { id: "text2image_soul_v2", name: "Higgsfield Soul V2", ratios: &["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"], resolutions: &[], qualities: &["1.5k", "2k"], images: Some(1), transparent: false, note: "Mode, éditorial, personnages." },
    Documented { id: "soul_cinematic", name: "Soul Cinematic", ratios: &["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], resolutions: &[], qualities: &["1.5k", "2k"], images: Some(1), transparent: false, note: "" },
    Documented { id: "soul_location", name: "Soul Location", ratios: &["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"], resolutions: &[], qualities: &[], images: None, transparent: false, note: "Lieux et décors sans personne." },
    Documented { id: "soul_cast", name: "Soul Cast", ratios: &["16:9"], resolutions: &[], qualities: &[], images: None, transparent: false, note: "Personnages expressifs, en 16:9." },
    Documented { id: "recraft_v4_1", name: "Recraft V4.1", ratios: &["1:1", "3:4", "4:3", "4:5", "5:4", "3:2", "2:3", "16:9", "9:16"], resolutions: &["1k", "2k"], qualities: &[], images: None, transparent: false, note: "Logos, icônes, illustrations nettes." },
    Documented { id: "z_image", name: "Z Image", ratios: R5, resolutions: &[], qualities: &[], images: None, transparent: false, note: "Essais rapides, selon la documentation Higgsfield." },
    Documented { id: "image_auto", name: "Image Auto", ratios: R5, resolutions: &[], qualities: &[], images: Some(14), transparent: false, note: "Higgsfield choisit le modèle d'après la consigne." },
];

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

impl Documented {
    fn to_model(&self, source: CapabilitySource) -> ProviderModel {
        let mut caps = ModelCapabilities::minimal(source);
        caps.image_input = self.images.is_some();
        caps.max_input_images = self.images.filter(|n| *n > 0);
        caps.aspect_ratios = strings(self.ratios);
        caps.resolutions = strings(self.resolutions);
        caps.qualities = strings(self.qualities);
        caps.transparent_background = self.transparent;
        ProviderModel {
            provider: ProviderId::HiggsfieldAccount,
            id: self.id.into(),
            name: self.name.into(),
            description: if self.note.is_empty() {
                "Réglages tirés de la documentation officielle de la CLI.".into()
            } else {
                format!("{} Réglages tirés de la documentation officielle de la CLI.", self.note)
            },
            capabilities: caps,
            pricing: Vec::new(),
            free: false,
        }
    }
}

/// Binaire de la CLI : sous Windows, npm installe un `higgsfield.cmd` qui relance Node ; on
/// appelle directement le binaire `hf.exe` qu'il a téléchargé, pour que la consigne passe
/// telle quelle (pas de réinterprétation par cmd.exe).
pub fn find_binary() -> Option<PathBuf> {
    let vendor = |dir: &Path| {
        let exe = if cfg!(windows) { "hf.exe" } else { "hf" };
        let path = dir.join("node_modules").join("@higgsfield").join("cli").join("vendor").join(exe);
        path.is_file().then_some(path)
    };
    for name in ["higgsfield", "higgs"] {
        if let Ok(path) = which::which(name) {
            let script = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "cmd" | "ps1" | "bat"));
            if script {
                if let Some(found) = path.parent().and_then(vendor) {
                    return Some(found);
                }
            }
            return Some(path);
        }
    }
    std::env::var_os("APPDATA").and_then(|appdata| vendor(&PathBuf::from(appdata).join("npm")))
}

pub fn npm_available() -> bool {
    which::which("npm").is_ok()
}

/// Installation demandée et confirmée par la personne : `npm install -g @higgsfield/cli`.
pub async fn install() -> AppResult<String> {
    let npm = which::which("npm").map_err(|_| {
        AppError::invalid("npm est introuvable : installez Node.js (nodejs.org), ou la CLI depuis sa page officielle.")
    })?;
    let output = async_command(npm)
        .args(["install", "-g", NPM_PACKAGE])
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(Duration::from_secs(10 * 60), output)
        .await
        .map_err(|_| AppError::new(AppErrorCode::Network, "Installation trop longue : réessayez."))?
        .map_err(|e| AppError::internal(format!("npm : {e}")))?;
    let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(AppError::new(AppErrorCode::Network, format!("L'installation a échoué : {}", last_lines(&text, 4))));
    }
    if find_binary().is_none() {
        return Err(AppError::invalid(
            "Installée, mais introuvable dans le PATH : redémarrez ARCHIMED pour qu'il la voie.",
        ));
    }
    Ok(last_lines(&text, 3))
}

fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join(" · ")
}

pub struct HiggsfieldCli {
    http: Option<reqwest::Client>,
    tmp: PathBuf,
    cached: Mutex<Option<(Instant, ProviderStatus)>>,
}

impl HiggsfieldCli {
    pub fn new(tmp: PathBuf, builder: reqwest::ClientBuilder) -> Self {
        Self { http: http::client(builder), tmp, cached: Mutex::new(None) }
    }

    fn forget(&self) {
        if let Ok(mut cached) = self.cached.lock() {
            *cached = None;
        }
    }

    async fn run(&self, args: &[String], limit: Duration, cancel: Option<Cancel>) -> AppResult<String> {
        let binary = find_binary().ok_or_else(missing)?;
        let mut command = async_command(binary);
        command.args(args).kill_on_drop(true).stdin(std::process::Stdio::null());
        let work = async {
            tokio::time::timeout(limit, command.output())
                .await
                .map_err(|_| AppError::new(AppErrorCode::Network, "La CLI Higgsfield n'a pas répondu à temps."))?
                .map_err(|e| AppError::internal(format!("CLI Higgsfield : {e}")))
        };
        let output = match cancel {
            Some(cancel) => wait_or_cancel(work, cancel).await??,
            None => work.await?,
        };
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if output.status.success() {
            return Ok(stdout);
        }
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(cli_error(if stderr.trim().is_empty() { &stdout } else { &stderr }))
    }

    async fn fresh_status(&self) -> ProviderStatus {
        let mut status = blank_status();
        if find_binary().is_none() {
            return status;
        }
        match self.run(&args(&["account", "status", "--json"]), Duration::from_secs(20), None).await {
            Ok(out) => {
                let value = parse_json(&out);
                status.state = ConnectionState::Connected;
                let email = value.as_ref().and_then(|v| find_string(v, &["email"]));
                let plan = value.as_ref().and_then(|v| find_string(v, &["plan_name", "plan", "subscription", "tier"]));
                let credits = value.as_ref().and_then(|v| find_number(v, &["credits_exact", "credits", "balance"]));
                status.detail = Some(match (email, plan) {
                    (Some(e), Some(p)) => format!("Connecté : {e} · formule {p}"),
                    (Some(e), None) => format!("Connecté : {e}"),
                    (None, Some(p)) => format!("Connecté · formule {p}"),
                    (None, None) => "Connecté avec votre compte Higgsfield.".into(),
                });
                status.credits = credits.map(|c| format!("Crédits Higgsfield disponibles : {}", trim_number(c)));
            }
            Err(error) if signed_out(&error.message) => {
                status.state = ConnectionState::AuthRequired;
                status.detail = Some("Connectez-vous avec votre compte Higgsfield (dans votre navigateur).".into());
            }
            Err(error) => {
                status.state = ConnectionState::Error;
                status.detail = Some(error.message);
            }
        }
        status
    }
}

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|a| a.to_string()).collect()
}

fn missing() -> AppError {
    AppError::invalid("L'outil officiel Higgsfield n'est pas installé : bouton « Compte » › Higgsfield › Installer.")
}

fn signed_out(message: &str) -> bool {
    let lower = message.to_lowercase();
    ["not authenticated", "session expired", "no workspace", "auth login", "unauthorized", "session higgsfield"]
        .iter()
        .any(|w| lower.contains(w))
}

/// Message d'erreur de la CLI → français, avec la correction.
fn cli_error(raw: &str) -> AppError {
    let line = raw
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("erreur inconnue")
        .trim_start_matches("Error:")
        .trim();
    let lower = raw.to_lowercase();
    if signed_out(&lower) {
        AppError::invalid("Session Higgsfield à ouvrir : bouton « Compte » › Se connecter, avec votre compte.")
    } else if lower.contains("credit") || lower.contains("insufficient") {
        AppError::invalid("Crédits Higgsfield insuffisants : rechargez votre compte sur higgsfield.ai.")
    } else if lower.contains("nsfw") || lower.contains("moderat") {
        AppError::invalid("Demande refusée par la modération de Higgsfield : reformulez-la.")
    } else if lower.contains("unknown model") {
        AppError::not_found("Modèle introuvable chez Higgsfield : rechargez la liste des modèles.")
    } else {
        AppError::new(AppErrorCode::Network, format!("Higgsfield (CLI) : {line}"))
    }
}

fn blank_status() -> ProviderStatus {
    ProviderStatus {
        provider: ProviderId::HiggsfieldAccount,
        name: NAME.into(),
        access: ProviderAccess::Account,
        state: ConnectionState::CliMissing,
        key_source: None,
        masked_key: None,
        detail: Some(format!(
            "Outil officiel à installer une fois (npm install -g {NPM_PACKAGE}), puis connexion dans votre navigateur."
        )),
        credits: None,
        key_hint: String::new(),
        key_url: CLI_PAGE.into(),
    }
}

/// Sortie `--json` : un document, ou plusieurs (un par ligne ou à la suite).
fn parse_json(out: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(out.trim()) {
        return Some(value);
    }
    let mut values = Vec::new();
    for item in serde_json::Deserializer::from_str(out).into_iter::<Value>() {
        match item {
            Ok(value) => values.push(value),
            Err(_) => break,
        }
    }
    if values.is_empty() {
        let docs: Vec<Value> = out.lines().filter_map(|l| serde_json::from_str(l.trim()).ok()).collect();
        return (!docs.is_empty()).then_some(Value::Array(docs));
    }
    Some(if values.len() == 1 { values.remove(0) } else { Value::Array(values) })
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(Value::String(s)) = map.get(*key) {
                    if !s.is_empty() {
                        return Some(s.clone());
                    }
                }
            }
            map.values().find_map(|v| find_string(v, keys))
        }
        Value::Array(items) => items.iter().find_map(|v| find_string(v, keys)),
        _ => None,
    }
}

fn find_number(value: &Value, keys: &[&str]) -> Option<f64> {
    match value {
        Value::Object(map) => {
            for key in keys {
                match map.get(*key) {
                    Some(Value::Number(n)) => return n.as_f64(),
                    Some(Value::String(s)) => {
                        if let Ok(n) = s.parse::<f64>() {
                            return Some(n);
                        }
                    }
                    _ => {}
                }
            }
            map.values().find_map(|v| find_number(v, keys))
        }
        Value::Array(items) => items.iter().find_map(|v| find_number(v, keys)),
        _ => None,
    }
}

fn trim_number(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{n:.0}")
    } else {
        format!("{n:.2}")
    }
}

/// Identifiants de modèles dans la sortie de `model list --json`.
fn listed_models(value: &Value) -> Vec<(String, Option<String>)> {
    let mut out = Vec::new();
    let mut visit = |item: &Value| {
        if let Value::Object(map) = item {
            let id = ["job_set_type", "job_type", "id", "type"]
                .iter()
                .find_map(|k| map.get(*k).and_then(Value::as_str).map(str::to_string));
            let name = ["display_name", "name"].iter().find_map(|k| map.get(*k).and_then(Value::as_str).map(str::to_string));
            if let Some(id) = id.filter(|i| i.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')) {
                out.push((id, name));
            }
        }
    };
    match value {
        Value::Array(items) => items.iter().for_each(&mut visit),
        Value::Object(map) => {
            for key in ["models", "items", "data", "image"] {
                if let Some(Value::Array(items)) = map.get(key) {
                    items.iter().for_each(&mut visit);
                }
            }
        }
        _ => {}
    }
    out
}

/// Adresses des images produites : liens HTTPS d'images, hors vignettes et aperçus.
fn result_urls(value: &Value) -> Vec<String> {
    fn walk(value: &Value, key: &str, out: &mut Vec<(bool, String)>) {
        match value {
            Value::String(s) if s.starts_with("https://") => {
                let lower_key = key.to_lowercase();
                if ["thumb", "preview", "avatar", "icon", "favicon", "report", "min_url"].iter().any(|w| lower_key.contains(w)) {
                    return;
                }
                let path = s.split(['?', '#']).next().unwrap_or(s).to_lowercase();
                let image = [".png", ".jpg", ".jpeg", ".webp"].iter().any(|e| path.ends_with(e));
                if image || lower_key.contains("url") || lower_key == "raw" {
                    out.push((image, s.clone()));
                }
            }
            Value::Array(items) => items.iter().for_each(|v| walk(v, key, out)),
            Value::Object(map) => map.iter().for_each(|(k, v)| walk(v, k, out)),
            _ => {}
        }
    }
    let mut found = Vec::new();
    walk(value, "", &mut found);
    // Les liens d'image d'abord ; les autres seulement s'il n'y en a aucun.
    let images: Vec<String> = found.iter().filter(|(img, _)| *img).map(|(_, u)| u.clone()).collect();
    let mut urls = if images.is_empty() { found.into_iter().map(|(_, u)| u).collect() } else { images };
    let mut seen = std::collections::HashSet::new();
    urls.retain(|u| seen.insert(u.clone()));
    urls
}

#[async_trait]
impl ImageProvider for HiggsfieldCli {
    fn id(&self) -> ProviderId {
        ProviderId::HiggsfieldAccount
    }

    async fn status(&self, check: bool) -> ProviderStatus {
        if !check {
            if let Ok(cached) = self.cached.lock() {
                if let Some((at, status)) = cached.as_ref() {
                    if at.elapsed() < STATUS_TTL {
                        return status.clone();
                    }
                }
            }
        }
        let status = self.fresh_status().await;
        if let Ok(mut cached) = self.cached.lock() {
            *cached = Some((Instant::now(), status.clone()));
        }
        status
    }

    async fn set_key(&self, _key: &str) -> AppResult<ProviderStatus> {
        Err(AppError::invalid("Higgsfield (compte) n'utilise pas de clé : « Se connecter » ouvre la connexion dans votre navigateur."))
    }

    fn clear_key(&self) -> AppResult<()> {
        let binary = find_binary().ok_or_else(missing)?;
        crate::core::process::command(binary)
            .args(["auth", "logout"])
            .output()
            .map_err(|e| AppError::internal(format!("CLI Higgsfield : {e}")))?;
        self.forget();
        Ok(())
    }

    async fn login(&self) -> AppResult<ProviderStatus> {
        self.forget();
        // La CLI ouvre la page de connexion de Higgsfield dans le navigateur et attend le retour.
        self.run(&args(&["auth", "login"]), LOGIN_LIMIT, None).await.map_err(|error| {
            if error.message.contains("à temps") {
                AppError::invalid("Connexion non terminée dans le navigateur : relancez « Se connecter ».")
            } else {
                error
            }
        })?;
        self.forget();
        Ok(self.status(true).await)
    }

    async fn models(&self) -> AppResult<ModelList> {
        let documented: Vec<ProviderModel> = CATALOG.iter().map(|d| d.to_model(CapabilitySource::Docs)).collect();
        if find_binary().is_none() {
            return Ok(ModelList {
                provider: ProviderId::HiggsfieldAccount,
                models: documented,
                offline: false,
                note: Some("Installez la CLI officielle et connectez-vous pour générer avec votre compte.".into()),
            });
        }
        let live = self
            .run(&args(&["model", "list", "--image", "--json"]), Duration::from_secs(30), None)
            .await
            .ok()
            .and_then(|out| parse_json(&out))
            .map(|v| listed_models(&v))
            .unwrap_or_default();
        if live.is_empty() {
            return Ok(ModelList {
                provider: ProviderId::HiggsfieldAccount,
                models: documented,
                offline: false,
                note: Some("Liste tirée de la documentation officielle (la liste en direct demande d'être connecté).".into()),
            });
        }
        let skipped = ["outpaint", "image_background_remover", "marketing_studio_image"];
        let mut models: Vec<ProviderModel> = Vec::new();
        for (id, name) in &live {
            if skipped.contains(&id.as_str()) {
                continue;
            }
            match CATALOG.iter().find(|d| d.id == id) {
                Some(doc) => models.push(doc.to_model(CapabilitySource::Api)),
                None => {
                    let mut caps = ModelCapabilities::minimal(CapabilitySource::Api);
                    caps.text_to_image = true;
                    models.push(ProviderModel {
                        provider: ProviderId::HiggsfieldAccount,
                        id: id.clone(),
                        name: name.clone().unwrap_or_else(|| id.clone()),
                        description: "Nouveau modèle de votre compte : réglages non documentés, texte seulement.".into(),
                        capabilities: caps,
                        pricing: Vec::new(),
                        free: false,
                    });
                }
            }
        }
        Ok(ModelList { provider: ProviderId::HiggsfieldAccount, models, offline: false, note: None })
    }

    async fn generate(&self, request: &ImageRequest, cancel: Cancel) -> AppResult<ImageResponse> {
        let doc = CATALOG.iter().find(|d| d.id == request.model);
        let mut list = vec!["generate".to_string(), "create".into(), request.model.clone()];
        if !request.prompt.trim().is_empty() {
            list.extend(["--prompt".into(), request.prompt.clone()]);
        }
        if let Some(ratio) = &request.aspect_ratio {
            list.extend(["--aspect_ratio".into(), ratio.clone()]);
        }
        if let Some(resolution) = &request.resolution {
            list.extend(["--resolution".into(), resolution.clone()]);
        }
        if let Some(quality) = &request.quality {
            list.extend(["--quality".into(), quality.clone()]);
        }
        if request.transparent_background && doc.is_some_and(|d| d.transparent) {
            list.extend(["--background".into(), "transparent".into()]);
        }
        // Images d'entrée : fichiers temporaires, envoyés par la CLI (effacés ensuite).
        std::fs::create_dir_all(&self.tmp)?;
        let limit = doc.and_then(|d| d.images).filter(|n| *n > 0).unwrap_or(u32::MAX) as usize;
        let mut files = Vec::new();
        for (i, image) in request.images.iter().take(limit).enumerate() {
            let ext = if image.mime == "image/jpeg" { "jpg" } else if image.mime == "image/webp" { "webp" } else { "png" };
            let path = self.tmp.join(format!("in-{}-{i}.{ext}", uuid::Uuid::new_v4().simple()));
            std::fs::write(&path, &image.bytes)?;
            list.extend(["--image".into(), path.to_string_lossy().to_string()]);
            files.push(path);
        }
        list.extend(["--wait".into(), "--wait-timeout".into(), GENERATION_LIMIT.into(), "--json".into()]);
        let result = self.run(&list, Duration::from_secs(16 * 60), Some(cancel)).await;
        for file in files {
            let _ = std::fs::remove_file(file);
        }
        let out = result?;
        let value = parse_json(&out).ok_or_else(|| AppError::internal("réponse de la CLI Higgsfield illisible"))?;
        if let Some(status) = find_string(&value, &["status", "job_status"]) {
            let lower = status.to_lowercase();
            if lower == "nsfw" {
                return Err(AppError::invalid("Demande refusée par la modération de Higgsfield : reformulez-la."));
            }
            if lower == "failed" {
                let reason = find_string(&value, &["fail_reason", "error"]).unwrap_or_default();
                return Err(AppError::new(AppErrorCode::Network, format!("La génération a échoué chez Higgsfield. {reason}")));
            }
        }
        let http = self.http.as_ref().ok_or_else(|| AppError::internal("client HTTP indisponible"))?;
        let mut images = Vec::new();
        for url in result_urls(&value) {
            let bytes = http::download(http, NAME, &url).await?;
            if http::sniff_mime(&bytes).starts_with("image/") {
                images.push(GeneratedImage { bytes });
            }
        }
        if images.is_empty() {
            return Err(AppError::invalid("Higgsfield n'a renvoyé aucune image : reformulez ou changez de modèle."));
        }
        self.forget();
        Ok(ImageResponse {
            images,
            usage: ImageUsage {
                cost_usd: None,
                input_tokens: None,
                output_tokens: None,
                note: Some("Crédits débités sur votre compte Higgsfield (solde dans Connexions).".into()),
            },
            dropped: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_matches_the_documented_flags() {
        let gpt = CATALOG.iter().find(|d| d.id == "gpt_image_2_5").unwrap().to_model(CapabilitySource::Docs);
        assert!(gpt.capabilities.transparent_background && gpt.capabilities.image_input);
        assert_eq!(gpt.capabilities.max_input_images, Some(16));
        assert!(gpt.capabilities.qualities.contains(&"max".to_string()));
        let z = CATALOG.iter().find(|d| d.id == "z_image").unwrap().to_model(CapabilitySource::Docs);
        assert!(!z.capabilities.image_input, "modèle texte seul");
        let flux = CATALOG.iter().find(|d| d.id == "flux_2").unwrap().to_model(CapabilitySource::Docs);
        assert_eq!(flux.capabilities.max_input_images, None, "plusieurs, nombre non publié");
        assert!(CATALOG.len() >= 20);
        let mut ids: Vec<&str> = CATALOG.iter().map(|d| d.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len(), "pas de doublon");
    }

    #[test]
    fn results_are_image_links_and_errors_say_what_to_do() {
        let out = r#"{"id":"j1","status":"completed","result":{"url":"https://cdn.hf/x.png?sig=1","thumbnail_url":"https://cdn.hf/t.png"}}
{"report_url":"https://hf/r"}"#;
        let value = parse_json(out).unwrap();
        assert_eq!(result_urls(&value), vec!["https://cdn.hf/x.png?sig=1"]);
        let plain = parse_json(r#"{"images":[{"url":"https://cdn.hf/a"}]}"#).unwrap();
        assert_eq!(result_urls(&plain), vec!["https://cdn.hf/a"]);
        assert!(cli_error("Error: Session expired").message.contains("Se connecter"));
        assert!(cli_error("Error: not enough credits").message.contains("Crédits"));
        assert!(cli_error("Error: Unknown model \"x\"").message.contains("introuvable"));
        assert!(signed_out("Error: No workspace selected."));
    }

    #[test]
    fn model_lists_and_account_fields_are_read_loosely() {
        let list = parse_json(r#"[{"job_set_type":"nano_banana_2","display_name":"Nano Banana Pro"},{"job_set_type":"bad id!"}]"#).unwrap();
        assert_eq!(listed_models(&list), vec![("nano_banana_2".to_string(), Some("Nano Banana Pro".to_string()))]);
        let account = parse_json(r#"{"user":{"email":"a@b.c"},"wallet":{"credits":"120.5"},"plan":"pro"}"#).unwrap();
        assert_eq!(find_string(&account, &["email"]).as_deref(), Some("a@b.c"));
        assert_eq!(find_number(&account, &["credits"]), Some(120.5));
        assert_eq!(trim_number(12.0), "12");
    }
}
