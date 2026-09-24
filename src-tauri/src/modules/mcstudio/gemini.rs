//! Génération d'images par l'API Gemini de Google (modèles « Nano Banana »), avec la clé
//! Google AI Studio de la personne.
//!
//! - L'abonnement Google AI Pro ne donne pas accès à l'API : il faut une clé créée sur
//!   aistudio.google.com/apikey. Les images sont facturées sur le projet Google de la clé (les
//!   crédits Google Cloud offerts avec l'abonnement s'y appliquent) : chaque génération demande
//!   l'accord explicite de la personne.
//! - La clé vit dans le Gestionnaire d'identifiants de Windows (`secrets`), part seulement dans
//!   l'en-tête `x-goog-api-key` (jamais dans l'adresse) et ne revient jamais vers l'interface.
//! - La liste des modèles est lue en direct (`/models`, modèles « image » qui acceptent
//!   `generateContent`) et gardée en cache.
//! - Source remplaçable (HTTPS uniquement) : `{"geminiApi": "https://…"}` dans
//!   `<données>/modules/mcstudio/env.json`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::secrets::{check_shape, CredentialStore, KeyStore};
use super::types::{GeminiStatus, ImageModel, ImageModelList};

const DEFAULT_API: &str = "https://generativelanguage.googleapis.com/v1beta";
/// Une image se fait en 5 à 60 secondes selon le modèle et la charge.
const GENERATION_TIMEOUT: Duration = Duration::from_secs(180);

/// Noms commerciaux des modèles d'image de Gemini, reconnus dans leur identifiant.
const NICKNAMES: &[(&str, &str)] = &[
    ("3.1-flash-image", "Nano Banana 2"),
    ("3-pro-image", "Nano Banana Pro"),
    ("2.5-flash-image", "Nano Banana"),
];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvSettings {
    gemini_api: Option<String>,
}

pub struct Gemini {
    api: String,
    http: Option<reqwest::Client>,
    store: Box<dyn KeyStore>,
    cache: PathBuf,
}

impl Gemini {
    pub fn new(module_dir: &Path) -> Self {
        let settings: EnvSettings = std::fs::read_to_string(module_dir.join("env.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let api = settings
            .gemini_api
            .filter(|url| url.starts_with("https://"))
            .unwrap_or_else(|| DEFAULT_API.to_string());
        Self::with_parts(
            &api,
            Box::new(CredentialStore::new("mcstudio-gemini")),
            module_dir.join("cache").join("gemini-models.json"),
            reqwest::Client::builder(),
        )
    }

    fn with_parts(
        api: &str,
        store: Box<dyn KeyStore>,
        cache: PathBuf,
        builder: reqwest::ClientBuilder,
    ) -> Self {
        let http = builder
            .connect_timeout(Duration::from_secs(15))
            .user_agent(concat!(
                "SDAI-ARCHIMED-ModStudio/",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .map_err(|e| tracing::warn!("client HTTP indisponible : {e}"))
            .ok();
        Self {
            api: api.trim_end_matches('/').to_string(),
            http,
            store,
            cache,
        }
    }

    fn http(&self) -> AppResult<&reqwest::Client> {
        self.http
            .as_ref()
            .ok_or_else(|| AppError::internal("client HTTP indisponible"))
    }

    fn key(&self) -> AppResult<String> {
        self.store.load()?.ok_or_else(|| {
            AppError::invalid(
                "Aucune clé Google AI Studio : ajoutez-la dans Environnement (liste des projets).",
            )
        })
    }

    /// Clé présente ? Avec `check`, l'API dit aussi combien de modèles d'image elle ouvre.
    pub async fn status(&self, check: bool) -> AppResult<GeminiStatus> {
        let Some(key) = self.store.load()? else {
            return Ok(GeminiStatus::default());
        };
        let mut status = GeminiStatus {
            configured: true,
            ..GeminiStatus::default()
        };
        if check {
            match self.fetch_models(&key).await {
                Ok(models) => status.image_models = Some(models.len() as u32),
                Err(error) => status.problem = Some(error.message),
            }
        }
        Ok(status)
    }

    /// Vérifie la clé auprès de Google (liste des modèles), puis la range. Une clé refusée
    /// n'est pas gardée.
    pub async fn set_key(&self, key: &str) -> AppResult<GeminiStatus> {
        let key = key.trim();
        check_shape(
            key,
            "copiez-la telle quelle depuis aistudio.google.com/apikey.",
        )?;
        let models = self.fetch_models(key).await?;
        self.store.save(key)?;
        self.remember(&models);
        crate::core::audit::record("mcstudio.gemini_key", "gemini", "saved", "user");
        Ok(GeminiStatus {
            configured: true,
            image_models: Some(models.len() as u32),
            problem: None,
        })
    }

    pub fn clear_key(&self) -> AppResult<()> {
        self.store.clear()?;
        let _ = std::fs::remove_file(&self.cache);
        crate::core::audit::record("mcstudio.gemini_key", "gemini", "removed", "user");
        Ok(())
    }

    /// Modèles d'image ouverts par la clé ; le cache prend le relais hors connexion.
    pub async fn models(&self) -> AppResult<ImageModelList> {
        let key = self.key()?;
        match self.fetch_models(&key).await {
            Ok(models) => {
                self.remember(&models);
                Ok(ImageModelList {
                    models,
                    offline: false,
                })
            }
            Err(error) if matches!(error.code, AppErrorCode::Network) => {
                let cached: Option<Vec<ImageModel>> = std::fs::read(&self.cache)
                    .ok()
                    .and_then(|raw| serde_json::from_slice(&raw).ok());
                match cached {
                    Some(models) => Ok(ImageModelList {
                        models,
                        offline: true,
                    }),
                    None => Err(error),
                }
            }
            Err(error) => Err(error),
        }
    }

    fn remember(&self, models: &[ImageModel]) {
        if let Some(dir) = self.cache.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(raw) = serde_json::to_vec(models) {
            let _ = std::fs::write(&self.cache, raw);
        }
    }

    /// `GET /models`, toutes les pages, filtré sur les modèles d'image.
    async fn fetch_models(&self, key: &str) -> AppResult<Vec<ImageModel>> {
        let mut models = Vec::new();
        let mut page: Option<String> = None;
        // Quelques pages au plus : la liste tient aujourd'hui en une.
        for _ in 0..5 {
            let mut url = reqwest::Url::parse(&format!("{}/models", self.api)).map_err(|e| {
                AppError::internal(format!("adresse de l'API Gemini invalide : {e}"))
            })?;
            url.query_pairs_mut().append_pair("pageSize", "1000");
            if let Some(token) = &page {
                url.query_pairs_mut().append_pair("pageToken", token);
            }
            let response = self
                .http()?
                .get(url)
                .header("x-goog-api-key", key)
                .timeout(Duration::from_secs(20))
                .send()
                .await
                .map_err(unreachable)?;
            let status = response.status().as_u16();
            let body = response.text().await.map_err(unreachable)?;
            if status != 200 {
                return Err(api_error(status, &body));
            }
            let (found, next) = parse_models(&body)?;
            models.extend(found);
            match next {
                Some(token) => page = Some(token),
                None => break,
            }
        }
        sort_models(&mut models);
        Ok(models)
    }

    /// Envoie la demande au modèle (avec une image de référence en PNG si fournie) et renvoie
    /// l'image reçue (PNG, JPEG ou WebP). `aspect` : format demandé (« 1:1 », « 21:9 »…).
    pub async fn generate(
        &self,
        model: &ImageModel,
        prompt: &str,
        reference: Option<&[u8]>,
        aspect: &str,
    ) -> AppResult<Vec<u8>> {
        let key = self.key()?;
        let ask = |with_format: bool| Ask {
            key: &key,
            model,
            prompt,
            reference,
            aspect: with_format.then_some(aspect),
        };
        match self.request_image(ask(true)).await {
            // Modèle qui ne connaît pas `imageConfig` : même demande sans le format
            // (la conversion recadre de toute façon).
            Err(Rejected::ImageConfig(_)) => self
                .request_image(ask(false))
                .await
                .map_err(Rejected::into_error),
            other => other.map_err(Rejected::into_error),
        }
    }

    async fn request_image(&self, ask: Ask<'_>) -> Result<Vec<u8>, Rejected> {
        let Ask {
            key,
            model,
            prompt,
            reference,
            aspect,
        } = ask;
        let mut config = json!({ "responseModalities": ["TEXT", "IMAGE"] });
        if let Some(aspect) = aspect {
            config["imageConfig"] = json!({ "aspectRatio": aspect });
        }
        let mut parts = vec![json!({ "text": prompt })];
        if let Some(png) = reference {
            parts.push(json!({ "inlineData": {
                "mimeType": "image/png",
                "data": base64::engine::general_purpose::STANDARD.encode(png),
            } }));
        }
        let request = json!({
            "contents": [{ "role": "user", "parts": parts }],
            "generationConfig": config,
        });
        let response = self
            .http()
            .map_err(Rejected::Other)?
            .post(format!("{}/models/{}:generateContent", self.api, model.id))
            .header("x-goog-api-key", key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(request.to_string())
            .timeout(GENERATION_TIMEOUT)
            .send()
            .await
            .map_err(|e| Rejected::Other(unreachable(e)))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .map_err(|e| Rejected::Other(unreachable(e)))?;
        if status == 400 && aspect.is_some() && mentions_image_config(&body) {
            return Err(Rejected::ImageConfig(api_error(status, &body)));
        }
        if status != 200 {
            return Err(Rejected::Other(api_error(status, &body)));
        }
        first_image(&body).map_err(Rejected::Other)
    }
}

/// Une demande d'image.
struct Ask<'a> {
    key: &'a str,
    model: &'a ImageModel,
    prompt: &'a str,
    reference: Option<&'a [u8]>,
    aspect: Option<&'a str>,
}

enum Rejected {
    /// Le modèle refuse le réglage de format : on réessaie sans.
    ImageConfig(AppError),
    Other(AppError),
}

impl Rejected {
    fn into_error(self) -> AppError {
        match self {
            Rejected::ImageConfig(error) | Rejected::Other(error) => error,
        }
    }
}

fn mentions_image_config(body: &str) -> bool {
    let lower = body.to_lowercase();
    lower.contains("image_config") || lower.contains("imageconfig") || lower.contains("aspect")
}

fn unreachable(error: reqwest::Error) -> AppError {
    let message = if error.is_timeout() {
        "Google n'a pas répondu à temps : réessayez.".to_string()
    } else {
        format!("API Gemini injoignable ({error}) : une connexion Internet est nécessaire.")
    };
    AppError::new(AppErrorCode::Network, message)
}

/// Erreur de l'API Gemini → explication en français, avec son message quand il y en a un.
fn api_error(status: u16, body: &str) -> AppError {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let error = &value["error"];
    let detail: String = error["message"]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(300)
        .collect();
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
    let bad_key = reasons.iter().any(|r| r.contains("API_KEY"))
        || detail.to_lowercase().contains("api key not valid");
    let (code, message) = match status {
        400 | 401 | 403 if bad_key => (
            AppErrorCode::InvalidInput,
            "Clé Google refusée : vérifiez-la ou créez-en une sur aistudio.google.com/apikey."
                .to_string(),
        ),
        400 if error["status"] == "FAILED_PRECONDITION" => (
            AppErrorCode::InvalidInput,
            with_detail(
                "L'API Gemini n'est pas ouverte pour ce compte (pays non couvert ou facturation à activer sur le projet de la clé)",
            ),
        ),
        400 => (
            AppErrorCode::InvalidInput,
            with_detail("Demande refusée par le modèle"),
        ),
        401 | 403 => (
            AppErrorCode::InvalidInput,
            with_detail("Cette clé n'a pas accès à l'API Gemini (projet Google sans l'API activée ou clé restreinte)"),
        ),
        404 => (
            AppErrorCode::NotFound,
            "Modèle introuvable chez Google : il a peut-être été retiré. Rechargez la liste."
                .to_string(),
        ),
        429 => (
            AppErrorCode::Network,
            "Quota Gemini atteint : les modèles d'image n'ont pas (ou plus) de quota gratuit. Activez la facturation sur le projet de la clé dans Google AI Studio (les crédits Google Cloud de l'abonnement Google AI Pro s'y appliquent), ou réessayez plus tard."
                .to_string(),
        ),
        500 | 502 | 503 | 504 => (
            AppErrorCode::Network,
            "Modèle momentanément indisponible chez Google : réessayez dans un instant.".to_string(),
        ),
        other => (
            AppErrorCode::Network,
            with_detail(&format!("L'API Gemini a répondu {other}")),
        ),
    };
    AppError::new(code, message)
}

fn nickname(id: &str) -> Option<&'static str> {
    NICKNAMES
        .iter()
        .find(|(fragment, _)| id.contains(fragment))
        .map(|(_, name)| *name)
}

/// Page de `/models` → modèles d'image utilisables avec `generateContent`, et page suivante.
fn parse_models(body: &str) -> AppResult<(Vec<ImageModel>, Option<String>)> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::internal(format!("liste des modèles illisible : {e}")))?;
    let models = value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model["name"].as_str()?.trim_start_matches("models/");
            let generates = model["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|methods| methods.iter().any(|m| m == "generateContent"));
            // Les modèles Imagen passent par `predict` : ils restent hors liste.
            if !generates || !id.contains("image") || id.contains("imagen") {
                return None;
            }
            let display = model["displayName"].as_str().unwrap_or(id);
            let name = match nickname(id) {
                Some(nick) if !display.contains(nick) => format!("{nick} · {display}"),
                _ => display.to_string(),
            };
            let description: String = model["description"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(220)
                .collect();
            Some(ImageModel {
                id: id.to_string(),
                name,
                // Facturé sur le projet Google de la clé : jamais présenté comme gratuit.
                free: false,
                description,
                text_output: true,
                image_input: true,
            })
        })
        .collect();
    let next = value["nextPageToken"]
        .as_str()
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    Ok((models, next))
}

/// Versions stables avant les préversions, les plus récentes d'abord.
fn sort_models(models: &mut Vec<ImageModel>) {
    models.sort_by(|a, b| {
        let preview = |m: &ImageModel| m.id.contains("preview") || m.id.contains("exp");
        preview(a).cmp(&preview(b)).then(b.id.cmp(&a.id))
    });
    models.dedup_by(|a, b| a.id == b.id);
}

/// Première image de la réponse (`candidates[0].content.parts[*].inlineData`).
fn first_image(body: &str) -> AppResult<Vec<u8>> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::internal(format!("réponse de Gemini illisible : {e}")))?;
    if let Some(reason) = value["promptFeedback"]["blockReason"].as_str() {
        return Err(AppError::invalid(format!(
            "Description refusée par le filtre de sécurité de Google ({reason}) : reformulez-la."
        )));
    }
    let candidate = &value["candidates"][0];
    let parts = candidate["content"]["parts"].as_array();
    let inline = parts.into_iter().flatten().find_map(|part| {
        let data = part.get("inlineData").or_else(|| part.get("inline_data"))?;
        data["data"].as_str()
    });
    if let Some(encoded) = inline {
        return base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .map_err(|e| AppError::internal(format!("image reçue illisible : {e}")));
    }
    let finish = candidate["finishReason"].as_str().unwrap_or("");
    if matches!(
        finish,
        "SAFETY" | "IMAGE_SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "SPII" | "RECITATION"
    ) {
        return Err(AppError::invalid(format!(
            "Image refusée par le filtre de sécurité de Google ({finish}) : reformulez la description."
        )));
    }
    let said: String = parts
        .into_iter()
        .flatten()
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(200)
        .collect();
    Err(AppError::invalid(if said.trim().is_empty() {
        "Le modèle n'a renvoyé aucune image : réessayez ou changez de modèle.".to_string()
    } else {
        format!(
            "Le modèle a répondu sans image : « {} ». Reformulez ou changez de modèle.",
            said.trim()
        )
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::pixelart;
    use crate::modules::mcstudio::secrets::MemoryStore;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const MODELS: &str = r#"{"models":[
        {"name":"models/gemini-3.5-flash","displayName":"Gemini 3.5 Flash",
         "supportedGenerationMethods":["generateContent","countTokens"]},
        {"name":"models/gemini-2.5-flash-image","displayName":"Nano Banana",
         "description":"Fast image generation.","supportedGenerationMethods":["generateContent"]},
        {"name":"models/gemini-3.1-flash-image-preview","displayName":"Gemini 3.1 Flash Image Preview",
         "supportedGenerationMethods":["generateContent"]},
        {"name":"models/gemini-3.1-flash-image","displayName":"Gemini 3.1 Flash Image",
         "supportedGenerationMethods":["generateContent","countTokens"]},
        {"name":"models/imagen-4.0-generate-001","displayName":"Imagen 4",
         "supportedGenerationMethods":["predict"]},
        {"name":"models/gemini-3-pro-image","displayName":"Gemini 3 Pro Image",
         "supportedGenerationMethods":["generateContent"]}
    ]}"#;

    fn tiny_png() -> Vec<u8> {
        let mut raster = pixelart::Raster::new(4, 4);
        raster.px[5] = [0, 128, 255, 255];
        raster.png().unwrap()
    }

    /// Faux service Gemini local : répond selon le chemin, exige l'en-tête « x-goog-api-key: good ».
    async fn fake_gemini(seen: Arc<Mutex<Vec<String>>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let seen = seen.clone();
                tokio::spawn(async move {
                    let mut raw = Vec::new();
                    let mut buffer = [0u8; 8192];
                    let (head, body) = loop {
                        let n = socket.read(&mut buffer).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        raw.extend_from_slice(&buffer[..n]);
                        let text = String::from_utf8_lossy(&raw).to_string();
                        if let Some((head, body)) = text.split_once("\r\n\r\n") {
                            let length = head
                                .lines()
                                .find_map(|l| {
                                    l.to_ascii_lowercase()
                                        .strip_prefix("content-length:")
                                        .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                                })
                                .unwrap_or(0);
                            if body.len() >= length {
                                break (head.to_string(), body.to_string());
                            }
                        }
                    };
                    let line = head.lines().next().unwrap_or("").to_string();
                    let authorized = head
                        .lines()
                        .any(|l| l.eq_ignore_ascii_case("x-goog-api-key: good"));
                    seen.lock().unwrap().push(format!("{line}\n{body}"));
                    let image = base64::engine::general_purpose::STANDARD.encode(tiny_png());
                    let (status, reply) = if !authorized {
                        (400, r#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}"#.to_string())
                    } else if line.starts_with("GET /v1beta/models") {
                        (200, MODELS.to_string())
                    } else if line.contains("gemini-busy") {
                        (429, r#"{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}"#.to_string())
                    } else if line.contains("gemini-old-image") && body.contains("imageConfig") {
                        (400, r#"{"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"imageConfig\"","status":"INVALID_ARGUMENT"}}"#.to_string())
                    } else if body.contains("forbidden") {
                        (200, r#"{"candidates":[{"content":{"parts":[]},"finishReason":"IMAGE_SAFETY"}]}"#.to_string())
                    } else if body.contains("mute") {
                        (200, r#"{"candidates":[{"content":{"parts":[{"text":"I cannot draw that."}]},"finishReason":"STOP"}]}"#.to_string())
                    } else {
                        (
                            200,
                            json!({"candidates":[{"content":{"parts":[
                            {"text":"Voici l'image."},
                            {"inlineData":{"mimeType":"image/png","data": image}}
                        ]},"finishReason":"STOP"}]})
                            .to_string(),
                        )
                    };
                    let response = format!(
                        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                        reply.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        format!("http://{address}/v1beta")
    }

    fn client(api: &str, cache: PathBuf) -> Gemini {
        Gemini::with_parts(
            api,
            Box::new(MemoryStore::default()),
            cache,
            reqwest::Client::builder().no_proxy(),
        )
    }

    fn model(id: &str) -> ImageModel {
        ImageModel {
            id: id.into(),
            name: id.into(),
            free: false,
            description: String::new(),
            text_output: true,
            image_input: true,
        }
    }

    impl Gemini {
        async fn generate_plain(&self, model: &ImageModel, prompt: &str) -> AppResult<Vec<u8>> {
            self.generate(model, prompt, None, "1:1").await
        }
    }

    #[test]
    fn only_image_models_with_generate_content_are_listed() {
        let (mut models, next) = parse_models(MODELS).unwrap();
        assert!(next.is_none());
        sort_models(&mut models);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "gemini-3.1-flash-image",
                "gemini-3-pro-image",
                "gemini-2.5-flash-image",
                "gemini-3.1-flash-image-preview"
            ]
        );
        assert_eq!(models[0].name, "Nano Banana 2 · Gemini 3.1 Flash Image");
        assert_eq!(models[1].name, "Nano Banana Pro · Gemini 3 Pro Image");
        assert_eq!(
            models[2].name, "Nano Banana",
            "nom déjà commercial : gardé tel quel"
        );
        assert!(models.iter().all(|m| !m.free), "toujours facturé");
    }

    #[test]
    fn images_and_refusals_are_read_from_the_response() {
        let body = json!({"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/png","data":"iVBORw0KGgo="}}]}}]});
        assert!(first_image(&body.to_string())
            .unwrap()
            .starts_with(b"\x89PNG"));
        let blocked = first_image(r#"{"promptFeedback":{"blockReason":"SAFETY"}}"#)
            .err()
            .unwrap();
        assert!(blocked.message.contains("filtre de sécurité"));
        let empty =
            first_image(r#"{"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}"#)
                .err()
                .unwrap();
        assert!(empty.message.contains("aucune image"));
    }

    #[test]
    fn http_errors_are_explained() {
        let bad_key = api_error(
            400,
            r#"{"error":{"message":"API key not valid.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}"#,
        );
        assert!(bad_key.message.contains("Clé Google refusée"));
        let quota = api_error(429, r#"{"error":{"message":"Quota exceeded"}}"#);
        assert!(quota.message.contains("facturation") && quota.message.contains("Google AI Pro"));
        let region = api_error(
            400,
            r#"{"error":{"message":"User location is not supported","status":"FAILED_PRECONDITION"}}"#,
        );
        assert!(region.message.contains("User location is not supported"));
        assert!(
            api_error(403, r#"{"error":{"message":"Permission denied"}}"#)
                .message
                .contains("n'a pas accès")
        );
    }

    #[tokio::test]
    async fn key_models_and_generation_against_a_local_gemini() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let api = fake_gemini(seen.clone()).await;
        let cache =
            std::env::temp_dir().join(format!("mcstudio-gemini-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&cache);
        let gemini = client(&api, cache.clone());

        // Pas de clé : statut vide, rien n'est demandé au réseau.
        assert!(!gemini.status(true).await.unwrap().configured);
        assert!(gemini.models().await.is_err());
        assert!(gemini
            .generate_plain(&model("gemini-3.1-flash-image"), "x")
            .await
            .is_err());
        assert!(seen.lock().unwrap().is_empty());

        // Clé refusée : rien n'est rangé.
        let refused = gemini.set_key("bad").await.err().unwrap();
        assert!(refused.message.contains("Clé Google refusée"));
        assert!(!gemini.status(false).await.unwrap().configured);
        assert!(gemini.set_key("avec espace").await.is_err());

        let status = gemini.set_key(" good ").await.unwrap();
        assert!(status.configured);
        assert_eq!(status.image_models, Some(4));
        // La clé part dans l'en-tête, jamais dans l'adresse.
        assert!(seen
            .lock()
            .unwrap()
            .iter()
            .all(|call| !call.contains("key=")));

        let list = gemini.models().await.unwrap();
        assert!(!list.offline);
        assert_eq!(list.models[0].id, "gemini-3.1-flash-image");

        let bytes = gemini
            .generate_plain(&model("gemini-3.1-flash-image"), "a ruby sword")
            .await
            .unwrap();
        assert_eq!(pixelart::decode(&bytes).unwrap().width, 4);
        {
            let seen = seen.lock().unwrap();
            let call = seen
                .iter()
                .find(|c| {
                    c.starts_with("POST /v1beta/models/gemini-3.1-flash-image:generateContent")
                })
                .unwrap();
            assert!(
                call.contains(r#""responseModalities":["TEXT","IMAGE"]"#),
                "{call}"
            );
            assert!(call.contains(r#""aspectRatio":"1:1""#), "{call}");
            assert!(call.contains("a ruby sword"));
        }

        // Texture de référence et format allongé.
        gemini
            .generate(
                &model("gemini-3.1-flash-image"),
                "same style",
                Some(&tiny_png()),
                "21:9",
            )
            .await
            .unwrap();
        {
            let seen = seen.lock().unwrap();
            let call = seen.iter().find(|c| c.contains("same style")).unwrap();
            assert!(
                call.contains(r#""inlineData":{"data":"#)
                    || call.contains(r#""mimeType":"image/png""#),
                "{call}"
            );
            assert!(call.contains(r#""aspectRatio":"21:9""#), "{call}");
        }

        // Modèle qui ignore `imageConfig` : la demande repart sans.
        let bytes = gemini
            .generate_plain(&model("gemini-old-image"), "a ruby")
            .await
            .unwrap();
        assert!(!bytes.is_empty());
        let retries = seen
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.contains("gemini-old-image"))
            .count();
        assert_eq!(retries, 2);

        let busy = gemini
            .generate_plain(&model("gemini-busy"), "x")
            .await
            .err()
            .unwrap();
        assert!(busy.message.contains("Quota Gemini atteint"));
        let refused = gemini
            .generate_plain(&model("gemini-3.1-flash-image"), "forbidden thing")
            .await
            .err()
            .unwrap();
        assert!(refused.message.contains("IMAGE_SAFETY"));
        let mute = gemini
            .generate_plain(&model("gemini-3.1-flash-image"), "mute")
            .await
            .err()
            .unwrap();
        assert!(mute.message.contains("I cannot draw that."));

        // Hors connexion : la dernière liste connue (même clé, service injoignable).
        let offline = client("http://127.0.0.1:9/v1beta", cache.clone());
        offline.store.save("good").unwrap();
        let list = offline.models().await.unwrap();
        assert!(list.offline);
        assert_eq!(list.models.len(), 4);

        gemini.clear_key().unwrap();
        assert!(!gemini.status(false).await.unwrap().configured);
        assert!(!cache.exists(), "liste propre à la clé : effacée avec elle");
    }
}
