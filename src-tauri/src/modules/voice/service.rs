//! État du module Voice : moteurs locaux, modèles, fournisseurs, serveur MCP, sessions.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use crate::core::error::AppErrorCode;
use crate::core::imaging::keys::{check_shape, mask, CredentialStore, KeyStore};
use crate::core::{AppError, AppResult};

use super::cloud::{self, Expressive};
use super::local::{whisper_threads, PiperEngine, Priority, WhisperServer};
use super::mcp::McpServer;
use super::models::ModelManager;
use super::types::{HardwareInfo, VoiceOption, VoiceProviderStatus, VoiceSessionSummary};
use super::{catalog, hardware};

/// Fournisseurs à clé : (identifiant, nom, compte du Gestionnaire d'identifiants).
pub const PROVIDERS: &[(&str, &str, &str)] = &[
    ("openai", "OpenAI", "voice-openai"),
    ("groq", "Groq", "voice-groq"),
    ("elevenlabs", "ElevenLabs", "voice-elevenlabs"),
    ("custom", "Serveur compatible OpenAI", "voice-custom"),
];

pub const OPENAI_URL: &str = "https://api.openai.com/v1";
pub const GROQ_URL: &str = "https://api.groq.com/openai/v1";

/// Voix proposées par OpenAI (`/audio/speech`).
const OPENAI_VOICES: &[&str] = &["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];

/// Demande de transcription venue de l'interface.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// `whisper`, `openai`, `groq`, `elevenlabs`, `voicebox`, `custom`.
    pub engine: String,
    /// WAV mono 16 kHz, encodé en base64.
    pub wav: String,
    #[serde(default)]
    pub language: Option<String>,
    /// Modèle : identifiant du catalogue (whisper) ou nom chez le fournisseur.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub priority: Priority,
}

/// Demande de synthèse venue de l'interface.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpeakRequest {
    /// `piper`, `openai`, `elevenlabs`, `voicebox`, `custom`.
    pub engine: String,
    pub text: String,
    #[serde(default)]
    pub voice: Option<String>,
    #[serde(default)]
    pub speaker: Option<u32>,
    #[serde(default = "one")]
    pub speed: f32,
    #[serde(default)]
    pub language: Option<String>,
    /// Ton ou émotion en toutes lettres (modèles qui l'acceptent seulement).
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub expressive: Expressive,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub priority: Priority,
}

fn one() -> f32 {
    1.0
}

pub struct VoiceService {
    pub http: reqwest::Client,
    pub models: Arc<ModelManager>,
    pub whisper: WhisperServer,
    pub piper: PiperEngine,
    pub mcp: Mutex<Option<Arc<McpServer>>>,
    pub chats: Mutex<HashMap<String, Arc<AtomicBool>>>,
    hardware: OnceLock<HardwareInfo>,
    module_dir: PathBuf,
}

fn io(error: std::io::Error) -> AppError {
    AppError::new(AppErrorCode::Io, error.to_string())
}

impl VoiceService {
    pub fn new(data: &Path, module_dir: PathBuf) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .user_agent(concat!("SDAI-ARCHIMED/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| AppError::internal(e.to_string()))?;
        std::fs::create_dir_all(module_dir.join("sessions")).map_err(io)?;
        Ok(Self {
            models: Arc::new(ModelManager::new(data.join("models"), http.clone())),
            http,
            whisper: WhisperServer::default(),
            piper: PiperEngine::default(),
            mcp: Mutex::new(None),
            chats: Mutex::new(HashMap::new()),
            hardware: OnceLock::new(),
            module_dir,
        })
    }

    pub fn hardware(&self) -> HardwareInfo {
        self.hardware.get_or_init(hardware::detect).clone()
    }

    fn key(&self, provider: &str) -> AppResult<Option<String>> {
        let account = PROVIDERS
            .iter()
            .find(|(id, _, _)| *id == provider)
            .map(|(_, _, account)| *account)
            .ok_or_else(|| AppError::invalid(format!("Fournisseur inconnu : {provider}")))?;
        CredentialStore::new(account).load()
    }

    fn required_key(&self, provider: &str, name: &str) -> AppResult<String> {
        self.key(provider)?.ok_or_else(|| {
            AppError::new(AppErrorCode::PermissionDenied, format!("Clé {name} absente : ajoutez-la dans Voice › Fournisseurs."))
        })
    }

    pub fn providers(&self) -> Vec<VoiceProviderStatus> {
        PROVIDERS
            .iter()
            .map(|(id, name, account)| {
                let key = CredentialStore::new(*account).load().ok().flatten();
                VoiceProviderStatus {
                    id: id.to_string(),
                    name: name.to_string(),
                    has_key: key.is_some(),
                    masked: key.as_deref().map(mask),
                    needs_key: *id != "custom",
                }
            })
            .collect()
    }

    /// Enregistre une clé après l'avoir fait vérifier par le fournisseur (sauf serveur compatible,
    /// dont l'adresse peut changer).
    pub async fn set_key(&self, provider: &str, key: &str) -> AppResult<()> {
        let key = key.trim();
        check_shape(key, "collez la clé telle qu'elle est donnée par le fournisseur.")?;
        let (name, account) = PROVIDERS
            .iter()
            .find(|(id, _, _)| *id == provider)
            .map(|(_, name, a)| (*name, *a))
            .ok_or_else(|| AppError::invalid(format!("Fournisseur inconnu : {provider}")))?;
        let base = match provider {
            "openai" => Some(OPENAI_URL),
            "groq" => Some(GROQ_URL),
            _ => None,
        };
        cloud::verify_key(&self.http, provider, name, base, key).await?;
        CredentialStore::new(account).save(key)
    }

    pub fn clear_key(&self, provider: &str) -> AppResult<()> {
        let account = PROVIDERS
            .iter()
            .find(|(id, _, _)| *id == provider)
            .map(|(_, _, a)| *a)
            .ok_or_else(|| AppError::invalid(format!("Fournisseur inconnu : {provider}")))?;
        CredentialStore::new(account).clear()
    }

    /// Exécutable d'un outil local : celui téléchargé par ARCHIMED, sinon celui du système
    /// (ex. `brew install whisper-cpp` sur macOS).
    fn runtime(&self, id: &str, fallback: &str) -> AppResult<PathBuf> {
        if let Some(path) = self.models.entry_path(id) {
            return Ok(path);
        }
        which::which(fallback).map_err(|_| {
            AppError::new(
                AppErrorCode::NotFound,
                format!("Outil local absent : téléchargez-le dans Voice › Modèles locaux ({fallback})."),
            )
        })
    }

    fn model_file(&self, id: &str) -> AppResult<PathBuf> {
        self.models.entry_path(id).ok_or_else(|| {
            let name = catalog::find(id).map(|i| i.name).unwrap_or(id);
            AppError::new(AppErrorCode::NotFound, format!("Modèle « {name} » non installé : téléchargez-le dans Voice › Modèles locaux."))
        })
    }

    /// Charge le moteur de reconnaissance locale d'avance (première phrase plus rapide).
    pub async fn prepare_whisper(&self, model: &str, language: &str, priority: Priority) -> AppResult<u16> {
        let exe = self.runtime("runtime-whisper", "whisper-server")?;
        let model = self.model_file(model)?;
        self.whisper.ensure(&self.http, &exe, &model, language, whisper_threads(priority), priority).await
    }

    pub async fn transcribe(&self, request: TranscribeRequest) -> AppResult<String> {
        use base64::Engine;
        let wav = base64::engine::general_purpose::STANDARD
            .decode(request.wav.as_bytes())
            .map_err(|_| AppError::invalid("Audio illisible."))?;
        if wav.len() < 44 {
            return Ok(String::new());
        }
        let language = request.language.as_deref().filter(|l| !l.is_empty()).map(|l| l.split('-').next().unwrap_or(l));
        match request.engine.as_str() {
            "whisper" => {
                let model = request.model.as_deref().unwrap_or("stt-whisper-base");
                let lang = language.unwrap_or("auto");
                let port = self.prepare_whisper(model, lang, request.priority).await?;
                self.whisper.transcribe(&self.http, port, wav, lang).await
            }
            "openai" => {
                let key = self.required_key("openai", "OpenAI")?;
                let model = request.model.as_deref().unwrap_or("gpt-4o-mini-transcribe");
                cloud::openai_transcribe(&self.http, "OpenAI", OPENAI_URL, Some(&key), model, language, &wav).await
            }
            "groq" => {
                let key = self.required_key("groq", "Groq")?;
                let model = request.model.as_deref().unwrap_or("whisper-large-v3-turbo");
                cloud::openai_transcribe(&self.http, "Groq", GROQ_URL, Some(&key), model, language, &wav).await
            }
            "custom" => {
                let base = cloud::check_base(request.base_url.as_deref().unwrap_or(""))?;
                let key = self.key("custom")?;
                let model = request.model.as_deref().unwrap_or("whisper-1");
                cloud::openai_transcribe(&self.http, "Serveur de reconnaissance", &base, key.as_deref(), model, language, &wav).await
            }
            "elevenlabs" => {
                let key = self.required_key("elevenlabs", "ElevenLabs")?;
                cloud::elevenlabs_transcribe(&self.http, &key, &wav, language).await
            }
            "voicebox" => {
                let base = cloud::check_base(request.base_url.as_deref().unwrap_or(cloud::VOICEBOX_URL))?;
                cloud::voicebox_transcribe(&self.http, &base, &wav, language).await
            }
            other => Err(AppError::invalid(format!("Moteur de reconnaissance inconnu : {other}"))),
        }
    }

    pub async fn synthesize(&self, request: SpeakRequest) -> AppResult<Vec<u8>> {
        let text = request.text.trim();
        if text.is_empty() {
            return Ok(Vec::new());
        }
        if text.chars().count() > 4000 {
            return Err(AppError::invalid("Texte trop long pour une seule phrase (4 000 caractères au plus)."));
        }
        match request.engine.as_str() {
            "piper" => {
                let exe = self.runtime("runtime-piper", "piper")?;
                let voice = request.voice.as_deref().unwrap_or("tts-piper-fr-siwis");
                let model = self.model_file(voice)?;
                let tmp = self.models.root().join("tmp");
                self.piper.synthesize(&exe, &model, request.speaker, request.speed, text, &tmp, request.priority).await
            }
            "openai" => {
                let key = self.required_key("openai", "OpenAI")?;
                let model = request.model.as_deref().unwrap_or("gpt-4o-mini-tts");
                let voice = request.voice.as_deref().unwrap_or("alloy");
                // Seul gpt-4o-mini-tts accepte des consignes de ton.
                let instructions = if model.contains("gpt-4o") { request.instructions.as_deref() } else { None };
                cloud::openai_speech(&self.http, "OpenAI", OPENAI_URL, Some(&key), model, voice, text, request.speed, instructions).await
            }
            "custom" => {
                let base = cloud::check_base(request.base_url.as_deref().unwrap_or(""))?;
                let key = self.key("custom")?;
                let model = request.model.as_deref().unwrap_or("kokoro");
                let voice = request.voice.as_deref().unwrap_or("ff_siwis");
                cloud::openai_speech(&self.http, "Serveur de voix", &base, key.as_deref(), model, voice, text, request.speed, None).await
            }
            "elevenlabs" => {
                let key = self.required_key("elevenlabs", "ElevenLabs")?;
                let voice = request.voice.as_deref().ok_or_else(|| AppError::invalid("Choisissez une voix ElevenLabs dans Voice › Voix."))?;
                let model = request.model.as_deref().unwrap_or("eleven_flash_v2_5");
                cloud::elevenlabs_speech(&self.http, &key, voice, model, text, request.speed, request.expressive).await
            }
            "voicebox" => {
                let base = cloud::check_base(request.base_url.as_deref().unwrap_or(cloud::VOICEBOX_URL))?;
                let profile = request.voice.as_deref().ok_or_else(|| AppError::invalid("Choisissez un profil Voicebox dans Voice › Voix."))?;
                cloud::voicebox_speech(&self.http, &base, profile, text, request.language.as_deref(), request.instructions.as_deref()).await
            }
            other => Err(AppError::invalid(format!("Moteur de voix inconnu : {other}"))),
        }
    }

    /// Voix d'un moteur (installées pour Piper, compte pour ElevenLabs, profils Voicebox).
    pub async fn voices(&self, engine: &str, base_url: Option<&str>) -> AppResult<Vec<VoiceOption>> {
        match engine {
            "piper" => Ok(catalog::CATALOG
                .iter()
                .filter(|i| i.engine == "piper" && i.kind == super::types::ModelKind::Tts && self.models.is_installed(i.id))
                .map(|i| VoiceOption {
                    id: i.id.to_string(),
                    name: i.name.to_string(),
                    language: i.languages.first().map(|l| l.to_string()),
                    custom: false,
                })
                .collect()),
            "openai" => Ok(OPENAI_VOICES
                .iter()
                .map(|v| VoiceOption { id: v.to_string(), name: v.to_string(), language: None, custom: false })
                .collect()),
            "elevenlabs" => {
                let key = self.required_key("elevenlabs", "ElevenLabs")?;
                cloud::elevenlabs_voices(&self.http, &key).await
            }
            "voicebox" => {
                let base = cloud::check_base(base_url.unwrap_or(cloud::VOICEBOX_URL))?;
                cloud::voicebox_profiles(&self.http, &base).await
            }
            _ => Ok(Vec::new()),
        }
    }

    pub async fn stop_engines(&self) {
        self.whisper.stop().await;
        self.piper.stop().await;
    }

    // ── Réglages et sessions (fichiers du module) ───────────────────────────────────

    pub fn settings(&self) -> Value {
        std::fs::read_to_string(self.module_dir.join("settings.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or(Value::Null)
    }

    pub fn save_settings(&self, settings: &Value) -> AppResult<()> {
        let body = serde_json::to_string_pretty(settings).map_err(|e| AppError::internal(e.to_string()))?;
        std::fs::write(self.module_dir.join("settings.json"), body).map_err(io)
    }

    fn session_path(&self, id: &str) -> AppResult<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(AppError::invalid("Identifiant de session invalide."));
        }
        Ok(self.module_dir.join("sessions").join(format!("{id}.json")))
    }

    pub fn sessions(&self) -> Vec<VoiceSessionSummary> {
        let Ok(entries) = std::fs::read_dir(self.module_dir.join("sessions")) else {
            return Vec::new();
        };
        let mut list: Vec<VoiceSessionSummary> = entries
            .flatten()
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
            .filter_map(|v| {
                Some(VoiceSessionSummary {
                    id: v["id"].as_str()?.to_string(),
                    title: v["title"].as_str().unwrap_or("Session vocale").to_string(),
                    started_at: v["startedAt"].as_i64().unwrap_or(0),
                    updated_at: v["updatedAt"].as_i64().unwrap_or(0),
                    turns: v["turns"].as_array().map(|t| t.len() as u32).unwrap_or(0),
                })
            })
            .collect();
        list.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
        list
    }

    pub fn session(&self, id: &str) -> AppResult<Value> {
        let raw = std::fs::read_to_string(self.session_path(id)?).map_err(|_| AppError::not_found("Session introuvable."))?;
        serde_json::from_str(&raw).map_err(|e| AppError::invalid(e.to_string()))
    }

    pub fn save_session(&self, session: &Value) -> AppResult<()> {
        let id = session["id"].as_str().ok_or_else(|| AppError::invalid("Session sans identifiant."))?;
        let body = serde_json::to_string(session).map_err(|e| AppError::internal(e.to_string()))?;
        if body.len() > 8 * 1024 * 1024 {
            return Err(AppError::invalid("Session trop longue pour être enregistrée."));
        }
        std::fs::write(self.session_path(id)?, body).map_err(io)
    }

    pub fn delete_session(&self, id: &str) -> AppResult<()> {
        let path = self.session_path(id)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(io)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> (VoiceService, PathBuf) {
        let root = std::env::temp_dir().join(format!("archimed-voice-{}-{}", std::process::id(), uuid::Uuid::new_v4().simple()));
        let service = VoiceService::new(&root, root.join("modules/voice")).unwrap();
        (service, root)
    }

    #[test]
    fn sessions_are_saved_listed_and_deleted() {
        let (service, root) = service();
        let session = serde_json::json!({ "id": "abc-1", "title": "Roadmap", "startedAt": 1, "updatedAt": 5, "turns": [{}, {}] });
        service.save_session(&session).unwrap();
        let list = service.sessions();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].title.as_str(), list[0].turns), ("Roadmap", 2));
        assert_eq!(service.session("abc-1").unwrap()["title"], "Roadmap");
        assert!(service.session_path("../x").is_err());
        service.delete_session("abc-1").unwrap();
        assert!(service.sessions().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn models_folder_is_created_with_its_categories() {
        let (_service, root) = service();
        for dir in ["stt", "tts", "llm", "voice", "runtime"] {
            assert!(root.join("models").join(dir).is_dir(), "{dir}");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn missing_models_are_explained() {
        let (service, root) = service();
        let request = SpeakRequest {
            engine: "piper".into(),
            text: "Bonjour".into(),
            voice: Some("tts-piper-fr-siwis".into()),
            speaker: None,
            speed: 1.0,
            language: None,
            instructions: None,
            expressive: Expressive::default(),
            model: None,
            base_url: None,
            priority: Priority::Normal,
        };
        let error = service.synthesize(request).await.unwrap_err();
        assert!(error.message.contains("Voice › Modèles locaux"), "{}", error.message);
        let _ = std::fs::remove_dir_all(root);
    }
}
