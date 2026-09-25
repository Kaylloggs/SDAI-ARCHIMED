//! API Gemini de Google (clé Google AI Studio), modèles d'image « Nano Banana », vérifiée sur
//! le SDK officiel `@google/genai` :
//! - `GET /models` : modèles qui acceptent `generateContent` et produisent des images ;
//! - `POST /models/{modèle}:generateContent` : texte + images d'entrée (`inlineData`) →
//!   image ; `generationConfig.imageConfig` : `aspectRatio` (« 1:1 », « 2:3 », « 3:2 », « 3:4 »,
//!   « 4:3 », « 9:16 », « 16:9 », « 21:9 ») et `imageSize` (« 1K », « 2K », « 4K »).
//! - L'édition à masque, l'agrandissement et la segmentation d'image (`editImage`,
//!   `upscaleImage`, `segmentImage`) n'existent que sur Vertex AI : ils ne sont pas proposés ici.
//!   Une édition passe par une consigne et des images d'entrée.
//! - Un modèle qui refuse `imageSize` (ou `imageConfig`) est réessayé sans ; le refus est
//!   mémorisé pour ne plus proposer le réglage.
//! - Le coût n'est pas renvoyé par l'API : seuls les tokens le sont.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::http;
use super::keys::{check_shape, mask, KeyRing};
use super::types::*;
use super::{wait_or_cancel, Cancel, ImageProvider};

pub const DEFAULT_API: &str = "https://generativelanguage.googleapis.com/v1beta";
const NAME: &str = "Google";
const GENERATION_TIMEOUT: Duration = Duration::from_secs(300);
/// Formats acceptés par `imageConfig.aspectRatio` (SDK `@google/genai`, `ImageConfig`).
const ASPECTS: [&str; 8] = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];
/// Paliers acceptés par `imageConfig.imageSize`.
const SIZES: [&str; 3] = ["1K", "2K", "4K"];

/// Noms commerciaux des modèles d'image de Gemini, reconnus dans leur identifiant.
const NICKNAMES: &[(&str, &str)] = &[
    ("3.1-flash-image", "Nano Banana 2"),
    ("3-pro-image", "Nano Banana Pro"),
    ("2.5-flash-image", "Nano Banana"),
];

pub struct Gemini {
    api: String,
    http: Option<reqwest::Client>,
    keys: KeyRing,
    cache: PathBuf,
    /// Réglages refusés par un modèle : `{ modèle: ["imageSize", …] }`.
    refused: Mutex<BTreeMap<String, Vec<String>>>,
}

impl Gemini {
    pub fn new(api: &str, keys: KeyRing, cache: PathBuf, builder: reqwest::ClientBuilder) -> Self {
        let refused = std::fs::read(refused_path(&cache))
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default();
        Self {
            api: api.trim_end_matches('/').to_string(),
            http: http::client(builder),
            keys,
            cache,
            refused: Mutex::new(refused),
        }
    }

    fn http(&self) -> AppResult<&reqwest::Client> {
        self.http
            .as_ref()
            .ok_or_else(|| AppError::internal("client HTTP indisponible"))
    }

    fn key(&self) -> AppResult<String> {
        self.keys.resolve()?.map(|(key, _)| key).ok_or_else(|| {
            AppError::invalid(
                "Aucune clé Google AI Studio : ajoutez-la dans Connexions (aistudio.google.com/apikey).",
            )
        })
    }

    fn refuses(&self, model: &str, setting: &str) -> bool {
        self.refused
            .lock()
            .map(|r| r.get(model).is_some_and(|list| list.iter().any(|s| s == setting)))
            .unwrap_or(false)
    }

    fn learn_refusal(&self, model: &str, setting: &str) {
        if let Ok(mut refused) = self.refused.lock() {
            let list = refused.entry(model.to_string()).or_default();
            if !list.iter().any(|s| s == setting) {
                list.push(setting.to_string());
            }
            if let Some(dir) = self.cache.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Ok(raw) = serde_json::to_vec(&*refused) {
                let _ = std::fs::write(refused_path(&self.cache), raw);
            }
        }
    }

    /// `GET /models`, toutes les pages.
    async fn list(&self, key: &str) -> AppResult<Vec<Value>> {
        let mut all = Vec::new();
        let mut page: Option<String> = None;
        for _ in 0..5 {
            let mut url = reqwest::Url::parse(&format!("{}/models", self.api))
                .map_err(|e| AppError::internal(format!("adresse de l'API Gemini invalide : {e}")))?;
            url.query_pairs_mut().append_pair("pageSize", "1000");
            if let Some(token) = &page {
                url.query_pairs_mut().append_pair("pageToken", token);
            }
            let response = self
                .http()?
                .get(url)
                .header("x-goog-api-key", key)
                .timeout(Duration::from_secs(25))
                .send()
                .await
                .map_err(|e| http::unreachable(NAME, e))?;
            let status = response.status().as_u16();
            let body = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
            if status != 200 {
                return Err(api_error(status, &body));
            }
            let value: Value = serde_json::from_str(&body)
                .map_err(|e| AppError::internal(format!("liste des modèles illisible : {e}")))?;
            all.extend(value["models"].as_array().cloned().unwrap_or_default());
            match value["nextPageToken"].as_str().filter(|t| !t.is_empty()) {
                Some(token) => page = Some(token.to_string()),
                None => break,
            }
        }
        Ok(all)
    }

    async fn image_models(&self, key: &str) -> AppResult<Vec<ProviderModel>> {
        let mut models = image_models(&self.list(key).await?);
        for model in &mut models {
            if self.refuses(&model.id, "imageSize") {
                model.capabilities.resolutions.clear();
            }
            if self.refuses(&model.id, "imageConfig") {
                model.capabilities.resolutions.clear();
                model.capabilities.aspect_ratios.clear();
            }
        }
        Ok(models)
    }

    async fn call(&self, key: &str, model: &str, body: &Value, timeout: Duration) -> AppResult<(u16, String)> {
        let response = self
            .http()?
            .post(format!("{}/models/{model}:generateContent", self.api))
            .header("x-goog-api-key", key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .timeout(timeout)
            .send()
            .await
            .map_err(|e| http::unreachable(NAME, e))?;
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
        Ok((status, text))
    }
}

fn refused_path(cache: &std::path::Path) -> PathBuf {
    cache.with_file_name("gemini-refused-settings.json")
}

#[async_trait]
impl ImageProvider for Gemini {
    fn id(&self) -> ProviderId {
        ProviderId::Gemini
    }

    async fn status(&self, check: bool) -> ProviderStatus {
        let mut status = blank_status();
        let resolved = match self.keys.resolve() {
            Ok(resolved) => resolved,
            Err(error) => {
                status.state = ConnectionState::Error;
                status.detail = Some(error.message);
                return status;
            }
        };
        let Some((key, source)) = resolved else {
            return status;
        };
        status.masked_key = Some(mask(&key));
        status.key_source = Some(source);
        status.state = ConnectionState::Disconnected;
        if check {
            match self.image_models(&key).await {
                Ok(models) if models.is_empty() => {
                    status.state = ConnectionState::ModelUnavailable;
                    status.detail = Some("La clé est acceptée, mais aucun modèle d'image n'est ouvert pour ce projet Google.".into());
                }
                Ok(models) => {
                    super::remember(&self.cache, &models);
                    status.state = ConnectionState::Connected;
                    status.detail = Some(format!(
                        "{} modèle{} d'image. Facturé sur le projet Google de la clé.",
                        models.len(),
                        if models.len() > 1 { "s" } else { "" }
                    ));
                }
                Err(error) => {
                    status.state = if matches!(error.code, AppErrorCode::InvalidInput) {
                        ConnectionState::AuthRequired
                    } else {
                        ConnectionState::Error
                    };
                    status.detail = Some(error.message);
                }
            }
        }
        status
    }

    async fn set_key(&self, key: &str) -> AppResult<ProviderStatus> {
        let key = key.trim();
        check_shape(key, "copiez-la telle quelle depuis aistudio.google.com/apikey.")?;
        let models = self.image_models(key).await?;
        self.keys.save_own(key)?;
        super::remember(&self.cache, &models);
        crate::core::audit::record("imaging.key", "gemini", "saved", "user");
        Ok(self.status(true).await)
    }

    fn clear_key(&self) -> AppResult<()> {
        self.keys.clear_own()?;
        let _ = std::fs::remove_file(&self.cache);
        crate::core::audit::record("imaging.key", "gemini", "removed", "user");
        Ok(())
    }

    async fn models(&self) -> AppResult<ModelList> {
        let key = self.key()?;
        match self.image_models(&key).await {
            Ok(models) => {
                super::remember(&self.cache, &models);
                Ok(ModelList {
                    provider: ProviderId::Gemini,
                    note: models.is_empty().then(|| "Aucun modèle d'image ouvert pour cette clé.".into()),
                    models,
                    offline: false,
                })
            }
            Err(error) if matches!(error.code, AppErrorCode::Network) => match super::recall(&self.cache) {
                Some(models) => Ok(ModelList {
                    provider: ProviderId::Gemini,
                    models,
                    offline: true,
                    note: Some(format!("Liste enregistrée ({})", error.message)),
                }),
                None => Err(error),
            },
            Err(error) => Err(error),
        }
    }

    async fn generate(&self, request: &ImageRequest, cancel: Cancel) -> AppResult<ImageResponse> {
        let key = self.key()?;
        let mut aspect = request.aspect_ratio.clone();
        let mut size = request
            .resolution
            .clone()
            .filter(|_| !self.refuses(&request.model, "imageSize"));
        if self.refuses(&request.model, "imageConfig") {
            aspect = None;
            size = None;
        }
        let mut dropped = Vec::new();
        // Au plus trois essais : tout, sans résolution, sans aucun réglage d'image.
        for _ in 0..3 {
            let body = request_body(request, aspect.as_deref(), size.as_deref());
            let (status, text) =
                wait_or_cancel(self.call(&key, &request.model, &body, GENERATION_TIMEOUT), cancel.clone()).await??;
            if status == 400 {
                let lower = text.to_lowercase();
                if size.is_some() && (lower.contains("image_size") || lower.contains("imagesize")) {
                    self.learn_refusal(&request.model, "imageSize");
                    size = None;
                    dropped.push("résolution".to_string());
                    continue;
                }
                if (aspect.is_some() || size.is_some())
                    && (lower.contains("image_config") || lower.contains("imageconfig") || lower.contains("aspect"))
                {
                    self.learn_refusal(&request.model, "imageConfig");
                    aspect = None;
                    size = None;
                    dropped.push("format".to_string());
                    continue;
                }
            }
            if status != 200 {
                return Err(api_error(status, &text));
            }
            let mut response = parse_generation(&text)?;
            response.dropped = dropped;
            return Ok(response);
        }
        Err(AppError::invalid("Le modèle refuse cette demande : changez de modèle."))
    }

    async fn improve_prompt(&self, prompt: &str, instructions: &str) -> AppResult<PromptSuggestion> {
        let key = self.key()?;
        let model = pick_text_model(&self.list(&key).await?)
            .ok_or_else(|| AppError::invalid("Aucun modèle de texte Gemini n'est ouvert pour cette clé."))?;
        let body = json!({
            "systemInstruction": { "parts": [{ "text": instructions }] },
            "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        });
        let (status, text) = self.call(&key, &model, &body, Duration::from_secs(90)).await?;
        if status != 200 {
            return Err(api_error(status, &text));
        }
        let value: Value = serde_json::from_str(&text)?;
        let rewritten: String = value["candidates"][0]["content"]["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("")
            .trim()
            .to_string();
        if rewritten.is_empty() {
            return Err(AppError::invalid("Le modèle de texte n'a rien proposé : réessayez."));
        }
        Ok(PromptSuggestion {
            prompt: rewritten,
            usage: usage(&value),
            model,
        })
    }
}

fn blank_status() -> ProviderStatus {
    ProviderStatus {
        provider: ProviderId::Gemini,
        access: ProviderAccess::Key,
        name: "Google AI Studio (Gemini)".into(),
        state: ConnectionState::ApiKeyMissing,
        key_source: None,
        masked_key: None,
        detail: None,
        credits: None,
        key_hint: "Clé API Google AI Studio (AIza…)".into(),
        key_url: "https://aistudio.google.com/apikey".into(),
    }
}

fn nickname(id: &str) -> Option<&'static str> {
    NICKNAMES
        .iter()
        .find(|(fragment, _)| id.contains(fragment))
        .map(|(_, name)| *name)
}

/// Modèles d'image utilisables avec `generateContent` (les Imagen passent par `predict`).
pub(crate) fn image_models(list: &[Value]) -> Vec<ProviderModel> {
    let mut models: Vec<ProviderModel> = list
        .iter()
        .filter_map(|model| {
            let id = model["name"].as_str()?.trim_start_matches("models/");
            let generates = model["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|methods| methods.iter().any(|m| m == "generateContent"));
            if !generates || !id.contains("image") || id.contains("imagen") {
                return None;
            }
            let display = model["displayName"].as_str().unwrap_or(id);
            let name = match nickname(id) {
                Some(nick) if !display.contains(nick) => format!("{nick} · {display}"),
                _ => display.to_string(),
            };
            let mut capabilities = ModelCapabilities::minimal(CapabilitySource::Docs);
            capabilities.image_input = true;
            capabilities.aspect_ratios = ASPECTS.iter().map(|a| a.to_string()).collect();
            // La première génération (2.5) produit une taille fixe ; les suivantes ont des paliers.
            if !id.contains("2.5-flash-image") {
                capabilities.resolutions = SIZES.iter().map(|s| s.to_string()).collect();
            }
            Some(ProviderModel {
                provider: ProviderId::Gemini,
                id: id.to_string(),
                name,
                description: model["description"].as_str().unwrap_or("").chars().take(240).collect(),
                capabilities,
                pricing: Vec::new(),
                // Facturé sur le projet Google de la clé : jamais présenté comme gratuit.
                free: false,
            })
        })
        .collect();
    let preview = |m: &ProviderModel| m.id.contains("preview") || m.id.contains("exp");
    models.sort_by(|a, b| preview(a).cmp(&preview(b)).then(b.id.cmp(&a.id)));
    models.dedup_by(|a, b| a.id == b.id);
    models
}

/// Modèle de texte rapide et stable pour réécrire une description.
fn pick_text_model(list: &[Value]) -> Option<String> {
    let excluded = ["image", "imagen", "tts", "audio", "live", "embedding", "vision", "aqa", "learnlm"];
    let mut ids: Vec<&str> = list
        .iter()
        .filter(|m| {
            m["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|methods| methods.iter().any(|x| x == "generateContent"))
        })
        .filter_map(|m| m["name"].as_str())
        .map(|name| name.trim_start_matches("models/"))
        .filter(|id| id.starts_with("gemini") && id.contains("flash") && !excluded.iter().any(|x| id.contains(x)))
        .collect();
    let preview = |id: &&str| id.contains("preview") || id.contains("exp");
    ids.sort_by(|a, b| preview(a).cmp(&preview(b)).then(b.cmp(a)));
    ids.first().map(|id| id.to_string())
}

pub(crate) fn request_body(request: &ImageRequest, aspect: Option<&str>, size: Option<&str>) -> Value {
    let mut parts = vec![json!({ "text": request.prompt })];
    for image in &request.images {
        parts.push(json!({ "inlineData": {
            "mimeType": image.mime,
            "data": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &image.bytes),
        } }));
    }
    let mut config = json!({ "responseModalities": ["TEXT", "IMAGE"] });
    let mut image_config = serde_json::Map::new();
    if let Some(aspect) = aspect {
        image_config.insert("aspectRatio".into(), json!(aspect));
    }
    if let Some(size) = size {
        image_config.insert("imageSize".into(), json!(size));
    }
    if !image_config.is_empty() {
        config["imageConfig"] = Value::Object(image_config);
    }
    json!({ "contents": [{ "role": "user", "parts": parts }], "generationConfig": config })
}

fn usage(value: &Value) -> ImageUsage {
    let meta = &value["usageMetadata"];
    ImageUsage {
        cost_usd: None,
        input_tokens: meta["promptTokenCount"].as_u64(),
        output_tokens: meta["candidatesTokenCount"].as_u64(),
        note: Some("Coût non communiqué par l'API : facturé par Google sur le projet de la clé.".into()),
    }
}

pub(crate) fn parse_generation(body: &str) -> AppResult<ImageResponse> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::internal(format!("réponse de Gemini illisible : {e}")))?;
    if let Some(reason) = value["promptFeedback"]["blockReason"].as_str() {
        return Err(AppError::invalid(format!(
            "Demande refusée par le filtre de sécurité de Google ({reason}) : reformulez-la."
        )));
    }
    let mut images = Vec::new();
    let mut said = Vec::new();
    for candidate in value["candidates"].as_array().into_iter().flatten() {
        for part in candidate["content"]["parts"].as_array().into_iter().flatten() {
            if let Some(data) = part.get("inlineData").or_else(|| part.get("inline_data")) {
                if let Some(encoded) = data["data"].as_str() {
                    images.push(GeneratedImage { bytes: http::decode_base64(encoded)? });
                }
            } else if let Some(text) = part["text"].as_str() {
                said.push(text.to_string());
            }
        }
    }
    if images.is_empty() {
        let finish = value["candidates"][0]["finishReason"].as_str().unwrap_or("");
        if matches!(finish, "SAFETY" | "IMAGE_SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "SPII" | "RECITATION") {
            return Err(AppError::invalid(format!(
                "Image refusée par le filtre de sécurité de Google ({finish}) : reformulez la demande."
            )));
        }
        let said: String = said.join(" ").chars().take(200).collect();
        return Err(AppError::invalid(if said.trim().is_empty() {
            "Le modèle n'a renvoyé aucune image : réessayez ou changez de modèle.".to_string()
        } else {
            format!("Le modèle a répondu sans image : « {} ». Reformulez ou changez de modèle.", said.trim())
        }));
    }
    Ok(ImageResponse {
        images,
        usage: usage(&value),
        dropped: Vec::new(),
    })
}

/// Erreur de l'API Gemini → explication en français, avec son message quand il y en a un.
fn api_error(status: u16, body: &str) -> AppError {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let error = &value["error"];
    let detail: String = error["message"].as_str().unwrap_or("").chars().take(300).collect();
    let reasons: Vec<&str> = error["details"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| d["reason"].as_str())
        .collect();
    let with_detail = |text: &str| {
        if detail.is_empty() {
            text.to_string()
        } else {
            format!("{text} ({detail})")
        }
    };
    let bad_key =
        reasons.iter().any(|r| r.contains("API_KEY")) || detail.to_lowercase().contains("api key not valid");
    let (code, message) = match status {
        400 | 401 | 403 if bad_key => (
            AppErrorCode::InvalidInput,
            "Clé Google refusée : vérifiez-la ou créez-en une sur aistudio.google.com/apikey.".to_string(),
        ),
        400 if error["status"] == "FAILED_PRECONDITION" => (
            AppErrorCode::InvalidInput,
            with_detail("L'API Gemini n'est pas ouverte pour ce compte (pays non couvert ou facturation à activer sur le projet de la clé)"),
        ),
        400 => (AppErrorCode::InvalidInput, with_detail("Demande refusée par le modèle")),
        401 | 403 => (
            AppErrorCode::InvalidInput,
            with_detail("Cette clé n'a pas accès à l'API Gemini (projet Google sans l'API activée ou clé restreinte)"),
        ),
        404 => (
            AppErrorCode::NotFound,
            "Modèle introuvable chez Google : il a peut-être été retiré. Rechargez la liste.".to_string(),
        ),
        429 => (
            AppErrorCode::Network,
            "Quota Gemini atteint : les modèles d'image n'ont pas (ou plus) de quota gratuit. Activez la facturation sur le projet de la clé dans Google AI Studio, ou réessayez plus tard.".to_string(),
        ),
        500 | 502 | 503 | 504 => (
            AppErrorCode::Network,
            "Modèle momentanément indisponible chez Google : réessayez dans un instant.".to_string(),
        ),
        other => (AppErrorCode::Network, with_detail(&format!("L'API Gemini a répondu {other}"))),
    };
    AppError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::imaging::keys::MemoryStore;
    use crate::core::imaging::test_server::{fake_server, tiny_png, Reply};
    use std::sync::{Arc, Mutex};

    const MODELS: &str = r#"{"models":[
      {"name":"models/gemini-3.5-flash","displayName":"Gemini 3.5 Flash","supportedGenerationMethods":["generateContent"]},
      {"name":"models/gemini-3.5-flash-preview","supportedGenerationMethods":["generateContent"]},
      {"name":"models/gemini-2.5-flash-image","displayName":"Nano Banana","supportedGenerationMethods":["generateContent"]},
      {"name":"models/gemini-3-pro-image-preview","displayName":"Gemini 3 Pro Image","supportedGenerationMethods":["generateContent"]},
      {"name":"models/imagen-4.0-generate-001","supportedGenerationMethods":["predict"]}
    ]}"#;

    #[test]
    fn image_models_and_their_settings() {
        let list: Value = serde_json::from_str(MODELS).unwrap();
        let models = image_models(list["models"].as_array().unwrap());
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"]);
        assert!(models[0].capabilities.resolutions.is_empty());
        assert_eq!(models[1].capabilities.resolutions, ["1K", "2K", "4K"]);
        assert_eq!(models[1].capabilities.aspect_ratios.len(), 8);
        assert!(models.iter().all(|m| m.capabilities.image_input && !m.capabilities.native_mask && !m.free));
        assert_eq!(models[1].name, "Nano Banana Pro · Gemini 3 Pro Image");
        assert_eq!(pick_text_model(list["models"].as_array().unwrap()).as_deref(), Some("gemini-3.5-flash"));
    }

    #[test]
    fn request_carries_images_and_only_the_given_settings() {
        let request = ImageRequest {
            model: "m".into(),
            prompt: "remplace la voiture".into(),
            images: vec![InputImage { bytes: vec![1], mime: "image/jpeg".into() }],
            ..Default::default()
        };
        let body = request_body(&request, Some("16:9"), None);
        assert_eq!(body["contents"][0]["parts"][1]["inlineData"]["mimeType"], "image/jpeg");
        assert_eq!(body["generationConfig"]["imageConfig"], json!({"aspectRatio":"16:9"}));
        let body = request_body(&request, None, None);
        assert!(body["generationConfig"].get("imageConfig").is_none());
    }

    #[tokio::test]
    async fn a_refused_resolution_is_dropped_remembered_and_hidden() {
        let png = tiny_png();
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let api = fake_server(seen.clone(), move |line, head, body| {
            if !head.contains("x-goog-api-key: good") {
                return Reply::json(400, r#"{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}"#);
            }
            if line.starts_with("GET /v1beta/models") {
                return Reply::json(200, MODELS);
            }
            if body.contains("imageSize") {
                return Reply::json(400, r#"{"error":{"message":"image_size is not supported for this model"}}"#);
            }
            if line.contains("gemini-3.5-flash:generateContent") {
                return Reply::json(200, r#"{"candidates":[{"content":{"parts":[{"text":"Un chevalier en armure"}]}}]}"#);
            }
            Reply::json(200, &format!(r#"{{"candidates":[{{"content":{{"parts":[{{"text":"voici"}},{{"inlineData":{{"mimeType":"image/png","data":"{b64}"}}}}]}}}}],"usageMetadata":{{"promptTokenCount":12,"candidatesTokenCount":1290}}}}"#))
        })
        .await;
        let dir = std::env::temp_dir().join(format!("imaging-gemini-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let gemini = Gemini::new(
            &format!("{api}/v1beta"),
            KeyRing::with_stores(Box::new(MemoryStore::default()), Vec::new()),
            dir.join("models.json"),
            reqwest::Client::builder().no_proxy(),
        );
        assert!(gemini.set_key("bad").await.err().unwrap().message.contains("Clé Google refusée"));
        let status = gemini.set_key("good").await.unwrap();
        assert_eq!(status.state, ConnectionState::Connected);

        let (_tx, cancel) = crate::core::imaging::cancel_pair();
        let request = ImageRequest {
            model: "gemini-3-pro-image-preview".into(),
            prompt: "un chevalier".into(),
            resolution: Some("4K".into()),
            aspect_ratio: Some("16:9".into()),
            count: 1,
            ..Default::default()
        };
        let response = gemini.generate(&request, cancel).await.unwrap();
        assert_eq!(response.images.len(), 1);
        assert_eq!(response.dropped, ["résolution"]);
        assert_eq!(response.usage.output_tokens, Some(1290));
        assert!(response.usage.cost_usd.is_none());
        let list = gemini.models().await.unwrap();
        let pro = list.models.iter().find(|m| m.id == "gemini-3-pro-image-preview").unwrap();
        assert!(pro.capabilities.resolutions.is_empty(), "refus mémorisé");

        let suggestion = gemini.improve_prompt("chevalier", "Réécris").await.unwrap();
        assert_eq!(suggestion.prompt, "Un chevalier en armure");
        assert_eq!(suggestion.model, "gemini-3.5-flash");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
