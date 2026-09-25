//! Higgsfield (API asynchrone), vérifiée sur les SDK officiels `@higgsfield/client` (v2) et
//! `higgsfield-client` (Python) :
//! - authentification `Authorization: Key <KEY_ID>:<KEY_SECRET>` (identifiants de
//!   cloud.higgsfield.ai) ;
//! - `POST /<application>` avec les arguments du modèle en JSON → `request_id`, `status` ;
//! - `GET /requests/{id}/status` → `queued`, `in_progress`, `completed` (+ `images[].url`),
//!   `failed` / `nsfw` (crédits remboursés), `canceled` ;
//! - `POST /requests/{id}/cancel` (seulement tant que la demande attend) ;
//! - `POST /files/generate-upload-url` `{content_type}` → `public_url`, `upload_url`,
//!   `upload_headers`, puis `PUT` des octets : c'est ainsi qu'une image d'entrée est envoyée
//!   (elle devient accessible par son adresse chez Higgsfield).
//!
//! L'API ne liste pas ses modèles (retiré de la v2 du SDK) : trois applications vues dans les
//! exemples officiels sont proposées, avec les seuls arguments montrés ; d'autres s'ajoutent à la
//! main, avec leurs arguments recopiés de la documentation Higgsfield. L'API ne donne ni le
//! solde de crédits ni le coût d'une demande.

use std::sync::RwLock;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::http;
use super::keys::{mask, KeyRing};
use super::types::*;
use super::{cancelled, wait_or_cancel, Cancel, ImageProvider};

pub const DEFAULT_API: &str = "https://api.higgsfield.ai";
const NAME: &str = "Higgsfield";
const POLL_EVERY: Duration = Duration::from_secs(2);
const POLL_LIMIT: Duration = Duration::from_secs(15 * 60);
const COMMON_ASPECTS: [&str; 8] = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"];

/// Un modèle (« application ») Higgsfield et les arguments qu'il reçoit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct HiggsfieldModelSpec {
    /// Chemin de l'application (« bytedance/seedream/v4/text-to-image »).
    pub id: String,
    pub name: String,
    /// Formats proposés (`aspect_ratio`) ; vide = argument non envoyé.
    pub aspect_ratios: Vec<String>,
    /// Paliers proposés (`resolution`) ; vide = argument non envoyé.
    pub resolutions: Vec<String>,
    /// Envoie `seed`.
    pub seed: bool,
    /// Argument qui reçoit les images d'entrée (« image_urls »…) ; absent = texte seulement.
    pub image_field: Option<String>,
    /// L'argument attend une liste d'adresses (sinon une seule).
    pub image_field_list: bool,
    /// Arguments fixes ajoutés à chaque demande (objet JSON).
    #[ts(type = "Record<string, unknown> | null")]
    pub extra: Option<Value>,
    pub source: CapabilitySource,
}

/// Applications vues dans les exemples des SDK officiels, avec les arguments qui y figurent.
pub fn presets() -> Vec<HiggsfieldModelSpec> {
    let aspects = || COMMON_ASPECTS.iter().map(|a| a.to_string()).collect::<Vec<_>>();
    vec![
        HiggsfieldModelSpec {
            id: "bytedance/seedream/v4/text-to-image".into(),
            name: "Seedream 4 · texte vers image".into(),
            aspect_ratios: aspects(),
            resolutions: vec!["2K".into()],
            seed: false,
            image_field: None,
            image_field_list: false,
            extra: None,
            source: CapabilitySource::Docs,
        },
        HiggsfieldModelSpec {
            id: "flux-pro/kontext/max/text-to-image".into(),
            name: "FLUX.1 Kontext [max] · texte vers image".into(),
            aspect_ratios: aspects(),
            resolutions: Vec::new(),
            seed: true,
            image_field: None,
            image_field_list: false,
            extra: None,
            source: CapabilitySource::Docs,
        },
        HiggsfieldModelSpec {
            id: "nano-banana-pro".into(),
            name: "Nano Banana Pro".into(),
            aspect_ratios: Vec::new(),
            resolutions: Vec::new(),
            seed: false,
            image_field: None,
            image_field_list: false,
            extra: None,
            source: CapabilitySource::Docs,
        },
    ]
}

impl HiggsfieldModelSpec {
    fn to_model(&self) -> ProviderModel {
        let mut capabilities = ModelCapabilities::minimal(self.source);
        capabilities.image_input = self.image_field.is_some();
        capabilities.max_input_images = self.image_field.as_ref().map(|_| if self.image_field_list { 8 } else { 1 });
        capabilities.aspect_ratios = self.aspect_ratios.clone();
        capabilities.resolutions = self.resolutions.clone();
        capabilities.seed = self.seed;
        let description = match self.source {
            CapabilitySource::Docs => {
                "Arguments tirés des exemples officiels ; les valeurs sont vérifiées par Higgsfield à l'envoi.".into()
            }
            _ => "Modèle ajouté à la main.".into(),
        };
        ProviderModel {
            provider: ProviderId::Higgsfield,
            id: self.id.clone(),
            name: self.name.clone(),
            description,
            capabilities,
            pricing: Vec::new(),
            free: false,
        }
    }

    /// Arguments envoyés : seulement ceux que l'application reçoit.
    pub(crate) fn arguments(&self, request: &ImageRequest, image_urls: &[String]) -> Value {
        let mut args = match &self.extra {
            Some(Value::Object(map)) => Value::Object(map.clone()),
            _ => json!({}),
        };
        args["prompt"] = json!(request.prompt);
        if let Some(ratio) = request.aspect_ratio.as_ref().filter(|_| !self.aspect_ratios.is_empty()) {
            args["aspect_ratio"] = json!(ratio);
        }
        if let Some(resolution) = request.resolution.as_ref().filter(|_| !self.resolutions.is_empty()) {
            args["resolution"] = json!(resolution);
        }
        if let Some(seed) = request.seed.filter(|_| self.seed) {
            args["seed"] = json!(seed);
        }
        if let (Some(field), false) = (&self.image_field, image_urls.is_empty()) {
            args[field.as_str()] = if self.image_field_list {
                json!(image_urls)
            } else {
                json!(image_urls[0])
            };
        }
        args
    }
}

pub struct Higgsfield {
    api: String,
    http: Option<reqwest::Client>,
    keys: KeyRing,
    custom: RwLock<Vec<HiggsfieldModelSpec>>,
}

impl Higgsfield {
    pub fn new(api: &str, keys: KeyRing, builder: reqwest::ClientBuilder) -> Self {
        Self {
            api: api.trim_end_matches('/').to_string(),
            http: http::client(builder),
            keys,
            custom: RwLock::new(Vec::new()),
        }
    }

    pub fn set_custom(&self, models: Vec<HiggsfieldModelSpec>) {
        if let Ok(mut custom) = self.custom.write() {
            *custom = models;
        }
    }

    fn specs(&self) -> Vec<HiggsfieldModelSpec> {
        let mut all = presets();
        if let Ok(custom) = self.custom.read() {
            for spec in custom.iter() {
                all.retain(|p| p.id != spec.id);
                all.push(spec.clone());
            }
        }
        all
    }

    fn http(&self) -> AppResult<&reqwest::Client> {
        self.http
            .as_ref()
            .ok_or_else(|| AppError::internal("client HTTP indisponible"))
    }

    fn key(&self) -> AppResult<String> {
        self.keys.resolve()?.map(|(key, _)| key).ok_or_else(|| {
            AppError::invalid("Aucun identifiant Higgsfield : ajoutez-le dans Connexions (cloud.higgsfield.ai).")
        })
    }

    fn call(&self, method: reqwest::Method, path: &str, key: &str) -> AppResult<reqwest::RequestBuilder> {
        let url = if path.starts_with("https://") || path.starts_with("http://") {
            path.to_string()
        } else {
            format!("{}/{}", self.api, path.trim_start_matches('/'))
        };
        Ok(self
            .http()?
            .request(method, url)
            .header(reqwest::header::AUTHORIZATION, format!("Key {key}")))
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> AppResult<(u16, String)> {
        let response = request.send().await.map_err(|e| http::unreachable(NAME, e))?;
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| http::unreachable(NAME, e))?;
        Ok((status, text))
    }

    /// Vérifie les identifiants : l'API n'a pas de page « compte » ; le suivi d'une demande
    /// inconnue répond 401 si les identifiants sont refusés, autre chose sinon.
    async fn check(&self, key: &str) -> AppResult<()> {
        let request = self
            .call(reqwest::Method::GET, "/requests/00000000-0000-0000-0000-000000000000/status", key)?
            .timeout(Duration::from_secs(20));
        let (status, body) = self.send(request).await?;
        if status == 401 {
            return Err(api_error(status, &body));
        }
        if status >= 500 {
            return Err(api_error(status, &body));
        }
        Ok(())
    }

    /// Envoie une image d'entrée chez Higgsfield et renvoie son adresse publique.
    async fn upload(&self, key: &str, image: &InputImage) -> AppResult<String> {
        let request = self
            .call(reqwest::Method::POST, "/files/generate-upload-url", key)?
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(json!({ "content_type": image.mime }).to_string())
            .timeout(Duration::from_secs(30));
        let (status, body) = self.send(request).await?;
        if status != 200 {
            return Err(api_error(status, &body));
        }
        let value: Value = serde_json::from_str(&body)?;
        let public = value["public_url"].as_str().ok_or_else(|| AppError::internal("adresse d'envoi manquante"))?;
        let upload = value["upload_url"].as_str().ok_or_else(|| AppError::internal("adresse d'envoi manquante"))?;
        if !upload.starts_with("https://") && !cfg!(test) {
            return Err(AppError::invalid("Adresse d'envoi non sécurisée : image non envoyée."));
        }
        let mut put = self.http()?.put(upload).body(image.bytes.clone()).timeout(Duration::from_secs(120));
        match value["upload_headers"].as_object() {
            Some(headers) => {
                for (name, value) in headers {
                    if let Some(value) = value.as_str() {
                        put = put.header(name.as_str(), value);
                    }
                }
            }
            None => put = put.header(reqwest::header::CONTENT_TYPE, image.mime.as_str()),
        }
        let response = put.send().await.map_err(|e| http::unreachable(NAME, e))?;
        if !response.status().is_success() {
            return Err(AppError::new(
                AppErrorCode::Network,
                format!("Envoi de l'image refusé par le stockage de Higgsfield ({}).", response.status()),
            ));
        }
        Ok(public.to_string())
    }

    async fn poll(&self, key: &str, request_id: &str, cancel: &mut Cancel) -> AppResult<Value> {
        let started = Instant::now();
        loop {
            if *cancel.borrow() {
                let _ = self
                    .send(self.call(reqwest::Method::POST, &format!("/requests/{request_id}/cancel"), key)?.timeout(Duration::from_secs(15)))
                    .await;
                return Err(cancelled());
            }
            if started.elapsed() > POLL_LIMIT {
                return Err(AppError::new(AppErrorCode::Network, "Higgsfield n'a pas terminé en 15 minutes : la demande continue peut-être de son côté."));
            }
            let request = self
                .call(reqwest::Method::GET, &format!("/requests/{request_id}/status"), key)?
                .timeout(Duration::from_secs(30));
            match self.send(request).await {
                Ok((200, body)) => {
                    let value: Value = serde_json::from_str(&body)?;
                    match value["status"].as_str().unwrap_or("") {
                        "completed" => return Ok(value),
                        "failed" => return Err(AppError::new(AppErrorCode::Network, "La génération a échoué chez Higgsfield (crédits remboursés) : réessayez.")),
                        "nsfw" => return Err(AppError::invalid("Demande refusée par la modération de Higgsfield (crédits remboursés) : reformulez-la.")),
                        "canceled" | "cancelled" => return Err(cancelled()),
                        _ => {}
                    }
                }
                Ok((status, body)) if status < 500 => return Err(api_error(status, &body)),
                // Erreur serveur passagère : on continue de suivre.
                _ => {}
            }
            let _ = tokio::time::timeout(POLL_EVERY, cancel.changed()).await;
        }
    }
}

#[async_trait]
impl ImageProvider for Higgsfield {
    fn id(&self) -> ProviderId {
        ProviderId::Higgsfield
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
            match self.check(&key).await {
                Ok(()) => {
                    status.state = ConnectionState::Connected;
                    status.detail = Some("Identifiants acceptés. Le solde de crédits se consulte sur cloud.higgsfield.ai.".into());
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
        let valid = key.split_once(':').is_some_and(|(id, secret)| !id.is_empty() && !secret.is_empty() && !secret.contains(':'))
            && !key.chars().any(char::is_whitespace)
            && key.len() <= 512;
        if !valid {
            return Err(AppError::invalid(
                "Identifiants invalides : collez « KEY_ID:KEY_SECRET » tels que donnés par cloud.higgsfield.ai.",
            ));
        }
        self.check(key).await?;
        self.keys.save_own(key)?;
        crate::core::audit::record("imaging.key", "higgsfield", "saved", "user");
        Ok(self.status(true).await)
    }

    fn clear_key(&self) -> AppResult<()> {
        self.keys.clear_own()?;
        crate::core::audit::record("imaging.key", "higgsfield", "removed", "user");
        Ok(())
    }

    async fn models(&self) -> AppResult<ModelList> {
        Ok(ModelList {
            provider: ProviderId::Higgsfield,
            models: self.specs().iter().map(HiggsfieldModelSpec::to_model).collect(),
            offline: false,
            note: Some(
                "Higgsfield ne publie pas la liste de ses modèles par l'API : ajoutez-en d'autres avec leur identifiant et leurs arguments (documentation Higgsfield).".into(),
            ),
        })
    }

    async fn generate(&self, request: &ImageRequest, mut cancel: Cancel) -> AppResult<ImageResponse> {
        let key = self.key()?;
        let spec = self
            .specs()
            .into_iter()
            .find(|s| s.id == request.model)
            .ok_or_else(|| AppError::not_found(format!("Modèle Higgsfield inconnu : {}", request.model)))?;
        if !request.images.is_empty() && spec.image_field.is_none() {
            return Err(AppError::invalid(
                "Ce modèle Higgsfield ne reçoit pas d'image : choisissez un modèle d'édition, ou indiquez son argument d'image.",
            ));
        }
        let mut urls = Vec::new();
        for image in &request.images {
            urls.push(wait_or_cancel(self.upload(&key, image), cancel.clone()).await??);
        }
        let submit = self
            .call(reqwest::Method::POST, &spec.id, &key)?
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(spec.arguments(request, &urls).to_string())
            .timeout(Duration::from_secs(60));
        let (status, body) = wait_or_cancel(self.send(submit), cancel.clone()).await??;
        if !(200..300).contains(&status) {
            return Err(api_error(status, &body));
        }
        let mut value: Value = serde_json::from_str(&body)?;
        if value["status"] != "completed" {
            let id = value["request_id"]
                .as_str()
                .ok_or_else(|| AppError::internal("Higgsfield n'a pas donné de numéro de demande"))?
                .to_string();
            value = self.poll(&key, &id, &mut cancel).await?;
        }
        let mut images = Vec::new();
        for item in value["images"].as_array().into_iter().flatten() {
            if let Some(url) = item["url"].as_str() {
                let bytes = wait_or_cancel(async { http::download(self.http()?, NAME, url).await }, cancel.clone()).await??;
                images.push(GeneratedImage { bytes });
            }
        }
        if images.is_empty() {
            return Err(AppError::invalid("Higgsfield n'a renvoyé aucune image pour ce modèle."));
        }
        Ok(ImageResponse {
            images,
            usage: ImageUsage {
                note: Some("Crédits décomptés par Higgsfield : l'API ne donne pas le coût d'une demande.".into()),
                ..ImageUsage::default()
            },
            dropped: Vec::new(),
        })
    }
}

fn blank_status() -> ProviderStatus {
    ProviderStatus {
        provider: ProviderId::Higgsfield,
        access: ProviderAccess::Key,
        name: NAME.into(),
        state: ConnectionState::ApiKeyMissing,
        key_source: None,
        masked_key: None,
        detail: None,
        credits: None,
        key_hint: "Identifiants API Higgsfield « KEY_ID:KEY_SECRET »".into(),
        key_url: "https://cloud.higgsfield.ai/".into(),
    }
}

/// Codes d'erreur tels que les SDK officiels les interprètent (403 = crédits insuffisants).
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
        401 => (
            AppErrorCode::InvalidInput,
            "Identifiants Higgsfield refusés : vérifiez KEY_ID:KEY_SECRET sur cloud.higgsfield.ai.".to_string(),
        ),
        402 | 403 => (
            AppErrorCode::InvalidInput,
            "Crédits Higgsfield insuffisants : rechargez votre compte sur cloud.higgsfield.ai.".to_string(),
        ),
        400 | 422 => (AppErrorCode::InvalidInput, with_detail("Arguments refusés par Higgsfield")),
        404 => (
            AppErrorCode::NotFound,
            with_detail("Application Higgsfield introuvable : vérifiez son identifiant dans la documentation"),
        ),
        429 => (AppErrorCode::Network, "Trop de demandes envoyées à Higgsfield : réessayez dans un instant.".to_string()),
        other => (AppErrorCode::Network, with_detail(&format!("Higgsfield a répondu {other}"))),
    };
    AppError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::imaging::keys::MemoryStore;
    use crate::core::imaging::test_server::{fake_server, tiny_png, Reply};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};

    #[test]
    fn arguments_follow_the_spec() {
        let spec = &presets()[1];
        let request = ImageRequest {
            model: spec.id.clone(),
            prompt: "a sunset".into(),
            aspect_ratio: Some("9:16".into()),
            resolution: Some("4K".into()),
            seed: Some(1234),
            ..Default::default()
        };
        let args = spec.arguments(&request, &[]);
        assert_eq!(args, json!({"prompt":"a sunset","aspect_ratio":"9:16","seed":1234}), "pas de résolution pour ce modèle");
        let custom = HiggsfieldModelSpec {
            id: "acme/edit".into(),
            name: "Edit".into(),
            aspect_ratios: vec![],
            resolutions: vec![],
            seed: false,
            image_field: Some("image_urls".into()),
            image_field_list: true,
            extra: Some(json!({"strength": 0.6})),
            source: CapabilitySource::User,
        };
        let args = custom.arguments(&request, &["https://cdn/x.png".into()]);
        assert_eq!(args["image_urls"], json!(["https://cdn/x.png"]));
        assert_eq!(args["strength"], 0.6);
        let model = custom.to_model();
        assert!(model.capabilities.image_input && model.capabilities.source == CapabilitySource::User);
    }

    #[tokio::test]
    async fn submit_upload_poll_download_and_errors() {
        let png = tiny_png();
        let polls = Arc::new(AtomicU32::new(0));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let counter = polls.clone();
        let png_reply = png.clone();
        let address = Arc::new(Mutex::new(String::new()));
        let base = address.clone();
        let api = fake_server(seen.clone(), move |line, head, body| {
            let base = base.lock().unwrap().clone();
            if line.starts_with("GET /files/result.png") {
                return Reply::bytes("image/png", png_reply.clone());
            }
            if line.starts_with("PUT /upload/slot") {
                return Reply::json(200, "{}");
            }
            if !head.contains("authorization: Key id:good") {
                return Reply::json(401, r#"{"detail":"Invalid API credentials"}"#);
            }
            if line.starts_with("GET /requests/00000000") {
                return Reply::json(404, r#"{"detail":"Not found"}"#);
            }
            if line.starts_with("POST /files/generate-upload-url") {
                return Reply::json(200, &format!(r#"{{"public_url":"{base}/files/input.png","upload_url":"{base}/upload/slot"}}"#));
            }
            if line.starts_with("POST /nano-banana-pro") {
                return Reply::json(403, r#"{"detail":"Not enough credits"}"#);
            }
            if line.starts_with("POST /acme/edit") {
                assert!(body.contains("/files/input.png"), "{body}");
                return Reply::json(200, r#"{"status":"queued","request_id":"r1"}"#);
            }
            if line.starts_with("POST /bytedance") {
                return Reply::json(200, r#"{"status":"queued","request_id":"r1"}"#);
            }
            if line.starts_with("GET /requests/r1/status") {
                let n = counter.fetch_add(1, Ordering::SeqCst);
                return if n == 0 {
                    Reply::json(200, r#"{"status":"in_progress","request_id":"r1"}"#)
                } else {
                    Reply::json(200, &format!(r#"{{"status":"completed","request_id":"r1","images":[{{"url":"{base}/files/result.png"}}]}}"#))
                };
            }
            Reply::json(500, "{}")
        })
        .await;
        *address.lock().unwrap() = api.clone();
        let higgsfield = Higgsfield::new(
            &api,
            KeyRing::with_stores(Box::new(MemoryStore::default()), Vec::new()),
            reqwest::Client::builder().no_proxy(),
        );
        assert!(higgsfield.set_key("sans-deux-points").await.is_err());
        assert!(higgsfield.set_key("id:bad").await.err().unwrap().message.contains("refusés"));
        assert_eq!(higgsfield.set_key("id:good").await.unwrap().state, ConnectionState::Connected);

        // Les liens de test sont en http : on autorise le téléchargement local via un faux https.
        let (_tx, cancel) = crate::core::imaging::cancel_pair();
        let request = ImageRequest { model: "nano-banana-pro".into(), prompt: "x".into(), ..Default::default() };
        let broke = higgsfield.generate(&request, cancel.clone()).await.err().unwrap();
        assert!(broke.message.contains("Crédits Higgsfield insuffisants"));

        let refused = higgsfield
            .generate(
                &ImageRequest {
                    images: vec![InputImage { bytes: png.clone(), mime: "image/png".into() }],
                    ..request.clone()
                },
                cancel.clone(),
            )
            .await
            .err()
            .unwrap();
        assert!(refused.message.contains("ne reçoit pas d'image"));

        higgsfield.set_custom(vec![HiggsfieldModelSpec {
            id: "acme/edit".into(),
            name: "Edit".into(),
            aspect_ratios: vec![],
            resolutions: vec![],
            seed: false,
            image_field: Some("image_urls".into()),
            image_field_list: true,
            extra: None,
            source: CapabilitySource::User,
        }]);
        assert_eq!(higgsfield.models().await.unwrap().models.len(), 4);
        // Téléchargement en http refusé (seul https est accepté) : l'erreur le dit.
        let edit = higgsfield
            .generate(
                &ImageRequest {
                    model: "acme/edit".into(),
                    prompt: "remove the car".into(),
                    images: vec![InputImage { bytes: png.clone(), mime: "image/png".into() }],
                    ..Default::default()
                },
                cancel,
            )
            .await
            .err()
            .unwrap();
        assert!(edit.message.contains("non sécurisé"), "{}", edit.message);
        assert!(polls.load(Ordering::SeqCst) >= 2, "suivi jusqu'à « completed »");
        let seen = seen.lock().unwrap();
        assert!(seen.iter().any(|c| c.starts_with("PUT /upload/slot")));
    }

    #[tokio::test]
    async fn cancelling_stops_the_polling_and_cancels_the_request() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let api = fake_server(seen.clone(), |line, _, _| {
            if line.starts_with("POST /bytedance") {
                return Reply::json(200, r#"{"status":"queued","request_id":"r2"}"#);
            }
            if line.starts_with("POST /requests/r2/cancel") {
                return Reply::json(200, "{}");
            }
            Reply::json(200, r#"{"status":"queued","request_id":"r2"}"#)
        })
        .await;
        let higgsfield = Higgsfield::new(
            &api,
            KeyRing::with_stores(Box::new(MemoryStore::with("id:good")), Vec::new()),
            reqwest::Client::builder().no_proxy(),
        );
        let (tx, cancel) = crate::core::imaging::cancel_pair();
        let request = ImageRequest { model: "bytedance/seedream/v4/text-to-image".into(), prompt: "x".into(), ..Default::default() };
        let task = tokio::spawn(async move { higgsfield.generate(&request, cancel).await });
        tokio::time::sleep(Duration::from_millis(300)).await;
        tx.send(true).unwrap();
        let error = task.await.unwrap().err().unwrap();
        assert!(crate::core::imaging::is_cancelled(&error));
        assert!(seen.lock().unwrap().iter().any(|c| c.starts_with("POST /requests/r2/cancel")));
    }
}
