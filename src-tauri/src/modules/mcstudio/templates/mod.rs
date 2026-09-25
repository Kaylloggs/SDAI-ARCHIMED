//! Templates de projet versionnés, embarqués dans l'exécutable.
//!
//! Un template = une liste de fichiers (chemin cible + contenu) avec des marqueurs
//! `{{clé}}`. Les valeurs saisies par l'utilisateur (nom, description, auteur) sont
//! échappées selon le format du fichier cible (JSON, TOML, Java) ; les valeurs
//! techniques (versions, identifiants validés, expressions Java) sont insérées telles quelles.

use std::collections::BTreeMap;
use std::path::Path;

use crate::core::{AppError, AppResult};

pub enum Content {
    Text(&'static str),
    Binary(&'static [u8]),
}

pub struct TemplateFile {
    /// Chemin relatif au projet, lui-même porteur de marqueurs.
    pub path: &'static str,
    pub content: Content,
    pub executable: bool,
}

const fn text(path: &'static str, body: &'static str) -> TemplateFile {
    TemplateFile {
        path,
        content: Content::Text(body),
        executable: false,
    }
}

const COMMON: &[TemplateFile] = &[
    TemplateFile {
        path: "gradlew",
        content: Content::Text(include_str!("files/common/gradlew")),
        executable: true,
    },
    text("gradlew.bat", include_str!("files/common/gradlew.bat")),
    TemplateFile {
        path: "gradle/wrapper/gradle-wrapper.jar",
        content: Content::Binary(include_bytes!("files/common/gradle-wrapper.jar")),
        executable: false,
    },
    text(
        "gradle/wrapper/gradle-wrapper.properties",
        include_str!("files/common/gradle-wrapper.properties"),
    ),
    text(".gitignore", include_str!("files/common/gitignore")),
    text("README.md", include_str!("files/common/README.md")),
    text(
        "src/main/resources/assets/{{mod_id}}/lang/en_us.json",
        include_str!("files/common/en_us.json"),
    ),
    text(
        "src/main/resources/assets/{{mod_id}}/lang/fr_fr.json",
        include_str!("files/common/en_us.json"),
    ),
];

const MAIN: &str = "src/main/java/{{package_path}}/{{main_class}}.java";
const ITEMS: &str = "src/main/java/{{package_path}}/registry/ModItems.java";
const BLOCKS: &str = "src/main/java/{{package_path}}/registry/ModBlocks.java";

// ── Fabric (Loom) ────────────────────────────────────────────────────────────
const FABRIC_BUILD: &[TemplateFile] = &[
    text(
        "settings.gradle",
        include_str!("files/fabric/settings.gradle"),
    ),
    text("build.gradle", include_str!("files/fabric/build.gradle")),
    text(
        "gradle.properties",
        include_str!("files/fabric/gradle.properties"),
    ),
    text(
        "src/main/resources/fabric.mod.json",
        include_str!("files/fabric/fabric.mod.json"),
    ),
];
/// 1.14 – 1.19.2 : `Registry.ITEM`, onglet créatif dans les réglages.
const FABRIC_LEGACY: &[TemplateFile] = &[
    text(MAIN, include_str!("files/fabric-legacy/Main.java")),
    text(ITEMS, include_str!("files/fabric-legacy/ModItems.java")),
    text(BLOCKS, include_str!("files/fabric-legacy/ModBlocks.java")),
];
/// 1.19.3 – 1.21.1 : `Registries`, onglets par événement.
const FABRIC: &[TemplateFile] = &[
    text(MAIN, include_str!("files/fabric/Main.java")),
    text(ITEMS, include_str!("files/fabric/ModItems.java")),
    text(BLOCKS, include_str!("files/fabric/ModBlocks.java")),
];
/// 26.1+ : noms officiels de Mojang, plus de mappings, Loom `net.fabricmc.fabric-loom`.
const FABRIC_26_BUILD: &[TemplateFile] = &[
    text(
        "settings.gradle",
        include_str!("files/fabric/settings.gradle"),
    ),
    text("build.gradle", include_str!("files/fabric-26/build.gradle")),
    text(
        "gradle.properties",
        include_str!("files/fabric-26/gradle.properties"),
    ),
    text(
        "src/main/resources/fabric.mod.json",
        include_str!("files/fabric/fabric.mod.json"),
    ),
];
const FABRIC_26: &[TemplateFile] = &[
    text(MAIN, include_str!("files/fabric-26/Main.java")),
    text(ITEMS, include_str!("files/fabric-26/ModItems.java")),
    text(BLOCKS, include_str!("files/fabric-26/ModBlocks.java")),
];
/// 1.21.2+ : clés de registre dans les réglages.
const FABRIC_1_21_2: &[TemplateFile] = &[
    text(MAIN, include_str!("files/fabric/Main.java")),
    text(ITEMS, include_str!("files/fabric-1.21.2/ModItems.java")),
    text(BLOCKS, include_str!("files/fabric-1.21.2/ModBlocks.java")),
];

// ── Forge (ForgeGradle) ──────────────────────────────────────────────────────
const FORGE_META: &[TemplateFile] = &[
    text(
        "settings.gradle",
        include_str!("files/forge-1.20/settings.gradle"),
    ),
    text(
        "gradle.properties",
        include_str!("files/forge-1.20/gradle.properties"),
    ),
    text(
        "src/main/resources/META-INF/mods.toml",
        include_str!("files/forge-1.20/mods.toml"),
    ),
    text(
        "src/main/resources/pack.mcmeta",
        include_str!("files/forge-1.20/pack.mcmeta"),
    ),
];
/// ForgeGradle 5 sur Java 8 : pas d'option `--release`.
const FORGE_BUILD_FG5_JAVA8: &[TemplateFile] = &[text(
    "build.gradle",
    include_str!("files/forge-legacy/build.gradle"),
)];
const FORGE_BUILD_FG5: &[TemplateFile] = &[text(
    "build.gradle",
    include_str!("files/forge-1.17/build.gradle"),
)];
const FORGE_BUILD_FG6: &[TemplateFile] = &[text(
    "build.gradle",
    include_str!("files/forge-1.20/build.gradle"),
)];
/// 1.14.4 – 1.16.5 : noms de classes MCP.
const FORGE_LEGACY: &[TemplateFile] = &[
    text(MAIN, include_str!("files/forge-legacy/Main.java")),
    text(ITEMS, include_str!("files/forge-legacy/ModItems.java")),
    text(BLOCKS, include_str!("files/forge-legacy/ModBlocks.java")),
];
/// 1.17.1 – 1.19.2 : noms Mojang, onglet dans les propriétés.
const FORGE_1_17: &[TemplateFile] = &[
    text(MAIN, include_str!("files/forge-1.17/Main.java")),
    text(ITEMS, include_str!("files/forge-1.17/ModItems.java")),
    text(BLOCKS, include_str!("files/forge-1.17/ModBlocks.java")),
];
/// 1.19.3 – 1.19.4 : `CreativeModeTabEvent`.
const FORGE_1_19_3: &[TemplateFile] = &[
    text(MAIN, include_str!("files/forge-1.19.3/Main.java")),
    text(ITEMS, include_str!("files/forge-1.19.3/ModItems.java")),
    text(BLOCKS, include_str!("files/forge-1.19.3/ModBlocks.java")),
];
/// 1.20.1 – 1.21.1 : `BuildCreativeModeTabContentsEvent`.
const FORGE_1_20: &[TemplateFile] = &[
    text(MAIN, include_str!("files/forge-1.20/Main.java")),
    text(ITEMS, include_str!("files/forge-1.20/ModItems.java")),
    text(BLOCKS, include_str!("files/forge-1.20/ModBlocks.java")),
];
/// 1.21.3+ : `setId`.
const FORGE_1_21_3: &[TemplateFile] = &[
    text(MAIN, include_str!("files/forge-1.21.3/Main.java")),
    text(ITEMS, include_str!("files/forge-1.21.3/ModItems.java")),
    text(BLOCKS, include_str!("files/forge-1.21.3/ModBlocks.java")),
];

// ── NeoForge (ModDevGradle) ──────────────────────────────────────────────────
const NEOFORGE_BUILD: &[TemplateFile] = &[
    text(
        "settings.gradle",
        include_str!("files/neoforge-1.21/settings.gradle"),
    ),
    text(
        "build.gradle",
        include_str!("files/neoforge-1.21/build.gradle"),
    ),
    text(
        "gradle.properties",
        include_str!("files/neoforge-1.21/gradle.properties"),
    ),
];
const NEOFORGE_TOML: &[TemplateFile] = &[text(
    "src/main/resources/META-INF/neoforge.mods.toml",
    include_str!("files/neoforge-1.21/neoforge.mods.toml"),
)];
/// 1.20.4 : `mods.toml`, constructeur sans `ModContainer`.
const NEOFORGE_1_20_4: &[TemplateFile] = &[
    text(
        "src/main/resources/META-INF/mods.toml",
        include_str!("files/neoforge-1.20.4/mods.toml"),
    ),
    text(MAIN, include_str!("files/neoforge-1.20.4/Main.java")),
    text(ITEMS, include_str!("files/neoforge-1.21/ModItems.java")),
    text(BLOCKS, include_str!("files/neoforge-1.21/ModBlocks.java")),
];
/// 1.20.5 – 1.21.1.
const NEOFORGE_1_21: &[TemplateFile] = &[
    text(MAIN, include_str!("files/neoforge-1.21/Main.java")),
    text(ITEMS, include_str!("files/neoforge-1.21/ModItems.java")),
    text(BLOCKS, include_str!("files/neoforge-1.21/ModBlocks.java")),
];
/// 1.21.2+ : `setId`.
const NEOFORGE_1_21_2: &[TemplateFile] = &[
    text(MAIN, include_str!("files/neoforge-1.21/Main.java")),
    text(ITEMS, include_str!("files/neoforge-1.21.2/ModItems.java")),
    text(BLOCKS, include_str!("files/neoforge-1.21.2/ModBlocks.java")),
];

/// Ids de template connus (référencés par les profils).
#[cfg(test)]
pub const TEMPLATE_IDS: &[&str] = &[
    "fabric-legacy",
    "fabric",
    "fabric-1.21.2",
    "fabric-26",
    "forge-legacy",
    "forge-1.17",
    "forge-1.19.3",
    "forge-1.20",
    "forge-1.21.3",
    "neoforge-1.20.4",
    "neoforge-1.21",
    "neoforge-1.21.2",
];

/// Fichiers d'un template, fichiers communs compris.
pub fn files(template: &str) -> AppResult<Vec<&'static TemplateFile>> {
    let parts: &[&[TemplateFile]] = match template {
        "fabric-legacy" => &[FABRIC_BUILD, FABRIC_LEGACY],
        "fabric" => &[FABRIC_BUILD, FABRIC],
        "fabric-1.21.2" => &[FABRIC_BUILD, FABRIC_1_21_2],
        "fabric-26" => &[FABRIC_26_BUILD, FABRIC_26],
        "forge-legacy" => &[FORGE_META, FORGE_BUILD_FG5_JAVA8, FORGE_LEGACY],
        "forge-1.17" => &[FORGE_META, FORGE_BUILD_FG5, FORGE_1_17],
        "forge-1.19.3" => &[FORGE_META, FORGE_BUILD_FG5, FORGE_1_19_3],
        "forge-1.20" => &[FORGE_META, FORGE_BUILD_FG6, FORGE_1_20],
        "forge-1.21.3" => &[FORGE_META, FORGE_BUILD_FG6, FORGE_1_21_3],
        "neoforge-1.20.4" => &[NEOFORGE_BUILD, NEOFORGE_1_20_4],
        "neoforge-1.21" => &[NEOFORGE_BUILD, NEOFORGE_TOML, NEOFORGE_1_21],
        "neoforge-1.21.2" => &[NEOFORGE_BUILD, NEOFORGE_TOML, NEOFORGE_1_21_2],
        other => return Err(AppError::not_found(format!("template inconnu : {other}"))),
    };
    Ok(COMMON
        .iter()
        .chain(parts.iter().flat_map(|part| part.iter()))
        .collect())
}

/// Valeur d'un marqueur.
#[derive(Debug, Clone)]
pub enum Value {
    /// Saisie utilisateur : échappée selon le fichier cible.
    Text(String),
    /// Valeur technique déjà sûre : insérée telle quelle.
    Raw(String),
}

pub type Vars = BTreeMap<&'static str, Value>;

/// Remplace les marqueurs `{{clé}}`. Un marqueur inconnu est une erreur : un fichier
/// à moitié rendu ne doit jamais atteindre le disque.
pub fn render(source: &str, vars: &Vars, target: &str) -> AppResult<String> {
    let format = Format::of(target);
    let mut out = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after
            .find("}}")
            .ok_or_else(|| AppError::internal(format!("marqueur non fermé dans {target}")))?;
        let key = &after[..end];
        let value = vars.get(key).ok_or_else(|| {
            AppError::internal(format!("marqueur inconnu {{{{{key}}}}} dans {target}"))
        })?;
        match value {
            Value::Raw(raw) => out.push_str(raw),
            Value::Text(text) => out.push_str(&format.escape(text)),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

enum Format {
    Json,
    Toml,
    Java,
    Plain,
}

impl Format {
    fn of(target: &str) -> Self {
        let extension = Path::new(target)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        match extension {
            "json" | "mcmeta" => Self::Json,
            "toml" => Self::Toml,
            "java" | "kt" | "gradle" => Self::Java,
            _ => Self::Plain,
        }
    }

    fn escape(&self, value: &str) -> String {
        match self {
            // Chaîne JSON sans les guillemets englobants.
            Self::Json => {
                let quoted = serde_json::Value::String(value.to_string()).to_string();
                quoted[1..quoted.len() - 1].to_string()
            }
            Self::Toml | Self::Java => {
                let mut out = String::with_capacity(value.len());
                for c in value.chars() {
                    match c {
                        '\\' => out.push_str("\\\\"),
                        '"' => out.push_str("\\\""),
                        '\n' => out.push_str("\\n"),
                        '\r' => {}
                        '\t' => out.push_str("\\t"),
                        c if c.is_control() => {}
                        c => out.push(c),
                    }
                }
                out
            }
            Self::Plain => value.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_text_is_escaped_per_format() {
        let mut vars = Vars::new();
        vars.insert("name", Value::Text("Dragon \"Realms\"\nv2".into()));
        vars.insert("expr", Value::Raw("Identifier.of(MOD_ID, path)".into()));
        assert_eq!(
            render("\"{{name}}\"", &vars, "a.json").unwrap(),
            "\"Dragon \\\"Realms\\\"\\nv2\""
        );
        assert_eq!(
            render("name=\"{{name}}\"", &vars, "mods.toml").unwrap(),
            "name=\"Dragon \\\"Realms\\\"\\nv2\""
        );
        assert_eq!(
            render("return {{expr}};", &vars, "Main.java").unwrap(),
            "return Identifier.of(MOD_ID, path);"
        );
    }

    #[test]
    fn unknown_placeholder_is_refused() {
        assert!(render("{{nope}}", &Vars::new(), "a.txt").is_err());
        assert!(render("{{open", &Vars::new(), "a.txt").is_err());
    }

    #[test]
    fn every_template_id_resolves() {
        for id in TEMPLATE_IDS {
            assert!(files(id).unwrap().len() > COMMON.len());
        }
        assert!(files("quilt").is_err());
    }
}
