//! Textures du projet : inventaire, brouillons (image reçue + texture convertie) et
//! application dans le projet.
//!
//! Un brouillon vit dans le cache du module (`cache/textures/<id>/`) tant que la personne
//! ne l'a pas appliqué ; appliquer écrit le PNG dans `assets/` après avoir gardé l'ancien
//! dans `.mcstudio/history/textures/`. Rien n'est écrit dans le projet sans ce geste.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::core::{AppError, AppResult};

use super::content;
use super::fsutil;
use super::pixelart::{self, Raster};
use super::types::{DraftSource, PixelOptions, TextureDraft, TextureInfo, TextureTarget};

/// Brouillons gardés en cache (les plus récents).
const KEEP_DRAFTS: usize = 30;
/// Côté minimal de l'icône du mod : une icône 16 × 16 est agrandie sans lissage.
const ICON_SIDE: u32 = 64;
/// Longueur maximale d'une description envoyée au modèle.
pub const MAX_DESCRIPTION: usize = 600;

fn assets_dir(root: &Path, mod_id: &str) -> PathBuf {
    root.join("src/main/resources/assets").join(mod_id)
}

/// Chemin du PNG d'une cible, relatif au projet.
pub fn relative_path(mod_id: &str, target: &TextureTarget) -> AppResult<String> {
    let base = format!("src/main/resources/assets/{mod_id}");
    Ok(match target {
        TextureTarget::Item { id } => {
            content::validate_id(id)?;
            format!("{base}/textures/item/{id}.png")
        }
        TextureTarget::Block { id } => {
            content::validate_id(id)?;
            format!("{base}/textures/block/{id}.png")
        }
        TextureTarget::Icon => format!("{base}/icon.png"),
    })
}

/// Ce qui part au modèle : la description de la personne, cadrée pour Minecraft.
pub fn prompt_for(target: &TextureTarget, description: &str) -> String {
    let what = description.trim();
    match target {
        TextureTarget::Item { .. } => format!(
            "Minecraft item sprite of {what}. One single object, centered and entirely visible, \
             drawn like a Minecraft inventory icon: bold simple silhouette, flat colors with \
             simple shading, pixel art style. Isolated on a plain uniform background of one \
             flat color that contrasts with the object. No text, no border, no shadow, no frame."
        ),
        TextureTarget::Block { .. } => format!(
            "Seamless tileable Minecraft block texture of {what}. Square, fills the whole image \
             edge to edge, flat front view, no perspective, no 3D cube, even lighting, pixel art \
             style. No text, no border, no frame."
        ),
        TextureTarget::Icon => format!(
            "Square logo icon for a Minecraft mod: {what}. Bold and readable at small size, \
             centered, pixel art style, simple background. No text, no letters."
        ),
    }
}

pub fn validate_description(description: &str) -> AppResult<()> {
    let length = description.trim().chars().count();
    if length == 0 {
        return Err(AppError::invalid("Décrivez la texture à obtenir."));
    }
    if length > MAX_DESCRIPTION {
        return Err(AppError::invalid(format!(
            "Description trop longue ({length} caractères, {MAX_DESCRIPTION} au plus)."
        )));
    }
    Ok(())
}

fn lang_names(root: &Path, mod_id: &str) -> Map<String, Value> {
    let mut names = Map::new();
    // Le français d'abord, l'anglais comble les manques.
    for lang in ["en_us", "fr_fr"] {
        let path = assets_dir(root, mod_id).join(format!("lang/{lang}.json"));
        if let Some(Value::Object(map)) = std::fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
        {
            names.extend(map);
        }
    }
    names
}

fn png_stems(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            (path.extension().and_then(|e| e.to_str()) == Some("png"))
                .then(|| path.file_stem()?.to_str().map(str::to_string))
                .flatten()
        })
        .filter(|stem| content::validate_id(stem).is_ok())
        .collect()
}

pub fn info(root: &Path, mod_id: &str, target: &TextureTarget) -> AppResult<TextureInfo> {
    info_with(root, mod_id, target, &lang_names(root, mod_id))
}

fn info_with(
    root: &Path,
    mod_id: &str,
    target: &TextureTarget,
    names: &Map<String, Value>,
) -> AppResult<TextureInfo> {
    let relative = relative_path(mod_id, target)?;
    let path = root.join(&relative);
    let (width, height) = image::image_dimensions(&path).unwrap_or((0, 0));
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    let label = match target {
        TextureTarget::Item { id } => names
            .get(&format!("item.{mod_id}.{id}"))
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string(),
        TextureTarget::Block { id } => names
            .get(&format!("block.{mod_id}.{id}"))
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string(),
        TextureTarget::Icon => "Icône du mod".to_string(),
    };
    Ok(TextureInfo {
        target: target.clone(),
        label,
        exists: path.is_file(),
        path: path.display().to_string(),
        relative,
        width,
        height,
        modified,
    })
}

/// L'icône, puis les objets et les blocs : textures présentes et textures attendues par
/// un objet ou un bloc déclaré dans les traductions.
pub fn list(root: &Path, mod_id: &str) -> Vec<TextureInfo> {
    let names = lang_names(root, mod_id);
    let textures = assets_dir(root, mod_id).join("textures");
    let declared = |kind: &str| -> BTreeSet<String> {
        let prefix = format!("{kind}.{mod_id}.");
        names
            .keys()
            .filter_map(|key| key.strip_prefix(&prefix))
            .filter(|rest| !rest.contains('.') && content::validate_id(rest).is_ok())
            .map(str::to_string)
            .collect()
    };
    let mut items = declared("item");
    items.extend(png_stems(&textures.join("item")));
    let mut blocks = declared("block");
    blocks.extend(png_stems(&textures.join("block")));

    std::iter::once(TextureTarget::Icon)
        .chain(items.into_iter().map(|id| TextureTarget::Item { id }))
        .chain(blocks.into_iter().map(|id| TextureTarget::Block { id }))
        .filter_map(|target| info_with(root, mod_id, &target, &names).ok())
        .collect()
}

/// Brouillons de textures, dans le cache du module.
pub struct Drafts {
    dir: PathBuf,
}

fn valid_draft_id(id: &str) -> AppResult<()> {
    if id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(AppError::invalid("Brouillon inconnu."))
    }
}

/// Texture finale d'un brouillon : l'icône est agrandie pixel par pixel.
fn render(source: &Raster, target: &TextureTarget, options: &PixelOptions) -> AppResult<Vec<u8>> {
    let texture = pixelart::convert(source, options)?;
    match target {
        TextureTarget::Icon => pixelart::upscale_to(&texture, ICON_SIDE).png(),
        _ => texture.png(),
    }
}

impl Drafts {
    pub fn new(module_dir: &Path) -> Self {
        Self {
            dir: module_dir.join("cache").join("textures"),
        }
    }

    fn folder(&self, id: &str) -> AppResult<PathBuf> {
        valid_draft_id(id)?;
        Ok(self.dir.join(id))
    }

    /// Enregistre l'image reçue, la convertit, et garde le tout en brouillon.
    pub fn create(
        &self,
        project_id: &str,
        target: TextureTarget,
        source: DraftSource,
        original: &[u8],
        options: PixelOptions,
    ) -> AppResult<TextureDraft> {
        if let TextureTarget::Item { id } | TextureTarget::Block { id } = &target {
            content::validate_id(id)?;
        }
        let raster = pixelart::decode(original)?;
        let extension = pixelart::extension_of(original).unwrap_or("png");
        let pixels = render(&raster, &target, &options)?;

        let id = uuid::Uuid::new_v4().simple().to_string();
        let folder = self.folder(&id)?;
        std::fs::create_dir_all(&folder)?;
        let original_path = folder.join(format!("source.{extension}"));
        let pixel_path = folder.join("pixel.png");
        std::fs::write(&original_path, original)?;
        std::fs::write(&pixel_path, pixels)?;
        let draft = TextureDraft {
            id,
            project_id: project_id.to_string(),
            target,
            source,
            original_path: original_path.display().to_string(),
            original_width: raster.width,
            original_height: raster.height,
            pixel_path: pixel_path.display().to_string(),
            options,
            revision: 1,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.save(&draft)?;
        self.prune();
        Ok(draft)
    }

    fn save(&self, draft: &TextureDraft) -> AppResult<()> {
        let body = serde_json::to_vec_pretty(draft)?;
        fsutil::write_atomic(&self.folder(&draft.id)?.join("draft.json"), &body)
    }

    pub fn load(&self, id: &str) -> AppResult<TextureDraft> {
        let raw = std::fs::read(self.folder(id)?.join("draft.json")).map_err(|_| {
            AppError::not_found("Ce brouillon n'existe plus : régénérez la texture.")
        })?;
        Ok(serde_json::from_slice(&raw)?)
    }

    /// Nouvelle conversion de la même image avec d'autres réglages (sans réseau).
    pub fn reprocess(&self, id: &str, options: PixelOptions) -> AppResult<TextureDraft> {
        let mut draft = self.load(id)?;
        let original = std::fs::read(&draft.original_path)?;
        let raster = pixelart::decode(&original)?;
        let pixels = render(&raster, &draft.target, &options)?;
        fsutil::write_atomic(Path::new(&draft.pixel_path), &pixels)?;
        draft.options = options;
        draft.revision += 1;
        self.save(&draft)?;
        Ok(draft)
    }

    /// Écrit la texture dans le projet ; l'ancienne part dans l'historique du projet.
    pub fn apply(
        &self,
        id: &str,
        project_id: &str,
        root: &Path,
        mod_id: &str,
    ) -> AppResult<TextureInfo> {
        let draft = self.load(id)?;
        if draft.project_id != project_id {
            return Err(AppError::invalid(
                "Ce brouillon a été préparé pour un autre projet.",
            ));
        }
        let relative = relative_path(mod_id, &draft.target)?;
        let path = root.join(&relative);
        let pixels = std::fs::read(&draft.pixel_path)?;
        pixelart::decode(&pixels)?;
        if path.is_file() {
            backup(root, &path, &draft.target)?;
        }
        fsutil::write_atomic(&path, &pixels)?;
        let origin = match &draft.source {
            DraftSource::OpenRouter { model, .. } => format!("openrouter:{model}"),
            DraftSource::Gemini { model, .. } => format!("gemini:{model}"),
            DraftSource::File { .. } => "fichier".to_string(),
        };
        crate::core::audit::record(
            "mcstudio.texture_apply",
            &format!("{} ({origin})", path.display()),
            "applied",
            "user",
        );
        info(root, mod_id, &draft.target)
    }

    /// Garde les brouillons les plus récents (nom de dossier sans importance : date du JSON).
    fn prune(&self) {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return;
        };
        let mut drafts: Vec<(String, PathBuf)> = entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                let raw = std::fs::read(path.join("draft.json")).ok()?;
                let draft: TextureDraft = serde_json::from_slice(&raw).ok()?;
                Some((draft.created_at, path))
            })
            .collect();
        drafts.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in drafts.into_iter().skip(KEEP_DRAFTS) {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

/// Copie datée de la texture remplacée : `.mcstudio/history/textures/<date>-<cible>.png`.
fn backup(root: &Path, current: &Path, target: &TextureTarget) -> AppResult<PathBuf> {
    let dir = root.join(".mcstudio/history/textures");
    std::fs::create_dir_all(&dir)?;
    let name = match target {
        TextureTarget::Item { id } => format!("item-{id}"),
        TextureTarget::Block { id } => format!("block-{id}"),
        TextureTarget::Icon => "icon".to_string(),
    };
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let mut destination = dir.join(format!("{stamp}-{name}.png"));
    let mut n = 2;
    while destination.exists() {
        destination = dir.join(format!("{stamp}-{name}-{n}.png"));
        n += 1;
    }
    std::fs::copy(current, &destination)?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mcstudio-art-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn picture() -> Vec<u8> {
        let mut raster = Raster::new(128, 128);
        for (i, p) in raster.px.iter_mut().enumerate() {
            let (x, y) = (i % 128, i / 128);
            *p = if (32..96).contains(&x) && (32..96).contains(&y) {
                [30, 120, 220, 255]
            } else {
                [255, 255, 255, 255]
            };
        }
        raster.png().unwrap()
    }

    fn options(size: u32, transparent: bool) -> PixelOptions {
        PixelOptions {
            size,
            colors: 16,
            transparent,
        }
    }

    #[test]
    fn prompts_frame_the_description() {
        let item = prompt_for(
            &TextureTarget::Item { id: "ruby".into() },
            "  une épée en rubis ",
        );
        assert!(item.starts_with("Minecraft item sprite of une épée en rubis."));
        assert!(prompt_for(&TextureTarget::Block { id: "x".into() }, "x").contains("tileable"));
        assert!(validate_description(" ").is_err());
        assert!(validate_description(&"a".repeat(MAX_DESCRIPTION + 1)).is_err());
    }

    #[test]
    fn paths_refuse_foreign_ids() {
        assert!(relative_path("dm", &TextureTarget::Item { id: "../x".into() }).is_err());
        assert_eq!(
            relative_path(
                "dm",
                &TextureTarget::Block {
                    id: "ruby_block".into()
                }
            )
            .unwrap(),
            "src/main/resources/assets/dm/textures/block/ruby_block.png"
        );
    }

    #[test]
    fn a_draft_is_converted_reprocessed_then_applied_with_a_backup() {
        let module = temp("module");
        let root = temp("project");
        let drafts = Drafts::new(&module);
        let target = TextureTarget::Item {
            id: "sapphire".into(),
        };

        // Projet : un objet déclaré sans texture, une icône existante.
        let assets = assets_dir(&root, "dm");
        std::fs::create_dir_all(assets.join("lang")).unwrap();
        std::fs::write(
            assets.join("lang/fr_fr.json"),
            r#"{"item.dm.sapphire":"Saphir","block.dm.ore":"Minerai"}"#,
        )
        .unwrap();
        std::fs::write(assets.join("icon.png"), picture()).unwrap();
        let listed = list(&root, "dm");
        let labels: Vec<(&str, bool)> = listed
            .iter()
            .map(|t| (t.label.as_str(), t.exists))
            .collect();
        assert_eq!(
            labels,
            [
                ("Icône du mod", true),
                ("Saphir", false),
                ("Minerai", false)
            ]
        );

        let draft = drafts
            .create(
                "p1",
                target.clone(),
                DraftSource::File {
                    name: "saphir.png".into(),
                },
                &picture(),
                options(16, true),
            )
            .unwrap();
        assert_eq!((draft.original_width, draft.original_height), (128, 128));
        let pixel = pixelart::decode(&std::fs::read(&draft.pixel_path).unwrap()).unwrap();
        assert_eq!((pixel.width, pixel.height), (16, 16));
        assert_eq!(pixel.px[0][3], 0, "fond blanc retiré");

        let again = drafts.reprocess(&draft.id, options(32, true)).unwrap();
        assert_eq!(again.revision, 2);
        let pixel = pixelart::decode(&std::fs::read(&again.pixel_path).unwrap()).unwrap();
        assert_eq!(pixel.width, 32);

        assert!(drafts
            .apply(&draft.id, "autre-projet", &root, "dm")
            .is_err());
        let applied = drafts.apply(&draft.id, "p1", &root, "dm").unwrap();
        assert!(applied.exists);
        assert_eq!((applied.width, applied.height), (32, 32));

        // Deuxième application : l'ancienne texture est gardée.
        drafts.apply(&draft.id, "p1", &root, "dm").unwrap();
        let history: Vec<_> = std::fs::read_dir(root.join(".mcstudio/history/textures"))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(history.len(), 1);

        // L'icône est agrandie à 64 px, pixel par pixel.
        let icon = drafts
            .create(
                "p1",
                TextureTarget::Icon,
                DraftSource::File {
                    name: "logo.png".into(),
                },
                &picture(),
                options(16, false),
            )
            .unwrap();
        let info = drafts.apply(&icon.id, "p1", &root, "dm").unwrap();
        assert_eq!((info.width, info.height), (64, 64));

        assert!(drafts.load("../../etc").is_err());
        let _ = std::fs::remove_dir_all(&module);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn old_drafts_are_pruned() {
        let module = temp("prune");
        let drafts = Drafts::new(&module);
        for _ in 0..KEEP_DRAFTS + 3 {
            drafts
                .create(
                    "p",
                    TextureTarget::Icon,
                    DraftSource::File {
                        name: "a.png".into(),
                    },
                    &picture(),
                    options(16, false),
                )
                .unwrap();
        }
        assert_eq!(
            std::fs::read_dir(module.join("cache/textures"))
                .unwrap()
                .count(),
            KEEP_DRAFTS
        );
        let _ = std::fs::remove_dir_all(&module);
    }
}
