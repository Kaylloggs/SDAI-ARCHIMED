//! Générateurs de contenu déterministes : un objet, un bloc ou une recette produit
//! toujours les mêmes fichiers, au format de la version et du loader du projet.
//!
//! Le code Java est inséré au-dessus des marqueurs `// @mcstudio:*` des classes de
//! registre ; tout le reste (modèles, états, textures, loot tables, tags, langues)
//! est écrit en fichiers séparés. Toutes les vérifications passent **avant** la
//! première écriture : une demande refusée ne laisse aucun fichier à moitié créé.

use std::path::PathBuf;

use regex::Regex;
use serde_json::{json, Value};

use crate::core::{AppError, AppResult};

use super::fsutil::write_atomic;
use super::profiles::{DataFormat, Dialect};
use super::textures;
use super::types::{BlockRequest, BlockSound, ContentResult, ItemRequest, RecipeRequest};

const MARKER_ITEMS: &str = "// @mcstudio:items";
const MARKER_BLOCKS: &str = "// @mcstudio:blocks";
const MARKER_TAB: &str = "// @mcstudio:creative-tab";

/// Ce qu'un générateur doit savoir du projet.
pub struct GenContext {
    pub root: PathBuf,
    pub mod_id: String,
    pub package: String,
    pub dialect: Dialect,
    pub data_format: DataFormat,
}

/// Écriture prévue : chemin relatif + contenu.
struct Planned {
    path: String,
    bytes: Vec<u8>,
    existed: bool,
}

impl GenContext {
    fn assets(&self, rest: &str) -> String {
        format!("src/main/resources/assets/{}/{rest}", self.mod_id)
    }

    fn data(&self, namespace: &str, rest: &str) -> String {
        format!("src/main/resources/data/{namespace}/{rest}")
    }

    fn registry_file(&self, class: &str) -> String {
        format!(
            "src/main/java/{}/registry/{class}.java",
            self.package.replace('.', "/")
        )
    }

    fn abs(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    /// Dossiers de données au pluriel jusqu'à 1.20.6, au singulier ensuite.
    fn plural_dirs(&self) -> bool {
        self.data_format < DataFormat::V1_21
    }

    fn recipe_dir(&self) -> &'static str {
        if self.plural_dirs() {
            "recipes"
        } else {
            "recipe"
        }
    }

    fn loot_dir(&self) -> &'static str {
        if self.plural_dirs() {
            "loot_tables"
        } else {
            "loot_table"
        }
    }

    fn block_tag_dir(&self) -> &'static str {
        if self.plural_dirs() {
            "blocks"
        } else {
            "block"
        }
    }

    /// Pile d'objets en résultat de recette.
    fn stack(&self, item: &str, count: u32) -> Value {
        match self.data_format {
            DataFormat::Legacy => json!({ "item": item, "count": count }),
            _ => json!({ "id": item, "count": count }),
        }
    }

    /// Ingrédient : objet `{"item": …}` jusqu'à 1.21.1, simple texte ensuite.
    fn ingredient(&self, item: &str) -> Value {
        if self.data_format >= DataFormat::V1_21_2 {
            Value::String(item.to_string())
        } else {
            json!({ "item": item })
        }
    }

    /// Résultat de cuisson : texte jusqu'à 1.20.4, pile `{"id": …}` ensuite.
    fn smelting_result(&self, item: &str) -> Value {
        match self.data_format {
            DataFormat::Legacy => Value::String(item.to_string()),
            _ => json!({ "id": item }),
        }
    }

    /// Depuis 1.21.4, chaque objet a une définition dans `assets/<modid>/items/`.
    fn item_definitions(&self) -> bool {
        self.data_format >= DataFormat::V1_21_4
    }

    fn namespaced(&self, id: &str) -> String {
        format!("{}:{id}", self.mod_id)
    }
}

pub fn validate_id(id: &str) -> AppResult<()> {
    let ok = Regex::new(r"^[a-z][a-z0-9_]{0,63}$")
        .map(|re| re.is_match(id))
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "« {id} » n'est pas un nom de registre valide : minuscules, chiffres et _ uniquement, en commençant par une lettre."
        )))
    }
}

fn validate_ref(reference: &str) -> AppResult<()> {
    let ok = Regex::new(r"^[a-z0-9_.-]+:[a-z0-9_./-]+$")
        .map(|re| re.is_match(reference))
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "« {reference} » doit être un identifiant complet, par exemple minecraft:stick."
        )))
    }
}

fn constant(id: &str) -> String {
    id.to_ascii_uppercase()
}

fn pretty(value: &Value) -> Vec<u8> {
    let mut text = serde_json::to_string_pretty(value).unwrap_or_default();
    text.push('\n');
    text.into_bytes()
}

fn java_float(value: f32) -> AppResult<String> {
    if !value.is_finite() || !(-1.0..=3_600_000.0).contains(&value) {
        return Err(AppError::invalid(
            "Dureté ou résistance hors limites (−1 à 3 600 000).",
        ));
    }
    Ok(format!("{value:?}f"))
}

/// Ligne(s) Java insérées dans les registres, selon l'API du loader et de la version.
pub(super) mod java {
    use super::super::profiles::Dialect;
    use super::super::types::BlockSound;

    pub fn item_field(dialect: Dialect, konst: &str, id: &str) -> String {
        match dialect {
            Dialect::FabricYarn114 => format!(
                "public static final Item {konst} = register(\"{id}\", new Item(new Item.Settings().group(ItemGroup.MISC)));"
            ),
            Dialect::FabricYarn1193 | Dialect::FabricYarn120 | Dialect::FabricYarn121 => {
                format!("public static final Item {konst} = register(\"{id}\", new Item(new Item.Settings()));")
            }
            Dialect::FabricYarn1212 => {
                format!("public static final Item {konst} = register(\"{id}\", Item::new, new Item.Settings());")
            }
            Dialect::Forge114 => format!(
                "public static final RegistryObject<Item> {konst} = ITEMS.register(\"{id}\", () -> new Item(new Item.Properties().tab(ItemGroup.TAB_MISC)));"
            ),
            Dialect::Forge117 => format!(
                "public static final RegistryObject<Item> {konst} = ITEMS.register(\"{id}\", () -> new Item(new Item.Properties().tab(CreativeModeTab.TAB_MISC)));"
            ),
            Dialect::Forge1193 | Dialect::Forge120 => format!(
                "public static final RegistryObject<Item> {konst} = ITEMS.register(\"{id}\", () -> new Item(new Item.Properties()));"
            ),
            Dialect::Forge1213 => format!("public static final RegistryObject<Item> {konst} = registerItem(\"{id}\");"),
            Dialect::NeoForge121 => format!(
                "public static final DeferredItem<Item> {konst} = ITEMS.register(\"{id}\", () -> new Item(new Item.Properties()));"
            ),
            Dialect::NeoForge1212 => format!("public static final DeferredItem<Item> {konst} = registerItem(\"{id}\");"),
        }
    }

    /// Bloc vanilla dont on copie les réglages (le son et l'outil suivent).
    fn vanilla_model(sound: BlockSound) -> &'static str {
        match sound {
            BlockSound::Stone => "STONE",
            BlockSound::Metal => "IRON_BLOCK",
            BlockSound::Wood => "OAK_PLANKS",
        }
    }

    pub fn block_field(
        dialect: Dialect,
        konst: &str,
        id: &str,
        hardness: &str,
        resistance: &str,
        sound: BlockSound,
    ) -> String {
        let model = vanilla_model(sound);
        let sound = match sound {
            BlockSound::Stone => "STONE",
            BlockSound::Metal => "METAL",
            BlockSound::Wood => "WOOD",
        };
        let strength = format!("strength({hardness}, {resistance})");
        match dialect {
            // Avant 1.20, pas de `Settings.create()` et les sons sont protégés en 1.14 :
            // on copie les réglages d'un bloc vanilla puis on règle la solidité.
            Dialect::FabricYarn114 => format!(
                "public static final Block {konst} = register(\"{id}\", new Block(Block.Settings.copy(Blocks.{model}).{strength}));"
            ),
            Dialect::FabricYarn1193 => format!(
                "public static final Block {konst} = register(\"{id}\", new Block(AbstractBlock.Settings.copy(Blocks.{model}).{strength}));"
            ),
            Dialect::FabricYarn120 | Dialect::FabricYarn121 => format!(
                "public static final Block {konst} = register(\"{id}\", new Block(AbstractBlock.Settings.create().{strength}.sounds(BlockSoundGroup.{sound})));"
            ),
            Dialect::FabricYarn1212 => format!(
                "public static final Block {konst} = register(\"{id}\", Block::new, AbstractBlock.Settings.create().{strength}.sounds(BlockSoundGroup.{sound}));"
            ),
            // Noms de classes MCP (`Block.Properties`), membres aux noms officiels.
            Dialect::Forge114 => format!(
                "public static final RegistryObject<Block> {konst} = registerBlock(\"{id}\", () -> new Block(Block.Properties.of(Material.{sound}).{strength}.sound(SoundType.{sound})));"
            ),
            Dialect::Forge117 | Dialect::Forge1193 => format!(
                "public static final RegistryObject<Block> {konst} = registerBlock(\"{id}\", () -> new Block(BlockBehaviour.Properties.of(Material.{sound}).{strength}.sound(SoundType.{sound})));"
            ),
            Dialect::Forge120 => format!(
                "public static final RegistryObject<Block> {konst} = registerBlock(\"{id}\", () -> new Block(BlockBehaviour.Properties.of().{strength}.sound(SoundType.{sound})));"
            ),
            Dialect::Forge1213 => format!(
                "public static final RegistryObject<Block> {konst} = registerBlock(\"{id}\", BlockBehaviour.Properties.of().{strength}.sound(SoundType.{sound}));"
            ),
            Dialect::NeoForge121 => format!(
                "public static final DeferredBlock<Block> {konst} = registerBlock(\"{id}\", () -> new Block(BlockBehaviour.Properties.of().{strength}.sound(SoundType.{sound})));"
            ),
            Dialect::NeoForge1212 => format!(
                "public static final DeferredBlock<Block> {konst} = registerBlock(\"{id}\", BlockBehaviour.Properties.of().{strength}.sound(SoundType.{sound}));"
            ),
        }
    }

    /// Entrée de l'onglet créatif (le marqueur vit dans `ModItems`) ; `None` quand
    /// l'onglet est fixé dans les réglages de l'objet (avant 1.19.3).
    pub fn creative_entry(dialect: Dialect, reference: &str) -> Option<String> {
        match dialect {
            Dialect::FabricYarn114 | Dialect::Forge114 | Dialect::Forge117 => None,
            Dialect::FabricYarn1193
            | Dialect::FabricYarn120
            | Dialect::FabricYarn121
            | Dialect::FabricYarn1212 => Some(format!("entries.add({reference});")),
            Dialect::Forge1193
            | Dialect::Forge120
            | Dialect::Forge1213
            | Dialect::NeoForge121
            | Dialect::NeoForge1212 => Some(format!("event.accept({reference});")),
        }
    }
}

/// Insère `line` au-dessus de la ligne qui contient `marker`, à la même indentation.
fn insert_before_marker(source: &str, marker: &str, line: &str, file: &str) -> AppResult<String> {
    let mut out = String::with_capacity(source.len() + line.len() + 16);
    let mut inserted = false;
    for current in source.split_inclusive('\n') {
        if !inserted && current.contains(marker) {
            let indent: String = current.chars().take_while(|c| c.is_whitespace()).collect();
            let newline = if current.ends_with("\r\n") {
                "\r\n"
            } else {
                "\n"
            };
            out.push_str(&indent);
            out.push_str(line);
            out.push_str(newline);
            inserted = true;
        }
        out.push_str(current);
    }
    if inserted {
        Ok(out)
    } else {
        Err(AppError::invalid(format!(
            "Le marqueur « {marker} » est introuvable dans {file} : remettez-le pour que Mod Studio sache où ajouter le code."
        )))
    }
}

fn declares(source: &str, konst: &str) -> bool {
    Regex::new(&format!(r"\b{konst}\b"))
        .map(|re| re.is_match(source))
        .unwrap_or(false)
}

/// Ajoute des clés à un fichier de langue sans reformater l'existant.
fn add_lang_entries(source: &str, entries: &[(String, String)], file: &str) -> AppResult<String> {
    let parsed: serde_json::Map<String, Value> = serde_json::from_str(source).map_err(|e| {
        AppError::invalid(format!(
            "{file} n'est pas un JSON valide ({e}) : corrigez-le d'abord."
        ))
    })?;
    if let Some((key, _)) = entries.iter().find(|(key, _)| parsed.contains_key(key)) {
        return Err(AppError::invalid(format!(
            "La traduction « {key} » existe déjà dans {file}."
        )));
    }
    let end = source
        .rfind('}')
        .ok_or_else(|| AppError::invalid(format!("{file} : objet JSON attendu.")))?;
    let before = source[..end].trim_end();
    let lines: Vec<String> = entries
        .iter()
        .map(|(key, value)| {
            format!(
                "  {}: {}",
                Value::String(key.clone()),
                Value::String(value.clone())
            )
        })
        .collect();
    let separator = if before.ends_with('{') { "" } else { "," };
    Ok(format!("{before}{separator}\n{}\n}}\n", lines.join(",\n")))
}

/// Ajoute une valeur à un tag (`{"replace": false, "values": [...]}`), créé au besoin.
fn add_tag_value(existing: Option<&str>, value: &str, file: &str) -> AppResult<Vec<u8>> {
    let mut tag: Value = match existing {
        Some(raw) => serde_json::from_str(raw)
            .map_err(|e| AppError::invalid(format!("{file} n'est pas un JSON valide ({e}).")))?,
        None => json!({ "replace": false, "values": [] }),
    };
    let values = tag
        .get_mut("values")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| AppError::invalid(format!("{file} : tableau « values » attendu.")))?;
    if !values.iter().any(|v| v.as_str() == Some(value)) {
        values.push(Value::String(value.to_string()));
    }
    Ok(pretty(&tag))
}

fn read(ctx: &GenContext, relative: &str) -> AppResult<String> {
    std::fs::read_to_string(ctx.abs(relative))
        .map_err(|e| AppError::not_found(format!("{relative} illisible : {e}")))
}

fn ensure_absent(ctx: &GenContext, relative: &str) -> AppResult<()> {
    if ctx.abs(relative).exists() {
        return Err(AppError::invalid(format!(
            "{relative} existe déjà : choisissez un autre nom."
        )));
    }
    Ok(())
}

fn commit(ctx: &GenContext, planned: Vec<Planned>) -> AppResult<ContentResult> {
    let mut result = ContentResult::default();
    for file in planned {
        write_atomic(&ctx.abs(&file.path), &file.bytes)?;
        if file.existed {
            result.modified.push(file.path);
        } else {
            result.created.push(file.path);
        }
    }
    Ok(result)
}

fn planned(ctx: &GenContext, path: String, bytes: Vec<u8>) -> Planned {
    let existed = ctx.abs(&path).exists();
    Planned {
        path,
        bytes,
        existed,
    }
}

fn lang_updates(ctx: &GenContext, key: &str, en: &str, fr: &str) -> AppResult<Vec<Planned>> {
    let mut out = Vec::new();
    for (lang, name) in [("en_us", en), ("fr_fr", fr)] {
        let path = ctx.assets(&format!("lang/{lang}.json"));
        let source = if ctx.abs(&path).exists() {
            read(ctx, &path)?
        } else {
            "{\n}\n".to_string()
        };
        let updated = add_lang_entries(&source, &[(key.to_string(), name.to_string())], &path)?;
        out.push(planned(ctx, path, updated.into_bytes()));
    }
    Ok(out)
}

/// `assets/<modid>/items/<id>.json` (1.21.4+) : quel modèle affiche l'objet.
fn item_definition(model: &str) -> Vec<u8> {
    pretty(&json!({ "model": { "type": "minecraft:model", "model": model } }))
}

pub fn add_item(ctx: &GenContext, request: &ItemRequest) -> AppResult<ContentResult> {
    validate_id(&request.id)?;
    let id = &request.id;
    let konst = constant(id);
    let model = ctx.assets(&format!("models/item/{id}.json"));
    let definition = ctx.assets(&format!("items/{id}.json"));
    let texture = ctx.assets(&format!("textures/item/{id}.png"));
    ensure_absent(ctx, &model)?;

    let items_file = ctx.registry_file("ModItems");
    let items = read(ctx, &items_file)?;
    if declares(&items, &konst) {
        return Err(AppError::invalid(format!(
            "{konst} est déjà déclaré dans ModItems."
        )));
    }
    let items = insert_before_marker(
        &items,
        MARKER_ITEMS,
        &java::item_field(ctx.dialect, &konst, id),
        &items_file,
    )?;
    let items = match java::creative_entry(ctx.dialect, &konst) {
        Some(entry) => insert_before_marker(&items, MARKER_TAB, &entry, &items_file)?,
        None => items,
    };

    let mut plan = vec![planned(ctx, items_file, items.into_bytes())];
    plan.extend(lang_updates(
        ctx,
        &format!("item.{}.{id}", ctx.mod_id),
        &request.name_en,
        &request.name_fr,
    )?);
    plan.push(planned(
        ctx,
        model,
        pretty(&json!({ "parent": "minecraft:item/generated", "textures": { "layer0": format!("{}:item/{id}", ctx.mod_id) } })),
    ));
    if ctx.item_definitions() {
        plan.push(planned(
            ctx,
            definition,
            item_definition(&format!("{}:item/{id}", ctx.mod_id)),
        ));
    }
    if !ctx.abs(&texture).exists() {
        plan.push(planned(ctx, texture, textures::gem(id).png()?));
    }
    commit(ctx, plan)
}

pub fn add_block(ctx: &GenContext, request: &BlockRequest) -> AppResult<ContentResult> {
    validate_id(&request.id)?;
    let id = &request.id;
    let konst = constant(id);
    let hardness = java_float(request.hardness)?;
    let resistance = java_float(request.resistance)?;
    let blockstate = ctx.assets(&format!("blockstates/{id}.json"));
    let block_model = ctx.assets(&format!("models/block/{id}.json"));
    let item_model = ctx.assets(&format!("models/item/{id}.json"));
    let texture = ctx.assets(&format!("textures/block/{id}.png"));
    let loot = ctx.data(&ctx.mod_id, &format!("{}/blocks/{id}.json", ctx.loot_dir()));
    for path in [&blockstate, &block_model, &item_model, &loot] {
        ensure_absent(ctx, path)?;
    }

    let blocks_file = ctx.registry_file("ModBlocks");
    let blocks = read(ctx, &blocks_file)?;
    if declares(&blocks, &konst) {
        return Err(AppError::invalid(format!(
            "{konst} est déjà déclaré dans ModBlocks."
        )));
    }
    let field = java::block_field(
        ctx.dialect,
        &konst,
        id,
        &hardness,
        &resistance,
        request.sound,
    );
    let blocks = insert_before_marker(&blocks, MARKER_BLOCKS, &field, &blocks_file)?;

    let items_file = ctx.registry_file("ModItems");
    let items = read(ctx, &items_file)?;
    let items = match java::creative_entry(ctx.dialect, &format!("ModBlocks.{konst}")) {
        Some(entry) => Some(insert_before_marker(
            &items,
            MARKER_TAB,
            &entry,
            &items_file,
        )?),
        // Onglet fixé dans les réglages de l'objet du bloc : `ModItems` ne change pas.
        None => None,
    };

    let tool = match request.sound {
        BlockSound::Wood => "axe",
        BlockSound::Stone | BlockSound::Metal => "pickaxe",
    };
    let tag = ctx.data(
        "minecraft",
        &format!("tags/{}/mineable/{tool}.json", ctx.block_tag_dir()),
    );
    let existing_tag = if ctx.abs(&tag).exists() {
        Some(read(ctx, &tag)?)
    } else {
        None
    };
    let tag_bytes = add_tag_value(existing_tag.as_deref(), &ctx.namespaced(id), &tag)?;

    let reference = format!("{}:block/{id}", ctx.mod_id);
    let mut plan = vec![planned(ctx, blocks_file, blocks.into_bytes())];
    if let Some(items) = items {
        plan.push(planned(ctx, items_file, items.into_bytes()));
    }
    plan.extend(lang_updates(
        ctx,
        &format!("block.{}.{id}", ctx.mod_id),
        &request.name_en,
        &request.name_fr,
    )?);
    plan.push(planned(
        ctx,
        blockstate,
        pretty(&json!({ "variants": { "": { "model": reference } } })),
    ));
    plan.push(planned(
        ctx,
        block_model,
        pretty(&json!({ "parent": "minecraft:block/cube_all", "textures": { "all": reference } })),
    ));
    plan.push(planned(
        ctx,
        item_model,
        pretty(&json!({ "parent": reference })),
    ));
    if ctx.item_definitions() {
        let definition = ctx.assets(&format!("items/{id}.json"));
        plan.push(planned(ctx, definition, item_definition(&reference)));
    }
    plan.push(planned(
        ctx,
        loot,
        pretty(&json!({
            "type": "minecraft:block",
            "pools": [{
                "rolls": 1,
                "entries": [{ "type": "minecraft:item", "name": ctx.namespaced(id) }],
                "conditions": [{ "condition": "minecraft:survives_explosion" }]
            }]
        })),
    ));
    plan.push(planned(ctx, tag, tag_bytes));
    if !ctx.abs(&texture).exists() {
        plan.push(planned(ctx, texture, textures::block(id).png()?));
    }
    commit(ctx, plan)
}

pub fn add_recipe(ctx: &GenContext, request: &RecipeRequest) -> AppResult<ContentResult> {
    let (id, body) = match request {
        RecipeRequest::Shaped {
            id,
            pattern,
            key,
            result,
            count,
        } => {
            validate_id(id)?;
            validate_ref(result)?;
            let width = pattern.first().map(|row| row.chars().count()).unwrap_or(0);
            if pattern.is_empty() || pattern.len() > 3 || width == 0 || width > 3 {
                return Err(AppError::invalid(
                    "Le motif d'une recette façonnée fait de 1 à 3 lignes de 1 à 3 cases.",
                ));
            }
            if pattern.iter().any(|row| row.chars().count() != width) {
                return Err(AppError::invalid(
                    "Toutes les lignes du motif doivent avoir la même largeur.",
                ));
            }
            for symbol in pattern
                .iter()
                .flat_map(|row| row.chars())
                .filter(|c| *c != ' ')
            {
                if !key.contains_key(&symbol.to_string()) {
                    return Err(AppError::invalid(format!(
                        "Le symbole « {symbol} » du motif n'a pas d'ingrédient."
                    )));
                }
            }
            let mut keys = serde_json::Map::new();
            for (symbol, item) in key {
                if symbol.chars().count() != 1 || symbol == " " {
                    return Err(AppError::invalid(format!(
                        "« {symbol} » : un symbole de motif est un seul caractère."
                    )));
                }
                validate_ref(item)?;
                keys.insert(symbol.clone(), ctx.ingredient(item));
            }
            (
                id,
                json!({
                    "type": "minecraft:crafting_shaped",
                    "category": "misc",
                    "pattern": pattern,
                    "key": keys,
                    "result": ctx.stack(result, (*count).max(1)),
                }),
            )
        }
        RecipeRequest::Shapeless {
            id,
            ingredients,
            result,
            count,
        } => {
            validate_id(id)?;
            validate_ref(result)?;
            if ingredients.is_empty() || ingredients.len() > 9 {
                return Err(AppError::invalid(
                    "Une recette sans forme prend de 1 à 9 ingrédients.",
                ));
            }
            for item in ingredients {
                validate_ref(item)?;
            }
            let ingredients: Vec<Value> = ingredients
                .iter()
                .map(|item| ctx.ingredient(item))
                .collect();
            (
                id,
                json!({
                    "type": "minecraft:crafting_shapeless",
                    "category": "misc",
                    "ingredients": ingredients,
                    "result": ctx.stack(result, (*count).max(1)),
                }),
            )
        }
        RecipeRequest::Smelting {
            id,
            ingredient,
            result,
            experience,
            cooking_time,
        } => {
            validate_id(id)?;
            validate_ref(ingredient)?;
            validate_ref(result)?;
            let result_value = ctx.smelting_result(result);
            (
                id,
                json!({
                    "type": "minecraft:smelting",
                    "category": "misc",
                    "ingredient": ctx.ingredient(ingredient),
                    "result": result_value,
                    "experience": experience,
                    "cookingtime": (*cooking_time).max(1),
                }),
            )
        }
    };
    let path = ctx.data(&ctx.mod_id, &format!("{}/{id}.json", ctx.recipe_dir()));
    ensure_absent(ctx, &path)?;
    commit(ctx, vec![planned(ctx, path, pretty(&body))])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_insertion_keeps_indentation_and_line_endings() {
        let source = "class A {\r\n    // @mcstudio:items\r\n}\r\n";
        let out = insert_before_marker(source, MARKER_ITEMS, "int X = 1;", "A.java").unwrap();
        assert_eq!(
            out,
            "class A {\r\n    int X = 1;\r\n    // @mcstudio:items\r\n}\r\n"
        );
        assert!(insert_before_marker("class A {}", MARKER_ITEMS, "x", "A.java").is_err());
    }

    #[test]
    fn lang_entries_are_appended_without_reformatting() {
        let empty = add_lang_entries(
            "{\n}\n",
            &[("item.m.ruby".into(), "Ruby".into())],
            "en_us.json",
        )
        .unwrap();
        assert_eq!(empty, "{\n  \"item.m.ruby\": \"Ruby\"\n}\n");
        let more = add_lang_entries(
            &empty,
            &[("block.m.x".into(), "Bloc « X »".into())],
            "fr_fr.json",
        )
        .unwrap();
        assert!(more.contains("\"item.m.ruby\": \"Ruby\",\n  \"block.m.x\": \"Bloc « X »\""));
        serde_json::from_str::<Value>(&more).unwrap();
        assert!(
            add_lang_entries(&more, &[("block.m.x".into(), "dup".into())], "fr_fr.json").is_err()
        );
        assert!(add_lang_entries("{ oops", &[("a".into(), "b".into())], "x.json").is_err());
    }

    #[test]
    fn tags_merge_without_duplicates() {
        let first = add_tag_value(None, "m:a", "t.json").unwrap();
        let second =
            add_tag_value(Some(std::str::from_utf8(&first).unwrap()), "m:a", "t.json").unwrap();
        let tag: Value = serde_json::from_slice(&second).unwrap();
        assert_eq!(tag["values"], json!(["m:a"]));
        assert_eq!(tag["replace"], json!(false));
    }

    #[test]
    fn java_snippets_follow_the_loader_api() {
        assert!(
            java::item_field(Dialect::Forge114, "RUBY", "ruby").contains("tab(ItemGroup.TAB_MISC)")
        );
        assert!(java::item_field(Dialect::FabricYarn1212, "RUBY", "ruby").contains("Item::new"));
        assert!(java::block_field(
            Dialect::FabricYarn114,
            "X",
            "x",
            "1.0f",
            "1.0f",
            BlockSound::Wood
        )
        .contains("copy(Blocks.OAK_PLANKS)"));
        assert!(java::creative_entry(Dialect::Forge117, "X").is_none());
        assert_eq!(
            java::creative_entry(Dialect::NeoForge1212, "X").as_deref(),
            Some("event.accept(X);")
        );
        assert!(
            java::item_field(Dialect::Forge120, "RUBY", "ruby").contains("RegistryObject<Item>")
        );
        assert!(
            java::item_field(Dialect::NeoForge121, "RUBY", "ruby").contains("DeferredItem<Item>")
        );
        assert!(java::item_field(Dialect::FabricYarn121, "RUBY", "ruby")
            .contains("new Item.Settings()"));
        let block = java::block_field(
            Dialect::FabricYarn120,
            "X",
            "x",
            "3.0f",
            "6.0f",
            BlockSound::Metal,
        );
        assert!(block.contains("BlockSoundGroup.METAL") && block.contains("strength(3.0f, 6.0f)"));
        assert_eq!(java_float(1.5).unwrap(), "1.5f");
        assert!(java_float(f32::NAN).is_err());
    }

    #[test]
    fn ids_and_references_are_validated() {
        assert!(validate_id("ruby_block").is_ok());
        assert!(validate_id("Ruby").is_err());
        assert!(validate_id("1ruby").is_err());
        assert!(validate_ref("minecraft:stick").is_ok());
        assert!(validate_ref("stick").is_err());
    }
}
