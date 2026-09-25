//! Types d'Image Maker échangés avec le frontend (bindings ts-rs dans `src/core/ipc/bindings/`).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::core::imaging::{HiggsfieldModelSpec, ImageUsage, ProviderId};

/// Ce qui a produit une version d'image.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageNodeKind")]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Import,
    Generate,
    Edit,
    Inpaint,
    Outpaint,
    Variation,
    Restyle,
    Upscale,
    Background,
    Restore,
    Combine,
    Crop,
    Resize,
    Rotate,
    Flip,
    Adjust,
    Move,
    /// Pinceau ou gomme sur l'image, dans l'éditeur.
    Paint,
    /// Fond rendu transparent localement (couleur unie).
    ChromaKey,
    Blur,
}

/// Une version d'image du projet. Rien n'est jamais écrasé : chaque opération en ajoute une,
/// rattachée à la version dont elle part (`parent`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ImageNode {
    pub id: String,
    pub parent: Option<String>,
    pub kind: NodeKind,
    pub label: String,
    /// Chemin absolu du fichier (lu par le webview via le protocole d'assets).
    pub file: String,
    /// Vignette (320 px), chemin absolu.
    pub thumb: String,
    pub width: u32,
    pub height: u32,
    pub mime: String,
    pub created_at: i64,
    pub prompt: Option<String>,
    pub negative_prompt: Option<String>,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    /// Réglages utilisés (format, résolution, graine, rectangle de recadrage…).
    #[ts(type = "Record<string, unknown>")]
    pub params: Value,
    /// Masque utilisé (blanc = zone modifiée), chemin absolu.
    pub mask: Option<String>,
    /// Versions utilisées comme références.
    pub references: Vec<String>,
    pub usage: Option<ImageUsage>,
    /// Remarque (réglages retirés par le modèle…).
    pub note: Option<String>,
    pub favorite: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageProject")]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub nodes: Vec<ImageNode>,
    /// Version affichée.
    pub current: Option<String>,
    /// Versions épinglées comme références du panneau IA.
    pub references: Vec<String>,
    /// Derniers réglages du panneau IA (fournisseur, modèle, format…), rendus tels quels.
    #[ts(type = "Record<string, unknown>")]
    pub ai_settings: Value,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageProjectSummary")]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub updated_at: i64,
    pub images: u32,
    pub cover: Option<String>,
}

/// Opérations faites sur la machine, sans envoi à un service.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageLocalOperation")]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum LocalOperation {
    Crop { x: u32, y: u32, width: u32, height: u32 },
    Resize { width: u32, height: u32 },
    /// Agrandissement local (Lanczos) avec un léger renforcement des détails.
    Upscale { factor: f32, sharpen: bool },
    /// Rotation en degrés (sens horaire) ; hors multiples de 90, le fond devient transparent.
    Rotate { degrees: f32 },
    Flip { horizontal: bool },
    /// Luminosité, contraste (-100…100), teinte (degrés).
    Adjust { brightness: i32, contrast: f32, hue: i32 },
    /// Flou gaussien hors du masque (fond flou) ou dans le masque.
    Blur { sigma: f32, #[ts(type = "string | null")] mask_png: Option<String>, inside: bool },
    /// Déplace la zone du masque de (dx, dy) ; la zone quittée reste à combler (IA ou non).
    Move { #[ts(type = "string")] mask_png: String, dx: i32, dy: i32 },
    /// Rend transparente une couleur de fond unie (tolérance 0…255).
    ChromaKey { #[ts(type = "[number, number, number]")] color: [u8; 3], tolerance: u8 },
}

/// Ce qu'on demande à l'IA. Chaque opération sait quelles images envoyer et comment
/// recoller le résultat (voir `pipeline.rs`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageAiOperation")]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AiOperation {
    /// Texte → image, avec d'éventuelles références (rôle libre : « personnage », « style »…).
    Generate { references: Vec<ReferenceRole> },
    /// Consigne sur toute l'image (image vers image).
    Edit { source: String, references: Vec<ReferenceRole> },
    /// Consigne limitée à la zone du masque ; le reste de l'image n'est jamais modifié.
    Inpaint {
        source: String,
        #[ts(type = "string")]
        mask_png: String,
        mode: InpaintMode,
    },
    /// Agrandit la toile ; l'original est replacé tel quel au pixel près.
    Outpaint { source: String, width: u32, height: u32, offset_x: u32, offset_y: u32 },
    /// Variante : éléments à garder, ce qui change.
    Variation { source: String, keep: Vec<String> },
    /// Même composition, autre style (décrit librement).
    Restyle { source: String, style: String },
    /// Régénération plus définie par l'IA (peut modifier de petits détails).
    Upscale { source: String },
    Background { source: String, action: BackgroundAction },
    Restore { source: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageReferenceRole")]
#[serde(rename_all = "camelCase")]
pub struct ReferenceRole {
    pub node: String,
    /// « personnage », « vêtements », « décor », « style »… (texte libre, peut être vide).
    pub role: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageInpaintMode")]
#[serde(rename_all = "camelCase")]
pub enum InpaintMode {
    /// Remplacer ce qui est dans la zone par ce qui est décrit.
    Replace,
    /// Effacer ce qui est dans la zone (le décor continue).
    Remove,
    /// Ajouter ce qui est décrit dans la zone.
    Add,
    /// Changer couleur, matière ou aspect de ce qui est dans la zone.
    Modify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageBackgroundAction")]
#[serde(rename_all = "camelCase")]
pub enum BackgroundAction {
    /// Fond transparent (détourage).
    Remove,
    /// Nouveau fond décrit par la consigne.
    Replace,
}

/// Réglages communs d'une demande à l'IA. Seuls ceux que le modèle accepte sont transmis.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageAiSettings")]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: ProviderId,
    pub model: String,
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub aspect_ratio: Option<String>,
    pub resolution: Option<String>,
    /// Nombre de résultats (1…20) ; découpé en demandes si le modèle en produit moins à la fois.
    pub count: u32,
    #[ts(type = "number | null")]
    pub seed: Option<u64>,
    pub quality: Option<String>,
    pub transparent_background: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageJobStatus")]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Waiting,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// Une tâche de la file (génération, édition, agrandissement…).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageJob")]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    /// Tâches nées d'une même demande (plusieurs résultats découpés en demandes).
    pub group: String,
    pub project_id: String,
    pub label: String,
    pub status: JobStatus,
    pub provider: ProviderId,
    pub model: String,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    /// Versions créées.
    pub results: Vec<String>,
    pub error: Option<String>,
    /// Nature de l'échec : le frontend propose l'action qui corrige (clé, crédit, modèle…).
    pub failure: Option<FailureKind>,
    pub usage: Option<ImageUsage>,
    /// Demande d'origine, gardée pour « Réessayer » (source et consigne ne se perdent pas).
    pub operation: AiOperation,
    pub settings: AiSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageFailureKind")]
#[serde(rename_all = "camelCase")]
pub enum FailureKind {
    /// Clé absente, refusée ou sans accès : Connexions.
    Key,
    /// Crédit ou quota épuisé chez le fournisseur.
    Credit,
    /// Demande refusée par la modération : reformuler.
    Moderation,
    /// Modèle retiré, indisponible ou qui refuse ces réglages : en choisir un autre.
    Model,
    /// Réseau, délai, surcharge : réessayer.
    Network,
    /// Demande incomplète (zone vide, consigne manquante…).
    Input,
    Other,
}

/// Format de toile nommé (réseau social, écran, impression…), modifiable par la personne.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageFormatPreset")]
#[serde(rename_all = "camelCase")]
pub struct FormatPreset {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageExportFormat")]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Png,
    Jpeg,
    Webp,
    Tiff,
    Gif,
    Bmp,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Webp => "webp",
            Self::Tiff => "tiff",
            Self::Gif => "gif",
            Self::Bmp => "bmp",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageExportPreset")]
#[serde(rename_all = "camelCase")]
pub struct ExportPreset {
    pub id: String,
    pub name: String,
    pub format: ExportFormat,
    /// Qualité JPEG (1…100).
    pub quality: u8,
    /// Plus grand côté en pixels (réduction seulement) ; `None` = taille d'origine.
    pub max_side: Option<u32>,
    /// Nom des fichiers : `{projet}`, `{version}`, `{n}`, `{date}`.
    pub naming: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageExportRequest")]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub project_id: String,
    pub nodes: Vec<String>,
    pub directory: String,
    pub format: ExportFormat,
    pub quality: u8,
    pub max_side: Option<u32>,
    pub naming: String,
    /// Fond appliqué aux zones transparentes pour les formats sans transparence (JPEG).
    #[ts(type = "[number, number, number]")]
    pub matte: [u8; 3],
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageExportResult")]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub files: Vec<String>,
    /// Remarques (transparence aplatie en JPEG, WebP sans perte…).
    pub notes: Vec<String>,
}

/// Réglages du module, rangés dans `settings.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct ImageMakerSettings {
    pub format_presets: Vec<FormatPreset>,
    pub export_presets: Vec<ExportPreset>,
    pub higgsfield_models: Vec<HiggsfieldModelSpec>,
    /// Tâches IA lancées en même temps par fournisseur.
    pub parallel_per_provider: u32,
    /// Projet qui reçoit les images demandées par d'autres modules.
    pub integration_project: Option<String>,
}

impl Default for ImageMakerSettings {
    fn default() -> Self {
        let format = |id: &str, name: &str, width: u32, height: u32| FormatPreset {
            id: id.into(),
            name: name.into(),
            width,
            height,
        };
        let export = |id: &str, name: &str, format: ExportFormat, quality: u8, max_side: Option<u32>| ExportPreset {
            id: id.into(),
            name: name.into(),
            format,
            quality,
            max_side,
            naming: "{projet}-{n}".into(),
        };
        Self {
            format_presets: vec![
                format("youtube-thumbnail", "Miniature YouTube", 1280, 720),
                format("youtube-banner", "Bannière YouTube", 2560, 1440),
                format("instagram-square", "Instagram carré", 1080, 1080),
                format("instagram-portrait", "Instagram portrait", 1080, 1350),
                format("story", "Story, Reels, TikTok", 1080, 1920),
                format("x-post", "Publication X", 1600, 900),
                format("full-hd", "Écran Full HD", 1920, 1080),
                format("uhd", "Écran 4K", 3840, 2160),
            ],
            export_presets: vec![
                export("original", "PNG d'origine", ExportFormat::Png, 100, None),
                export("web", "Web léger (JPEG 2048 px)", ExportFormat::Jpeg, 85, Some(2048)),
                export("webp", "WebP sans perte", ExportFormat::Webp, 100, None),
                export("print", "Impression (TIFF)", ExportFormat::Tiff, 100, None),
            ],
            higgsfield_models: Vec::new(),
            parallel_per_provider: 2,
            integration_project: None,
        }
    }
}

/// Résultat d'un traitement par lot (import, opération locale sur plusieurs versions).
#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[ts(rename = "ImageBatchOutcome")]
#[serde(rename_all = "camelCase")]
pub struct BatchOutcome {
    /// Projet après le dernier ajout réussi.
    pub project: Option<Project>,
    /// Versions créées.
    pub created: Vec<String>,
    /// Ce qui n'a pas pu être traité, et pourquoi.
    pub skipped: Vec<String>,
}

/// Image trouvée dans le dossier Téléchargements (mode compte : site officiel, puis import).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct DownloadedImage {
    pub path: String,
    pub name: String,
    pub modified: i64,
    pub bytes: u64,
}
