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

const FABRIC: &[TemplateFile] = &[
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
    text(
        "src/main/java/{{package_path}}/{{main_class}}.java",
        include_str!("files/fabric/Main.java"),
    ),
    text(
        "src/main/java/{{package_path}}/registry/ModItems.java",
        include_str!("files/fabric/ModItems.java"),
    ),
    text(
        "src/main/java/{{package_path}}/registry/ModBlocks.java",
        include_str!("files/fabric/ModBlocks.java"),
    ),
];

const FORGE_1_20: &[TemplateFile] = &[
    text(
        "settings.gradle",
        include_str!("files/forge-1.20/settings.gradle"),
    ),
    text(
        "build.gradle",
        include_str!("files/forge-1.20/build.gradle"),
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
    text(
        "src/main/java/{{package_path}}/{{main_class}}.java",
        include_str!("files/forge-1.20/Main.java"),
    ),
    text(
        "src/main/java/{{package_path}}/registry/ModItems.java",
        include_str!("files/forge-1.20/ModItems.java"),
    ),
    text(
        "src/main/java/{{package_path}}/registry/ModBlocks.java",
        include_str!("files/forge-1.20/ModBlocks.java"),
    ),
];

const NEOFORGE_1_21: &[TemplateFile] = &[
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
    text(
        "src/main/resources/META-INF/neoforge.mods.toml",
        include_str!("files/neoforge-1.21/neoforge.mods.toml"),
    ),
    text(
        "src/main/java/{{package_path}}/{{main_class}}.java",
        include_str!("files/neoforge-1.21/Main.java"),
    ),
    text(
        "src/main/java/{{package_path}}/registry/ModItems.java",
        include_str!("files/neoforge-1.21/ModItems.java"),
    ),
    text(
        "src/main/java/{{package_path}}/registry/ModBlocks.java",
        include_str!("files/neoforge-1.21/ModBlocks.java"),
    ),
];

/// Ids de template connus (référencés par les profils).
#[cfg(test)]
pub const TEMPLATE_IDS: &[&str] = &["fabric", "forge-1.20", "neoforge-1.21"];

/// Fichiers d'un template, fichiers communs compris.
pub fn files(template: &str) -> AppResult<Vec<&'static TemplateFile>> {
    let specific = match template {
        "fabric" => FABRIC,
        "forge-1.20" => FORGE_1_20,
        "neoforge-1.21" => NEOFORGE_1_21,
        other => return Err(AppError::not_found(format!("template inconnu : {other}"))),
    };
    Ok(COMMON.iter().chain(specific.iter()).collect())
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
