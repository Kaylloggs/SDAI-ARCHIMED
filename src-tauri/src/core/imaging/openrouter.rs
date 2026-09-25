//! OpenRouter, API d'images dédiée (vérifiée sur le SDK officiel `@openrouter/sdk`) :
//! - `GET /images/models` : modèles d'image et paramètres qu'ils acceptent
//!   (`supported_parameters` : `{type: enum|range|boolean, …}`), modalités d'entrée ;
//! - `GET /images/models/{auteur}/{modèle}/endpoints` : prix par ligne facturée ;
//! - `POST /images` : `model`, `prompt`, `aspect_ratio`, `resolution`, `n`, `seed`, `quality`,
//!   `background`, `output_format`, `input_references` (images en data URL) → `data[].b64_json`
//!   et `usage.cost` (coût réel en dollars) ;
//! - `GET /key` : libellé et crédit restant de la clé ;
//! - `POST /chat/completions` : réécriture d'une description par un modèle de texte.

use std::path::PathBuf;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::http;
use super::keys::{check_shape, mask, KeyRing};
use super::types::*;
use super::{wait_or_cancel, Cancel, ImageProvider};

pub const DEFAULT_API: &str = "https://openrouter.ai/api/v1";
const NAME: &str = "OpenRouter";
/// Identité de l'application, affichée par OpenRouter dans l'historique de la clé.
const REFERER: &str = "https://github.com/Kaylloggs/SDAI-ARCHIMED";
const TITLE: &str = "SDAI ARCHIMED";
const GENERATION_TIMEOUT: Duration = Duration::from_secs(300);

pub struct OpenRouter {
    api: String,
    http: Option<reqwest::Client>,
    keys: KeyRing,
    cache: PathBuf,
}

impl OpenRouter {
    pub fn new(api: &str, keys: KeyRing, cache: PathBuf, builder: reqwest::ClientBuilder) -> Self {
        Self {
            api: api.trim_end_matches('/').to_string(),
            http: http::client(builder),
            keys,
            cache,
        }
    }

    fn http(&self) -> AppResult<&reqwest::Client> {
        self.http
            .as_ref()
            .ok_or_else(|| AppError::internal("client HTTP indisponible"))
    }

    fn key(&self) -> AppResult<String> {
        self.keys.resolve()?.map(|(key, _)| key).ok_or_else(|| {
            AppError::invalid("Aucune clé OpenRouter : ajoutez-la dans Connexions (openrouter.ai/keys).")
        })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> AppResult<reqwest::RequestBuilder> {
        Ok(self
            .http()?
            .request(method, format!("{}{path}", self.api))
            .header("HTTP-Referer", REFERER)
            .header("X-Title", TITLE))
    }

    async fn describe_key(&self, key: &str) -> AppResult<(Option<String>, Option<String>)> {
        let response = self
            .request(reqwest::Method::GET, "/key")?
            .bearer_auth(key)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| http::unreachable(NAME, e))?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
        if status != 200 {
            return Err(api_error(status, &body));
        }
        let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        let data = &value["data"];
        let credits = match (data["limit_remaining"].as_f64(), data["is_free_tier"].as_bool()) {
            (Some(left), _) => Some(format!("Crédit restant sur la clé : {left:.2} $")),
            (None, Some(true)) => Some("Compte gratuit : seuls les modèles gratuits répondent.".into()),
            _ => None,
        };
        Ok((data["label"].as_str().map(str::to_string), credits))
    }

    async fn fetch_models(&self) -> AppResult<Vec<ProviderModel>> {
        let mut request = self
            .request(reqwest::Method::GET, "/images/models")?
            .timeout(Duration::from_secs(25));
        if let Ok(Some((key, _))) = self.keys.resolve() {
            request = request.bearer_auth(key);
        }
        let response = request.send().await.map_err(|e| http::unreachable(NAME, e))?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
        if status != 200 {
            return Err(api_error(status, &body));
        }
        parse_models(&body)
    }

    /// Modèle de texte pour réécrire une description : gratuit si possible.
    async fn text_model(&self, key: &str) -> AppResult<(String, bool)> {
        let response = self
            .request(reqwest::Method::GET, "/models?output_modalities=text")?
            .bearer_auth(key)
            .timeout(Duration::from_secs(25))
            .send()
            .await
            .map_err(|e| http::unreachable(NAME, e))?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
        if status != 200 {
            return Err(api_error(status, &body));
        }
        Ok(pick_text_model(&body))
    }
}

#[async_trait]
impl ImageProvider for OpenRouter {
    fn id(&self) -> ProviderId {
        ProviderId::Openrouter
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
            match self.describe_key(&key).await {
                Ok((label, credits)) => {
                    status.state = ConnectionState::Connected;
                    status.credits = credits;
                    status.detail = label.map(|l| format!("Clé « {l} »"));
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
        check_shape(key, "copiez-la telle quelle depuis openrouter.ai/keys.")?;
        self.describe_key(key).await?;
        self.keys.save_own(key)?;
        crate::core::audit::record("imaging.key", "openrouter", "saved", "user");
        Ok(self.status(true).await)
    }

    fn clear_key(&self) -> AppResult<()> {
        self.keys.clear_own()?;
        crate::core::audit::record("imaging.key", "openrouter", "removed", "user");
        Ok(())
    }

    async fn models(&self) -> AppResult<ModelList> {
        match self.fetch_models().await {
            Ok(models) => {
                super::remember(&self.cache, &models);
                Ok(ModelList {
                    provider: ProviderId::Openrouter,
                    note: models.is_empty().then(|| "OpenRouter ne propose aucun modèle d'image pour le moment.".into()),
                    models,
                    offline: false,
                })
            }
            Err(error) => match super::recall(&self.cache) {
                Some(models) => Ok(ModelList {
                    provider: ProviderId::Openrouter,
                    models,
                    offline: true,
                    note: Some(format!("Liste enregistrée ({})", error.message)),
                }),
                None => Err(error),
            },
        }
    }

    async fn pricing(&self, model: &str) -> AppResult<Vec<PriceLine>> {
        let Some((author, slug)) = model.split_once('/') else {
            return Ok(Vec::new());
        };
        let mut request = self
            .request(reqwest::Method::GET, &format!("/images/models/{author}/{slug}/endpoints"))?
            .timeout(Duration::from_secs(20));
        if let Ok(Some((key, _))) = self.keys.resolve() {
            request = request.bearer_auth(key);
        }
        let response = request.send().await.map_err(|e| http::unreachable(NAME, e))?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
        if status != 200 {
            return Err(api_error(status, &body));
        }
        Ok(parse_pricing(&body))
    }

    async fn generate(&self, request: &ImageRequest, cancel: Cancel) -> AppResult<ImageResponse> {
        let key = self.key()?;
        let body = request_body(request);
        let send = async {
            let response = self
                .request(reqwest::Method::POST, "/images")?
                .bearer_auth(&key)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body.to_string())
                .timeout(GENERATION_TIMEOUT)
                .send()
                .await
                .map_err(|e| http::unreachable(NAME, e))?;
            let status = response.status().as_u16();
            let text = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
            Ok::<_, AppError>((status, text))
        };
        let (status, text) = wait_or_cancel(send, cancel).await??;
        if status != 200 {
            return Err(api_error(status, &text));
        }
        parse_generation(&text)
    }

    async fn improve_prompt(&self, prompt: &str, instructions: &str) -> AppResult<PromptSuggestion> {
        let key = self.key()?;
        let (model, free) = self.text_model(&key).await?;
        let body = json!({
            "model": model,
            "messages": [
                { "role": "system", "content": instructions },
                { "role": "user", "content": prompt },
            ],
            "usage": { "include": true },
        });
        let response = self
            .request(reqwest::Method::POST, "/chat/completions")?
            .bearer_auth(&key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .timeout(Duration::from_secs(90))
            .send()
            .await
            .map_err(|e| http::unreachable(NAME, e))?;
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
        if status != 200 {
            return Err(api_error(status, &text));
        }
        let value: Value = serde_json::from_str(&text)?;
        let rewritten = value["choices"][0]["message"]["content"]
            .as_str()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| AppError::invalid("Le modèle de texte n'a rien proposé : réessayez."))?;
        let usage = &value["usage"];
        Ok(PromptSuggestion {
            prompt: rewritten.to_string(),
            model: if free { format!("{model} (gratuit)") } else { model },
            usage: ImageUsage {
                cost_usd: usage["cost"].as_f64(),
                input_tokens: usage["prompt_tokens"].as_u64(),
                output_tokens: usage["completion_tokens"].as_u64(),
                note: None,
            },
        })
    }
}

fn blank_status() -> ProviderStatus {
    ProviderStatus {
        provider: ProviderId::Openrouter,
        access: ProviderAccess::Key,
        name: NAME.into(),
        state: ConnectionState::ApiKeyMissing,
        key_source: None,
        masked_key: None,
        detail: None,
        credits: None,
        key_hint: "Clé API OpenRouter (sk-or-…)".into(),
        key_url: "https://openrouter.ai/keys".into(),
    }
}

/// Code HTTP → explication en français, avec le message d'OpenRouter quand il y en a un.
fn api_error(status: u16, body: &str) -> AppError {
    let detail = http::error_detail(body);
    let with_detail = |text: &str| {
        if detail.is_empty() {
            text.to_string()
        } else {
            format!("{text} ({detail})")
        }
    };
    let (code, message) = match status {
        400 => (AppErrorCode::InvalidInput, with_detail("Demande refusée par le modèle")),
        401 => (
            AppErrorCode::InvalidInput,
            "Clé OpenRouter refusée : vérifiez-la ou créez-en une sur openrouter.ai/keys.".to_string(),
        ),
        402 => (
            AppErrorCode::InvalidInput,
            "Crédit OpenRouter insuffisant pour ce modèle : ajoutez du crédit ou choisissez un modèle moins cher."
                .to_string(),
        ),
        403 => (AppErrorCode::InvalidInput, with_detail("Demande refusée par la modération")),
        404 => (
            AppErrorCode::NotFound,
            "Modèle introuvable sur OpenRouter : il a peut-être été retiré. Rechargez la liste.".to_string(),
        ),
        413 => (
            AppErrorCode::InvalidInput,
            "Images envoyées trop lourdes pour ce modèle : réduisez leur taille ou leur nombre.".to_string(),
        ),
        408 | 504 | 524 => (
            AppErrorCode::Network,
            "Le modèle a mis trop de temps à répondre : réessayez.".to_string(),
        ),
        429 => (
            AppErrorCode::Network,
            "Limite de requêtes atteinte : réessayez plus tard ou changez de modèle.".to_string(),
        ),
        500 | 502 | 503 | 529 => (
            AppErrorCode::Network,
            "Modèle momentanément indisponible chez son fournisseur : réessayez ou changez de modèle.".to_string(),
        ),
        other => (AppErrorCode::Network, with_detail(&format!("OpenRouter a répondu {other}"))),
    };
    AppError::new(code, message)
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|list| list.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// `supported_parameters` (et sa variante camelCase) → capacités. Ce qui n'y figure pas
/// n'est pas proposé.
fn capabilities(model: &Value) -> ModelCapabilities {
    let params = model
        .get("supported_parameters")
        .or_else(|| model.get("supportedParameters"))
        .cloned()
        .unwrap_or(Value::Null);
    let architecture = &model["architecture"];
    let inputs = strings(
        architecture
            .get("input_modalities")
            .or_else(|| architecture.get("inputModalities"))
            .unwrap_or(&Value::Null),
    );
    let enum_values = |name: &str| -> Vec<String> {
        let param = &params[name];
        if param["type"] == "enum" {
            strings(&param["values"]).into_iter().filter(|v| v != "auto").collect()
        } else {
            Vec::new()
        }
    };
    let n = &params["n"];
    let max_images = if n["type"] == "range" {
        n["max"].as_f64().map(|m| m.clamp(1.0, 10.0) as u32).unwrap_or(1)
    } else if n["type"] == "boolean" {
        4
    } else {
        1
    };
    ModelCapabilities {
        text_to_image: true,
        image_input: inputs.iter().any(|m| m == "image") || params.get("input_references").is_some(),
        max_input_images: None,
        native_mask: false,
        aspect_ratios: enum_values("aspect_ratio"),
        resolutions: enum_values("resolution"),
        max_images_per_request: max_images,
        seed: params.get("seed").is_some(),
        negative_prompt: false,
        transparent_background: enum_values("background").iter().any(|b| b == "transparent"),
        qualities: enum_values("quality"),
        source: CapabilitySource::Api,
    }
}

/// `/images/models` → modèles, capacités lues dans la réponse.
pub(crate) fn parse_models(body: &str) -> AppResult<Vec<ProviderModel>> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::internal(format!("liste des modèles illisible : {e}")))?;
    let list = value["data"]
        .as_array()
        .ok_or_else(|| AppError::internal("liste des modèles illisible (data)"))?;
    let mut models: Vec<ProviderModel> = list
        .iter()
        .filter_map(|model| {
            let id = model["id"].as_str()?.to_string();
            let outputs = strings(
                model["architecture"]
                    .get("output_modalities")
                    .or_else(|| model["architecture"].get("outputModalities"))
                    .unwrap_or(&Value::Null),
            );
            if !outputs.is_empty() && !outputs.iter().any(|m| m == "image") {
                return None;
            }
            let description: String = model["description"]
                .as_str()
                .unwrap_or("")
                .split("\n\n")
                .next()
                .unwrap_or("")
                .chars()
                .take(240)
                .collect();
            Some(ProviderModel {
                provider: ProviderId::Openrouter,
                name: model["name"].as_str().unwrap_or(&id).to_string(),
                free: id.ends_with(":free"),
                capabilities: capabilities(model),
                pricing: Vec::new(),
                description,
                id,
            })
        })
        .collect();
    models.sort_by(|a, b| b.free.cmp(&a.free).then(a.name.cmp(&b.name)));
    Ok(models)
}

fn billable_label(billable: &str) -> String {
    match billable {
        "output_image" => "image produite",
        "input_image" => "image envoyée",
        "input_reference" => "image de référence",
        "input_text" => "texte envoyé",
        "input_font" => "police envoyée",
        other => other,
    }
    .to_string()
}

fn unit_label(unit: &str) -> String {
    match unit {
        "request" => "demande",
        "image" => "image",
        "megapixel" => "mégapixel",
        "token" => "token",
        other => other,
    }
    .to_string()
}

/// Prix du premier endpoint (celui qu'OpenRouter choisit par défaut).
pub(crate) fn parse_pricing(body: &str) -> Vec<PriceLine> {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let endpoints = value["data"]
        .as_array()
        .or_else(|| value["data"]["endpoints"].as_array())
        .or_else(|| value["endpoints"].as_array())
        .cloned()
        .unwrap_or_default();
    let Some(first) = endpoints.first() else {
        return Vec::new();
    };
    first["pricing"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|line| {
            let cost = line
                .get("cost_usd")
                .or_else(|| line.get("costUsd"))
                .and_then(|c| c.as_f64().or_else(|| c.as_str().and_then(|s| s.parse().ok())))?;
            let mut label = billable_label(line["billable"].as_str().unwrap_or(""));
            if let Some(variant) = line["variant"].as_str() {
                label = format!("{label} ({variant})");
            }
            Some(PriceLine {
                label,
                cost_usd: cost,
                unit: unit_label(line["unit"].as_str().unwrap_or("")),
            })
        })
        .collect()
}

/// Corps de `POST /images` : seulement les champs renseignés.
pub(crate) fn request_body(request: &ImageRequest) -> Value {
    let mut body = json!({ "model": request.model, "prompt": request.prompt });
    if request.count > 1 {
        body["n"] = json!(request.count);
    }
    if let Some(ratio) = &request.aspect_ratio {
        body["aspect_ratio"] = json!(ratio);
    }
    if let Some(resolution) = &request.resolution {
        body["resolution"] = json!(resolution);
    }
    if let Some(seed) = request.seed {
        body["seed"] = json!(seed);
    }
    if let Some(quality) = &request.quality {
        body["quality"] = json!(quality);
    }
    if request.transparent_background {
        body["background"] = json!("transparent");
        body["output_format"] = json!("png");
    }
    if !request.images.is_empty() {
        body["input_references"] = Value::Array(
            request
                .images
                .iter()
                .map(|image| json!({ "type": "image_url", "image_url": { "url": http::data_url(&image.bytes, &image.mime) } }))
                .collect(),
        );
    }
    body
}

pub(crate) fn parse_generation(body: &str) -> AppResult<ImageResponse> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::internal(format!("réponse d'OpenRouter illisible : {e}")))?;
    if let Some(message) = value["error"]["message"].as_str() {
        return Err(AppError::new(
            AppErrorCode::Network,
            format!("Le modèle a échoué : {}", message.chars().take(300).collect::<String>()),
        ));
    }
    let mut images = Vec::new();
    for item in value["data"].as_array().into_iter().flatten() {
        let encoded = item
            .get("b64_json")
            .or_else(|| item.get("b64Json"))
            .and_then(Value::as_str);
        if let Some(encoded) = encoded {
            images.push(GeneratedImage { bytes: http::decode_base64(encoded)? });
        }
    }
    if images.is_empty() {
        return Err(AppError::invalid(
            "Le modèle n'a renvoyé aucune image : reformulez ou changez de modèle.",
        ));
    }
    let usage = &value["usage"];
    Ok(ImageResponse {
        images,
        usage: ImageUsage {
            cost_usd: usage["cost"].as_f64(),
            input_tokens: usage["prompt_tokens"].as_u64(),
            output_tokens: usage["completion_tokens"].as_u64(),
            note: usage.is_null().then(|| "Coût non communiqué par OpenRouter pour cette demande.".into()),
        },
        dropped: Vec::new(),
    })
}

/// Modèle de texte gratuit, de préférence d'une famille connue pour bien réécrire.
fn pick_text_model(body: &str) -> (String, bool) {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let free: Vec<String> = value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str())
        .filter(|id| id.ends_with(":free"))
        .map(str::to_string)
        .collect();
    for family in ["gemini", "llama", "mistral", "qwen", "deepseek"] {
        if let Some(id) = free.iter().find(|id| id.contains(family)) {
            return (id.clone(), true);
        }
    }
    match free.first() {
        Some(id) => (id.clone(), true),
        None => ("openrouter/auto".to_string(), false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::imaging::keys::MemoryStore;
    use crate::core::imaging::test_server::{fake_server, Reply};
    use std::sync::{Arc, Mutex};

    const MODELS: &str = r#"{"data":[
      {"id":"bytedance-seed/seedream-4.5","name":"Seedream 4.5","description":"A text-to-image model.\n\nMore.",
       "architecture":{"input_modalities":["text","image"],"output_modalities":["image"]},
       "supported_parameters":{"resolution":{"type":"enum","values":["1K","2K","4K"]},"seed":{"type":"boolean"},
         "aspect_ratio":{"type":"enum","values":["1:1","16:9","auto"]},"n":{"type":"range","min":1,"max":4},
         "background":{"type":"enum","values":["auto","transparent","opaque"]}}},
      {"id":"acme/sketch:free","name":"Sketch","architecture":{"input_modalities":["text"],"output_modalities":["image"]},
       "supported_parameters":{}},
      {"id":"acme/speaker","name":"Voice","architecture":{"input_modalities":["text"],"output_modalities":["audio"]}}
    ]}"#;

    #[test]
    fn capabilities_come_from_the_model_list_only() {
        let models = parse_models(MODELS).unwrap();
        assert_eq!(models.len(), 2);
        let sketch = &models[0];
        assert!(sketch.free && !sketch.capabilities.image_input);
        assert!(sketch.capabilities.aspect_ratios.is_empty() && !sketch.capabilities.seed);
        assert_eq!(sketch.capabilities.max_images_per_request, 1);
        let seedream = &models[1];
        let c = &seedream.capabilities;
        assert!(c.image_input && c.seed && c.transparent_background);
        assert_eq!(c.resolutions, ["1K", "2K", "4K"]);
        assert_eq!(c.aspect_ratios, ["1:1", "16:9"], "« auto » n'est pas un format");
        assert_eq!(c.max_images_per_request, 4);
        assert!(!c.negative_prompt && !c.native_mask);
        assert_eq!(seedream.description, "A text-to-image model.");
    }

    #[test]
    fn request_body_only_carries_what_was_asked() {
        let request = ImageRequest {
            model: "m".into(),
            prompt: "p".into(),
            count: 1,
            ..ImageRequest::default()
        };
        let body = request_body(&request);
        assert_eq!(body, json!({"model":"m","prompt":"p"}));
        let request = ImageRequest {
            count: 3,
            aspect_ratio: Some("16:9".into()),
            seed: Some(7),
            transparent_background: true,
            images: vec![InputImage { bytes: vec![1, 2], mime: "image/png".into() }],
            ..request
        };
        let body = request_body(&request);
        assert_eq!(body["n"], 3);
        assert_eq!(body["background"], "transparent");
        assert_eq!(body["input_references"][0]["type"], "image_url");
        assert!(body["input_references"][0]["image_url"]["url"].as_str().unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn pricing_lines_are_translated_not_invented() {
        let body = r#"{"data":[{"provider_name":"X","pricing":[
            {"billable":"output_image","cost_usd":0.04,"unit":"image"},
            {"billable":"input_reference","cost_usd":0.002,"unit":"image","variant":"hd"}]}]}"#;
        let lines = parse_pricing(body);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].label, "image produite");
        assert_eq!(lines[1].label, "image de référence (hd)");
        assert!(parse_pricing("{}").is_empty());
    }

    #[tokio::test]
    async fn key_models_generation_and_prompt_against_a_local_openrouter() {
        let png = crate::core::imaging::test_server::tiny_png();
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let api = fake_server(seen.clone(), move |line, head, body| {
            let authorized = head.to_lowercase().contains("authorization: bearer good");
            if line.starts_with("GET /api/v1/images/models") {
                return Reply::json(200, MODELS);
            }
            if !authorized {
                return Reply::json(401, r#"{"error":{"message":"No auth"}}"#);
            }
            if line.starts_with("GET /api/v1/key") {
                return Reply::json(200, r#"{"data":{"label":"perso","limit_remaining":4.5}}"#);
            }
            if line.starts_with("GET /api/v1/models") {
                return Reply::json(200, r#"{"data":[{"id":"acme/big"},{"id":"meta-llama/llama-4:free"}]}"#);
            }
            if line.starts_with("POST /api/v1/chat/completions") {
                return Reply::json(200, r#"{"choices":[{"message":{"content":"Un chevalier, lumière dorée"}}],"usage":{"prompt_tokens":20,"completion_tokens":8,"cost":0}}"#);
            }
            if body.contains("acme/broke") {
                return Reply::json(402, r#"{"error":{"message":"Insufficient credits"}}"#);
            }
            Reply::json(200, &format!(r#"{{"created":1,"data":[{{"b64_json":"{b64}","media_type":"image/png"}},{{"b64_json":"{b64}"}}],"usage":{{"prompt_tokens":10,"completion_tokens":1300,"cost":0.08}}}}"#))
        })
        .await;
        let cache = std::env::temp_dir().join(format!("imaging-or-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&cache);
        let router = OpenRouter::new(
            &format!("{api}/api/v1"),
            KeyRing::with_stores(Box::new(MemoryStore::default()), Vec::new()),
            cache.clone(),
            reqwest::Client::builder().no_proxy(),
        );

        assert_eq!(router.status(true).await.state, ConnectionState::ApiKeyMissing);
        assert!(router.set_key("bad").await.is_err());
        let status = router.set_key(" good ").await.unwrap();
        assert_eq!(status.state, ConnectionState::Connected);
        assert_eq!(status.masked_key.as_deref(), Some("••••"));
        assert!(status.credits.unwrap().contains("4.50"));

        let list = router.models().await.unwrap();
        assert_eq!(list.models.len(), 2);
        assert!(!list.offline);

        let (_tx, cancel) = crate::core::imaging::cancel_pair();
        let response = router
            .generate(
                &ImageRequest { model: "bytedance-seed/seedream-4.5".into(), prompt: "un chevalier".into(), count: 2, ..Default::default() },
                cancel.clone(),
            )
            .await
            .unwrap();
        assert_eq!(response.images.len(), 2);
        assert_eq!(response.usage.cost_usd, Some(0.08));
        {
            let seen = seen.lock().unwrap();
            let call = seen.iter().find(|c| c.starts_with("POST /api/v1/images")).unwrap();
            assert!(call.contains(r#""n":2"#), "{call}");
        }

        let broke = router
            .generate(&ImageRequest { model: "acme/broke".into(), prompt: "x".into(), count: 1, ..Default::default() }, cancel)
            .await
            .err()
            .unwrap();
        assert!(broke.message.contains("Crédit OpenRouter insuffisant"));

        let suggestion = router.improve_prompt("chevalier", "Réécris").await.unwrap();
        assert_eq!(suggestion.prompt, "Un chevalier, lumière dorée");
        assert!(suggestion.model.starts_with("meta-llama/llama-4:free"));

        // Hors connexion : la dernière liste connue.
        let offline = OpenRouter::new(
            "http://127.0.0.1:9/api/v1",
            KeyRing::with_stores(Box::new(MemoryStore::with("good")), Vec::new()),
            cache.clone(),
            reqwest::Client::builder().no_proxy(),
        );
        let list = offline.models().await.unwrap();
        assert!(list.offline && list.models.len() == 2);
        router.clear_key().unwrap();
        assert_eq!(router.status(false).await.state, ConnectionState::ApiKeyMissing);
        let _ = std::fs::remove_file(&cache);
    }
}
