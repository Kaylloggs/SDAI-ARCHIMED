//! Génération d'images par OpenRouter, avec la clé API de la personne.
//!
//! - La clé vit dans le Gestionnaire d'identifiants de Windows (`secrets`), jamais dans un
//!   fichier ni dans les journaux ; elle ne revient jamais vers l'interface.
//! - La liste des modèles est lue en direct (`/models`, sortie « image ») et gardée en cache.
//!   Un modèle payant n'est appelé qu'avec l'accord explicite de la personne.
//! - Source remplaçable (HTTPS uniquement) : `{"openrouterApi": "https://…"}` dans
//!   `<données>/modules/mcstudio/env.json`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::pixelart;
use super::secrets::{check_shape, CredentialStore, KeyStore};
use super::types::{ImageModel, ImageModelList, OpenRouterStatus};

const DEFAULT_API: &str = "https://openrouter.ai/api/v1";
/// Identité de l'application, affichée par OpenRouter dans l'historique de la clé.
const REFERER: &str = "https://github.com/Kaylloggs/SDAI-ARCHIMED";
const TITLE: &str = "SDAI ARCHIMED Mod Studio";
/// Une image se fait en 5 à 60 secondes selon le modèle et la charge.
const GENERATION_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvSettings {
    openrouter_api: Option<String>,
}

pub struct OpenRouter {
    api: String,
    http: Option<reqwest::Client>,
    store: Box<dyn KeyStore>,
    cache: PathBuf,
}

impl OpenRouter {
    pub fn new(module_dir: &Path) -> Self {
        let settings: EnvSettings = std::fs::read_to_string(module_dir.join("env.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let api = settings
            .openrouter_api
            .filter(|url| url.starts_with("https://"))
            .unwrap_or_else(|| DEFAULT_API.to_string());
        Self::with_parts(
            &api,
            Box::new(CredentialStore::new("mcstudio-openrouter")),
            module_dir.join("cache").join("openrouter-models.json"),
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
                "Aucune clé OpenRouter : ajoutez-la dans Environnement (liste des projets).",
            )
        })
    }

    /// Clé présente ? Avec `check`, OpenRouter dit aussi à quoi elle donne droit.
    pub async fn status(&self, check: bool) -> AppResult<OpenRouterStatus> {
        let Some(key) = self.store.load()? else {
            return Ok(OpenRouterStatus::default());
        };
        let mut status = OpenRouterStatus {
            configured: true,
            ..OpenRouterStatus::default()
        };
        if check {
            match self.describe_key(&key).await {
                Ok(described) => {
                    status.label = described.label;
                    status.free_tier = described.free_tier;
                    status.credits_left = described.credits_left;
                }
                Err(error) => status.problem = Some(error.message),
            }
        }
        Ok(status)
    }

    /// Vérifie la clé auprès d'OpenRouter, puis la range. Une clé refusée n'est pas gardée.
    pub async fn set_key(&self, key: &str) -> AppResult<OpenRouterStatus> {
        let key = key.trim();
        check_shape(key, "copiez-la telle quelle depuis openrouter.ai/keys.")?;
        let described = self.describe_key(key).await?;
        self.store.save(key)?;
        crate::core::audit::record("mcstudio.openrouter_key", "openrouter", "saved", "user");
        Ok(OpenRouterStatus {
            configured: true,
            label: described.label,
            free_tier: described.free_tier,
            credits_left: described.credits_left,
            problem: None,
        })
    }

    pub fn clear_key(&self) -> AppResult<()> {
        self.store.clear()?;
        crate::core::audit::record("mcstudio.openrouter_key", "openrouter", "removed", "user");
        Ok(())
    }

    async fn describe_key(&self, key: &str) -> AppResult<OpenRouterStatus> {
        let response = self
            .http()?
            .get(format!("{}/key", self.api))
            .bearer_auth(key)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(unreachable)?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(unreachable)?;
        if status != 200 {
            return Err(api_error(status, &body));
        }
        Ok(parse_key(&body))
    }

    /// Modèles qui savent produire une image ; le cache prend le relais hors connexion.
    pub async fn models(&self) -> AppResult<ImageModelList> {
        let network = async {
            let response = self
                .http()?
                .get(format!("{}/models?output_modalities=image", self.api))
                .timeout(Duration::from_secs(20))
                .send()
                .await
                .map_err(unreachable)?;
            let status = response.status().as_u16();
            let body = response.text().await.map_err(unreachable)?;
            if status != 200 {
                return Err(api_error(status, &body));
            }
            Ok(body)
        }
        .await;
        match network {
            Ok(body) => {
                let models = parse_models(&body)?;
                if let Some(dir) = self.cache.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                if let Ok(raw) = serde_json::to_vec(&models) {
                    let _ = std::fs::write(&self.cache, raw);
                }
                Ok(ImageModelList {
                    models,
                    offline: false,
                })
            }
            Err(error) => {
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
        }
    }

    /// Envoie la demande au modèle et renvoie l'image reçue (PNG, JPEG ou WebP).
    pub async fn generate(&self, model: &ImageModel, prompt: &str) -> AppResult<Vec<u8>> {
        let key = self.key()?;
        let modalities = if model.text_output {
            json!(["image", "text"])
        } else {
            json!(["image"])
        };
        let request = json!({
            "model": model.id,
            "messages": [{ "role": "user", "content": prompt }],
            "modalities": modalities,
            "image_config": { "aspect_ratio": "1:1" },
        });
        let response = self
            .http()?
            .post(format!("{}/chat/completions", self.api))
            .bearer_auth(&key)
            .header("HTTP-Referer", REFERER)
            .header("X-Title", TITLE)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(request.to_string())
            .timeout(GENERATION_TIMEOUT)
            .send()
            .await
            .map_err(unreachable)?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(unreachable)?;
        if status != 200 {
            return Err(api_error(status, &body));
        }
        match first_image(&body)? {
            Picture::Inline(bytes) => Ok(bytes),
            Picture::Remote(url) => self.download(&url).await,
        }
    }

    /// Certains fournisseurs renvoient un lien plutôt que l'image : HTTPS seulement.
    async fn download(&self, url: &str) -> AppResult<Vec<u8>> {
        if !url.starts_with("https://") {
            return Err(AppError::invalid(
                "Le modèle a renvoyé un lien d'image non sécurisé : ignoré.",
            ));
        }
        let response = self
            .http()?
            .get(url)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(unreachable)?;
        if !response.status().is_success() {
            return Err(AppError::new(
                AppErrorCode::Network,
                format!(
                    "Image introuvable à l'adresse fournie ({}).",
                    response.status()
                ),
            ));
        }
        if response
            .content_length()
            .is_some_and(|len| len > pixelart::MAX_BYTES as u64)
        {
            return Err(AppError::invalid("Image trop lourde (32 Mo au plus)."));
        }
        let bytes = response.bytes().await.map_err(unreachable)?;
        Ok(bytes.to_vec())
    }
}

fn unreachable(error: reqwest::Error) -> AppError {
    let message = if error.is_timeout() {
        "OpenRouter n'a pas répondu à temps : réessayez, ou choisissez un modèle plus rapide."
            .to_string()
    } else {
        format!("OpenRouter injoignable ({error}) : une connexion Internet est nécessaire.")
    };
    AppError::new(AppErrorCode::Network, message)
}

/// Code HTTP d'OpenRouter → explication en français, avec son message quand il y en a un.
fn api_error(status: u16, body: &str) -> AppError {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .map(|m| m.chars().take(300).collect::<String>())
        .unwrap_or_default();
    let with_detail = |text: &str| {
        if detail.is_empty() {
            text.to_string()
        } else {
            format!("{text} ({detail})")
        }
    };
    let (code, message) = match status {
        400 => (
            AppErrorCode::InvalidInput,
            with_detail("Demande refusée par le modèle"),
        ),
        401 => (
            AppErrorCode::InvalidInput,
            "Clé OpenRouter refusée : vérifiez-la ou créez-en une sur openrouter.ai/keys."
                .to_string(),
        ),
        402 => (
            AppErrorCode::InvalidInput,
            "Crédit OpenRouter insuffisant pour ce modèle : choisissez un modèle gratuit ou ajoutez du crédit."
                .to_string(),
        ),
        403 => (
            AppErrorCode::InvalidInput,
            with_detail("Description refusée par la modération du modèle"),
        ),
        404 => (
            AppErrorCode::NotFound,
            "Modèle introuvable sur OpenRouter : il a peut-être été retiré. Rechargez la liste."
                .to_string(),
        ),
        408 | 504 => (
            AppErrorCode::Network,
            "Le modèle a mis trop de temps à répondre : réessayez.".to_string(),
        ),
        429 => (
            AppErrorCode::Network,
            "Limite de requêtes atteinte (les modèles gratuits sont limités par minute et par jour) : réessayez plus tard ou changez de modèle."
                .to_string(),
        ),
        502 | 503 => (
            AppErrorCode::Network,
            "Modèle momentanément indisponible chez son fournisseur : réessayez ou changez de modèle."
                .to_string(),
        ),
        other => (
            AppErrorCode::Network,
            with_detail(&format!("OpenRouter a répondu {other}")),
        ),
    };
    AppError::new(code, message)
}

fn parse_key(body: &str) -> OpenRouterStatus {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let data = &value["data"];
    OpenRouterStatus {
        configured: true,
        label: data["label"].as_str().map(str::to_string),
        free_tier: data["is_free_tier"].as_bool(),
        credits_left: data["limit_remaining"].as_f64(),
        problem: None,
    }
}

/// Prix d'OpenRouter : chaînes en dollars (« 0 », « 0.000002 »), « -1 » pour variable.
fn costs_nothing(pricing: &Value) -> bool {
    let Some(prices) = pricing.as_object() else {
        return false;
    };
    prices.values().all(|price| {
        let parsed = match price {
            Value::String(text) => text.parse::<f64>().ok(),
            Value::Number(number) => number.as_f64(),
            _ => None,
        };
        parsed == Some(0.0)
    })
}

fn modalities(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|m| m.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// `/models` → modèles à sortie image, gratuits d'abord puis par nom.
fn parse_models(body: &str) -> AppResult<Vec<ImageModel>> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::internal(format!("liste des modèles illisible : {e}")))?;
    let list = value["data"]
        .as_array()
        .ok_or_else(|| AppError::internal("liste des modèles illisible (data)"))?;
    let mut models: Vec<ImageModel> = list
        .iter()
        .filter_map(|model| {
            let outputs = modalities(&model["architecture"]["output_modalities"]);
            if !outputs.iter().any(|m| m == "image") {
                return None;
            }
            let id = model["id"].as_str()?.to_string();
            let description: String = model["description"]
                .as_str()
                .unwrap_or("")
                .split("\n\n")
                .next()
                .unwrap_or("")
                .chars()
                .take(220)
                .collect();
            Some(ImageModel {
                name: model["name"].as_str().unwrap_or(&id).to_string(),
                free: id.ends_with(":free") || costs_nothing(&model["pricing"]),
                text_output: outputs.iter().any(|m| m == "text"),
                description,
                id,
            })
        })
        .collect();
    models.sort_by(|a, b| b.free.cmp(&a.free).then(a.name.cmp(&b.name)));
    Ok(models)
}

enum Picture {
    Inline(Vec<u8>),
    Remote(String),
}

/// Première image de la réponse (`choices[0].message.images[*].image_url.url`).
fn first_image(body: &str) -> AppResult<Picture> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::internal(format!("réponse d'OpenRouter illisible : {e}")))?;
    if let Some(message) = value["error"]["message"].as_str() {
        return Err(AppError::new(
            AppErrorCode::Network,
            format!(
                "Le modèle a échoué : {}",
                message.chars().take(300).collect::<String>()
            ),
        ));
    }
    let message = &value["choices"][0]["message"];
    let url = message["images"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|image| {
            image["image_url"]["url"]
                .as_str()
                .or_else(|| image["url"].as_str())
        });
    let Some(url) = url else {
        let said: String = message["content"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(200)
            .collect();
        return Err(AppError::invalid(if said.trim().is_empty() {
            "Le modèle n'a renvoyé aucune image : réessayez ou changez de modèle.".to_string()
        } else {
            format!(
                "Le modèle a répondu sans image : « {} ». Reformulez ou changez de modèle.",
                said.trim()
            )
        }));
    };
    if let Some(data) = url.strip_prefix("data:") {
        let (_, encoded) = data
            .split_once(";base64,")
            .ok_or_else(|| AppError::internal("image reçue dans un format inattendu"))?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .map_err(|e| AppError::internal(format!("image reçue illisible : {e}")))?;
        return Ok(Picture::Inline(bytes));
    }
    Ok(Picture::Remote(url.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::secrets::MemoryStore;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const MODELS: &str = r#"{"data":[
        {"id":"acme/text-only","name":"Texte","pricing":{"prompt":"0","completion":"0"},
         "architecture":{"output_modalities":["text"]}},
        {"id":"acme/painter","name":"Painter Pro","description":"Paints.\n\nMore.",
         "pricing":{"prompt":"0.000001","completion":"0.00003","image":"0.03"},
         "architecture":{"output_modalities":["image","text"]}},
        {"id":"acme/sketch:free","name":"Sketch (free)","pricing":{"prompt":"0","completion":"0"},
         "architecture":{"output_modalities":["image"]}},
        {"id":"acme/router","name":"Auto","pricing":{"prompt":"-1","completion":"-1"},
         "architecture":{"output_modalities":["image","text"]}}
    ]}"#;

    fn tiny_png() -> Vec<u8> {
        let mut raster = pixelart::Raster::new(4, 4);
        raster.px[5] = [255, 0, 0, 255];
        raster.png().unwrap()
    }

    /// Faux OpenRouter local : répond selon le chemin, exige « Bearer good ».
    async fn fake_openrouter(seen: Arc<Mutex<Vec<String>>>) -> String {
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
                        .any(|l| l.eq_ignore_ascii_case("authorization: Bearer good"));
                    seen.lock().unwrap().push(format!("{line}\n{body}"));
                    let data_url = format!(
                        "data:image/png;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(tiny_png())
                    );
                    let (status, reply) = if line.starts_with("GET /api/v1/models") {
                        (200, MODELS.to_string())
                    } else if !authorized {
                        (
                            401,
                            r#"{"error":{"code":401,"message":"No auth"}}"#.to_string(),
                        )
                    } else if line.starts_with("GET /api/v1/key") {
                        (200, r#"{"data":{"label":"sk-or-v1-abc...xyz","is_free_tier":true,"limit_remaining":null}}"#.to_string())
                    } else if body.contains("acme/busy") {
                        (429, r#"{"error":{"code":429,"message":"Rate limit exceeded: free-models-per-day"}}"#.to_string())
                    } else if body.contains("acme/mute") {
                        (
                            200,
                            r#"{"choices":[{"message":{"content":"I cannot draw that."}}]}"#
                                .to_string(),
                        )
                    } else {
                        (200, json!({"choices":[{"message":{"content":"","images":[{"type":"image_url","image_url":{"url": data_url}}]}}]}).to_string())
                    };
                    let response = format!(
                        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                        reply.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        format!("http://{address}/api/v1")
    }

    fn client(api: &str, cache: PathBuf) -> OpenRouter {
        OpenRouter::with_parts(
            api,
            Box::new(MemoryStore::default()),
            cache,
            reqwest::Client::builder().no_proxy(),
        )
    }

    fn model(id: &str, text_output: bool) -> ImageModel {
        ImageModel {
            id: id.into(),
            name: id.into(),
            free: true,
            description: String::new(),
            text_output,
        }
    }

    #[test]
    fn models_are_filtered_on_image_output_and_free_first() {
        let models = parse_models(MODELS).unwrap();
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["acme/sketch:free", "acme/router", "acme/painter"]);
        assert!(models[0].free && !models[0].text_output);
        assert!(!models[1].free, "prix variable (-1) : pas gratuit");
        assert!(!models[2].free && models[2].text_output);
        assert_eq!(models[2].description, "Paints.");
    }

    #[test]
    fn images_are_read_from_data_urls_or_links() {
        let body = json!({"choices":[{"message":{"images":[{"image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}]}}]});
        assert!(
            matches!(first_image(&body.to_string()).unwrap(), Picture::Inline(b) if b.starts_with(b"\x89PNG"))
        );
        let body =
            json!({"choices":[{"message":{"images":[{"url":"https://cdn.example/x.png"}]}}]});
        assert!(
            matches!(first_image(&body.to_string()).unwrap(), Picture::Remote(u) if u == "https://cdn.example/x.png")
        );
        let err = first_image(r#"{"choices":[{"message":{"content":"Non."}}]}"#)
            .err()
            .unwrap();
        assert!(err.message.contains("« Non. »"));
        let err = first_image(r#"{"error":{"message":"Provider down"}}"#)
            .err()
            .unwrap();
        assert!(err.message.contains("Provider down"));
    }

    #[test]
    fn http_errors_are_explained() {
        assert!(api_error(401, "")
            .message
            .contains("Clé OpenRouter refusée"));
        assert!(api_error(402, "").message.contains("gratuit"));
        let limited = api_error(429, r#"{"error":{"message":"x"}}"#);
        assert!(limited.message.contains("Limite de requêtes"));
        assert!(api_error(400, r#"{"error":{"message":"bad size"}}"#)
            .message
            .contains("bad size"));
    }

    #[tokio::test]
    async fn key_models_and_generation_against_a_local_openrouter() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let api = fake_openrouter(seen.clone()).await;
        let cache = std::env::temp_dir().join(format!("mcstudio-or-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&cache);
        let router = client(&api, cache.clone());

        // Pas de clé : statut vide, génération refusée sans appel réseau.
        assert!(!router.status(true).await.unwrap().configured);
        assert!(router
            .generate(&model("acme/sketch:free", false), "x")
            .await
            .is_err());

        // Clé refusée : rien n'est rangé.
        assert!(router.set_key("bad").await.is_err());
        assert!(!router.status(false).await.unwrap().configured);
        assert!(router.set_key("avec espace").await.is_err());

        let status = router.set_key(" good ").await.unwrap();
        assert!(status.configured);
        assert_eq!(status.free_tier, Some(true));
        assert_eq!(status.label.as_deref(), Some("sk-or-v1-abc...xyz"));

        let list = router.models().await.unwrap();
        assert!(!list.offline);
        assert_eq!(list.models.len(), 3);

        let bytes = router
            .generate(&model("acme/sketch:free", false), "a ruby sword")
            .await
            .unwrap();
        assert_eq!(pixelart::decode(&bytes).unwrap().width, 4);
        {
            let seen = seen.lock().unwrap();
            let call = seen
                .iter()
                .find(|c| c.starts_with("POST /api/v1/chat/completions"))
                .unwrap();
            assert!(call.contains(r#""modalities":["image"]"#), "{call}");
            assert!(call.contains("a ruby sword"));
        }

        let busy = router
            .generate(&model("acme/busy", true), "x")
            .await
            .err()
            .unwrap();
        assert!(busy.message.contains("Limite de requêtes"));
        let mute = router
            .generate(&model("acme/mute", true), "x")
            .await
            .err()
            .unwrap();
        assert!(mute.message.contains("I cannot draw that."));

        // Hors connexion : la dernière liste connue.
        let offline = client("http://127.0.0.1:9/api/v1", cache.clone());
        let list = offline.models().await.unwrap();
        assert!(list.offline);
        assert_eq!(list.models.len(), 3);

        router.clear_key().unwrap();
        assert!(!router.status(false).await.unwrap().configured);
        let _ = std::fs::remove_file(&cache);
    }
}
