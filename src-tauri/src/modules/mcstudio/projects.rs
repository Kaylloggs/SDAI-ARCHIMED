//! Projets Mod Studio : création depuis un template, liste, ouverture, duplication,
//! retrait, statistiques.
//!
//! Chaque projet est un dossier autonome ; son identité vit dans `.mcstudio/project.json`.
//! Le registre (`projects.json` dans les données du module) ne retient que les chemins :
//! le dossier fait foi, et un projet déplacé apparaît « introuvable » sans rien perdre.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::core::{AppError, AppResult};

use super::content::{self, GenContext};
use super::fsutil::{copy_project, walk_files, write_atomic};
use super::profiles::{self, next_minor, Dialect, Profile};
use super::templates::{self, Content, Value, Vars};
use super::textures;
use super::types::{
    BlockRequest, BlockSound, BuildRecord, CreateProjectRequest, ItemRequest, License, LoaderId,
    ProjectHealth, ProjectMeta, ProjectStats, ProjectSummary, RecipeRequest, ResolvedVersions,
};

pub const META_FORMAT: u32 = 1;
const RESERVED_IDS: &[&str] = &[
    "minecraft",
    "java",
    "forge",
    "neoforge",
    "fabric",
    "fabricloader",
    "fabric_api",
    "mcp",
    "realms",
    "c",
    "common",
    "quilt",
];
const JAVA_KEYWORDS: &[&str] = &[
    "abstract",
    "assert",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extends",
    "final",
    "finally",
    "float",
    "for",
    "goto",
    "if",
    "implements",
    "import",
    "instanceof",
    "int",
    "interface",
    "long",
    "native",
    "new",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "strictfp",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "try",
    "void",
    "volatile",
    "while",
    "true",
    "false",
    "null",
    "var",
    "record",
    "yield",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    id: String,
    path: String,
}

pub struct Projects {
    registry_file: PathBuf,
    lock: Mutex<()>,
}

pub fn meta_path(root: &Path) -> PathBuf {
    root.join(".mcstudio").join("project.json")
}

pub fn read_meta(root: &Path) -> AppResult<ProjectMeta> {
    let raw = std::fs::read_to_string(meta_path(root)).map_err(|e| {
        AppError::not_found(format!("{} illisible : {e}", meta_path(root).display()))
    })?;
    serde_json::from_str(&raw).map_err(|e| {
        AppError::invalid(format!(
            "project.json invalide ({e}) : le projet semble corrompu."
        ))
    })
}

/// Réécrit `.mcstudio/project.json` (portage).
pub fn save_meta(root: &Path, meta: &ProjectMeta) -> AppResult<()> {
    write_meta(root, meta)
}

fn write_meta(root: &Path, meta: &ProjectMeta) -> AppResult<()> {
    let mut body = serde_json::to_string_pretty(meta)?;
    body.push('\n');
    write_atomic(&meta_path(root), body.as_bytes())
}

fn display(path: &Path) -> String {
    let text = path.display().to_string();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

impl Projects {
    pub fn new(module_dir: &Path) -> Self {
        Self {
            registry_file: module_dir.join("projects.json"),
            lock: Mutex::new(()),
        }
    }

    fn entries(&self) -> Vec<RegistryEntry> {
        std::fs::read_to_string(&self.registry_file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn save(&self, entries: &[RegistryEntry]) -> AppResult<()> {
        let body = serde_json::to_string_pretty(entries)?;
        write_atomic(&self.registry_file, body.as_bytes())
    }

    fn with_registry<T>(
        &self,
        change: impl FnOnce(&mut Vec<RegistryEntry>) -> AppResult<T>,
    ) -> AppResult<T> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| AppError::internal("registre des projets verrouillé"))?;
        let mut entries = self.entries();
        let result = change(&mut entries)?;
        self.save(&entries)?;
        Ok(result)
    }

    /// Dossier d'un projet enregistré.
    pub fn root(&self, id: &str) -> AppResult<PathBuf> {
        self.entries()
            .into_iter()
            .find(|entry| entry.id == id)
            .map(|entry| PathBuf::from(entry.path))
            .ok_or_else(|| AppError::not_found("Projet inconnu : il a été retiré de la liste."))
    }

    pub fn list(&self) -> Vec<ProjectSummary> {
        self.entries()
            .into_iter()
            .map(|entry| summarize(&entry.id, Path::new(&entry.path)))
            .collect()
    }

    pub fn summary(&self, id: &str) -> AppResult<ProjectSummary> {
        Ok(summarize(id, &self.root(id)?))
    }

    fn register(&self, meta: &ProjectMeta, root: &Path) -> AppResult<()> {
        let path = display(root);
        self.with_registry(|entries| {
            entries.retain(|entry| entry.id != meta.id && entry.path != path);
            entries.insert(
                0,
                RegistryEntry {
                    id: meta.id.clone(),
                    path,
                },
            );
            Ok(())
        })
    }

    /// Crée le projet sur disque, puis l'ajoute à la liste.
    pub fn create(
        &self,
        profiles: &[Profile],
        request: &CreateProjectRequest,
    ) -> AppResult<ProjectSummary> {
        let profile = profiles::find(profiles, &request.versions.profile_id)?;
        if profile.loader != request.versions.loader || !profile.covers(&request.versions.minecraft)
        {
            return Err(AppError::invalid(
                "Versions incohérentes avec le profil choisi : relancez la résolution.",
            ));
        }
        validate(request)?;

        let parent = PathBuf::from(&request.parent_dir);
        if request.parent_dir.trim().is_empty() || !parent.is_absolute() {
            return Err(AppError::invalid(
                "Choisissez le dossier où créer le projet.",
            ));
        }
        std::fs::create_dir_all(&parent)?;
        let root = parent.join(&request.mod_id);
        let existed = root.exists();
        if existed
            && std::fs::read_dir(&root)
                .map(|mut d| d.next().is_some())
                .unwrap_or(true)
        {
            return Err(AppError::invalid(format!(
                "{} existe déjà et n'est pas vide : choisissez un autre dossier ou un autre Mod ID.",
                display(&root)
            )));
        }

        let meta = ProjectMeta {
            format: META_FORMAT,
            id: uuid::Uuid::new_v4().to_string(),
            name: request.name.trim().to_string(),
            mod_id: request.mod_id.clone(),
            package: request.package.clone(),
            main_class: request.main_class.clone(),
            author: if request.author.trim().is_empty() {
                "Unknown".into()
            } else {
                request.author.trim().into()
            },
            description: request.description.trim().to_string(),
            mod_version: "1.0.0".into(),
            license: request.license,
            versions: request.versions.clone(),
            java_home: request.java_home.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        // Tout est rendu en mémoire avant la première écriture.
        let files = render_project(profile, &meta)?;
        let outcome = (|| -> AppResult<()> {
            std::fs::create_dir_all(&root)?;
            for (relative, bytes, executable) in &files {
                let path = root.join(relative);
                write_atomic(&path, bytes)?;
                if *executable {
                    make_executable(&path)?;
                }
            }
            write_atomic(
                &root.join(format!(
                    "src/main/resources/assets/{}/icon.png",
                    meta.mod_id
                )),
                &textures::icon(&meta.mod_id).png()?,
            )?;
            if meta.license == License::Mit {
                write_atomic(&root.join("LICENSE"), mit_license(&meta.author).as_bytes())?;
            }
            write_meta(&root, &meta)?;
            if request.with_example {
                add_example_content(&gen_context(profile, &meta, &root))?;
            }
            Ok(())
        })();

        if let Err(error) = outcome {
            // Seul un dossier créé à l'instant (vide avant) est retiré.
            if !existed {
                let _ = std::fs::remove_dir_all(&root);
            }
            return Err(error);
        }
        self.register(&meta, &root)?;
        Ok(summarize(&meta.id, &root))
    }

    /// Ajoute un projet Mod Studio existant (dossier contenant `.mcstudio/project.json`).
    pub fn open(&self, path: &Path) -> AppResult<ProjectSummary> {
        if !meta_path(path).is_file() {
            return Err(AppError::invalid(
                "Ce dossier n'est pas un projet Mod Studio (pas de .mcstudio/project.json) : importez-le.",
            ));
        }
        let meta = read_meta(path)?;
        self.register(&meta, path)?;
        Ok(summarize(&meta.id, path))
    }

    /// Adopte un projet existant : seul `.mcstudio/project.json` est écrit.
    pub fn adopt(&self, root: &Path, meta: &ProjectMeta) -> AppResult<ProjectSummary> {
        if meta_path(root).exists() {
            return Err(AppError::invalid(
                "Ce dossier est déjà un projet Mod Studio.",
            ));
        }
        write_meta(root, meta)?;
        self.register(meta, root)?;
        crate::core::audit::record(
            "mcstudio.project_import",
            &display(root),
            "imported",
            "user",
        );
        Ok(summarize(&meta.id, root))
    }

    /// Copie le projet à côté de l'original, sans builds ni caches.
    pub fn duplicate(&self, id: &str) -> AppResult<ProjectSummary> {
        let root = self.root(id)?;
        let mut meta = read_meta(&root)?;
        let parent = root
            .parent()
            .ok_or_else(|| AppError::invalid("Projet à la racine d'un disque."))?;
        let base = root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| meta.mod_id.clone());
        let target = (1..100)
            .map(|n| {
                parent.join(if n == 1 {
                    format!("{base}-copie")
                } else {
                    format!("{base}-copie-{n}")
                })
            })
            .find(|candidate| !candidate.exists())
            .ok_or_else(|| AppError::invalid("Trop de copies de ce projet."))?;

        copy_project(&root, &target)?;
        meta.id = uuid::Uuid::new_v4().to_string();
        meta.name = format!("{} (copie)", meta.name);
        meta.created_at = chrono::Utc::now().to_rfc3339();
        write_meta(&target, &meta)?;
        self.register(&meta, &target)?;
        Ok(summarize(&meta.id, &target))
    }

    /// Retire le projet de la liste ; avec `delete_files`, son dossier part à la Corbeille.
    pub fn remove(&self, id: &str, delete_files: bool) -> AppResult<()> {
        let root = self.root(id)?;
        if delete_files && root.exists() {
            if !meta_path(&root).is_file() {
                return Err(AppError::invalid(
                    "Ce dossier n'a pas de project.json : suppression refusée par prudence.",
                ));
            }
            trash::delete(&root).map_err(|e| {
                AppError::new(
                    crate::core::error::AppErrorCode::Io,
                    format!("Mise à la Corbeille impossible (fichier ouvert par Gradle ou le jeu ?) : {e}"),
                )
            })?;
            crate::core::audit::record(
                "mcstudio.trash_project",
                &display(&root),
                "trashed",
                "user",
            );
        }
        self.with_registry(|entries| {
            entries.retain(|entry| entry.id != id);
            Ok(())
        })
    }
}

fn make_executable(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub fn gen_context(profile: &Profile, meta: &ProjectMeta, root: &Path) -> GenContext {
    GenContext {
        root: root.to_path_buf(),
        mod_id: meta.mod_id.clone(),
        package: meta.package.clone(),
        dialect: profile.dialect,
        data_format: profile.data_format,
    }
}

/// Remplace la valeur d'une clé `clé=valeur` d'un fichier `.properties`.
fn set_property(source: &str, key: &str, value: &str) -> AppResult<String> {
    let mut found = false;
    let out: Vec<String> = source
        .lines()
        .map(|line| match line.split_once('=') {
            Some((name, _)) if name.trim() == key => {
                found = true;
                format!("{key}={value}")
            }
            _ => line.to_string(),
        })
        .collect();
    if !found {
        return Err(AppError::invalid(format!(
            "La clé « {key} » est absente de gradle.properties : changez la version à la main dans ce fichier."
        )));
    }
    Ok(out.join("\n") + "\n")
}

/// Change les versions du loader, des mappings ou de l'API d'un projet existant
/// (même Minecraft, même profil). Tout est vérifié avant la première écriture.
pub fn apply_versions(
    root: &Path,
    meta: &mut ProjectMeta,
    versions: ResolvedVersions,
) -> AppResult<()> {
    if versions.profile_id != meta.versions.profile_id
        || versions.minecraft != meta.versions.minecraft
    {
        return Err(AppError::invalid(
            "Changer de version de Minecraft ou de loader est un portage : il n'est pas encore géré ici.",
        ));
    }
    let properties_path = root.join("gradle.properties");
    let mut properties = std::fs::read_to_string(&properties_path)?;
    let mut writes: Vec<(PathBuf, String)> = Vec::new();
    match versions.loader {
        LoaderId::Fabric => {
            properties = set_property(&properties, "loader_version", &versions.loader_version)?;
            if let Some(yarn) = &versions.mappings_version {
                properties = set_property(&properties, "yarn_mappings", yarn)?;
            }
            if let Some(api) = &versions.api_version {
                properties = set_property(&properties, "fabric_version", api)?;
            }
            let mod_json = root.join("src/main/resources/fabric.mod.json");
            if let Ok(source) = std::fs::read_to_string(&mod_json) {
                let re = Regex::new(r#""fabricloader"\s*:\s*">=[^"]*""#)
                    .map_err(|e| AppError::internal(e.to_string()))?;
                let updated = re.replace(
                    &source,
                    format!(r#""fabricloader": ">={}""#, versions.loader_version).as_str(),
                );
                writes.push((mod_json, updated.into_owned()));
            }
        }
        LoaderId::Forge => {
            properties = set_property(&properties, "forge_version", &versions.loader_version)?
        }
        LoaderId::Neoforge => {
            properties = set_property(&properties, "neo_version", &versions.loader_version)?
        }
    }
    writes.push((properties_path, properties));
    for (path, body) in writes {
        write_atomic(&path, body.as_bytes())?;
    }
    meta.versions = versions;
    write_meta(root, meta)
}

/// Un objet, un bloc, et les recettes qui passent de l'un à l'autre.
pub fn add_example_content(ctx: &GenContext) -> AppResult<()> {
    let gem = format!("{}:example_gem", ctx.mod_id);
    let block = format!("{}:example_block", ctx.mod_id);
    content::add_item(
        ctx,
        &ItemRequest {
            id: "example_gem".into(),
            name_en: "Example Gem".into(),
            name_fr: "Gemme d'exemple".into(),
        },
    )?;
    content::add_block(
        ctx,
        &BlockRequest {
            id: "example_block".into(),
            name_en: "Block of Example Gem".into(),
            name_fr: "Bloc de gemmes d'exemple".into(),
            hardness: 3.0,
            resistance: 6.0,
            sound: BlockSound::Metal,
        },
    )?;
    content::add_recipe(
        ctx,
        &RecipeRequest::Shaped {
            id: "example_block".into(),
            pattern: vec!["###".into(), "###".into(), "###".into()],
            key: [("#".to_string(), gem.clone())].into_iter().collect(),
            result: block.clone(),
            count: 1,
        },
    )?;
    content::add_recipe(
        ctx,
        &RecipeRequest::Shapeless {
            id: "example_gem_from_block".into(),
            ingredients: vec![block],
            result: gem,
            count: 9,
        },
    )?;
    Ok(())
}

/// Valeurs des marqueurs de template pour un projet.
pub fn template_vars(profile: &Profile, meta: &ProjectMeta) -> Vars {
    let versions = &meta.versions;
    let loader_major = match versions.loader {
        LoaderId::Forge => versions
            .loader_version
            .split('.')
            .next()
            .unwrap_or("")
            .to_string(),
        LoaderId::Neoforge => versions
            .loader_version
            .split('.')
            .take(2)
            .collect::<Vec<_>>()
            .join("."),
        LoaderId::Fabric => versions.loader_version.clone(),
    };
    let identifier_expr = match profile.dialect {
        Dialect::FabricYarn1193 | Dialect::FabricYarn120 => "new Identifier(MOD_ID, path)",
        // 1.21 : le constructeur d'`Identifier` devient privé.
        Dialect::FabricYarn121 | Dialect::FabricYarn1212 => "Identifier.of(MOD_ID, path)",
        _ => "",
    };
    let raw = |v: &str| Value::Raw(v.to_string());
    let mut vars = Vars::new();
    vars.insert("mod_id", raw(&meta.mod_id));
    vars.insert("mod_name", Value::Text(meta.name.clone()));
    vars.insert("description", Value::Text(meta.description.clone()));
    vars.insert("author", Value::Text(meta.author.clone()));
    vars.insert("license", raw(meta.license.spdx()));
    vars.insert("mod_version", raw(&meta.mod_version));
    vars.insert("package", raw(&meta.package));
    vars.insert("package_path", raw(&meta.package.replace('.', "/")));
    vars.insert("main_class", raw(&meta.main_class));
    vars.insert("mc_version", raw(&versions.minecraft));
    vars.insert("mc_next_minor", raw(&next_minor(&versions.minecraft)));
    vars.insert("loader_version", raw(&versions.loader_version));
    vars.insert("loader_major", raw(&loader_major));
    vars.insert("loader_label", raw(versions.loader.label()));
    vars.insert(
        "mappings_version",
        raw(versions.mappings_version.as_deref().unwrap_or("")),
    );
    vars.insert(
        "api_version",
        raw(versions.api_version.as_deref().unwrap_or("")),
    );
    vars.insert("java_version", raw(&versions.java.to_string()));
    // Bytecode visé (`--release`) et constante Gradle (`JavaVersion.VERSION_1_8`, `VERSION_17`).
    let release = profile.release();
    vars.insert("java_release", raw(&release.to_string()));
    vars.insert(
        "java_enum",
        raw(&if release <= 8 {
            format!("1_{release}")
        } else {
            release.to_string()
        }),
    );
    vars.insert("gradle_version", raw(&versions.gradle));
    vars.insert("plugin_version", raw(&versions.plugin));
    vars.insert("identifier_expr", raw(identifier_expr));
    vars.insert("pack_format", raw(&profile.pack_format.to_string()));
    // Valeurs propres au profil (chemins d'import qui changent d'une version à l'autre).
    for (key, value) in &profile.vars {
        if let Some(known) = PROFILE_VARS.iter().find(|k| **k == key.as_str()) {
            vars.insert(known, raw(value));
        }
    }
    vars
}

/// Marqueurs qu'un profil peut définir dans sa table `[vars]`.
const PROFILE_VARS: &[&str] = &["registry_object"];

/// Fichiers du template rendus : (chemin relatif, contenu, exécutable).
pub fn render_project(
    profile: &Profile,
    meta: &ProjectMeta,
) -> AppResult<Vec<(String, Vec<u8>, bool)>> {
    let vars = template_vars(profile, meta);
    templates::files(&profile.template)?
        .into_iter()
        .map(|file| {
            let path = templates::render(file.path, &vars, "path")?;
            let bytes = match file.content {
                Content::Text(body) => templates::render(body, &vars, &path)?.into_bytes(),
                Content::Binary(bytes) => bytes.to_vec(),
            };
            Ok((path, bytes, file.executable))
        })
        .collect()
}

fn mit_license(author: &str) -> String {
    format!(
        "MIT License\n\nCopyright (c) {year} {author}\n\n\
Permission is hereby granted, free of charge, to any person obtaining a copy\n\
of this software and associated documentation files (the \"Software\"), to deal\n\
in the Software without restriction, including without limitation the rights\n\
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n\
copies of the Software, and to permit persons to whom the Software is\n\
furnished to do so, subject to the following conditions:\n\n\
The above copyright notice and this permission notice shall be included in all\n\
copies or substantial portions of the Software.\n\n\
THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n\
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n\
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n\
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n\
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n\
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n\
SOFTWARE.\n",
        year = chrono::Utc::now().format("%Y"),
    )
}

fn matches(pattern: &str, value: &str) -> bool {
    Regex::new(pattern)
        .map(|re| re.is_match(value))
        .unwrap_or(false)
}

/// Règles d'identifiants communes à Fabric, Forge et NeoForge (la plus stricte gagne :
/// Forge refuse le tiret que Fabric accepte).
pub fn validate_mod_id(mod_id: &str) -> AppResult<()> {
    if !matches(r"^[a-z][a-z0-9_]{1,63}$", mod_id) {
        return Err(AppError::invalid(
            "Mod ID invalide : 2 à 64 caractères, minuscules, chiffres et _ uniquement, en commençant par une lettre.",
        ));
    }
    if RESERVED_IDS.contains(&mod_id) {
        return Err(AppError::invalid(format!(
            "« {mod_id} » est réservé par Minecraft ou un loader."
        )));
    }
    Ok(())
}

fn validate(request: &CreateProjectRequest) -> AppResult<()> {
    let name = request.name.trim();
    if name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control) {
        return Err(AppError::invalid(
            "Nom du mod : 1 à 64 caractères, sur une ligne.",
        ));
    }
    validate_mod_id(&request.mod_id)?;
    let segments_ok = request
        .package
        .split('.')
        .all(|segment| !JAVA_KEYWORDS.contains(&segment));
    if !matches(r"^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$", &request.package) || !segments_ok {
        return Err(AppError::invalid(
            "Package Java invalide : au moins deux segments en minuscules (ex. com.pseudo.monmod), sans mot réservé Java.",
        ));
    }
    if !matches(r"^[A-Z][A-Za-z0-9_]{0,63}$", &request.main_class)
        || ["ModItems", "ModBlocks"].contains(&request.main_class.as_str())
    {
        return Err(AppError::invalid("Classe principale invalide : commence par une majuscule, lettres et chiffres (ex. DragonRealms)."));
    }
    if request.author.chars().count() > 64 || request.description.chars().count() > 500 {
        return Err(AppError::invalid(
            "Auteur (64 caractères) ou description (500 caractères) trop longs.",
        ));
    }
    Ok(())
}

fn last_build(root: &Path) -> Option<BuildRecord> {
    let raw = std::fs::read_to_string(root.join(".mcstudio").join("builds.json")).ok()?;
    serde_json::from_str::<Vec<BuildRecord>>(&raw).ok()?.pop()
}

fn summarize(id: &str, root: &Path) -> ProjectSummary {
    let path = display(root);
    if !root.is_dir() {
        return ProjectSummary {
            id: id.into(),
            path,
            health: ProjectHealth::Missing,
            meta: None,
            updated_at: None,
            last_build: None,
        };
    }
    let meta = read_meta(root).ok();
    let mut latest = None;
    walk_files(&root.join("src"), &mut |file| {
        if let Ok(modified) = file.metadata().and_then(|m| m.modified()) {
            if latest.is_none_or(|current| modified > current) {
                latest = Some(modified);
            }
        }
    });
    ProjectSummary {
        id: id.into(),
        path,
        health: if meta.is_some() {
            ProjectHealth::Ok
        } else {
            ProjectHealth::Corrupt
        },
        meta,
        updated_at: latest.map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339()),
        last_build: last_build(root),
    }
}

/// Inventaire du projet, compté sur les fichiers réels.
pub fn stats(root: &Path, mod_id: &str) -> ProjectStats {
    let mut stats = ProjectStats::default();
    let src = root.join("src");
    walk_files(&src, &mut |file| {
        let relative = file
            .strip_prefix(&src)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");
        let extension = file.extension().and_then(|e| e.to_str()).unwrap_or("");
        match extension {
            "java" => stats.java_classes += 1,
            "kt" => stats.kotlin_classes += 1,
            _ => {}
        }
        let in_assets = relative.contains("/resources/assets/");
        let in_data = relative.contains("/resources/data/");
        if in_assets {
            stats.assets += 1;
            if relative.contains("/textures/") && extension == "png" {
                stats.textures += 1;
            }
            if relative.contains("/models/") && extension == "json" {
                stats.models += 1;
            }
            if relative.contains("/lang/") && extension == "json" {
                stats.lang_files += 1;
            }
            if extension == "ogg" {
                stats.sounds += 1;
            }
        }
        if in_data && extension == "json" {
            if relative.contains("/recipe/") || relative.contains("/recipes/") {
                stats.recipes += 1;
            }
            if relative.contains("/loot_table/") || relative.contains("/loot_tables/") {
                stats.loot_tables += 1;
            }
        }
    });

    let lang = src.join(format!("main/resources/assets/{mod_id}/lang/en_us.json"));
    if let Some(keys) = std::fs::read_to_string(lang).ok().and_then(|raw| {
        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw).ok()
    }) {
        for key in keys.keys() {
            let rest = |kind: &str| {
                key.strip_prefix(&format!("{kind}.{mod_id}."))
                    .is_some_and(|r| !r.contains('.'))
            };
            if rest("item") {
                stats.items += 1;
            } else if rest("block") {
                stats.blocks += 1;
            } else if rest("entity") {
                stats.entities += 1;
            }
        }
    }
    stats
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::modules::mcstudio::types::ResolvedVersions;

    pub fn versions(profile: &Profile) -> ResolvedVersions {
        let (loader_version, mappings, api) = match profile.loader {
            LoaderId::Fabric => (
                "0.16.14".to_string(),
                Some(format!("{}+build.1", profile.minecraft_max)),
                Some(format!("0.100.0+{}", profile.minecraft_max)),
            ),
            LoaderId::Forge => ("47.4.0".to_string(), None, None),
            LoaderId::Neoforge => ("21.1.172".to_string(), None, None),
        };
        ResolvedVersions {
            profile_id: profile.id.clone(),
            loader: profile.loader,
            minecraft: profile.minecraft_max.clone(),
            loader_version,
            mappings_version: mappings,
            api_version: api,
            java: profile.java,
            java_max: profile.java_max,
            gradle: profile.gradle.clone(),
            plugin: profile.plugin.clone(),
            offline: false,
        }
    }

    pub fn request(profile: &Profile, parent: &Path) -> CreateProjectRequest {
        CreateProjectRequest {
            name: "Test \"Mod\"".into(),
            mod_id: "testmod".into(),
            package: "com.example.testmod".into(),
            main_class: "TestMod".into(),
            author: "Mod Studio".into(),
            description: "Pipeline check:\n1 item, 1 block, 1 recipe.".into(),
            parent_dir: parent.display().to_string(),
            versions: versions(profile),
            license: License::Mit,
            with_example: true,
            java_home: None,
        }
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mcstudio-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn every_profile_creates_a_complete_project() {
        let profiles = profiles::load_all(&temp("no-profiles"));
        for profile in &profiles {
            let base = temp(&format!("create-{}", profile.id));
            let projects = Projects::new(&base.join("module"));
            let summary = projects
                .create(&profiles, &request(profile, &base))
                .unwrap();
            let root = PathBuf::from(&summary.path);
            assert_eq!(summary.health, ProjectHealth::Ok, "{}", profile.id);

            // Aucun marqueur oublié, JSON et TOML valides partout.
            walk_files(&root, &mut |file| {
                let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
                if [
                    "java",
                    "json",
                    "toml",
                    "gradle",
                    "properties",
                    "md",
                    "mcmeta",
                ]
                .contains(&ext)
                {
                    let text = std::fs::read_to_string(file).unwrap();
                    assert!(!text.contains("{{"), "{}: marqueur restant", file.display());
                    if ext == "json" || ext == "mcmeta" {
                        // fabric.mod.json garde `${version}`, remplacé par Gradle : JSON valide quand même.
                        serde_json::from_str::<serde_json::Value>(&text)
                            .unwrap_or_else(|e| panic!("{}: {e}", file.display()));
                    }
                    if ext == "toml" {
                        text.parse::<toml::Table>()
                            .unwrap_or_else(|e| panic!("{}: {e}", file.display()));
                    }
                }
            });

            let java = root.join("src/main/java/com/example/testmod");
            assert!(java.join("TestMod.java").is_file());
            let items = std::fs::read_to_string(java.join("registry/ModItems.java")).unwrap();
            assert!(items.contains("EXAMPLE_GEM"));
            assert!(
                std::fs::read_to_string(java.join("registry/ModBlocks.java"))
                    .unwrap()
                    .contains("EXAMPLE_BLOCK")
            );
            assert!(root.join("gradle/wrapper/gradle-wrapper.jar").is_file());
            assert!(root.join("LICENSE").is_file());

            // Le projet généré passe sa propre vérification, au format de sa version.
            let report = crate::modules::mcstudio::validator::validate(
                &root,
                "testmod",
                profile.data_format,
            );
            assert!(
                report.issues.is_empty(),
                "{} : {:#?}",
                profile.id,
                report.issues
            );
            let props =
                std::fs::read_to_string(root.join("gradle/wrapper/gradle-wrapper.properties"))
                    .unwrap();
            assert!(props.contains(&format!("gradle-{}-bin.zip", profile.gradle)));

            let data = root.join("src/main/resources/data/testmod");
            use profiles::DataFormat;
            let (recipe_dir, loot_dir) = if profile.data_format < DataFormat::V1_21 {
                ("recipes", "loot_tables")
            } else {
                ("recipe", "loot_table")
            };
            let recipe: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(data.join(recipe_dir).join("example_block.json")).unwrap(),
            )
            .unwrap();
            let result_key = if profile.data_format == DataFormat::Legacy {
                "item"
            } else {
                "id"
            };
            assert_eq!(
                recipe["result"][result_key], "testmod:example_block",
                "{}",
                profile.id
            );
            // Ingrédients en texte à partir de 1.21.2.
            let ingredient = &recipe["key"]["#"];
            if profile.data_format >= DataFormat::V1_21_2 {
                assert_eq!(ingredient, "testmod:example_gem", "{}", profile.id);
            } else {
                assert_eq!(ingredient["item"], "testmod:example_gem", "{}", profile.id);
            }
            let definition = root.join("src/main/resources/assets/testmod/items/example_gem.json");
            assert_eq!(
                definition.is_file(),
                profile.data_format >= DataFormat::V1_21_4,
                "{}",
                profile.id
            );
            // Onglet créatif : dans les réglages avant 1.19.3, par événement ensuite.
            let items_src = std::fs::read_to_string(java.join("registry/ModItems.java")).unwrap();
            let blocks_src = std::fs::read_to_string(java.join("registry/ModBlocks.java")).unwrap();
            let in_settings =
                items_src.contains(".group(ItemGroup.MISC)") || items_src.contains(".tab(");
            assert_eq!(
                !items_src.contains("ModBlocks.EXAMPLE_BLOCK"),
                in_settings,
                "{}",
                profile.id
            );
            // Les marqueurs restent en place pour les ajouts suivants.
            assert!(
                items_src.contains("// @mcstudio:items")
                    && blocks_src.contains("// @mcstudio:blocks")
            );
            assert!(data
                .join(loot_dir)
                .join("blocks/example_block.json")
                .is_file());
            assert!(root
                .join("src/main/resources/assets/testmod/textures/item/example_gem.png")
                .is_file());

            let stats = stats(&root, "testmod");
            assert_eq!(
                (stats.items, stats.blocks, stats.recipes, stats.loot_tables),
                (1, 1, 2, 1)
            );
            assert_eq!(stats.java_classes, 3);

            // Second projet identique : refusé, l'original intact.
            assert!(projects
                .create(&profiles, &request(profile, &base))
                .is_err());
            assert!(java.join("TestMod.java").is_file());
            // MCSTUDIO_KEEP_TEST_OUTPUT=1 garde les projets générés pour les inspecter ou les compiler.
            if std::env::var_os("MCSTUDIO_KEEP_TEST_OUTPUT").is_none() {
                let _ = std::fs::remove_dir_all(&base);
            } else {
                println!("projet gardé : {}", root.display());
            }
        }
    }

    #[test]
    fn duplicate_open_and_remove_keep_files_safe() {
        let profiles = profiles::load_all(&temp("no-profiles-2"));
        let profile = profiles::find(&profiles, "fabric-1.21").unwrap();
        let base = temp("lifecycle");
        let projects = Projects::new(&base.join("module"));
        let mut req = request(profile, &base);
        req.with_example = false;
        let original = projects.create(&profiles, &req).unwrap();
        std::fs::create_dir_all(Path::new(&original.path).join("build/libs")).unwrap();

        let copy = projects.duplicate(&original.id).unwrap();
        assert_ne!(copy.id, original.id);
        assert!(copy.path.ends_with("testmod-copie"));
        assert!(!Path::new(&copy.path).join("build").exists());
        assert_eq!(projects.list().len(), 2);

        // Retirer de la liste ne touche pas au disque ; rouvrir le retrouve.
        projects.remove(&copy.id, false).unwrap();
        assert!(Path::new(&copy.path).exists());
        assert_eq!(projects.open(Path::new(&copy.path)).unwrap().id, copy.id);
        assert!(projects.open(&base).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn loader_versions_can_be_changed_after_creation() {
        let profiles = profiles::load_all(&temp("no-profiles-4"));
        let base = temp("versions");
        let projects = Projects::new(&base.join("module"));
        for id in ["fabric-1.21", "forge-1.20"] {
            let profile = profiles::find(&profiles, id).unwrap();
            let mut req = request(profile, &base.join(id));
            req.with_example = false;
            let summary = projects.create(&profiles, &req).unwrap();
            let root = PathBuf::from(&summary.path);
            let mut meta = read_meta(&root).unwrap();
            let mut next = meta.versions.clone();
            next.loader_version = "9.9.9".into();
            if profile.loader == LoaderId::Fabric {
                next.api_version = Some("0.200.0+1.21.1".into());
            }
            apply_versions(&root, &mut meta, next.clone()).unwrap();
            let props = std::fs::read_to_string(root.join("gradle.properties")).unwrap();
            let key = if profile.loader == LoaderId::Fabric {
                "loader_version=9.9.9"
            } else {
                "forge_version=9.9.9"
            };
            assert!(props.contains(key), "{id}");
            assert_eq!(read_meta(&root).unwrap().versions.loader_version, "9.9.9");
            if profile.loader == LoaderId::Fabric {
                assert!(props.contains("fabric_version=0.200.0+1.21.1"));
                let mod_json =
                    std::fs::read_to_string(root.join("src/main/resources/fabric.mod.json"))
                        .unwrap();
                assert!(mod_json.contains(r#""fabricloader": ">=9.9.9""#));
            }
            // Autre Minecraft : refusé (c'est un portage).
            let mut other = next.clone();
            other.minecraft = "1.20.1".into();
            assert!(apply_versions(&root, &mut meta, other).is_err());
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn identifiers_are_validated() {
        let profiles = profiles::load_all(&temp("no-profiles-3"));
        let profile = profiles::find(&profiles, "forge-1.20").unwrap();
        let base = temp("invalid");
        let mut req = request(profile, &base);
        for (field, value) in [
            ("mod_id", "Dragon Realms"),
            ("mod_id", "minecraft"),
            ("mod_id", "dragon-realms"),
            ("package", "monmod"),
            ("package", "com.class.x"),
            ("main_class", "dragon"),
        ] {
            let mut r = req.clone();
            match field {
                "mod_id" => r.mod_id = value.into(),
                "package" => r.package = value.into(),
                _ => r.main_class = value.into(),
            }
            assert!(validate(&r).is_err(), "{field}={value}");
        }
        req.mod_id = "dragonrealms".into();
        assert!(validate(&req).is_ok());
        let _ = std::fs::remove_dir_all(&base);
    }
}
