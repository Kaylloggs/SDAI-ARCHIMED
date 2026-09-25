//! Types de la couche fournisseurs d'images, partagés avec le frontend (bindings ts-rs).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Fournisseurs d'images branchés par API. En ajouter un : une variante ici, un fichier
/// dans `providers/`, une ligne dans `Imaging::new`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Openrouter,
    Gemini,
    Higgsfield,
    /// Higgsfield avec le compte de la personne, par la CLI officielle (`higgsfield auth login`).
    #[serde(rename = "higgsfieldAccount")]
    HiggsfieldAccount,
}

impl ProviderId {
    /// Suffixe des comptes du Gestionnaire d'identifiants (`<module>-<suffixe>`).
    pub fn slug(self) -> &'static str {
        match self {
            Self::Openrouter => "openrouter",
            Self::Gemini => "gemini",
            Self::Higgsfield => "higgsfield",
            Self::HiggsfieldAccount => "higgsfield-account",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Openrouter => "OpenRouter",
            Self::Gemini => "Google AI Studio (Gemini)",
            Self::Higgsfield => "Higgsfield",
            Self::HiggsfieldAccount => "Higgsfield (compte)",
        }
    }
}

/// État d'une connexion, tel que montré dans le gestionnaire de connexions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    /// Clé présente et acceptée par le fournisseur.
    Connected,
    /// Clé présente, pas encore vérifiée.
    Disconnected,
    /// Le fournisseur n'a pas répondu comme prévu (réseau, panne).
    Error,
    /// Clé refusée : il faut en fournir une valide.
    AuthRequired,
    /// Aucune clé.
    ApiKeyMissing,
    /// Clé acceptée mais aucun modèle d'image n'est ouvert.
    ModelUnavailable,
    /// L'outil officiel du fournisseur (CLI) n'est pas installé.
    CliMissing,
}

/// Comment on se connecte : clé d'API, ou compte de la personne (connexion dans son navigateur,
/// par l'outil officiel du fournisseur ; aucun mot de passe ne passe par l'application).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum ProviderAccess {
    Key,
    Account,
}

/// D'où vient la clé utilisée.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum KeySource {
    /// Rangée pour ce module.
    Own,
    /// Déjà rangée par un autre module : relue sur place, jamais recopiée.
    Shared { module: String },
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: ProviderId,
    pub name: String,
    pub access: ProviderAccess,
    pub state: ConnectionState,
    pub key_source: Option<KeySource>,
    /// Début et fin de la clé (« sk-or-…3f9a ») : jamais la clé entière.
    pub masked_key: Option<String>,
    /// Explication lisible (erreur, ce que la clé ouvre…).
    pub detail: Option<String>,
    /// Crédit restant, quand le fournisseur le donne.
    pub credits: Option<String>,
    /// Ce qu'il faut coller dans le champ de clé.
    pub key_hint: String,
    /// Page officielle où créer une clé.
    pub key_url: String,
}

/// Où l'information sur une capacité a été trouvée.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum CapabilitySource {
    /// Lue dans la liste des modèles du fournisseur (API).
    Api,
    /// Tirée de la documentation ou du SDK officiel du fournisseur.
    Docs,
    /// Déclarée par la personne (modèle ajouté à la main).
    User,
}

/// Ce qu'un modèle sait faire. Une option absente ici n'est jamais proposée.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    /// Crée une image à partir d'un texte.
    pub text_to_image: bool,
    /// Accepte des images en entrée : édition par consigne, image vers image, références.
    pub image_input: bool,
    /// Nombre d'images d'entrée accepté, quand il est connu.
    pub max_input_images: Option<u32>,
    /// Accepte un masque natif (sinon la zone est indiquée au modèle, puis recollée ici).
    pub native_mask: bool,
    /// Formats proposés (« 16:9 »…) ; vide = format non réglable.
    pub aspect_ratios: Vec<String>,
    /// Paliers de résolution (« 1K », « 2K »…) ; vide = non réglable.
    pub resolutions: Vec<String>,
    /// Images par demande (1 = une demande par image).
    pub max_images_per_request: u32,
    pub seed: bool,
    pub negative_prompt: bool,
    pub transparent_background: bool,
    pub qualities: Vec<String>,
    pub source: CapabilitySource,
}

impl ModelCapabilities {
    pub fn minimal(source: CapabilitySource) -> Self {
        Self {
            text_to_image: true,
            image_input: false,
            max_input_images: None,
            native_mask: false,
            aspect_ratios: Vec::new(),
            resolutions: Vec::new(),
            max_images_per_request: 1,
            seed: false,
            negative_prompt: false,
            transparent_background: false,
            qualities: Vec::new(),
            source,
        }
    }
}

/// Une ligne de prix donnée par le fournisseur (jamais inventée).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PriceLine {
    /// Ce qui est facturé (« image produite », « image d'entrée »…).
    pub label: String,
    pub cost_usd: f64,
    /// Par quoi (« image », « mégapixel », « demande », « token »).
    pub unit: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub provider: ProviderId,
    pub id: String,
    pub name: String,
    pub description: String,
    pub capabilities: ModelCapabilities,
    /// Prix connus ; vide = le fournisseur ne les donne pas ici.
    pub pricing: Vec<PriceLine>,
    /// Sans frais selon le fournisseur.
    pub free: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ModelList {
    pub provider: ProviderId,
    pub models: Vec<ProviderModel>,
    /// Liste reprise du cache : le fournisseur n'a pas répondu.
    pub offline: bool,
    /// Pourquoi la liste est vide ou partielle.
    pub note: Option<String>,
}

/// Image envoyée au modèle (source, zone indiquée ou référence).
#[derive(Debug, Clone)]
pub struct InputImage {
    pub bytes: Vec<u8>,
    pub mime: String,
}

/// Une demande d'image, commune à tous les fournisseurs. Chaque fournisseur ne transmet que
/// ce que le modèle accepte (voir `ModelCapabilities`).
#[derive(Debug, Clone, Default)]
pub struct ImageRequest {
    pub model: String,
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub images: Vec<InputImage>,
    pub aspect_ratio: Option<String>,
    pub resolution: Option<String>,
    pub count: u32,
    pub seed: Option<u64>,
    pub quality: Option<String>,
    pub transparent_background: bool,
}

/// Image produite ; son format est reconnu à ses premiers octets.
#[derive(Debug, Clone)]
pub struct GeneratedImage {
    pub bytes: Vec<u8>,
}

/// Consommation rapportée par le fournisseur ; `None` = non communiqué.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ImageUsage {
    pub cost_usd: Option<f64>,
    #[ts(type = "number | null")]
    pub input_tokens: Option<u64>,
    #[ts(type = "number | null")]
    pub output_tokens: Option<u64>,
    /// Remarque lisible (« coût non communiqué par le fournisseur »…).
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ImageResponse {
    pub images: Vec<GeneratedImage>,
    pub usage: ImageUsage,
    /// Réglages demandés que le modèle a refusés et qui ont été retirés (ex. résolution).
    pub dropped: Vec<String>,
}

/// Réécriture d'une description par un modèle de texte.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PromptSuggestion {
    pub prompt: String,
    pub model: String,
    pub usage: ImageUsage,
}
