//! Textures du projet : inventaire, brouillons (image reçue + texture convertie), retouches
//! au pixel, faces des blocs, éléments d'interface, et application dans le projet.
//!
//! Un brouillon vit dans le cache du module (`cache/textures/<id>/`) tant que la personne
//! ne l'a pas appliqué ; appliquer écrit le PNG dans `assets/` après avoir gardé l'ancien
//! dans `.mcstudio/history/textures/`. Rien n'est écrit dans le projet sans ce geste.
//!
//! Les faces d'un bloc suivent son modèle (`models/block/<id>.json`) : `cube_all` (une
//! texture), `cube_column` (côtés + extrémités), `cube_bottom_top` (dessus, dessous, côtés)
//! ou `cube` (six faces). Le chemin de chaque face est lu dans le modèle ; à défaut, il suit
//! la convention `block/<id>_<face>.png`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{json, Map, Value};

use crate::core::{AppError, AppResult};

use super::content;
use super::files;
use super::fsutil;
use super::pixelart::{self, Raster};
use super::snapshots;
use super::textures;
use super::types::{
    BlockFace, BlockLayout, DraftSource, GuiPreset, GuiRequest, PixelData, PixelOptions,
    PromptSettings, SnapshotKind, TextureDraft, TextureInfo, TextureStyle, TextureTarget, Tiling,
};

/// Propositions gardées par texture (historique de l'atelier), les plus récentes.
const KEEP_PER_TEXTURE: usize = 20;
/// Propositions gardées en tout dans le cache du module.
const KEEP_DRAFTS: usize = 150;
/// Côté minimal de l'icône du mod : une icône 16 × 16 est agrandie sans lissage.
const ICON_SIDE: u32 = 64;
/// Longueur maximale d'une description envoyée au modèle.
pub const MAX_DESCRIPTION: usize = 600;
/// Longueur maximale des consignes ajoutées.
pub const MAX_EXTRA: usize = 600;
/// Longueur maximale d'un texte écrit à la main pour le modèle.
pub const MAX_PROMPT: usize = 4000;
/// Côté visé d'une texture envoyée en référence (agrandie pixel par pixel).
const REFERENCE_SIDE: u32 = 512;
/// Côté maximal d'une texture ouverte dans l'éditeur.
const EDITOR_MAX: u32 = 512;
const HAND_EDITED: &str = "Retouchée à la main.";

fn assets_base(mod_id: &str) -> String {
    format!("src/main/resources/assets/{mod_id}")
}

fn assets_dir(root: &Path, mod_id: &str) -> PathBuf {
    root.join(assets_base(mod_id))
}

// ── Faces des blocs ─────────────────────────────────────────────────────────

fn face_suffix(face: BlockFace) -> &'static str {
    match face {
        BlockFace::Top => "top",
        BlockFace::Bottom => "bottom",
        BlockFace::Side => "side",
        BlockFace::End => "end",
        BlockFace::North => "north",
        BlockFace::South => "south",
        BlockFace::East => "east",
        BlockFace::West => "west",
    }
}

fn face_label(face: BlockFace) -> &'static str {
    match face {
        BlockFace::Top => "dessus",
        BlockFace::Bottom => "dessous",
        BlockFace::Side => "côtés",
        BlockFace::End => "extrémités",
        BlockFace::North => "nord",
        BlockFace::South => "sud",
        BlockFace::East => "est",
        BlockFace::West => "ouest",
    }
}

/// Faces qui portent chacune leur texture ; vide : une texture pour tout le bloc.
pub fn layout_faces(layout: BlockLayout) -> &'static [BlockFace] {
    match layout {
        BlockLayout::All | BlockLayout::Custom => &[],
        BlockLayout::Column => &[BlockFace::Side, BlockFace::End],
        BlockLayout::BottomTop => &[BlockFace::Top, BlockFace::Bottom, BlockFace::Side],
        BlockLayout::Faces => &[
            BlockFace::Top,
            BlockFace::Bottom,
            BlockFace::North,
            BlockFace::South,
            BlockFace::East,
            BlockFace::West,
        ],
    }
}

fn layout_parent(layout: BlockLayout) -> Option<&'static str> {
    match layout {
        BlockLayout::All => Some("minecraft:block/cube_all"),
        BlockLayout::Column => Some("minecraft:block/cube_column"),
        BlockLayout::BottomTop => Some("minecraft:block/cube_bottom_top"),
        BlockLayout::Faces => Some("minecraft:block/cube"),
        BlockLayout::Custom => None,
    }
}

fn layout_of_parent(parent: &str) -> BlockLayout {
    match parent.strip_prefix("minecraft:").unwrap_or(parent) {
        "block/cube_all" => BlockLayout::All,
        "block/cube_column" => BlockLayout::Column,
        "block/cube_bottom_top" => BlockLayout::BottomTop,
        "block/cube" => BlockLayout::Faces,
        _ => BlockLayout::Custom,
    }
}

/// Clé de la face dans les `textures` du modèle parent.
fn face_key(layout: BlockLayout, face: BlockFace) -> &'static str {
    match (layout, face) {
        (BlockLayout::Faces, BlockFace::Top) => "up",
        (BlockLayout::Faces, BlockFace::Bottom) => "down",
        (_, face) => face_suffix(face),
    }
}

fn block_model_path(mod_id: &str, id: &str) -> String {
    format!("{}/models/block/{id}.json", assets_base(mod_id))
}

/// Modèle d'un bloc : sa répartition des faces et les textures qu'il référence.
struct BlockModel {
    layout: BlockLayout,
    body: Map<String, Value>,
    exists: bool,
}

impl BlockModel {
    fn textures(&self) -> Option<&Map<String, Value>> {
        self.body.get("textures").and_then(Value::as_object)
    }
}

fn read_block_model(root: &Path, mod_id: &str, id: &str) -> BlockModel {
    let Ok(raw) = std::fs::read_to_string(root.join(block_model_path(mod_id, id))) else {
        return BlockModel {
            layout: BlockLayout::All,
            body: Map::new(),
            exists: false,
        };
    };
    let body = serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let parent = body.get("parent").and_then(Value::as_str).unwrap_or("");
    BlockModel {
        layout: layout_of_parent(parent),
        body,
        exists: true,
    }
}

/// `<modid>:block/nom` → chemin relatif du PNG ; `None` pour une texture d'un autre espace de
/// noms (celles du jeu) ou un nom suspect.
fn texture_ref_path(mod_id: &str, reference: &str) -> Option<String> {
    let (namespace, rest) = reference.split_once(':')?;
    let clean = !rest.is_empty()
        && rest.split('/').all(|part| !part.is_empty())
        && rest.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '/' || c == '-'
        });
    (namespace == mod_id && clean).then(|| format!("{}/textures/{rest}.png", assets_base(mod_id)))
}

/// Référence de modèle (`<modid>:block/nom`) d'un PNG de `textures/`.
fn model_reference(mod_id: &str, relative: &str) -> Option<String> {
    let rest = relative
        .strip_prefix(&format!("{}/textures/", assets_base(mod_id)))?
        .strip_suffix(".png")?;
    Some(format!("{mod_id}:{rest}"))
}

// ── Chemins, noms, inventaire ───────────────────────────────────────────────

/// Chemin conventionnel du PNG d'une cible, relatif au projet (sans lire le modèle).
pub fn relative_path(mod_id: &str, target: &TextureTarget) -> AppResult<String> {
    let base = assets_base(mod_id);
    Ok(match target {
        TextureTarget::Item { id } => {
            content::validate_id(id)?;
            format!("{base}/textures/item/{id}.png")
        }
        TextureTarget::Block { id, face } => {
            content::validate_id(id)?;
            match face {
                None => format!("{base}/textures/block/{id}.png"),
                Some(face) => format!("{base}/textures/block/{id}_{}.png", face_suffix(*face)),
            }
        }
        TextureTarget::Icon => format!("{base}/icon.png"),
        TextureTarget::Gui { name } => {
            content::validate_id(name)?;
            format!("{base}/textures/gui/{name}.png")
        }
    })
}

/// Chemin réel du PNG : pour une face de bloc, celui que référence le modèle du bloc.
pub fn resolve_path(root: &Path, mod_id: &str, target: &TextureTarget) -> AppResult<String> {
    let convention = relative_path(mod_id, target)?;
    if let TextureTarget::Block { id, face } = target {
        let model = read_block_model(root, mod_id, id);
        let textures = model.textures();
        let path_of = |key: &str| {
            textures
                .and_then(|t| t.get(key))
                .and_then(Value::as_str)
                .and_then(|reference| texture_ref_path(mod_id, reference))
        };
        let found = match face {
            Some(face) => path_of(face_key(model.layout, *face)),
            // Texture unique : `all`, sinon celle qu'un modèle fait main met en avant.
            None => ["all", "texture", "side", "end", "top", "particle"]
                .iter()
                .find_map(|key| path_of(key))
                .or_else(|| {
                    textures?.values().find_map(|reference| {
                        reference.as_str().and_then(|r| texture_ref_path(mod_id, r))
                    })
                }),
        };
        if let Some(path) = found {
            return Ok(path);
        }
    }
    Ok(convention)
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

/// Consignes ajoutées et texte écrit à la main : longueurs bornées.
pub fn validate_prompt(settings: &PromptSettings, custom: Option<&str>) -> AppResult<()> {
    let extra = settings.extra.trim().chars().count();
    if extra > MAX_EXTRA {
        return Err(AppError::invalid(format!(
            "Consignes trop longues ({extra} caractères, {MAX_EXTRA} au plus)."
        )));
    }
    if let Some(custom) = custom {
        let length = custom.trim().chars().count();
        if length == 0 {
            return Err(AppError::invalid("Le texte envoyé au modèle est vide."));
        }
        if length > MAX_PROMPT {
            return Err(AppError::invalid(format!(
                "Texte trop long ({length} caractères, {MAX_PROMPT} au plus)."
            )));
        }
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

fn stems(dir: &Path, extension: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            (path.extension().and_then(|e| e.to_str()) == Some(extension))
                .then(|| path.file_stem()?.to_str().map(str::to_string))
                .flatten()
        })
        .filter(|stem| content::validate_id(stem).is_ok())
        .collect()
}

pub fn info(root: &Path, mod_id: &str, target: &TextureTarget) -> AppResult<TextureInfo> {
    let layout = match target {
        TextureTarget::Block { id, .. } => Some(read_block_model(root, mod_id, id).layout),
        _ => None,
    };
    info_with(
        root,
        mod_id,
        target,
        &lang_names(root, mod_id),
        layout,
        false,
    )
}

fn info_with(
    root: &Path,
    mod_id: &str,
    target: &TextureTarget,
    names: &Map<String, Value>,
    layout: Option<BlockLayout>,
    unused: bool,
) -> AppResult<TextureInfo> {
    let relative = resolve_path(root, mod_id, target)?;
    let path = root.join(&relative);
    let (width, height) = image::image_dimensions(&path).unwrap_or((0, 0));
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    let name = |key: String, fallback: &str| {
        names
            .get(&key)
            .and_then(Value::as_str)
            .unwrap_or(fallback)
            .to_string()
    };
    let label = match target {
        TextureTarget::Item { id } => name(format!("item.{mod_id}.{id}"), id),
        TextureTarget::Block { id, face } => {
            let block = name(format!("block.{mod_id}.{id}"), id);
            match face {
                Some(face) => format!("{block} · {}", face_label(*face)),
                None => block,
            }
        }
        TextureTarget::Icon => "Icône du mod".to_string(),
        TextureTarget::Gui { name } => name.clone(),
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
        layout,
        unused,
    })
}

/// Chemins des textures du mod citées par les modèles de blocs et d'objets.
fn referenced_textures(assets: &Path, mod_id: &str) -> BTreeSet<String> {
    let mut claimed = BTreeSet::new();
    for folder in ["models/block", "models/item"] {
        let Ok(entries) = std::fs::read_dir(assets.join(folder)) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(textures) = std::fs::read_to_string(&path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|value| value.get("textures").cloned())
            else {
                continue;
            };
            for reference in textures.as_object().into_iter().flat_map(|t| t.values()) {
                if let Some(path) = reference.as_str().and_then(|r| texture_ref_path(mod_id, r)) {
                    claimed.insert(path);
                }
            }
        }
    }
    claimed
}

/// Textures d'un bloc : une par face selon son modèle.
fn block_targets(id: &str, layout: BlockLayout) -> Vec<TextureTarget> {
    let faces = layout_faces(layout);
    if faces.is_empty() {
        return vec![TextureTarget::Block {
            id: id.to_string(),
            face: None,
        }];
    }
    faces
        .iter()
        .map(|face| TextureTarget::Block {
            id: id.to_string(),
            face: Some(*face),
        })
        .collect()
}

/// L'icône, les objets, les blocs (une entrée par face) et les éléments d'interface : textures
/// présentes et textures attendues par un objet ou un bloc déclaré.
pub fn list(root: &Path, mod_id: &str) -> Vec<TextureInfo> {
    let names = lang_names(root, mod_id);
    let assets = assets_dir(root, mod_id);
    let textures = assets.join("textures");
    let declared = |kind: &str| -> BTreeSet<String> {
        let prefix = format!("{kind}.{mod_id}.");
        names
            .keys()
            .filter_map(|key| key.strip_prefix(&prefix))
            .filter(|rest| !rest.contains('.') && content::validate_id(rest).is_ok())
            .map(str::to_string)
            .collect()
    };
    // Textures utilisées par un modèle (d'un bloc, de ses variantes, d'un objet).
    let mut claimed = referenced_textures(&assets, mod_id);
    let texture_path =
        |folder: &str, stem: &str| format!("{}/textures/{folder}/{stem}.png", assets_base(mod_id));

    // Objets : déclarés dans les traductions, ou dont un modèle utilise la texture.
    let mut items = declared("item");
    for stem in stems(&textures.join("item"), "png") {
        if claimed.contains(&texture_path("item", &stem)) {
            items.insert(stem);
        }
    }
    // Blocs : déclarés dans les traductions, ou qui ont un état de bloc (`blockstates/`). Les
    // modèles seuls ne comptent pas : une dalle ou une bûche en ont plusieurs (`_top`,
    // `_double`, `_horizontal`…) qui ne sont pas des blocs.
    let mut blocks = declared("block");
    blocks.extend(stems(&assets.join("blockstates"), "json"));

    let mut entries: Vec<(TextureTarget, Option<BlockLayout>, bool)> =
        vec![(TextureTarget::Icon, None, false)];
    for id in items {
        claimed.insert(texture_path("item", &id));
        entries.push((TextureTarget::Item { id }, None, false));
    }
    for id in &blocks {
        let model = read_block_model(root, mod_id, id);
        for target in block_targets(id, model.layout) {
            if let Ok(path) = resolve_path(root, mod_id, &target) {
                claimed.insert(path);
            }
            entries.push((target, Some(model.layout), false));
        }
    }
    entries.extend(
        stems(&textures.join("gui"), "png")
            .into_iter()
            .map(|name| (TextureTarget::Gui { name }, None, false)),
    );
    // PNG qu'aucun objet, bloc ni modèle n'utilise : à part, proposés à la suppression.
    for stem in stems(&textures.join("item"), "png") {
        if !claimed.contains(&texture_path("item", &stem)) {
            entries.push((TextureTarget::Item { id: stem }, None, true));
        }
    }
    for stem in stems(&textures.join("block"), "png") {
        if !claimed.contains(&texture_path("block", &stem)) && !blocks.contains(&stem) {
            let target = TextureTarget::Block {
                id: stem,
                face: None,
            };
            entries.push((target, None, true));
        }
    }
    entries
        .into_iter()
        .filter_map(|(target, layout, unused)| {
            info_with(root, mod_id, &target, &names, layout, unused).ok()
        })
        .collect()
}

/// Met à la Corbeille des textures du projet (`assets/<mod>/textures/…png` ou l'icône).
/// Renvoie le nombre de fichiers retirés.
pub fn delete_textures(root: &Path, mod_id: &str, relatives: &[String]) -> AppResult<usize> {
    let base = assets_base(mod_id);
    for relative in relatives {
        let clean = relative.replace('\\', "/");
        let allowed = (clean.starts_with(&format!("{base}/textures/"))
            || clean == format!("{base}/icon.png"))
            && clean.ends_with(".png")
            && !clean.contains("..");
        if !allowed {
            return Err(AppError::invalid(format!(
                "« {relative} » n'est pas une texture du mod : rien n'a été supprimé."
            )));
        }
    }
    for relative in relatives {
        files::trash(root, relative)?;
    }
    Ok(relatives.len())
}

// ── Texte envoyé au modèle ──────────────────────────────────────────────────

const SURFACE: &str = "Flat orthographic view of the surface filling the entire square edge to \
                       edge: no 3D cube, no perspective, no frame, no border, no background, no \
                       vignette, no drop shadow.";
const TILE_BOTH: &str = "The pattern must continue seamlessly across the left/right and \
                         top/bottom edges when the texture is repeated.";
const TILE_ACROSS: &str = "The pattern must continue seamlessly across the left and right edges \
                           when blocks are placed side by side.";
const REFERENCE: &str = "The attached image is an existing Minecraft texture: use it as the \
                         reference for palette, lighting and pixel style, and as the starting \
                         point if the description asks for a variation of it.";

/// Couleur d'incrustation demandée au modèle quand le fond sera retiré : magenta, sauf si le
/// sujet est lui-même rose ou violet (vert alors).
fn key_color(description: &str) -> (&'static str, &'static str) {
    const PINKISH: [&str; 12] = [
        "pink",
        "magenta",
        "purple",
        "violet",
        "fuchsia",
        "rose",
        "mauve",
        "lilac",
        "lilas",
        "pourpre",
        "améthyste",
        "amethyst",
    ];
    let lower = description.to_lowercase();
    if PINKISH.iter().any(|word| lower.contains(word)) {
        ("green", "#00FF00")
    } else {
        ("magenta", "#FF00FF")
    }
}

fn style_line(style: TextureStyle) -> &'static str {
    match style {
        TextureStyle::Vanilla => {
            "Style: vanilla Minecraft textures, a limited palette of 6 to 12 related colors, \
             subtle noise and hand-placed pixel clusters, soft light from the top-left, no \
             smooth gradients, no anti-aliasing: crisp pixel art that stays readable at 16×16."
        }
        TextureStyle::Detailed => {
            "Style: detailed pixel art in the spirit of 32× Minecraft resource packs, more \
             detail and contrast, still crisp pixels, no blur, no photographic realism."
        }
        TextureStyle::Simple => {
            "Style: simple and flat, few colors, clean shapes, minimal shading, bold readable \
             pixel art."
        }
    }
}

/// Ce qui part au modèle : la description de la personne, cadrée pour la cible (objet,
/// face de bloc, interface…), le style, la référence et les consignes ajoutées.
pub fn prompt_for(target: &TextureTarget, description: &str, settings: &PromptSettings) -> String {
    let what = description.trim();
    let subject = match target {
        TextureTarget::Item { .. } => format!(
            "Minecraft item sprite of {what}. One single object, centered and entirely visible, \
             drawn like a Minecraft inventory icon: bold readable silhouette, simple shading. \
             No text, no border, no frame."
        ),
        TextureTarget::Icon => format!(
            "Square logo icon for a Minecraft mod: {what}. Bold and readable at small size, \
             centered, simple background. No text, no letters."
        ),
        TextureTarget::Block { face: None, .. } => format!(
            "Seamless tileable texture for a Minecraft block of {what}, the same on all six \
             faces. {SURFACE} {TILE_BOTH}"
        ),
        TextureTarget::Block {
            face: Some(face), ..
        } => match face {
            BlockFace::Top => format!(
                "Top face of a Minecraft block of {what}, seen from directly above. {SURFACE} \
                 {TILE_BOTH}"
            ),
            BlockFace::Bottom => format!(
                "Bottom face of a Minecraft block of {what}, seen from directly below. {SURFACE} \
                 {TILE_BOTH}"
            ),
            BlockFace::Side => format!(
                "Side face of a Minecraft block of {what}, seen straight on (the same texture \
                 covers the four sides). If the block has a distinct top layer (grass, snow, \
                 moss…), show it only as a band along the upper edge. {SURFACE} {TILE_ACROSS}"
            ),
            BlockFace::End => format!(
                "End face of a Minecraft pillar or log of {what}: the cut cross-section seen \
                 straight on (rings or core in the middle, rim along the edges). {SURFACE}"
            ),
            BlockFace::North | BlockFace::South | BlockFace::East | BlockFace::West => {
                let side = match face {
                    BlockFace::North => "North (front)",
                    BlockFace::South => "South (back)",
                    BlockFace::East => "East",
                    _ => "West",
                };
                format!("{side} face of a Minecraft block of {what}, seen straight on. {SURFACE}")
            }
        },
        TextureTarget::Gui { .. } => {
            let ratio = match (settings.width, settings.height) {
                (Some(w), Some(h)) => format!(" Aspect ratio {w}:{h}."),
                _ => String::new(),
            };
            format!(
                "Minecraft user interface (GUI) texture: {what}. Flat 2D interface graphic in \
                 the style of Minecraft inventory screens: light grey panels with bevelled \
                 edges (white highlight on the top-left, dark grey shadow on the bottom-right), \
                 crisp pixel art, no perspective, no text or letters.{ratio} It fills the image \
                 edge to edge."
            )
        }
    };
    let mut parts = vec![subject, style_line(settings.style).to_string()];
    let background = match target {
        TextureTarget::Item { .. } if !settings.transparent => Some(
            "Isolated on a plain uniform background of one flat color that contrasts with \
                  the object, no shadow."
                .to_string(),
        ),
        TextureTarget::Block { .. } if settings.transparent => {
            let key = key_color(what);
            Some(format!(
                "Areas that should be see-through (glass, gaps, holes) are filled with solid pure \
                 {} ({}).",
                key.0, key.1
            ))
        }
        _ if settings.transparent => {
            let key = key_color(what);
            Some(format!(
                "Isolated on a perfectly flat, solid pure {} background ({}): no gradient, no \
                 shadow, no ground, no reflection, no outline glow. The subject itself never \
                 uses that color.",
                key.0, key.1
            ))
        }
        _ => None,
    };
    parts.extend(background);
    if settings.with_reference {
        parts.push(REFERENCE.to_string());
    }
    let extra = settings.extra.trim();
    if !extra.is_empty() {
        parts.push(format!("Additional instructions: {extra}"));
    }
    parts.join("\n")
}

/// Texture du projet envoyée en référence au modèle : agrandie pixel par pixel (512 px
/// environ) pour que le modèle en voie nettement les pixels.
pub fn reference_image(root: &Path, relative: &str) -> AppResult<Vec<u8>> {
    let relative = relative.replace('\\', "/");
    if !relative.starts_with("src/main/resources/assets/") || !relative.ends_with(".png") {
        return Err(AppError::invalid(
            "Référence : une texture PNG du projet (dossier assets).",
        ));
    }
    let path = files::resolve(root, &relative)?;
    let bytes = std::fs::read(&path)
        .map_err(|_| AppError::not_found(format!("{relative} est introuvable.")))?;
    let raster = pixelart::decode(&bytes)?;
    let factor = (REFERENCE_SIDE / raster.width.max(raster.height).max(1)).max(1);
    pixelart::upscale_to(&raster, raster.width * factor).png()
}

// ── Brouillons ──────────────────────────────────────────────────────────────

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
fn render(
    source: &Raster,
    target: &TextureTarget,
    options: &PixelOptions,
) -> AppResult<pixelart::Converted> {
    let mut converted = pixelart::convert_full(source, options)?;
    if matches!(target, TextureTarget::Icon) {
        converted.raster = pixelart::upscale_to(&converted.raster, ICON_SIDE);
    }
    Ok(converted)
}

fn opaque(raster: &Raster) -> bool {
    raster.px.iter().all(|p| p[3] == 255)
}

/// Réglages décrivant une texture existante (reprise telle quelle dans l'éditeur).
fn options_for_existing(target: &TextureTarget, raster: &Raster) -> PixelOptions {
    let square = raster.width == raster.height
        && pixelart::SIZES.contains(&raster.width)
        && !matches!(target, TextureTarget::Gui { .. });
    let fits = |side: u32| side.clamp(1, pixelart::GUI_MAX);
    PixelOptions {
        size: if square { raster.width } else { 16 },
        colors: 0,
        transparent: !opaque(raster),
        tiling: Tiling::None,
        outline: false,
        width: (!square).then(|| fits(raster.width)),
        height: (!square).then(|| fits(raster.height)),
        atlas: false,
        crop: None,
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

    fn check_target(target: &TextureTarget) -> AppResult<()> {
        relative_path("mod", target).map(|_| ())
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
        Self::check_target(&target)?;
        let raster = pixelart::decode(original)?;
        let extension = pixelart::extension_of(original).unwrap_or("png");
        let converted = render(&raster, &target, &options)?;
        self.store(
            project_id,
            target,
            source,
            (original, extension, &raster),
            &converted.raster,
            options,
            converted.seam,
            converted.notes,
        )
    }

    /// Texture du projet reprise telle quelle, pour la retoucher au pixel.
    pub fn open_project_texture(
        &self,
        project_id: &str,
        root: &Path,
        mod_id: &str,
        target: TextureTarget,
    ) -> AppResult<TextureDraft> {
        Self::check_target(&target)?;
        let relative = resolve_path(root, mod_id, &target)?;
        let bytes = std::fs::read(root.join(&relative)).map_err(|_| {
            AppError::not_found(
                "Cette texture n'existe pas encore : générez-la ou importez une image.",
            )
        })?;
        let raster = pixelart::decode(&bytes)?;
        if raster.width > EDITOR_MAX || raster.height > EDITOR_MAX {
            return Err(AppError::invalid(format!(
                "Texture trop grande pour l'éditeur ({EDITOR_MAX} pixels de côté au plus)."
            )));
        }
        let options = options_for_existing(&target, &raster);
        let seam = opaque(&raster).then(|| pixelart::seam_quality(&raster, true));
        self.store(
            project_id,
            target,
            DraftSource::Project { path: relative },
            (&bytes, "png", &raster),
            &raster,
            options,
            seam,
            Vec::new(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn store(
        &self,
        project_id: &str,
        target: TextureTarget,
        source: DraftSource,
        (original, extension, raster): (&[u8], &str, &Raster),
        pixels: &Raster,
        options: PixelOptions,
        seam: Option<u8>,
        notes: Vec<String>,
    ) -> AppResult<TextureDraft> {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let folder = self.folder(&id)?;
        std::fs::create_dir_all(&folder)?;
        let original_path = folder.join(format!("source.{extension}"));
        let pixel_path = folder.join("pixel.png");
        std::fs::write(&original_path, original)?;
        std::fs::write(&pixel_path, pixels.png()?)?;
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
            edited: false,
            seam,
            notes,
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

    /// Nouvelle conversion de la même image avec d'autres réglages (sans réseau). Les
    /// retouches au pixel sont perdues : l'interface le dit avant.
    pub fn reprocess(&self, id: &str, options: PixelOptions) -> AppResult<TextureDraft> {
        let mut draft = self.load(id)?;
        let original = std::fs::read(&draft.original_path)?;
        let raster = pixelart::decode(&original)?;
        let converted = render(&raster, &draft.target, &options)?;
        fsutil::write_atomic(Path::new(&draft.pixel_path), &converted.raster.png()?)?;
        draft.options = options;
        draft.revision += 1;
        draft.edited = false;
        draft.seam = converted.seam;
        draft.notes = converted.notes;
        self.save(&draft)?;
        Ok(draft)
    }

    /// Pixels de la texture du brouillon, pour l'éditeur.
    pub fn pixels(&self, id: &str) -> AppResult<PixelData> {
        let draft = self.load(id)?;
        let raster = pixelart::decode(&std::fs::read(&draft.pixel_path)?)?;
        let rgba: Vec<u8> = raster.px.iter().flatten().copied().collect();
        Ok(PixelData {
            width: raster.width,
            height: raster.height,
            rgba: base64::engine::general_purpose::STANDARD.encode(rgba),
        })
    }

    /// Enregistre les retouches faites dans l'éditeur (même taille que la texture).
    pub fn save_pixels(&self, id: &str, data: &PixelData) -> AppResult<TextureDraft> {
        let mut draft = self.load(id)?;
        let current = pixelart::decode(&std::fs::read(&draft.pixel_path)?)?;
        if (data.width, data.height) != (current.width, current.height) {
            return Err(AppError::invalid(
                "Les retouches doivent garder la taille de la texture.",
            ));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.rgba.trim())
            .map_err(|_| AppError::invalid("Pixels illisibles."))?;
        if bytes.len() != (data.width * data.height * 4) as usize {
            return Err(AppError::invalid("Pixels incomplets."));
        }
        let raster = Raster {
            width: data.width,
            height: data.height,
            px: bytes
                .chunks_exact(4)
                .map(|p| [p[0], p[1], p[2], p[3]])
                .collect(),
        };
        fsutil::write_atomic(Path::new(&draft.pixel_path), &raster.png()?)?;
        draft.revision += 1;
        draft.edited = true;
        draft.seam = opaque(&raster)
            .then(|| pixelart::seam_quality(&raster, draft.options.tiling != Tiling::Horizontal));
        if !draft.notes.iter().any(|n| n == HAND_EDITED) {
            draft.notes.push(HAND_EDITED.to_string());
        }
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
        let relative = resolve_path(root, mod_id, &draft.target)?;
        let path = files::resolve(root, &relative)?;
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
            DraftSource::Project { .. } => "retouche".to_string(),
        };
        let origin = if draft.edited && !matches!(draft.source, DraftSource::Project { .. }) {
            format!("{origin}, retouchée")
        } else {
            origin
        };
        crate::core::audit::record(
            "mcstudio.texture_apply",
            &format!("{} ({origin})", path.display()),
            "applied",
            "user",
        );
        info(root, mod_id, &draft.target)
    }

    /// Tous les brouillons du cache, les plus récents d'abord.
    fn all(&self) -> Vec<(TextureDraft, PathBuf)> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut drafts: Vec<(TextureDraft, PathBuf)> = entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                let raw = std::fs::read(path.join("draft.json")).ok()?;
                let draft: TextureDraft = serde_json::from_slice(&raw).ok()?;
                Some((draft, path))
            })
            .collect();
        drafts.sort_by(|a, b| b.0.created_at.cmp(&a.0.created_at));
        drafts
    }

    /// Propositions déjà faites pour une texture du projet (toutes si `target` est vide), les
    /// plus récentes d'abord : rien n'est perdu en fermant une proposition.
    pub fn history(&self, project_id: &str, target: Option<&TextureTarget>) -> Vec<TextureDraft> {
        self.all()
            .into_iter()
            .map(|(draft, _)| draft)
            .filter(|draft| draft.project_id == project_id)
            .filter(|draft| target.is_none_or(|t| &draft.target == t))
            .collect()
    }

    /// Retire une proposition de l'historique (cache du module, pas un fichier du projet).
    pub fn delete(&self, id: &str) -> AppResult<()> {
        let folder = self.folder(id)?;
        if folder.is_dir() {
            std::fs::remove_dir_all(folder)?;
        }
        Ok(())
    }

    /// Garde les plus récents : 20 par texture, 150 en tout.
    fn prune(&self) {
        let mut per_texture: std::collections::HashMap<(String, TextureTarget), usize> =
            std::collections::HashMap::new();
        for (index, (draft, path)) in self.all().into_iter().enumerate() {
            let count = per_texture
                .entry((draft.project_id.clone(), draft.target.clone()))
                .or_insert(0);
            *count += 1;
            if *count > KEEP_PER_TEXTURE || index >= KEEP_DRAFTS {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
}

/// Copie datée de la texture remplacée : `.mcstudio/history/textures/<date>-<cible>.png`.
fn backup(root: &Path, current: &Path, target: &TextureTarget) -> AppResult<PathBuf> {
    let dir = root.join(".mcstudio/history/textures");
    std::fs::create_dir_all(&dir)?;
    let name = match target {
        TextureTarget::Item { id } => format!("item-{id}"),
        TextureTarget::Block { id, face: None } => format!("block-{id}"),
        TextureTarget::Block {
            id,
            face: Some(face),
        } => format!("block-{id}-{}", face_suffix(*face)),
        TextureTarget::Icon => "icon".to_string(),
        TextureTarget::Gui { name } => format!("gui-{name}"),
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

// ── Répartition des faces d'un bloc ─────────────────────────────────────────

/// Change la répartition des textures d'un bloc : réécrit son modèle, crée les faces qui
/// manquent (copies de la texture actuelle du bloc) après un point de restauration. Un
/// modèle écrit à la main n'est remplacé qu'avec `replace_custom`.
pub fn set_block_layout(
    root: &Path,
    mod_id: &str,
    id: &str,
    layout: BlockLayout,
    replace_custom: bool,
) -> AppResult<Vec<TextureInfo>> {
    content::validate_id(id)?;
    let Some(parent) = layout_parent(layout) else {
        return Err(AppError::invalid(
            "Choisissez une répartition : une texture, colonne, dessus-dessous-côtés ou six faces.",
        ));
    };
    let model = read_block_model(root, mod_id, id);
    if model.exists && model.layout == BlockLayout::Custom && !replace_custom {
        return Err(AppError::invalid(format!(
            "Le modèle de {id} a été écrit à la main : confirmez pour le remplacer par un cube."
        )));
    }

    // Texture de départ des nouvelles faces : une texture actuelle du bloc, sinon provisoire.
    let current: Vec<String> = block_targets(id, model.layout)
        .iter()
        .chain(std::iter::once(&TextureTarget::Block {
            id: id.to_string(),
            face: None,
        }))
        .filter_map(|target| resolve_path(root, mod_id, target).ok())
        .collect();
    let seed = current
        .iter()
        .filter_map(|relative| std::fs::read(root.join(relative)).ok())
        .find(|bytes| pixelart::decode(bytes).is_ok());
    let seed = match seed {
        Some(bytes) => bytes,
        None => textures::block(id).png()?,
    };

    let targets = block_targets(id, layout);
    let mut faces = Vec::new();
    for target in &targets {
        let TextureTarget::Block { face, .. } = target else {
            continue;
        };
        // Une face déjà référencée par le modèle garde son fichier ; sinon, la convention.
        let relative = if model.layout == layout {
            resolve_path(root, mod_id, target)?
        } else {
            relative_path(mod_id, target)?
        };
        faces.push((*face, relative));
    }
    let model_path = block_model_path(mod_id, id);
    let missing: Vec<String> = faces
        .iter()
        .map(|(_, relative)| relative.clone())
        .filter(|relative| !root.join(relative).is_file())
        .collect();
    let mut touched = vec![model_path.clone()];
    touched.extend(missing.iter().cloned());
    snapshots::create(
        root,
        &format!("Avant : faces du bloc {id}"),
        SnapshotKind::Texture,
        &touched,
    )?;
    for relative in &missing {
        fsutil::write_atomic(&root.join(relative), &seed)?;
    }

    let reference = |face: Option<BlockFace>| -> AppResult<String> {
        faces
            .iter()
            .find(|(f, _)| *f == face)
            .and_then(|(_, relative)| model_reference(mod_id, relative))
            .ok_or_else(|| AppError::internal("face absente de la répartition"))
    };
    let mut textures_map = Map::new();
    match layout {
        BlockLayout::All => {
            textures_map.insert("all".into(), reference(None)?.into());
        }
        _ => {
            if layout == BlockLayout::Faces {
                textures_map.insert("particle".into(), reference(Some(BlockFace::North))?.into());
            }
            for face in layout_faces(layout) {
                textures_map.insert(
                    face_key(layout, *face).into(),
                    reference(Some(*face))?.into(),
                );
            }
        }
    }
    // Les autres réglages du modèle (`render_type`, `ambientocclusion`…) sont gardés, sauf
    // les éléments d'un modèle fait main, qui dessineraient une autre forme.
    let mut body = model.body.clone();
    if model.layout == BlockLayout::Custom {
        body.remove("elements");
    }
    body.insert("parent".into(), json!(parent));
    body.insert("textures".into(), Value::Object(textures_map));
    let mut bytes = serde_json::to_vec_pretty(&Value::Object(body))?;
    bytes.push(b'\n');
    fsutil::write_atomic(&root.join(&model_path), &bytes)?;
    crate::core::audit::record(
        "mcstudio.block_layout",
        &format!("{model_path} ({parent})"),
        "written",
        "user",
    );

    let names = lang_names(root, mod_id);
    targets
        .iter()
        .map(|target| info_with(root, mod_id, target, &names, Some(layout), false))
        .collect()
}

// ── Éléments d'interface ────────────────────────────────────────────────────

/// Crée un élément d'interface dans `textures/gui/`, dessiné sans IA aux couleurs des
/// écrans du jeu. N'écrase jamais un fichier existant.
pub fn create_gui(root: &Path, mod_id: &str, request: &GuiRequest) -> AppResult<TextureInfo> {
    let target = TextureTarget::Gui {
        name: request.name.clone(),
    };
    let relative = relative_path(mod_id, &target)?;
    if root.join(&relative).exists() {
        return Err(AppError::invalid(format!(
            "{relative} existe déjà : choisissez un autre nom, ou retouchez-le."
        )));
    }
    let image = match request.preset {
        GuiPreset::Panel => textures::gui_panel(false),
        GuiPreset::InventoryPanel => textures::gui_panel(true),
        GuiPreset::Button => textures::gui_button(),
        GuiPreset::Slot => textures::gui_slot(),
        GuiPreset::Arrow => textures::gui_arrow(),
        GuiPreset::Blank => {
            let range = 1..=pixelart::GUI_MAX;
            if !range.contains(&request.width) || !range.contains(&request.height) {
                return Err(AppError::invalid(format!(
                    "Taille d'un élément d'interface : de 1 à {} pixels de côté.",
                    pixelart::GUI_MAX
                )));
            }
            textures::blank(request.width, request.height)
        }
    };
    fsutil::write_atomic(&root.join(&relative), &image.png()?)?;
    crate::core::audit::record("mcstudio.gui_create", &relative, "created", "user");
    info(root, mod_id, &target)
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
            tiling: Tiling::None,
            outline: false,
            width: None,
            height: None,
            atlas: false,
            crop: None,
        }
    }

    fn block(id: &str, face: Option<BlockFace>) -> TextureTarget {
        TextureTarget::Block {
            id: id.into(),
            face,
        }
    }

    fn write(root: &Path, relative: &str, bytes: &[u8]) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn model(root: &Path, id: &str) -> Value {
        serde_json::from_str(
            &std::fs::read_to_string(root.join(block_model_path("dm", id))).unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn prompts_frame_the_description_for_each_target() {
        let plain = PromptSettings::default();
        let item = prompt_for(
            &TextureTarget::Item { id: "ruby".into() },
            "  une épée en rubis ",
            &plain,
        );
        assert!(item.starts_with("Minecraft item sprite of une épée en rubis."));
        assert!(item.contains("plain uniform background"));
        // Fond retiré ensuite : fond d'incrustation, vert si l'objet est rose.
        let keyed = PromptSettings {
            transparent: true,
            ..PromptSettings::default()
        };
        let sword = prompt_for(&TextureTarget::Item { id: "s".into() }, "épée", &keyed);
        assert!(sword.contains("magenta background (#FF00FF)"));
        let pink = prompt_for(&TextureTarget::Item { id: "s".into() }, "Pink gem", &keyed);
        assert!(pink.contains("green background (#00FF00)"));
        let glass = prompt_for(&block("g", None), "glass", &keyed);
        assert!(glass.contains("see-through") && glass.contains("#FF00FF"));
        assert!(item.contains("Style: vanilla Minecraft"));
        assert!(prompt_for(&block("x", None), "x", &plain).contains("top/bottom edges"));
        let side = prompt_for(&block("x", Some(BlockFace::Side)), "grass", &plain);
        assert!(side.starts_with("Side face") && side.contains("left and right edges"));
        assert!(
            !side.contains("top/bottom edges"),
            "le côté ne se raccorde qu'en largeur"
        );
        assert!(prompt_for(&block("x", Some(BlockFace::Top)), "x", &plain).starts_with("Top face"));
        assert!(
            prompt_for(&block("x", Some(BlockFace::End)), "oak", &plain).contains("cross-section")
        );

        let custom = PromptSettings {
            style: TextureStyle::Simple,
            extra: " lumière froide ".into(),
            with_reference: true,
            width: Some(176),
            height: Some(166),
            transparent: false,
        };
        let gui = prompt_for(
            &TextureTarget::Gui {
                name: "forge".into(),
            },
            "forge",
            &custom,
        );
        assert!(gui.contains("GUI") && gui.contains("Aspect ratio 176:166."));
        assert!(gui.contains("Style: simple and flat"));
        assert!(gui.contains("attached image"));
        assert!(gui.ends_with("Additional instructions: lumière froide"));

        assert!(validate_description(" ").is_err());
        assert!(validate_description(&"a".repeat(MAX_DESCRIPTION + 1)).is_err());
        assert!(validate_prompt(&plain, Some("  ")).is_err());
        assert!(validate_prompt(&plain, Some(&"a".repeat(MAX_PROMPT + 1))).is_err());
        assert!(validate_prompt(&plain, Some("draw a sword")).is_ok());
    }

    #[test]
    fn paths_follow_the_block_model_and_refuse_foreign_ids() {
        assert!(relative_path("dm", &TextureTarget::Item { id: "../x".into() }).is_err());
        assert!(relative_path("dm", &TextureTarget::Gui { name: "a/b".into() }).is_err());
        assert_eq!(
            relative_path("dm", &block("ruby_block", None)).unwrap(),
            "src/main/resources/assets/dm/textures/block/ruby_block.png"
        );
        assert_eq!(
            relative_path("dm", &block("ruby_log", Some(BlockFace::End))).unwrap(),
            "src/main/resources/assets/dm/textures/block/ruby_log_end.png"
        );
        assert_eq!(
            relative_path(
                "dm",
                &TextureTarget::Gui {
                    name: "forge".into()
                }
            )
            .unwrap(),
            "src/main/resources/assets/dm/textures/gui/forge.png"
        );

        // Modèle écrit ailleurs, avec ses propres noms : le chemin vient du modèle.
        let root = temp("resolve");
        write(
            &root,
            &block_model_path("dm", "ruby_log"),
            br#"{"parent":"minecraft:block/cube_column","textures":{"end":"dm:block/ruby_log_top","side":"minecraft:block/oak_log"}}"#,
        );
        assert_eq!(
            resolve_path(&root, "dm", &block("ruby_log", Some(BlockFace::End))).unwrap(),
            "src/main/resources/assets/dm/textures/block/ruby_log_top.png"
        );
        // Texture du jeu (autre espace de noms) : jamais écrite, convention à la place.
        assert_eq!(
            resolve_path(&root, "dm", &block("ruby_log", Some(BlockFace::Side))).unwrap(),
            "src/main/resources/assets/dm/textures/block/ruby_log_side.png"
        );
        assert!(texture_ref_path("dm", "dm:block/../x").is_none());
        assert!(texture_ref_path("dm", "dm:block/Évil").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn blocks_are_listed_face_by_face_and_gui_textures_appear() {
        let root = temp("list");
        let assets = assets_base("dm");
        write(
            &root,
            &format!("{assets}/lang/fr_fr.json"),
            r#"{"block.dm.ruby_log":"Bûche de rubis","block.dm.ore":"Minerai"}"#.as_bytes(),
        );
        write(
            &root,
            &block_model_path("dm", "ruby_log"),
            br#"{"parent":"minecraft:block/cube_column","textures":{"end":"dm:block/ruby_log_top","side":"dm:block/ruby_log"}}"#,
        );
        write(
            &root,
            &format!("{assets}/textures/block/ruby_log.png"),
            &picture(),
        );
        write(
            &root,
            &format!("{assets}/textures/block/ruby_log_top.png"),
            &picture(),
        );
        write(
            &root,
            &format!("{assets}/textures/block/loose.png"),
            &picture(),
        );
        write(
            &root,
            &format!("{assets}/textures/gui/forge.png"),
            &picture(),
        );
        // Dalle : un état de bloc, deux modèles ; la variante n'est pas un bloc.
        write(
            &root,
            &format!("{assets}/blockstates/ruby_slab.json"),
            b"{}",
        );
        write(
            &root,
            &block_model_path("dm", "ruby_slab"),
            br#"{"parent":"minecraft:block/slab","textures":{"bottom":"dm:block/ruby_planks","side":"dm:block/ruby_planks","top":"dm:block/ruby_planks"}}"#,
        );
        write(
            &root,
            &block_model_path("dm", "ruby_slab_double"),
            br#"{"parent":"minecraft:block/cube_all","textures":{"all":"dm:block/ruby_planks"}}"#,
        );
        write(
            &root,
            &format!("{assets}/textures/block/ruby_planks.png"),
            &picture(),
        );

        let labels: Vec<String> = list(&root, "dm").into_iter().map(|t| t.label).collect();
        assert_eq!(
            labels,
            [
                "Icône du mod",
                "Minerai",
                "Bûche de rubis · côtés",
                "Bûche de rubis · extrémités",
                "ruby_slab",
                "forge",
                "loose"
            ]
        );
        // Texture que rien n'utilise : à part, proposée à la suppression.
        let listed = list(&root, "dm");
        assert!(listed.iter().find(|t| t.label == "loose").unwrap().unused);
        assert!(listed
            .iter()
            .filter(|t| t.label != "loose")
            .all(|t| !t.unused));
        // Modèle fait main : sa vraie texture, pas un fichier au nom du bloc.
        let slab = list(&root, "dm")
            .into_iter()
            .find(|t| t.label == "ruby_slab")
            .unwrap();
        assert!(slab.exists && slab.relative.ends_with("block/ruby_planks.png"));
        assert_eq!(slab.layout, Some(BlockLayout::Custom));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_block_layout_rewrites_the_model_and_creates_missing_faces() {
        let root = temp("layout");
        let assets = assets_base("dm");
        write(
            &root,
            &block_model_path("dm", "ore"),
            br#"{"parent":"minecraft:block/cube_all","render_type":"minecraft:cutout","textures":{"all":"dm:block/ore"}}"#,
        );
        write(
            &root,
            &format!("{assets}/textures/block/ore.png"),
            &picture(),
        );

        let faces = set_block_layout(&root, "dm", "ore", BlockLayout::BottomTop, false).unwrap();
        let labels: Vec<&str> = faces.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, ["ore · dessus", "ore · dessous", "ore · côtés"]);
        assert!(faces
            .iter()
            .all(|f| f.exists && f.layout == Some(BlockLayout::BottomTop)));
        let written = model(&root, "ore");
        assert_eq!(written["parent"], "minecraft:block/cube_bottom_top");
        assert_eq!(written["textures"]["top"], "dm:block/ore_top");
        assert_eq!(written["textures"]["side"], "dm:block/ore_side");
        assert_eq!(written["render_type"], "minecraft:cutout", "réglage gardé");
        // Les nouvelles faces partent de la texture actuelle du bloc.
        assert_eq!(
            std::fs::read(root.join(format!("{assets}/textures/block/ore_top.png"))).unwrap(),
            picture()
        );
        let snapshot = &snapshots::list(&root)[0];
        assert_eq!(snapshot.kind, SnapshotKind::Texture);
        assert!(snapshot
            .files
            .iter()
            .any(|f| f.path.ends_with("models/block/ore.json")));

        // Six faces : « up »/« down » et la particule sur la face nord.
        set_block_layout(&root, "dm", "ore", BlockLayout::Faces, false).unwrap();
        let written = model(&root, "ore");
        assert_eq!(written["textures"]["up"], "dm:block/ore_top");
        assert_eq!(written["textures"]["particle"], "dm:block/ore_north");
        // Retour à une seule texture.
        set_block_layout(&root, "dm", "ore", BlockLayout::All, false).unwrap();
        assert_eq!(model(&root, "ore")["textures"]["all"], "dm:block/ore");

        // Modèle fait main : remplacé seulement sur confirmation.
        write(
            &root,
            &block_model_path("dm", "slab"),
            br#"{"parent":"minecraft:block/slab","textures":{"top":"dm:block/slab"},"elements":[]}"#,
        );
        assert!(set_block_layout(&root, "dm", "slab", BlockLayout::All, false).is_err());
        set_block_layout(&root, "dm", "slab", BlockLayout::Column, true).unwrap();
        let written = model(&root, "slab");
        assert_eq!(written["parent"], "minecraft:block/cube_column");
        assert!(written.get("elements").is_none());
        assert!(set_block_layout(&root, "dm", "ore", BlockLayout::Custom, true).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn faces_left_by_a_layout_change_are_unused_not_blocks() {
        let root = temp("phantoms");
        let assets = assets_base("dm");
        write(&root, &format!("{assets}/blockstates/ore.json"), b"{}");
        write(
            &root,
            &block_model_path("dm", "ore"),
            br#"{"parent":"minecraft:block/cube_all","textures":{"all":"dm:block/ore"}}"#,
        );
        write(
            &root,
            &format!("{assets}/textures/block/ore.png"),
            &picture(),
        );
        // On essaie six faces, puis on revient à une seule texture.
        set_block_layout(&root, "dm", "ore", BlockLayout::Faces, false).unwrap();
        set_block_layout(&root, "dm", "ore", BlockLayout::All, false).unwrap();

        let listed = list(&root, "dm");
        let blocks: Vec<&str> = listed
            .iter()
            .filter(|t| matches!(t.target, TextureTarget::Block { .. }) && !t.unused)
            .map(|t| t.label.as_str())
            .collect();
        assert_eq!(blocks, ["ore"], "un seul vrai bloc");
        let leftovers: Vec<String> = listed
            .iter()
            .filter(|t| t.unused)
            .map(|t| t.relative.clone())
            .collect();
        assert_eq!(leftovers.len(), 6, "{leftovers:?}");

        // Suppression : seulement des textures du mod.
        assert!(delete_textures(&root, "dm", &["build.gradle".into()]).is_err());
        assert!(
            delete_textures(&root, "dm", &[format!("{assets}/textures/../lang/x.png")]).is_err()
        );
        let _ = delete_textures(&root, "dm", &leftovers);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn gui_elements_are_created_once() {
        let root = temp("gui");
        let request = GuiRequest {
            name: "forge".into(),
            preset: GuiPreset::InventoryPanel,
            width: 0,
            height: 0,
        };
        let info = create_gui(&root, "dm", &request).unwrap();
        assert_eq!((info.width, info.height), (256, 256));
        assert!(create_gui(&root, "dm", &request).is_err(), "jamais écrasé");
        let blank = GuiRequest {
            name: "bar".into(),
            preset: GuiPreset::Blank,
            width: 300,
            height: 4,
        };
        assert!(create_gui(&root, "dm", &blank).is_err());
        let blank = GuiRequest { width: 90, ..blank };
        assert_eq!(create_gui(&root, "dm", &blank).unwrap().width, 90);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_draft_is_converted_reprocessed_edited_then_applied_with_a_backup() {
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
        assert_eq!(draft.seam, None, "objet détouré : pas de raccord");
        let pixel = pixelart::decode(&std::fs::read(&draft.pixel_path).unwrap()).unwrap();
        assert_eq!((pixel.width, pixel.height), (16, 16));
        assert_eq!(pixel.px[0][3], 0, "fond blanc retiré");

        let again = drafts.reprocess(&draft.id, options(32, true)).unwrap();
        assert_eq!(again.revision, 2);
        let pixel = pixelart::decode(&std::fs::read(&again.pixel_path).unwrap()).unwrap();
        assert_eq!(pixel.width, 32);

        // Retouche : un pixel rouge en haut à gauche.
        let mut data = drafts.pixels(&draft.id).unwrap();
        assert_eq!((data.width, data.height), (32, 32));
        let mut rgba = base64::engine::general_purpose::STANDARD
            .decode(&data.rgba)
            .unwrap();
        rgba[..4].copy_from_slice(&[255, 0, 0, 255]);
        data.rgba = base64::engine::general_purpose::STANDARD.encode(&rgba);
        let edited = drafts.save_pixels(&draft.id, &data).unwrap();
        assert!(edited.edited && edited.notes.iter().any(|n| n == HAND_EDITED));
        let wrong = PixelData {
            width: 16,
            ..data.clone()
        };
        assert!(drafts.save_pixels(&draft.id, &wrong).is_err());
        let short = PixelData {
            rgba: "AAAA".into(),
            ..data
        };
        assert!(drafts.save_pixels(&draft.id, &short).is_err());

        assert!(drafts
            .apply(&draft.id, "autre-projet", &root, "dm")
            .is_err());
        let applied = drafts.apply(&draft.id, "p1", &root, "dm").unwrap();
        assert!(applied.exists);
        assert_eq!((applied.width, applied.height), (32, 32));
        let written =
            pixelart::decode(&std::fs::read(root.join(&applied.relative)).unwrap()).unwrap();
        assert_eq!(written.px[0], [255, 0, 0, 255], "retouche appliquée");

        // Deuxième application : l'ancienne texture est gardée.
        drafts.apply(&draft.id, "p1", &root, "dm").unwrap();
        let history: Vec<_> = std::fs::read_dir(root.join(".mcstudio/history/textures"))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(history.len(), 1);

        // Texture du projet reprise pour retouche, telle quelle.
        let retouch = drafts
            .open_project_texture("p1", &root, "dm", target.clone())
            .unwrap();
        assert!(matches!(retouch.source, DraftSource::Project { .. }));
        assert_eq!(retouch.options.size, 32);
        assert!(retouch.options.transparent);
        assert_eq!(
            drafts.pixels(&retouch.id).unwrap().rgba,
            drafts.pixels(&draft.id).unwrap().rgba
        );
        assert!(drafts
            .open_project_texture("p1", &root, "dm", TextureTarget::Item { id: "none".into() })
            .is_err());

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
    fn block_faces_tile_and_references_are_enlarged() {
        let module = temp("tile-module");
        let root = temp("tile-project");
        let drafts = Drafts::new(&module);
        // Dégradé horizontal : sans traitement, le bord gauche et le bord droit jurent.
        let mut ramp = Raster::new(256, 256);
        for y in 0..256 {
            for x in 0..256 {
                ramp.put(x, y, [x as u8, 90, 255 - x as u8, 255]);
            }
        }
        let raw = drafts
            .create(
                "p",
                block("stone", Some(BlockFace::Top)),
                DraftSource::File {
                    name: "a.png".into(),
                },
                &ramp.png().unwrap(),
                PixelOptions {
                    colors: 0,
                    ..options(16, false)
                },
            )
            .unwrap();
        let tiled = drafts
            .create(
                "p",
                block("stone", Some(BlockFace::Top)),
                DraftSource::File {
                    name: "a.png".into(),
                },
                &ramp.png().unwrap(),
                PixelOptions {
                    colors: 0,
                    tiling: Tiling::Both,
                    ..options(16, false)
                },
            )
            .unwrap();
        let (raw, tiled) = (raw.seam.unwrap(), tiled.seam.unwrap());
        assert!(tiled > raw + 20, "raccord {raw} → {tiled}");

        write(
            &root,
            "src/main/resources/assets/dm/textures/item/a.png",
            &Raster::new(16, 16).png().unwrap(),
        );
        let big = pixelart::decode(
            &reference_image(&root, "src/main/resources/assets/dm/textures/item/a.png").unwrap(),
        )
        .unwrap();
        assert_eq!(big.width, 512);
        assert!(reference_image(&root, "../outside.png").is_err());
        assert!(reference_image(&root, "build.gradle").is_err());
        let _ = std::fs::remove_dir_all(&module);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn past_proposals_stay_in_the_history() {
        let module = temp("history");
        let drafts = Drafts::new(&module);
        let source = || DraftSource::File {
            name: "a.png".into(),
        };
        let first = drafts
            .create(
                "p",
                TextureTarget::Icon,
                source(),
                &picture(),
                options(16, false),
            )
            .unwrap();
        let second = drafts
            .create(
                "p",
                TextureTarget::Icon,
                source(),
                &picture(),
                options(32, false),
            )
            .unwrap();
        drafts
            .create(
                "autre",
                TextureTarget::Icon,
                source(),
                &picture(),
                options(16, false),
            )
            .unwrap();
        let item = TextureTarget::Item { id: "gem".into() };
        drafts
            .create("p", item.clone(), source(), &picture(), options(16, true))
            .unwrap();

        let icon: Vec<String> = drafts
            .history("p", Some(&TextureTarget::Icon))
            .into_iter()
            .map(|d| d.id)
            .collect();
        assert_eq!(icon.len(), 2);
        assert!(icon.contains(&first.id) && icon.contains(&second.id));
        assert_eq!(drafts.history("p", None).len(), 3);
        assert_eq!(drafts.history("p", Some(&item)).len(), 1);

        drafts.delete(&first.id).unwrap();
        assert_eq!(drafts.history("p", Some(&TextureTarget::Icon)).len(), 1);
        assert!(drafts.delete("../x").is_err());
        let _ = std::fs::remove_dir_all(&module);
    }

    #[test]
    fn old_drafts_are_pruned() {
        let module = temp("prune");
        let drafts = Drafts::new(&module);
        for _ in 0..KEEP_PER_TEXTURE + 3 {
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
            KEEP_PER_TEXTURE
        );
        let _ = std::fs::remove_dir_all(&module);
    }
}
