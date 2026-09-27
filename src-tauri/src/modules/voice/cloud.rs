//! Moteurs vocaux par API : fournisseurs en ligne (OpenAI, Groq, ElevenLabs) et serveurs
//! compatibles lancés sur la machine (Voicebox, Kokoro-FastAPI, LocalAI…).
//!
//! La clé reste dans le Gestionnaire d'identifiants ; elle n'est ajoutée qu'ici, à l'envoi.
//! Une adresse locale (`localhost`, `127.0.0.1`) est signalée « LOCAL » dans l'interface :
//! rien ne quitte alors la machine.

use std::time::Duration;

use serde_json::{json, Value};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::types::{LocalServerStatus, VoiceOption};

/// Corps `multipart/form-data` minimal (fichier audio + champs texte).
pub struct Multipart {
    boundary: String,
    body: Vec<u8>,
}

impl Default for Multipart {
    fn default() -> Self {
        Self::new()
    }
}

impl Multipart {
    pub fn new() -> Self {
        Self { boundary: format!("archimed-{}", uuid::Uuid::new_v4().simple()), body: Vec::new() }
    }

    pub fn text(&mut self, name: &str, value: &str) {
        self.body.extend_from_slice(
            format!("--{}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n", self.boundary).as_bytes(),
        );
    }

    pub fn file(&mut self, name: &str, filename: &str, mime: &str, data: &[u8]) {
        self.body.extend_from_slice(
            format!(
                "--{}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n",
                self.boundary
            )
            .as_bytes(),
        );
        self.body.extend_from_slice(data);
        self.body.extend_from_slice(b"\r\n");
    }

    pub fn finish(mut self) -> (String, Vec<u8>) {
        self.body.extend_from_slice(format!("--{}--\r\n", self.boundary).as_bytes());
        (format!("multipart/form-data; boundary={}", self.boundary), self.body)
    }
}

/// L'adresse désigne-t-elle la machine elle-même ?
pub fn is_local_url(url: &str) -> bool {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let host = rest.split(['/', '?']).next().unwrap_or("");
    let host = if host.starts_with('[') {
        host.split(']').next().unwrap_or("").trim_start_matches('[')
    } else {
        host.split(':').next().unwrap_or("")
    };
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "0.0.0.0") || host.starts_with("127.")
}

/// Adresse de base : seulement http(s), sans barre finale. Pas de http en clair hors machine.
pub fn check_base(url: &str) -> AppResult<String> {
    let url = url.trim().trim_end_matches('/').to_string();
    if url.starts_with("https://") || (url.starts_with("http://") && is_local_url(&url)) {
        Ok(url)
    } else {
        Err(AppError::invalid("Adresse refusée : https:// obligatoire (http:// seulement pour un serveur sur cette machine)."))
    }
}

/// Corps JSON (le client HTTP est compilé sans l'option `json` de reqwest).
pub fn with_json(builder: reqwest::RequestBuilder, body: &Value) -> reqwest::RequestBuilder {
    builder.header(reqwest::header::CONTENT_TYPE, "application/json").body(body.to_string())
}

/// Réponse JSON ; `Value::Null` si le corps n'en est pas.
pub async fn read_json(response: reqwest::Response) -> Result<Value, reqwest::Error> {
    let bytes = response.bytes().await?;
    Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn network(provider: &str, error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::new(AppErrorCode::Network, format!("{provider} n'a pas répondu à temps."))
    } else if error.is_connect() {
        AppError::new(AppErrorCode::Network, format!("{provider} injoignable : vérifiez la connexion ou que le serveur est lancé."))
    } else {
        AppError::new(AppErrorCode::Network, format!("{provider} : {error}"))
    }
}

async fn failure(provider: &str, response: reqwest::Response) -> AppError {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["detail"]["message"].as_str())
                .or_else(|| v["detail"].as_str())
                .or_else(|| v["error"].as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    let hint = match status.as_u16() {
        401 | 403 => " Vérifiez la clé dans Voice › Installations.",
        429 => " Limite atteinte : réessayez dans un moment.",
        _ => "",
    };
    AppError::new(AppErrorCode::Network, format!("{provider} ({status}) : {}{hint}", detail.trim()))
}

// ── OpenAI et compatibles (Groq, serveurs locaux) ────────────────────────────────────

pub async fn openai_transcribe(
    http: &reqwest::Client,
    provider: &str,
    base: &str,
    key: Option<&str>,
    model: &str,
    language: Option<&str>,
    wav: &[u8],
) -> AppResult<String> {
    let mut form = Multipart::new();
    form.file("file", "audio.wav", "audio/wav", wav);
    form.text("model", model);
    form.text("response_format", "json");
    if let Some(lang) = language.filter(|l| !l.is_empty() && *l != "auto") {
        form.text("language", lang);
    }
    let (content_type, body) = form.finish();
    let mut request = http
        .post(format!("{base}/audio/transcriptions"))
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(body)
        .timeout(Duration::from_secs(60));
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|e| network(provider, e))?;
    if !response.status().is_success() {
        return Err(failure(provider, response).await);
    }
    let value: Value = read_json(response).await.map_err(|e| network(provider, e))?;
    Ok(value["text"].as_str().unwrap_or("").trim().to_string())
}

#[allow(clippy::too_many_arguments)]
pub async fn openai_speech(
    http: &reqwest::Client,
    provider: &str,
    base: &str,
    key: Option<&str>,
    model: &str,
    voice: &str,
    input: &str,
    speed: f32,
    instructions: Option<&str>,
) -> AppResult<Vec<u8>> {
    let mut body = json!({ "model": model, "voice": voice, "input": input, "response_format": "mp3", "speed": speed.clamp(0.25, 4.0) });
    // `instructions` (ton, émotion) : seulement les modèles qui l'acceptent.
    if let Some(text) = instructions.filter(|t| !t.trim().is_empty()) {
        body["instructions"] = json!(text);
    }
    let mut request = with_json(http.post(format!("{base}/audio/speech")), &body).timeout(Duration::from_secs(60));
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|e| network(provider, e))?;
    if !response.status().is_success() {
        return Err(failure(provider, response).await);
    }
    Ok(response.bytes().await.map_err(|e| network(provider, e))?.to_vec())
}

// ── ElevenLabs ───────────────────────────────────────────────────────────────────────

const ELEVENLABS: &str = "https://api.elevenlabs.io/v1";

#[derive(Clone, Copy, Debug, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Expressive {
    /// 0 : très expressif, 1 : très stable.
    pub stability: Option<f32>,
    /// 0 à 1 : accentue le style du locuteur.
    pub style: Option<f32>,
}

pub async fn elevenlabs_speech(
    http: &reqwest::Client,
    key: &str,
    voice: &str,
    model: &str,
    text: &str,
    speed: f32,
    expressive: Expressive,
) -> AppResult<Vec<u8>> {
    let body = json!({
        "text": text,
        "model_id": model,
        "voice_settings": {
            "stability": expressive.stability.unwrap_or(0.5).clamp(0.0, 1.0),
            "similarity_boost": 0.75,
            "style": expressive.style.unwrap_or(0.0).clamp(0.0, 1.0),
            "speed": speed.clamp(0.7, 1.2),
        }
    });
    let response = http
        .post(format!("{ELEVENLABS}/text-to-speech/{voice}?output_format=mp3_44100_128"))
        .header("xi-api-key", key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| network("ElevenLabs", e))?;
    if !response.status().is_success() {
        return Err(failure("ElevenLabs", response).await);
    }
    Ok(response.bytes().await.map_err(|e| network("ElevenLabs", e))?.to_vec())
}

/// Vérifie une clé auprès du fournisseur avant de l'enregistrer (requête de lecture gratuite).
/// Une clé ElevenLabs restreinte (sans droit de lecture du compte) est acceptée : elle est valide.
pub async fn verify_key(http: &reqwest::Client, provider: &str, name: &str, base: Option<&str>, key: &str) -> AppResult<()> {
    let request = match (provider, base) {
        ("elevenlabs", _) => http.get(format!("{ELEVENLABS}/models")).header("xi-api-key", key),
        (_, Some(base)) => http.get(format!("{base}/models")).bearer_auth(key),
        _ => return Ok(()),
    };
    let response = request.timeout(Duration::from_secs(15)).send().await.map_err(|e| network(name, e))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    if provider == "elevenlabs" && status.as_u16() == 401 {
        let body = response.text().await.unwrap_or_default();
        if body.contains("missing_permissions") {
            return Ok(());
        }
        return Err(AppError::new(AppErrorCode::PermissionDenied, format!("Clé refusée par {name}.")));
    }
    if matches!(status.as_u16(), 401 | 403) {
        return Err(AppError::new(AppErrorCode::PermissionDenied, format!("Clé refusée par {name}.")));
    }
    Err(failure(name, response).await)
}

pub async fn elevenlabs_voices(http: &reqwest::Client, key: &str) -> AppResult<Vec<VoiceOption>> {
    let response = http
        .get(format!("{ELEVENLABS}/voices"))
        .header("xi-api-key", key)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| network("ElevenLabs", e))?;
    if !response.status().is_success() {
        return Err(failure("ElevenLabs", response).await);
    }
    let value: Value = read_json(response).await.map_err(|e| network("ElevenLabs", e))?;
    Ok(value["voices"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|v| {
            Some(VoiceOption {
                id: v["voice_id"].as_str()?.to_string(),
                name: v["name"].as_str().unwrap_or("Voix").to_string(),
                language: v["labels"]["language"].as_str().map(str::to_string),
                // Voix clonées ou conçues par la personne sur ElevenLabs (avec son accord).
                custom: matches!(v["category"].as_str(), Some("cloned" | "generated" | "professional")),
            })
        })
        .collect())
}

pub async fn elevenlabs_transcribe(http: &reqwest::Client, key: &str, wav: &[u8], language: Option<&str>) -> AppResult<String> {
    let mut form = Multipart::new();
    form.file("file", "audio.wav", "audio/wav", wav);
    form.text("model_id", "scribe_v1");
    if let Some(lang) = language.filter(|l| !l.is_empty() && *l != "auto") {
        form.text("language_code", lang);
    }
    let (content_type, body) = form.finish();
    let response = http
        .post(format!("{ELEVENLABS}/speech-to-text"))
        .header("xi-api-key", key)
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(body)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| network("ElevenLabs", e))?;
    if !response.status().is_success() {
        return Err(failure("ElevenLabs", response).await);
    }
    let value: Value = read_json(response).await.map_err(|e| network("ElevenLabs", e))?;
    Ok(value["text"].as_str().unwrap_or("").trim().to_string())
}

// ── Voicebox (serveur local, github.com/jamiepine/voicebox) ──────────────────────────

pub const VOICEBOX_URL: &str = "http://127.0.0.1:17493";

pub async fn voicebox_status(http: &reqwest::Client, base: &str) -> LocalServerStatus {
    let health = http.get(format!("{base}/health")).timeout(Duration::from_secs(2)).send().await;
    let running = health.as_ref().is_ok_and(|r| r.status().is_success());
    let profiles = if running { voicebox_profiles(http, base).await.unwrap_or_default() } else { Vec::new() };
    LocalServerStatus { running, url: base.to_string(), version: None, models: profiles.into_iter().map(|p| p.name).collect() }
}

pub async fn voicebox_profiles(http: &reqwest::Client, base: &str) -> AppResult<Vec<VoiceOption>> {
    let response = http
        .get(format!("{base}/profiles"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| network("Voicebox", e))?;
    if !response.status().is_success() {
        return Err(failure("Voicebox", response).await);
    }
    let value: Value = read_json(response).await.map_err(|e| network("Voicebox", e))?;
    let list = value.as_array().cloned().or_else(|| value["profiles"].as_array().cloned()).unwrap_or_default();
    Ok(list
        .iter()
        .filter_map(|p| {
            Some(VoiceOption {
                id: p["id"].as_str().map(str::to_string).or_else(|| p["id"].as_i64().map(|n| n.to_string()))?,
                name: p["name"].as_str().unwrap_or("Profil").to_string(),
                language: p["language"].as_str().map(str::to_string),
                custom: true,
            })
        })
        .collect())
}

pub async fn voicebox_transcribe(http: &reqwest::Client, base: &str, wav: &[u8], language: Option<&str>) -> AppResult<String> {
    let mut form = Multipart::new();
    form.file("file", "audio.wav", "audio/wav", wav);
    if let Some(lang) = language.filter(|l| !l.is_empty() && *l != "auto") {
        form.text("language", lang);
    }
    let (content_type, body) = form.finish();
    let response = http
        .post(format!("{base}/transcribe"))
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(body)
        .timeout(Duration::from_secs(90))
        .send()
        .await
        .map_err(|e| network("Voicebox", e))?;
    if !response.status().is_success() {
        return Err(failure("Voicebox", response).await);
    }
    let value: Value = read_json(response).await.map_err(|e| network("Voicebox", e))?;
    Ok(value["text"].as_str().unwrap_or("").trim().to_string())
}

/// Synthèse avec un profil de voix Voicebox (`POST /generate/stream` → WAV).
pub async fn voicebox_speech(
    http: &reqwest::Client,
    base: &str,
    profile: &str,
    text: &str,
    language: Option<&str>,
    instruct: Option<&str>,
) -> AppResult<Vec<u8>> {
    let mut body = json!({ "profile_id": profile, "text": text });
    if let Some(lang) = language.filter(|l| !l.is_empty()) {
        body["language"] = json!(lang.split('-').next().unwrap_or(lang));
    }
    if let Some(instruct) = instruct.filter(|t| !t.trim().is_empty()) {
        body["instruct"] = json!(instruct);
    }
    let response = http
        .post(format!("{base}/generate/stream"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| network("Voicebox", e))?;
    if !response.status().is_success() {
        return Err(failure("Voicebox", response).await);
    }
    Ok(response.bytes().await.map_err(|e| network("Voicebox", e))?.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multipart_body_has_fields_and_closing_boundary() {
        let mut form = Multipart::new();
        form.text("model", "whisper-1");
        form.file("file", "audio.wav", "audio/wav", b"RIFF");
        let (content_type, body) = form.finish();
        let boundary = content_type.split("boundary=").nth(1).unwrap().to_string();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"model\"\r\n\r\nwhisper-1\r\n"));
        assert!(text.contains("filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\nRIFF\r\n"));
        assert!(text.ends_with(&format!("--{boundary}--\r\n")));
    }

    #[test]
    fn local_urls_are_recognised() {
        assert!(is_local_url("http://127.0.0.1:17493"));
        assert!(is_local_url("http://localhost:8880/v1"));
        assert!(is_local_url("http://[::1]:8080"));
        assert!(!is_local_url("https://api.openai.com/v1"));
        assert!(!is_local_url("https://localhost.evil.com/v1"));
    }

    #[test]
    fn plain_http_is_only_allowed_on_this_machine() {
        assert_eq!(check_base("http://localhost:8880/v1/").unwrap(), "http://localhost:8880/v1");
        assert!(check_base("https://api.groq.com/openai/v1").is_ok());
        assert!(check_base("http://example.com/v1").is_err());
        assert!(check_base("ftp://x").is_err());
    }
}
