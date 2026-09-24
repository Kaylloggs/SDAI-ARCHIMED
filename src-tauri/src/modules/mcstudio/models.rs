//! Modèles 3D du mod (onglet Modèles) : blocs et objets au format JSON du jeu, entités et
//! armures.
//!
//! - **Blocs et objets** : les vrais fichiers `assets/<modid>/models/{block,item}/…json`. Le
//!   frontend les lit, résout leurs parents et les modifie ; ils sont réécrits tels quels après
//!   un point de restauration.
//! - **Entités** : la source vit dans `.mcstudio/models/<nom>.json` (espace des modèles du jeu :
//!   pixels, Y vers le bas, pivots comme dans le code). L'enregistrement génère la classe
//!   `client/model/<Nom>ModelData.java` (Yarn ou Mojmap selon le profil, Minecraft 1.17+) et crée
//!   la texture `textures/entity/<nom>.png` si elle manque.
//! - **Armures** : les couches trouvées dans `textures/models/armor/` (jusqu'à 1.21.1) ou
//!   `textures/entity/equipment/humanoid*/` (1.21.2+), montrées sur le modèle humanoïde du jeu.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{Map, Value};

use crate::core::{AppError, AppResult};

use super::content;
use super::fsutil;
use super::pixelart::{self, Raster};
use super::profiles::{self, Profile};
use super::snapshots;
use super::texture_refs;
use super::types::{
    EntityBone, EntityModel, EntitySaved, ModelFile, ModelInfo, ModelKind, PixelData, ProjectMeta,
    SnapshotKind,
};

/// Taille maximale d'un fichier de modèle.
const MAX_MODEL_BYTES: usize = 512 * 1024;
/// Côté maximal d'une texture de modèle.
const MAX_TEXTURE_SIDE: u32 = 1024;
const MAX_BONES: usize = 256;
const MAX_CUBES: usize = 2048;
/// Dossier des modèles d'entité (source), dans le projet.
const ENTITY_DIR: &str = ".mcstudio/models";

fn assets_base(mod_id: &str) -> String {
    format!("src/main/resources/assets/{mod_id}")
}

fn modified_ms(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

// ── Inventaire ──────────────────────────────────────────────────────────────

/// Fichiers `.json` d'un dossier et de ses sous-dossiers (chemins sans extension).
fn json_stems(base: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
    if depth > 6 || out.len() > 4000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            json_stems(base, &path, depth + 1, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let relative = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if let Some(stem) = relative.strip_suffix(".json") {
                if texture_refs::valid_asset_path(stem) {
                    out.push(stem.to_string());
                }
            }
        }
    }
}

fn read_json(path: &Path) -> Option<Map<String, Value>> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&raw)
        .ok()?
        .as_object()
        .cloned()
}

/// Modèles de blocs et d'objets, modèles d'entité, armures.
pub fn list(root: &Path, mod_id: &str, names: &Map<String, Value>) -> Vec<ModelInfo> {
    let assets = root.join(assets_base(mod_id));
    let mut models = Vec::new();

    for (kind, folder) in [(ModelKind::Block, "block"), (ModelKind::Item, "item")] {
        let dir = assets.join("models").join(folder);
        let mut stems = Vec::new();
        json_stems(&dir, &dir, 0, &mut stems);
        for stem in stems {
            let relative = format!("{}/models/{folder}/{stem}.json", assets_base(mod_id));
            let path = root.join(&relative);
            let body = read_json(&path).unwrap_or_default();
            let label = names
                .get(&format!("{folder}.{mod_id}.{stem}"))
                .and_then(Value::as_str)
                .map(|name| format!("{name} ({stem})"))
                .unwrap_or_else(|| stem.clone());
            models.push(ModelInfo {
                kind,
                id: format!("{folder}/{stem}"),
                label,
                relative,
                custom: body.get("elements").is_some_and(Value::is_array),
                parent: body
                    .get("parent")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                textures: Vec::new(),
                modified: modified_ms(&path),
            });
        }
    }

    let mut entities = Vec::new();
    json_stems(
        &root.join(ENTITY_DIR),
        &root.join(ENTITY_DIR),
        5,
        &mut entities,
    );
    for name in entities
        .into_iter()
        .filter(|n| content::validate_id(n).is_ok())
    {
        let relative = format!("{ENTITY_DIR}/{name}.json");
        models.push(ModelInfo {
            kind: ModelKind::Entity,
            label: name.clone(),
            modified: modified_ms(&root.join(&relative)),
            textures: vec![entity_texture(mod_id, &name)],
            id: name,
            relative,
            custom: true,
            parent: None,
        });
    }

    models.extend(armors(&assets.join("textures"), mod_id));
    models
}

/// Armures : couches 1 et 2 (`models/armor/<nom>_layer_N`) ou équipement 1.21.2+
/// (`entity/equipment/humanoid/<nom>` et `humanoid_leggings/<nom>`).
fn armors(textures: &Path, mod_id: &str) -> Vec<ModelInfo> {
    let present: BTreeSet<String> = texture_refs::present(textures).into_iter().collect();
    let base = format!("{}/textures", assets_base(mod_id));
    let mut sets: BTreeMap<String, [Option<String>; 2]> = BTreeMap::new();
    for path in &present {
        let found = if let Some(rest) = path.strip_prefix("models/armor/") {
            rest.strip_suffix("_layer_1")
                .map(|n| (n, 0))
                .or_else(|| rest.strip_suffix("_layer_2").map(|n| (n, 1)))
        } else if let Some(name) = path.strip_prefix("entity/equipment/humanoid/") {
            Some((name, 0))
        } else {
            path.strip_prefix("entity/equipment/humanoid_leggings/")
                .map(|name| (name, 1))
        };
        if let Some((name, layer)) = found.filter(|(n, _)| !n.contains('/')) {
            sets.entry(name.to_string()).or_default()[layer] = Some(format!("{base}/{path}.png"));
        }
    }
    sets.into_iter()
        .map(|(name, layers)| {
            let first = layers[0]
                .clone()
                .or_else(|| layers[1].clone())
                .unwrap_or_default();
            ModelInfo {
                kind: ModelKind::Armor,
                label: name.clone(),
                id: name,
                relative: first,
                custom: false,
                parent: None,
                textures: layers.into_iter().map(Option::unwrap_or_default).collect(),
                modified: None,
            }
        })
        .collect()
}

// ── Blocs et objets ─────────────────────────────────────────────────────────

/// `block/lamp`, `dm:block/lamp` → chemin relatif du JSON (seulement l'espace de noms du mod).
fn model_path(mod_id: &str, reference: &str) -> AppResult<String> {
    let path = match reference.split_once(':') {
        Some((namespace, rest)) if namespace == mod_id => rest,
        Some(_) => {
            return Err(AppError::invalid(format!(
                "« {reference} » est un modèle du jeu, pas du mod."
            )))
        }
        None => reference,
    };
    let folder_ok = path.starts_with("block/") || path.starts_with("item/");
    if !folder_ok || !texture_refs::valid_asset_path(path) {
        return Err(AppError::invalid(format!(
            "Modèle invalide : « {reference} »."
        )));
    }
    Ok(format!("{}/models/{path}.json", assets_base(mod_id)))
}

pub fn read_model(root: &Path, mod_id: &str, reference: &str) -> AppResult<ModelFile> {
    let relative = model_path(mod_id, reference)?;
    let path = root.join(&relative);
    let exists = path.is_file();
    let json = if exists {
        std::fs::read_to_string(&path)?
    } else {
        String::new()
    };
    Ok(ModelFile {
        relative,
        exists,
        json,
    })
}

/// Réécrit (ou crée, avec `create`) un modèle de bloc ou d'objet, après un point de restauration.
pub fn save_model(
    root: &Path,
    mod_id: &str,
    reference: &str,
    json: &str,
    create: bool,
) -> AppResult<String> {
    let relative = model_path(mod_id, reference)?;
    if json.len() > MAX_MODEL_BYTES {
        return Err(AppError::invalid("Modèle trop lourd (512 Ko au plus)."));
    }
    let value: Value = serde_json::from_str(json)
        .map_err(|e| AppError::invalid(format!("Modèle illisible : {e}")))?;
    if !value.is_object() {
        return Err(AppError::invalid("Un modèle est un objet JSON."));
    }
    let path = root.join(&relative);
    if create && path.exists() {
        return Err(AppError::invalid(format!(
            "Le modèle « {reference} » existe déjà."
        )));
    }
    snapshots::create(
        root,
        &format!("Avant l'enregistrement du modèle {reference}"),
        SnapshotKind::Model,
        std::slice::from_ref(&relative),
    )?;
    let pretty = serde_json::to_string_pretty(&value)?;
    fsutil::write_atomic(&path, format!("{pretty}\n").as_bytes())?;
    crate::core::audit::record("mcstudio.model_save", &relative, "written", "user");
    Ok(relative)
}

// ── Textures des modèles ────────────────────────────────────────────────────

/// Seules les textures PNG du mod (`assets/<modid>/textures/…png`) se lisent et s'écrivent ici.
fn texture_path(mod_id: &str, relative: &str) -> AppResult<String> {
    let clean = relative.replace('\\', "/");
    let prefix = format!("{}/textures/", assets_base(mod_id));
    let valid = clean
        .strip_prefix(&prefix)
        .and_then(|rest| rest.strip_suffix(".png"))
        .is_some_and(texture_refs::valid_asset_path);
    if valid {
        Ok(clean)
    } else {
        Err(AppError::invalid(format!(
            "« {relative} » n'est pas une texture du mod."
        )))
    }
}

pub fn texture_pixels(root: &Path, mod_id: &str, relative: &str) -> AppResult<PixelData> {
    let relative = texture_path(mod_id, relative)?;
    let bytes = std::fs::read(root.join(&relative))
        .map_err(|_| AppError::not_found(format!("{relative} est introuvable.")))?;
    let raster = pixelart::decode(&bytes)?;
    Ok(PixelData {
        width: raster.width,
        height: raster.height,
        rgba: base64::engine::general_purpose::STANDARD
            .encode(raster.px.iter().flatten().copied().collect::<Vec<u8>>()),
    })
}

/// Écrit une texture peinte dans l'atelier 3D ; l'ancienne part dans
/// `.mcstudio/history/textures/`.
pub fn save_texture_pixels(
    root: &Path,
    mod_id: &str,
    relative: &str,
    data: &PixelData,
) -> AppResult<()> {
    let relative = texture_path(mod_id, relative)?;
    if !(1..=MAX_TEXTURE_SIDE).contains(&data.width)
        || !(1..=MAX_TEXTURE_SIDE).contains(&data.height)
    {
        return Err(AppError::invalid(format!(
            "Texture de 1 à {MAX_TEXTURE_SIDE} pixels de côté."
        )));
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
    let path = root.join(&relative);
    if path.is_file() {
        backup(root, &path, &relative)?;
    }
    fsutil::write_atomic(&path, &raster.png()?)?;
    crate::core::audit::record("mcstudio.model_texture", &relative, "written", "user");
    Ok(())
}

fn backup(root: &Path, current: &Path, relative: &str) -> AppResult<()> {
    let dir = root.join(".mcstudio/history/textures");
    std::fs::create_dir_all(&dir)?;
    let name = relative
        .rsplit("/textures/")
        .next()
        .unwrap_or(relative)
        .trim_end_matches(".png")
        .replace('/', "-");
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let mut destination = dir.join(format!("{stamp}-model-{name}.png"));
    let mut n = 2;
    while destination.exists() {
        destination = dir.join(format!("{stamp}-model-{name}-{n}.png"));
        n += 1;
    }
    std::fs::copy(current, destination)?;
    Ok(())
}

// ── Entités ─────────────────────────────────────────────────────────────────

fn entity_texture(mod_id: &str, name: &str) -> String {
    format!("{}/textures/entity/{name}.png", assets_base(mod_id))
}

fn valid_bone_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Os dans un ordre où chaque parent précède ses enfants ; refuse les noms en double, les
/// parents inconnus et les boucles.
fn ordered(model: &EntityModel) -> AppResult<Vec<&EntityBone>> {
    let mut names = BTreeSet::new();
    for bone in &model.bones {
        if !valid_bone_name(&bone.name) {
            return Err(AppError::invalid(format!(
                "Nom d'os invalide : « {} » (lettres, chiffres et _).",
                bone.name
            )));
        }
        if !names.insert(bone.name.as_str()) {
            return Err(AppError::invalid(format!(
                "Deux os s'appellent « {} ».",
                bone.name
            )));
        }
    }
    let mut placed: BTreeSet<&str> = BTreeSet::new();
    let mut order = Vec::new();
    while order.len() < model.bones.len() {
        let before = order.len();
        for bone in &model.bones {
            if placed.contains(bone.name.as_str()) {
                continue;
            }
            let ready = match &bone.parent {
                None => true,
                Some(parent) => {
                    if !names.contains(parent.as_str()) {
                        return Err(AppError::invalid(format!(
                            "L'os « {} » a un parent inconnu : « {parent} ».",
                            bone.name
                        )));
                    }
                    placed.contains(parent.as_str())
                }
            };
            if ready {
                placed.insert(&bone.name);
                order.push(bone);
            }
        }
        if order.len() == before {
            return Err(AppError::invalid(
                "Les os forment une boucle (un os est son propre parent).",
            ));
        }
    }
    Ok(order)
}

pub fn validate_entity(model: &EntityModel) -> AppResult<()> {
    content::validate_id(&model.name)?;
    let sides = [model.texture_width, model.texture_height];
    if sides.iter().any(|s| !(1..=MAX_TEXTURE_SIDE).contains(s)) {
        return Err(AppError::invalid(format!(
            "Texture de 1 à {MAX_TEXTURE_SIDE} pixels de côté."
        )));
    }
    if model.bones.len() > MAX_BONES {
        return Err(AppError::invalid(format!("{MAX_BONES} os au plus.")));
    }
    let cubes: usize = model.bones.iter().map(|b| b.cubes.len()).sum();
    if cubes > MAX_CUBES {
        return Err(AppError::invalid(format!("{MAX_CUBES} cubes au plus.")));
    }
    let numbers = model.bones.iter().flat_map(|bone| {
        bone.pivot.iter().chain(&bone.rotation).copied().chain(
            bone.cubes
                .iter()
                .flat_map(|c| c.origin.iter().chain(&c.size).copied().chain([c.inflate])),
        )
    });
    for number in numbers {
        if !number.is_finite() || number.abs() > 4096.0 {
            return Err(AppError::invalid("Une valeur du modèle est hors limites."));
        }
    }
    if model
        .bones
        .iter()
        .flat_map(|b| &b.cubes)
        .any(|c| c.size.iter().any(|s| *s < 0.0))
    {
        return Err(AppError::invalid("Un cube a une taille négative."));
    }
    ordered(model).map(|_| ())
}

pub fn read_entity(root: &Path, name: &str) -> AppResult<EntityModel> {
    content::validate_id(name)?;
    let path = root.join(ENTITY_DIR).join(format!("{name}.json"));
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| AppError::not_found(format!("Modèle d'entité « {name} » introuvable.")))?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError::invalid(format!("Modèle d'entité illisible : {e}")))
}

/// `ruby_golem` → `RubyGolem`.
fn pascal(name: &str) -> String {
    name.split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect()
}

const JAVA_KEYWORDS: [&str; 20] = [
    "abstract", "boolean", "break", "byte", "case", "catch", "char", "class", "default", "do",
    "double", "else", "final", "float", "for", "if", "int", "new", "return", "static",
];

/// Nom de variable Java pour un os (`left_arm` → `leftArm`), unique dans la méthode.
fn variable(name: &str, taken: &mut BTreeSet<String>) -> String {
    let pascal = pascal(name);
    let mut base: String = pascal
        .chars()
        .enumerate()
        .map(|(i, c)| if i == 0 { c.to_ascii_lowercase() } else { c })
        .collect();
    if base.is_empty() || base.starts_with(|c: char| c.is_ascii_digit()) {
        base = format!("part{base}");
    }
    if JAVA_KEYWORDS.contains(&base.as_str()) || ["root", "data", "mesh"].contains(&base.as_str()) {
        base.push_str("Part");
    }
    let mut candidate = base.clone();
    let mut n = 2;
    while !taken.insert(candidate.clone()) {
        candidate = format!("{base}{n}");
        n += 1;
    }
    candidate
}

/// `1.5` → `1.5F`, `-4` → `-4.0F`.
fn float(value: f32) -> String {
    let rounded = (value * 10_000.0).round() / 10_000.0;
    let text = format!("{rounded}");
    let text = if text == "-0" { "0".to_string() } else { text };
    if text.contains('.') {
        format!("{text}F")
    } else {
        format!("{text}.0F")
    }
}

fn radians(degrees: f32) -> f32 {
    degrees.to_radians()
}

/// Code Java du modèle : une classe avec une méthode statique qui construit la géométrie,
/// en Yarn (`TexturedModelData`) ou en Mojmap (`LayerDefinition`). Minecraft 1.17 et plus.
pub fn entity_java(
    model: &EntityModel,
    meta: &ProjectMeta,
    profile: &Profile,
) -> AppResult<String> {
    let order = ordered(model)?;
    let yarn = profile.mappings == "yarn";
    let class = format!("{}ModelData", pascal(&model.name));
    let package = format!("{}.client.model", meta.package);
    let mut out = String::new();
    out.push_str(&format!("package {package};\n\n"));
    if yarn {
        for import in [
            "Dilation",
            "ModelData",
            "ModelPartBuilder",
            "ModelPartData",
            "ModelTransform",
            "TexturedModelData",
        ] {
            out.push_str(&format!("import net.minecraft.client.model.{import};\n"));
        }
    } else {
        out.push_str("import net.minecraft.client.model.geom.PartPose;\n");
        for import in [
            "CubeDeformation",
            "CubeListBuilder",
            "LayerDefinition",
            "MeshDefinition",
            "PartDefinition",
        ] {
            out.push_str(&format!(
                "import net.minecraft.client.model.geom.builders.{import};\n"
            ));
        }
    }
    let (layer_type, method) = if yarn {
        ("TexturedModelData", "getTexturedModelData")
    } else {
        ("LayerDefinition", "createBodyLayer")
    };
    out.push_str(&format!(
        "\n/**\n * Géométrie du modèle « {name} », générée par Mod Studio depuis\n * .mcstudio/models/{name}.json : modifiez le modèle dans l'onglet Modèles, pas ce fichier\n * (il est réécrit à chaque enregistrement). Texture : textures/entity/{name}.png\n * ({w} × {h}).\n */\npublic final class {class} {{\n    private {class}() {{\n    }}\n\n    public static {layer_type} {method}() {{\n",
        name = model.name,
        w = model.texture_width,
        h = model.texture_height,
    ));
    if yarn {
        out.push_str("        ModelData data = new ModelData();\n        ModelPartData root = data.getRoot();\n");
    } else {
        out.push_str("        MeshDefinition mesh = new MeshDefinition();\n        PartDefinition root = mesh.getRoot();\n");
    }

    let parents: BTreeSet<&str> = model
        .bones
        .iter()
        .filter_map(|b| b.parent.as_deref())
        .collect();
    let mut taken = BTreeSet::new();
    let mut variables: BTreeMap<&str, String> = BTreeMap::new();
    for bone in order {
        let owner = bone
            .parent
            .as_deref()
            .and_then(|p| variables.get(p).cloned())
            .unwrap_or_else(|| "root".to_string());
        let mut builder = if yarn {
            "ModelPartBuilder.create()".to_string()
        } else {
            "CubeListBuilder.create()".to_string()
        };
        for cube in &bone.cubes {
            let [x, y, z] = cube.origin;
            let [w, h, d] = cube.size;
            let [u, v] = cube.uv;
            if yarn {
                builder.push_str(&format!(".uv({u}, {v})"));
                if cube.mirror {
                    builder.push_str(".mirrored()");
                }
                builder.push_str(&format!(
                    ".cuboid({}, {}, {}, {}, {}, {}, new Dilation({}))",
                    float(x),
                    float(y),
                    float(z),
                    float(w),
                    float(h),
                    float(d),
                    float(cube.inflate)
                ));
                if cube.mirror {
                    builder.push_str(".mirrored(false)");
                }
            } else {
                builder.push_str(&format!(".texOffs({u}, {v})"));
                if cube.mirror {
                    builder.push_str(".mirror()");
                }
                builder.push_str(&format!(
                    ".addBox({}, {}, {}, {}, {}, {}, new CubeDeformation({}))",
                    float(x),
                    float(y),
                    float(z),
                    float(w),
                    float(h),
                    float(d),
                    float(cube.inflate)
                ));
                if cube.mirror {
                    builder.push_str(".mirror(false)");
                }
            }
        }
        let [px, py, pz] = bone.pivot;
        let [rx, ry, rz] = bone.rotation.map(radians);
        let pose = if yarn {
            format!(
                "ModelTransform.of({}, {}, {}, {}, {}, {})",
                float(px),
                float(py),
                float(pz),
                float(rx),
                float(ry),
                float(rz)
            )
        } else {
            format!(
                "PartPose.offsetAndRotation({}, {}, {}, {}, {}, {})",
                float(px),
                float(py),
                float(pz),
                float(rx),
                float(ry),
                float(rz)
            )
        };
        let add = if yarn {
            "addChild"
        } else {
            "addOrReplaceChild"
        };
        let call = format!("{owner}.{add}(\"{}\", {builder}, {pose});", bone.name);
        if parents.contains(bone.name.as_str()) {
            let name = variable(&bone.name, &mut taken);
            let kind = if yarn {
                "ModelPartData"
            } else {
                "PartDefinition"
            };
            out.push_str(&format!("        {kind} {name} = {call}\n"));
            variables.insert(&bone.name, name);
        } else {
            out.push_str(&format!("        {call}\n"));
        }
    }
    let (w, h) = (model.texture_width, model.texture_height);
    if yarn {
        out.push_str(&format!(
            "        return TexturedModelData.of(data, {w}, {h});\n"
        ));
    } else {
        out.push_str(&format!(
            "        return LayerDefinition.create(mesh, {w}, {h});\n"
        ));
    }
    out.push_str("    }\n}\n");
    Ok(out)
}

fn java_relative(meta: &ProjectMeta, name: &str) -> String {
    format!(
        "src/main/java/{}/client/model/{}ModelData.java",
        meta.package.replace('.', "/"),
        pascal(name)
    )
}

/// Enregistre un modèle d'entité : source, code Java (1.17+) et texture vide si elle manque,
/// après un point de restauration.
pub fn save_entity(
    root: &Path,
    meta: &ProjectMeta,
    profile: &Profile,
    model: &EntityModel,
) -> AppResult<EntitySaved> {
    validate_entity(model)?;
    let source = format!("{ENTITY_DIR}/{}.json", model.name);
    let texture = entity_texture(&meta.mod_id, &model.name);
    let modern =
        profiles::compare_releases(&meta.versions.minecraft, "1.17") != std::cmp::Ordering::Less;
    let java = modern.then(|| java_relative(meta, &model.name));
    let code = match modern {
        true => Some(entity_java(model, meta, profile)?),
        false => None,
    };

    let mut touched = vec![source.clone(), texture.clone()];
    touched.extend(java.clone());
    snapshots::create(
        root,
        &format!("Avant l'enregistrement du modèle d'entité {}", model.name),
        SnapshotKind::Model,
        &touched,
    )?;
    let body = serde_json::to_string_pretty(model)?;
    fsutil::write_atomic(&root.join(&source), format!("{body}\n").as_bytes())?;
    if let (Some(relative), Some(code)) = (&java, &code) {
        fsutil::write_atomic(&root.join(relative), code.as_bytes())?;
    }
    let texture_file = root.join(&texture);
    if !texture_file.exists() {
        let blank = Raster::new(model.texture_width, model.texture_height);
        fsutil::write_atomic(&texture_file, &blank.png()?)?;
    }
    crate::core::audit::record("mcstudio.entity_model_save", &source, "written", "user");
    Ok(EntitySaved {
        model: ModelInfo {
            kind: ModelKind::Entity,
            id: model.name.clone(),
            label: model.name.clone(),
            modified: modified_ms(&root.join(&source)),
            relative: source,
            custom: true,
            parent: None,
            textures: vec![texture],
        },
        java,
        note: (!modern).then(|| {
            "Minecraft 1.14 à 1.16 construit les modèles autrement : le code Java n'est pas généré, \
             la source et la texture sont enregistrées."
                .to_string()
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::types::EntityCube;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mcstudio-models-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, relative: &str, body: &[u8]) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn cube(origin: [f32; 3], size: [f32; 3], uv: [u32; 2]) -> EntityCube {
        EntityCube {
            origin,
            size,
            uv,
            inflate: 0.0,
            mirror: false,
        }
    }

    fn golem() -> EntityModel {
        EntityModel {
            name: "ruby_golem".into(),
            texture_width: 64,
            texture_height: 64,
            bones: vec![
                EntityBone {
                    name: "head".into(),
                    parent: Some("body".into()),
                    pivot: [0.0, -12.0, 0.0],
                    rotation: [22.5, 0.0, 0.0],
                    cubes: vec![cube([-4.0, -8.0, -4.0], [8.0, 8.0, 8.0], [0, 0])],
                },
                EntityBone {
                    name: "body".into(),
                    parent: None,
                    pivot: [0.0, 12.0, 0.0],
                    rotation: [0.0; 3],
                    cubes: vec![cube([-4.0, -12.0, -2.0], [8.0, 12.0, 4.0], [16, 16])],
                },
                EntityBone {
                    name: "left_arm".into(),
                    parent: Some("body".into()),
                    pivot: [5.0, -10.0, 0.0],
                    rotation: [0.0; 3],
                    cubes: vec![EntityCube {
                        mirror: true,
                        inflate: 0.25,
                        ..cube([-1.0, -2.0, -2.0], [4.0, 12.0, 4.0], [40, 16])
                    }],
                },
            ],
        }
    }

    fn profile(mappings: &str) -> Profile {
        let mut profile = profiles::load_all(Path::new("/nonexistent"))
            .into_iter()
            .find(|p| p.id == "fabric-1.21")
            .expect("profil intégré");
        profile.mappings = mappings.to_string();
        profile
    }

    fn meta() -> ProjectMeta {
        serde_json::from_value(serde_json::json!({
            "format": 1, "id": "p", "name": "Demo", "modId": "dm", "package": "com.demo.dm",
            "mainClass": "Dm", "author": "", "description": "", "modVersion": "1.0.0",
            "license": "mit",
            "versions": {"profileId": "fabric-1.21", "loader": "fabric", "minecraft": "1.21.1",
                "loaderVersion": "0.16.0", "mappingsVersion": "1.21.1+build.3", "apiVersion": null,
                "java": 21, "javaMax": null, "gradle": "8.14.3", "plugin": "1.10", "offline": false},
            "javaHome": null, "createdAt": "2026-01-01T00:00:00Z"
        }))
        .unwrap()
    }

    #[test]
    fn yarn_code_builds_parents_first_with_exact_numbers() {
        let code = entity_java(&golem(), &meta(), &profile("yarn")).unwrap();
        assert!(
            code.starts_with("package com.demo.dm.client.model;\n"),
            "{code}"
        );
        assert!(code.contains("public final class RubyGolemModelData"));
        assert!(code.contains("public static TexturedModelData getTexturedModelData()"));
        let body = code
            .find("ModelPartData body = root.addChild(\"body\"")
            .unwrap();
        let head = code.find("body.addChild(\"head\"").unwrap();
        assert!(body < head, "le parent d'abord :\n{code}");
        assert!(code.contains(
            ".uv(16, 16).cuboid(-4.0F, -12.0F, -2.0F, 8.0F, 12.0F, 4.0F, new Dilation(0.0F))"
        ));
        assert!(
            code.contains("ModelTransform.of(0.0F, -12.0F, 0.0F, 0.3927F, 0.0F, 0.0F)"),
            "{code}"
        );
        assert!(code.contains(".uv(40, 16).mirrored().cuboid(-1.0F, -2.0F, -2.0F, 4.0F, 12.0F, 4.0F, new Dilation(0.25F)).mirrored(false)"));
        assert!(code.contains("return TexturedModelData.of(data, 64, 64);"));
    }

    #[test]
    fn mojmap_code_uses_official_names() {
        let code = entity_java(&golem(), &meta(), &profile("official")).unwrap();
        assert!(code.contains("public static LayerDefinition createBodyLayer()"));
        assert!(code.contains("PartDefinition body = root.addOrReplaceChild(\"body\", CubeListBuilder.create().texOffs(16, 16).addBox("));
        assert!(code.contains("PartPose.offsetAndRotation(5.0F, -10.0F, 0.0F, 0.0F, 0.0F, 0.0F)"));
        assert!(code.contains(".texOffs(40, 16).mirror().addBox("));
        assert!(code.contains("return LayerDefinition.create(mesh, 64, 64);"));
    }

    #[test]
    fn broken_hierarchies_are_refused() {
        let mut model = golem();
        model.bones[1].parent = Some("head".into());
        assert!(validate_entity(&model).is_err(), "boucle");
        let mut model = golem();
        model.bones[0].parent = Some("tail".into());
        assert!(validate_entity(&model).is_err(), "parent inconnu");
        let mut model = golem();
        model.bones[2].name = "head".into();
        assert!(validate_entity(&model).is_err(), "doublon");
        let mut model = golem();
        model.bones[2].name = "bad\"name".into();
        assert!(validate_entity(&model).is_err(), "nom");
        let mut model = golem();
        model.bones[0].pivot[0] = f32::NAN;
        assert!(validate_entity(&model).is_err(), "nombre");
    }

    #[test]
    fn variables_stay_valid_java() {
        let mut taken = BTreeSet::new();
        assert_eq!(variable("left_arm", &mut taken), "leftArm");
        assert_eq!(variable("left_arm", &mut taken), "leftArm2");
        assert_eq!(variable("class", &mut taken), "classPart");
        assert_eq!(variable("root", &mut taken), "rootPart");
        assert_eq!(variable("2nd", &mut taken), "part2nd");
        assert_eq!(float(-0.0), "0.0F");
        assert_eq!(float(1.5), "1.5F");
    }

    #[test]
    fn entities_save_their_source_code_and_texture() {
        let root = temp("entity");
        let saved = save_entity(&root, &meta(), &profile("yarn"), &golem()).unwrap();
        assert_eq!(
            saved.java.as_deref(),
            Some("src/main/java/com/demo/dm/client/model/RubyGolemModelData.java")
        );
        assert!(root.join(".mcstudio/models/ruby_golem.json").is_file());
        let texture = root.join("src/main/resources/assets/dm/textures/entity/ruby_golem.png");
        assert_eq!(image::image_dimensions(&texture).unwrap(), (64, 64));
        assert_eq!(read_entity(&root, "ruby_golem").unwrap(), golem());

        let listed = list(&root, "dm", &Map::new());
        let entity = listed.iter().find(|m| m.kind == ModelKind::Entity).unwrap();
        assert_eq!(entity.id, "ruby_golem");
        assert_eq!(
            entity.textures,
            vec!["src/main/resources/assets/dm/textures/entity/ruby_golem.png"]
        );

        // Minecraft 1.16 : pas de code.
        let mut old = meta();
        old.versions.minecraft = "1.16.5".into();
        let saved = save_entity(&root, &old, &profile("yarn"), &golem()).unwrap();
        assert!(saved.java.is_none() && saved.note.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn block_and_item_models_are_listed_read_and_saved() {
        let root = temp("blocks");
        let base = "src/main/resources/assets/dm";
        write(
            &root,
            &format!("{base}/models/block/lamp.json"),
            br#"{"parent":"minecraft:block/block","elements":[]}"#,
        );
        write(
            &root,
            &format!("{base}/models/item/ruby.json"),
            br#"{"parent":"minecraft:item/generated","textures":{"layer0":"dm:item/ruby"}}"#,
        );
        write(
            &root,
            &format!("{base}/textures/models/armor/ruby_layer_1.png"),
            b"x",
        );
        write(
            &root,
            &format!("{base}/textures/models/armor/ruby_layer_2.png"),
            b"x",
        );
        let mut names = Map::new();
        names.insert("block.dm.lamp".into(), Value::String("Lampe".into()));
        let listed = list(&root, "dm", &names);
        let lamp = listed.iter().find(|m| m.id == "block/lamp").unwrap();
        assert!(lamp.custom);
        assert_eq!(lamp.label, "Lampe (lamp)");
        let ruby = listed.iter().find(|m| m.id == "item/ruby").unwrap();
        assert!(!ruby.custom);
        assert_eq!(ruby.parent.as_deref(), Some("minecraft:item/generated"));
        let armor = listed.iter().find(|m| m.kind == ModelKind::Armor).unwrap();
        assert_eq!(armor.id, "ruby");
        assert!(armor.textures[1].ends_with("models/armor/ruby_layer_2.png"));

        assert!(read_model(&root, "dm", "dm:block/lamp").unwrap().exists);
        assert!(read_model(&root, "dm", "minecraft:block/cube").is_err());
        assert!(read_model(&root, "dm", "block/../../x").is_err());
        assert!(read_model(&root, "dm", "textures/x").is_err());

        let json = r#"{"elements":[{"from":[0,0,0],"to":[16,8,16],"faces":{}}]}"#;
        save_model(&root, "dm", "block/lamp", json, false).unwrap();
        let saved =
            std::fs::read_to_string(root.join(format!("{base}/models/block/lamp.json"))).unwrap();
        assert!(saved.contains("\"to\": ["), "{saved}");
        assert!(
            save_model(&root, "dm", "block/lamp", json, true).is_err(),
            "existe déjà"
        );
        assert!(
            save_model(&root, "dm", "block/new", "[1]", true).is_err(),
            "pas un objet"
        );
        save_model(&root, "dm", "block/new", json, true).unwrap();
        assert!(snapshots::list(&root).len() >= 2);

        // Textures : seulement celles du mod.
        let pixels = PixelData {
            width: 2,
            height: 1,
            rgba: base64::engine::general_purpose::STANDARD.encode([255u8, 0, 0, 255, 0, 0, 0, 0]),
        };
        let texture = format!("{base}/textures/entity/lamp.png");
        save_texture_pixels(&root, "dm", &texture, &pixels).unwrap();
        assert_eq!(
            texture_pixels(&root, "dm", &texture).unwrap().rgba,
            pixels.rgba
        );
        save_texture_pixels(&root, "dm", &texture, &pixels).unwrap();
        assert!(
            root.join(".mcstudio/history/textures")
                .read_dir()
                .unwrap()
                .count()
                >= 1
        );
        assert!(save_texture_pixels(&root, "dm", "build.gradle", &pixels).is_err());
        assert!(texture_pixels(&root, "dm", &format!("{base}/textures/../lang/x.png")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
