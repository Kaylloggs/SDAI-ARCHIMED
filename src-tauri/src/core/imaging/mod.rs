//! Fournisseurs d'images par API (OpenRouter, Google AI Studio, Higgsfield), partagés entre
//! modules : chacun décrit les capacités réelles de ses modèles, et un module n'appelle que
//! le trait `ImageProvider`. Les clés vivent dans le Gestionnaire d'identifiants (`keys`).
//!
//! Aucune capacité n'est supposée : elle vient de la liste des modèles du fournisseur, ou de
//! sa documentation / de son SDK officiel quand l'API ne la donne pas (voir chaque fichier).

pub mod gemini;
pub mod higgsfield;
pub mod http;
pub mod keys;
pub mod openrouter;
pub mod types;

#[cfg(test)]
pub(crate) mod test_server;

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

pub use higgsfield::HiggsfieldModelSpec;
use keys::KeyRing;
pub use types::*;

/// Signal d'annulation d'une génération (`true` = annulée).
pub type Cancel = tokio::sync::watch::Receiver<bool>;

pub fn cancel_pair() -> (tokio::sync::watch::Sender<bool>, Cancel) {
    tokio::sync::watch::channel(false)
}

/// Attend `work`, ou s'arrête dès que l'annulation est demandée.
pub async fn wait_or_cancel<T>(work: impl Future<Output = T>, mut cancel: Cancel) -> AppResult<T> {
    if *cancel.borrow() {
        return Err(cancelled());
    }
    tokio::select! {
        result = work => Ok(result),
        _ = async {
            while cancel.changed().await.is_ok() {
                if *cancel.borrow() {
                    return;
                }
            }
            // Émetteur disparu : on laisse le travail se terminer.
            std::future::pending::<()>().await;
        } => Err(cancelled()),
    }
}

pub fn cancelled() -> AppError {
    AppError::new(AppErrorCode::Internal, "Annulée.")
}

pub fn is_cancelled(error: &AppError) -> bool {
    error.message == "Annulée."
}

#[async_trait]
pub trait ImageProvider: Send + Sync {
    fn id(&self) -> ProviderId;
    /// État de la connexion ; `check` interroge le fournisseur.
    async fn status(&self, check: bool) -> ProviderStatus;
    /// Vérifie la clé auprès du fournisseur, puis la range. Une clé refusée n'est pas gardée.
    async fn set_key(&self, key: &str) -> AppResult<ProviderStatus>;
    fn clear_key(&self) -> AppResult<()>;
    async fn models(&self) -> AppResult<ModelList>;
    /// Prix d'un modèle quand le fournisseur les publie.
    async fn pricing(&self, _model: &str) -> AppResult<Vec<PriceLine>> {
        Ok(Vec::new())
    }
    async fn generate(&self, request: &ImageRequest, cancel: Cancel) -> AppResult<ImageResponse>;
    /// Réécrit une description d'image avec un modèle de texte du fournisseur.
    async fn improve_prompt(&self, _prompt: &str, _instructions: &str) -> AppResult<PromptSuggestion> {
        Err(AppError::invalid("Ce fournisseur ne propose pas de modèle de texte."))
    }
}

/// Garde la dernière liste de modèles pour le hors-ligne.
pub(crate) fn remember(cache: &Path, models: &[ProviderModel]) {
    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(raw) = serde_json::to_vec(models) {
        let _ = std::fs::write(cache, raw);
    }
}

pub(crate) fn recall(cache: &Path) -> Option<Vec<ProviderModel>> {
    std::fs::read(cache).ok().and_then(|raw| serde_json::from_slice(&raw).ok())
}

/// Adresses remplaçables (HTTPS uniquement) : `<dossier>/imaging-env.json`, pour les tests
/// de bout en bout contre un faux service.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvSettings {
    openrouter_api: Option<String>,
    gemini_api: Option<String>,
    higgsfield_api: Option<String>,
}

/// Les fournisseurs d'un module, avec ses clés (`<module>-<fournisseur>`) et son cache.
pub struct Imaging {
    providers: Vec<Arc<dyn ImageProvider>>,
    higgsfield: Arc<higgsfield::Higgsfield>,
}

impl Imaging {
    pub fn new(owner: &str, module_dir: &Path) -> Self {
        let env: EnvSettings = std::fs::read_to_string(module_dir.join("imaging-env.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let https = |url: Option<String>, default: &str| {
            url.filter(|u| u.starts_with("https://"))
                .unwrap_or_else(|| default.to_string())
        };
        let cache = |name: &str| -> PathBuf { module_dir.join("cache").join(name) };
        let openrouter = Arc::new(openrouter::OpenRouter::new(
            &https(env.openrouter_api, openrouter::DEFAULT_API),
            KeyRing::for_module(owner, ProviderId::Openrouter),
            cache("openrouter-image-models.json"),
            reqwest::Client::builder(),
        ));
        let gemini = Arc::new(gemini::Gemini::new(
            &https(env.gemini_api, gemini::DEFAULT_API),
            KeyRing::for_module(owner, ProviderId::Gemini),
            cache("gemini-image-models.json"),
            reqwest::Client::builder(),
        ));
        let higgsfield = Arc::new(higgsfield::Higgsfield::new(
            &https(env.higgsfield_api, higgsfield::DEFAULT_API),
            KeyRing::for_module(owner, ProviderId::Higgsfield),
            reqwest::Client::builder(),
        ));
        Self {
            providers: vec![openrouter, gemini, higgsfield.clone()],
            higgsfield,
        }
    }

    /// Fournisseurs de test (faux services).
    #[cfg(test)]
    pub fn with_providers(providers: Vec<Arc<dyn ImageProvider>>) -> Self {
        let keys = KeyRing::with_stores(Box::<keys::MemoryStore>::default(), Vec::new());
        Self {
            providers,
            higgsfield: Arc::new(higgsfield::Higgsfield::new("https://127.0.0.1", keys, reqwest::Client::builder())),
        }
    }

    pub fn all(&self) -> &[Arc<dyn ImageProvider>] {
        &self.providers
    }

    pub fn provider(&self, id: ProviderId) -> AppResult<Arc<dyn ImageProvider>> {
        self.providers
            .iter()
            .find(|p| p.id() == id)
            .cloned()
            .ok_or_else(|| AppError::not_found(format!("Fournisseur inconnu : {}", id.label())))
    }

    /// Modèles Higgsfield ajoutés par la personne (l'API ne liste pas ses modèles).
    pub fn set_higgsfield_models(&self, models: Vec<HiggsfieldModelSpec>) {
        self.higgsfield.set_custom(models);
    }
}
