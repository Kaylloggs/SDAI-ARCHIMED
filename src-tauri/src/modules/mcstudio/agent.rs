//! Agent IA de Mod Studio : l'IA (Claude, Antigravity, Codex…) travaille dans une copie
//! de travail du projet ; Mod Studio compare, la personne relit et choisit ce qui entre
//! dans le vrai projet (ADR 0006).
//!
//! - Copie : `<données>/modules/mcstudio/work/<projet>/` (sans builds, caches, `.git`,
//!   `.mcstudio`), et `work/<projet>.base.json` : l'empreinte de chaque fichier au moment où
//!   il a été copié. L'agent ne voit pas ce fichier.
//! - Une modification de l'agent = fichier de la copie différent de son empreinte de base.
//!   Un conflit = le fichier du projet a lui aussi changé depuis.
//! - Appliquer : point de restauration, copie vers le projet, suppressions à la Corbeille.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::content::{self, GenContext};
use super::fsutil::{self, walk_files};
use super::profiles::{DataFormat, Profile};
use super::snapshots;
use super::types::{
    ApplyOutcome, BlockSound, ChangeKind, LoaderId, ProjectMeta, SnapshotKind, WorkChange, WorkInfo,
};

/// Texte montré dans la relecture au-delà duquel on n'affiche plus le diff.
const MAX_DIFF_BYTES: u64 = 512 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
struct Base {
    /// Chemin relatif → empreinte SHA-256 du fichier du projet copié.
    files: BTreeMap<String, String>,
}

pub struct Workspaces {
    dir: PathBuf,
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn hash_file(path: &Path) -> Option<String> {
    std::fs::read(path).ok().map(|bytes| digest(&bytes))
}

/// Fichiers d'un dossier, relatifs, hors builds, caches, `.git` et `.mcstudio`.
fn tree(root: &Path) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    walk_files(root, &mut |file| {
        if let Ok(relative) = file.strip_prefix(root) {
            out.insert(relative.to_string_lossy().replace('\\', "/"));
        }
    });
    out
}

fn io(action: &str, error: std::io::Error) -> AppError {
    AppError::new(AppErrorCode::Io, format!("{action} : {error}"))
}

impl Workspaces {
    pub fn new(module_dir: &Path) -> Self {
        Self {
            dir: module_dir.join("work"),
        }
    }

    fn work(&self, project_id: &str) -> AppResult<PathBuf> {
        if project_id.is_empty()
            || !project_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(AppError::invalid("Projet inconnu."));
        }
        Ok(self.dir.join(project_id))
    }

    fn base_path(&self, project_id: &str) -> AppResult<PathBuf> {
        self.work(project_id)?;
        Ok(self.dir.join(format!("{project_id}.base.json")))
    }

    fn load_base(&self, project_id: &str) -> AppResult<Option<Base>> {
        let path = self.base_path(project_id)?;
        match std::fs::read(&path) {
            Ok(raw) => Ok(serde_json::from_slice(&raw).ok()),
            Err(_) => Ok(None),
        }
    }

    fn save_base(&self, project_id: &str, base: &Base) -> AppResult<()> {
        fsutil::write_atomic(&self.base_path(project_id)?, &serde_json::to_vec(base)?)
    }

    /// Copie de travail prête et à jour : créée au besoin ; les fichiers que l'agent n'a
    /// pas touchés suivent le projet (modifications faites entre-temps dans l'éditeur).
    pub fn prepare(&self, root: &Path, project_id: &str) -> AppResult<WorkInfo> {
        let work = self.work(project_id)?;
        let mut base = match self.load_base(project_id)? {
            Some(base) if work.is_dir() => base,
            _ => {
                let _ = std::fs::remove_dir_all(&work);
                std::fs::create_dir_all(&work).map_err(|e| io("Copie de travail", e))?;
                Base::default()
            }
        };

        let project_files = tree(root);
        let work_files = tree(&work);
        for path in project_files.union(&work_files) {
            let in_project = root.join(path);
            let in_work = work.join(path);
            let project_hash = hash_file(&in_project);
            let work_hash = hash_file(&in_work);
            let base_hash = base.files.get(path).cloned();
            // Fichier que l'agent a modifié : on n'y touche pas.
            let agent_changed = work_hash != base_hash;
            if agent_changed {
                continue;
            }
            match project_hash {
                Some(hash) if Some(&hash) != base_hash.as_ref() => {
                    if let Some(parent) = in_work.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::copy(&in_project, &in_work).map_err(|e| io("Copie de travail", e))?;
                    base.files.insert(path.clone(), hash);
                }
                Some(_) => {}
                None => {
                    // Supprimé du projet et intact dans la copie : il disparaît aussi.
                    let _ = std::fs::remove_file(&in_work);
                    base.files.remove(path);
                }
            }
        }
        self.save_base(project_id, &base)?;
        let pending = self.changes(root, project_id)?.len() as u32;
        Ok(WorkInfo {
            path: work.display().to_string(),
            files: tree(&work).len() as u32,
            pending,
        })
    }

    /// Ce que l'agent a créé, modifié ou supprimé dans sa copie.
    pub fn changes(&self, root: &Path, project_id: &str) -> AppResult<Vec<WorkChange>> {
        let work = self.work(project_id)?;
        let Some(base) = self.load_base(project_id)? else {
            return Ok(Vec::new());
        };
        let work_files = tree(&work);
        let paths: BTreeSet<&String> = work_files.iter().chain(base.files.keys()).collect();
        let mut changes = Vec::new();
        for path in paths {
            let in_work = work.join(path);
            let in_project = root.join(path);
            let work_hash = hash_file(&in_work);
            let base_hash = base.files.get(path);
            if work_hash.as_ref() == base_hash {
                continue;
            }
            let kind = match (&work_hash, base_hash) {
                (Some(_), None) => ChangeKind::Added,
                (Some(_), Some(_)) => ChangeKind::Modified,
                (None, _) => ChangeKind::Deleted,
            };
            let project_hash = hash_file(&in_project);
            let conflict = project_hash.as_ref() != base_hash;
            let text = |file: &Path| -> Option<String> {
                let size = std::fs::metadata(file).ok()?.len();
                if size > MAX_DIFF_BYTES {
                    return None;
                }
                let bytes = std::fs::read(file).ok()?;
                if bytes[..bytes.len().min(8192)].contains(&0) {
                    return None;
                }
                String::from_utf8(bytes).ok()
            };
            let after = if kind == ChangeKind::Deleted {
                None
            } else {
                text(&in_work)
            };
            let before = text(&in_project);
            let binary = (kind != ChangeKind::Deleted && after.is_none())
                || (kind == ChangeKind::Deleted && before.is_none() && in_project.exists());
            changes.push(WorkChange {
                path: path.clone(),
                kind,
                conflict,
                binary,
                before,
                after,
                work_path: in_work.display().to_string(),
            });
        }
        Ok(changes)
    }

    /// Fait entrer dans le projet les modifications choisies, après un point de restauration.
    pub fn apply(
        &self,
        root: &Path,
        project_id: &str,
        paths: &[String],
    ) -> AppResult<ApplyOutcome> {
        let wanted: BTreeSet<&String> = paths.iter().collect();
        let chosen: Vec<WorkChange> = self
            .changes(root, project_id)?
            .into_iter()
            .filter(|change| wanted.contains(&change.path))
            .collect();
        if chosen.is_empty() {
            return Err(AppError::invalid(
                "Aucune de ces modifications n'est en attente : rechargez la liste.",
            ));
        }
        let touched: Vec<String> = chosen.iter().map(|c| c.path.clone()).collect();
        let snapshot = snapshots::create(
            root,
            &format!(
                "Avant l'IA : {} fichier{}",
                touched.len(),
                if touched.len() > 1 { "s" } else { "" }
            ),
            SnapshotKind::Ai,
            &touched,
        )?;

        let work = self.work(project_id)?;
        let mut base = self.load_base(project_id)?.unwrap_or_default();
        let mut applied = Vec::new();
        for change in &chosen {
            let target = super::files::resolve(root, &change.path)?;
            match change.kind {
                ChangeKind::Added | ChangeKind::Modified => {
                    let bytes = std::fs::read(work.join(&change.path))?;
                    fsutil::write_atomic(&target, &bytes)?;
                    base.files.insert(change.path.clone(), digest(&bytes));
                }
                ChangeKind::Deleted => {
                    if target.is_file() {
                        trash::delete(&target).map_err(|e| {
                            AppError::new(
                                AppErrorCode::Io,
                                format!("{} n'a pas pu être mis à la Corbeille : {e}", change.path),
                            )
                        })?;
                    }
                    base.files.remove(&change.path);
                }
            }
            applied.push(change.path.clone());
        }
        self.save_base(project_id, &base)?;
        crate::core::audit::record(
            "mcstudio.ai_apply",
            &format!("{} ({})", root.display(), applied.join(", ")),
            "applied",
            "user",
        );
        Ok(ApplyOutcome { snapshot, applied })
    }

    /// Rejette des modifications : la copie reprend la version du projet.
    pub fn discard(&self, root: &Path, project_id: &str, paths: &[String]) -> AppResult<()> {
        let work = self.work(project_id)?;
        let mut base = self.load_base(project_id)?.unwrap_or_default();
        let wanted: BTreeSet<&String> = paths.iter().collect();
        for change in self.changes(root, project_id)? {
            if !wanted.contains(&change.path) {
                continue;
            }
            let in_work = work.join(&change.path);
            let in_project = root.join(&change.path);
            if in_project.is_file() {
                if let Some(parent) = in_work.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(&in_project, &in_work)?;
                if let Some(hash) = hash_file(&in_project) {
                    base.files.insert(change.path.clone(), hash);
                }
            } else {
                let _ = std::fs::remove_file(&in_work);
                base.files.remove(&change.path);
            }
        }
        self.save_base(project_id, &base)
    }

    /// Repart d'une copie neuve du projet (toutes les modifications en attente sont perdues).
    pub fn reset(&self, root: &Path, project_id: &str) -> AppResult<WorkInfo> {
        let work = self.work(project_id)?;
        let _ = std::fs::remove_dir_all(&work);
        let _ = std::fs::remove_file(self.base_path(project_id)?);
        self.prepare(root, project_id)
    }
}

/// Règles de données propres au format de la version.
fn data_rules(format: DataFormat, mod_id: &str) -> Vec<String> {
    let plural = format < DataFormat::V1_21;
    let mut rules = vec![if plural {
        format!("Dossiers de données au pluriel : data/{mod_id}/recipes/, loot_tables/blocks/, data/minecraft/tags/blocks/ (jamais recipe/, loot_table/ ni tags/block/, ignorés dans cette version).")
    } else {
        format!("Dossiers de données au singulier : data/{mod_id}/recipe/, loot_table/blocks/, data/minecraft/tags/block/ (jamais recipes/, loot_tables/ ni tags/blocks/, ignorés depuis 1.21).")
    }];
    rules.push(match format {
        DataFormat::Legacy => "Recettes : ingrédient {\"item\": \"ns:id\"} ou {\"tag\": \"ns:tag\"} ; résultat {\"item\": \"ns:id\", \"count\": n} ; résultat de cuisson : texte \"ns:id\".".to_string(),
        DataFormat::V1_20_5 | DataFormat::V1_21 => "Recettes : ingrédient {\"item\": \"ns:id\"} ou {\"tag\": \"ns:tag\"} ; résultat {\"id\": \"ns:id\", \"count\": n}, y compris pour la cuisson.".to_string(),
        DataFormat::V1_21_2 | DataFormat::V1_21_4 => "Recettes : ingrédient en texte \"ns:id\" (ou \"#ns:tag\") ; résultat {\"id\": \"ns:id\", \"count\": n}, y compris pour la cuisson.".to_string(),
    });
    if format >= DataFormat::V1_21_4 {
        rules.push(format!("Chaque objet (et objet de bloc) a une définition assets/{mod_id}/items/<id>.json : {{\"model\": {{\"type\": \"minecraft:model\", \"model\": \"{mod_id}:item/<id>\"}}}}. Sans elle, il est invisible."));
    }
    rules
}

/// Consignes passées à l'agent (prompt système, ou tête du premier message).
pub fn instructions(profile: &Profile, meta: &ProjectMeta, root: &Path) -> String {
    let v = &meta.versions;
    let loader = match v.loader {
        LoaderId::Fabric => format!(
            "Fabric Loader {}{}{}",
            v.loader_version,
            v.api_version
                .as_deref()
                .map(|api| format!(", Fabric API {api}"))
                .unwrap_or_default(),
            match v.mappings_version.as_deref() {
                Some(yarn) => format!(", mappings Yarn {yarn}"),
                None if profile.mappings != "yarn" => {
                    " (jeu non obfusqué : noms officiels de Mojang, pas de Yarn ; Item.Properties, ResourceKey, BuiltInRegistries, Identifier.fromNamespaceAndPath)".to_string()
                }
                None => String::new(),
            }
        ),
        LoaderId::Forge if profile.dialect == super::profiles::Dialect::Forge114 => format!(
            "Forge {} (méthodes et champs aux noms officiels de Mojang, classes aux noms MCP : ItemGroup, Block.Properties)",
            v.loader_version
        ),
        LoaderId::Forge => format!(
            "Forge {} (mappings officielles de Mojang)",
            v.loader_version
        ),
        LoaderId::Neoforge => format!(
            "NeoForge {} (mappings officielles de Mojang)",
            v.loader_version
        ),
    };
    let ctx: GenContext = super::projects::gen_context(profile, meta, root);
    let item = content::java::item_field(profile.dialect, "RUBY", "ruby");
    let block = content::java::block_field(
        profile.dialect,
        "RUBY_BLOCK",
        "ruby_block",
        "5.0f",
        "6.0f",
        BlockSound::Metal,
    );
    let tab = content::java::creative_entry(profile.dialect, "RUBY");
    let package_dir = meta.package.replace('.', "/");
    let mut lines = vec![
        "Tu es l'assistant de code de SDAI ARCHIMED Mod Studio. Tu travailles dans une COPIE DE TRAVAIL d'un mod Minecraft : le dossier courant. Mod Studio montrera ensuite chaque fichier modifié à la personne, qui choisira ce qui entre dans le vrai projet. Ne travaille que dans ce dossier.".to_string(),
        String::new(),
        "## Projet".to_string(),
        format!("- Mod « {} » : Mod ID `{}`, package `{}`, classe principale `{}`.", meta.name, meta.mod_id, meta.package, meta.main_class),
        format!("- Minecraft {} avec {}.", v.minecraft, loader),
        format!("- Java {} (bytecode), Gradle {} avec le plugin {}.", profile.java_release.unwrap_or(profile.java), v.gradle, v.plugin),
        format!("- Registres : src/main/java/{package_dir}/registry/ModItems.java et ModBlocks.java."),
        String::new(),
        "## Code de cette version (à imiter exactement)".to_string(),
        format!("- Objet, au-dessus de `// @mcstudio:items` dans ModItems : `{item}`"),
        format!("- Bloc, au-dessus de `// @mcstudio:blocks` dans ModBlocks : `{block}`"),
        match tab {
            Some(entry) => format!("- Onglet créatif, au-dessus de `// @mcstudio:creative-tab` : `{entry}`"),
            None => "- Onglet créatif : réglé dans les propriétés de l'objet (pas de marqueur d'onglet dans cette version).".to_string(),
        },
        "- Garde les marqueurs `// @mcstudio:*` : Mod Studio s'en sert pour ajouter du contenu.".to_string(),
        "- N'utilise que des classes et méthodes qui existent dans cette version et ces mappings ; en cas de doute, lis le code existant du projet.".to_string(),
        String::new(),
        "## Ressources".to_string(),
        format!("- Textures : assets/{}/textures/item/<id>.png et textures/block/<id>.png (16×16). Ne dessine pas de PNG toi-même : garde ou crée une texture provisoire, la personne la générera dans l'onglet Textures.", meta.mod_id),
        format!("- Modèles : assets/{0}/models/item/<id>.json, models/block/<id>.json, états : assets/{0}/blockstates/<id>.json.", meta.mod_id),
        format!("- Noms affichés : assets/{0}/lang/en_us.json et fr_fr.json (`item.{0}.<id>`, `block.{0}.<id>`).", meta.mod_id),
    ];
    lines.extend(
        data_rules(ctx.data_format, &meta.mod_id)
            .into_iter()
            .map(|rule| format!("- {rule}")),
    );
    lines.extend([
        String::new(),
        "## Règles".to_string(),
        "- Ne modifie build.gradle, settings.gradle, gradle.properties ni le wrapper Gradle que si la demande l'exige, et dis-le clairement.".to_string(),
        "- Pour vérifier, lance la compilation dans ce dossier : `gradlew.bat build` sous Windows (`./gradlew build` sinon). La première télécharge Minecraft.".to_string(),
        "- Réponds en français, simplement. Termine par la liste des fichiers créés, modifiés ou supprimés, et ce qu'il reste à faire.".to_string(),
    ]);
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::projects::tests as fixtures;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mcstudio-agent-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn project(root: &Path) {
        for (path, text) in [
            ("build.gradle", "plugins {}\n"),
            ("src/main/java/A.java", "class A {}\n"),
            ("src/main/resources/assets/dm/lang/en_us.json", "{}\n"),
            ("build/libs/old.jar", "jar"),
        ] {
            let file = root.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, text).unwrap();
        }
    }

    #[test]
    fn the_agent_works_on_a_copy_and_changes_are_reviewed_then_applied() {
        let module = temp("module");
        let root = temp("project");
        project(&root);
        let spaces = Workspaces::new(&module);

        let info = spaces.prepare(&root, "p1").unwrap();
        let work = PathBuf::from(&info.path);
        assert_eq!(info.files, 3, "sans build/");
        assert_eq!(info.pending, 0);
        assert!(!work.join("build").exists());

        // L'agent modifie, crée et supprime dans sa copie.
        std::fs::write(work.join("src/main/java/A.java"), "class A { int x; }\n").unwrap();
        std::fs::write(work.join("src/main/java/B.java"), "class B {}\n").unwrap();
        std::fs::remove_file(work.join("build.gradle")).unwrap();
        // L'agent compile dans sa copie : ses sorties ne sont pas des modifications.
        std::fs::create_dir_all(work.join("build/classes")).unwrap();
        std::fs::write(work.join("build/classes/A.class"), "x").unwrap();

        let changes = spaces.changes(&root, "p1").unwrap();
        let summary: Vec<(&str, ChangeKind, bool)> = changes
            .iter()
            .map(|c| (c.path.as_str(), c.kind, c.conflict))
            .collect();
        assert_eq!(
            summary,
            [
                ("build.gradle", ChangeKind::Deleted, false),
                ("src/main/java/A.java", ChangeKind::Modified, false),
                ("src/main/java/B.java", ChangeKind::Added, false),
            ]
        );
        let a = &changes[1];
        assert_eq!(a.before.as_deref(), Some("class A {}\n"));
        assert_eq!(a.after.as_deref(), Some("class A { int x; }\n"));

        // Le projet réel n'a pas bougé.
        assert_eq!(
            std::fs::read_to_string(root.join("src/main/java/A.java")).unwrap(),
            "class A {}\n"
        );

        // Rejet de la suppression : la copie reprend build.gradle.
        spaces
            .discard(&root, "p1", &["build.gradle".into()])
            .unwrap();
        assert!(work.join("build.gradle").is_file());

        // Application de A et B, après un point de restauration.
        let outcome = spaces
            .apply(
                &root,
                "p1",
                &["src/main/java/A.java".into(), "src/main/java/B.java".into()],
            )
            .unwrap();
        assert_eq!(outcome.applied.len(), 2);
        assert_eq!(outcome.snapshot.kind, SnapshotKind::Ai);
        assert_eq!(
            std::fs::read_to_string(root.join("src/main/java/B.java")).unwrap(),
            "class B {}\n"
        );
        assert!(spaces.changes(&root, "p1").unwrap().is_empty());

        // Le point de restauration annule l'application.
        snapshots::restore(&root, &outcome.snapshot.id).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("src/main/java/A.java")).unwrap(),
            "class A {}\n"
        );
        assert!(!root.join("src/main/java/B.java").exists());

        let _ = std::fs::remove_dir_all(&module);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn project_edits_flow_into_the_copy_and_conflicts_are_flagged() {
        let module = temp("module2");
        let root = temp("project2");
        project(&root);
        let spaces = Workspaces::new(&module);
        let work = PathBuf::from(spaces.prepare(&root, "p2").unwrap().path);

        // La personne modifie le projet dans l'éditeur : la copie suit au prochain tour.
        std::fs::write(root.join("build.gradle"), "plugins { id 'java' }\n").unwrap();
        std::fs::write(root.join("src/main/java/C.java"), "class C {}\n").unwrap();
        spaces.prepare(&root, "p2").unwrap();
        assert_eq!(
            std::fs::read_to_string(work.join("build.gradle")).unwrap(),
            "plugins { id 'java' }\n"
        );
        assert!(work.join("src/main/java/C.java").is_file());
        assert!(spaces.changes(&root, "p2").unwrap().is_empty());

        // Les deux côtés modifient A : conflit signalé, et la copie de l'agent est gardée.
        std::fs::write(
            work.join("src/main/java/A.java"),
            "class A { /* agent */ }\n",
        )
        .unwrap();
        std::fs::write(
            root.join("src/main/java/A.java"),
            "class A { /* humain */ }\n",
        )
        .unwrap();
        spaces.prepare(&root, "p2").unwrap();
        let changes = spaces.changes(&root, "p2").unwrap();
        assert_eq!(changes.len(), 1);
        assert!(changes[0].conflict);
        assert_eq!(
            changes[0].before.as_deref(),
            Some("class A { /* humain */ }\n")
        );

        // Repartir de zéro.
        let fresh = spaces.reset(&root, "p2").unwrap();
        assert_eq!(fresh.pending, 0);
        assert!(spaces.work("../x").is_err());
        let _ = std::fs::remove_dir_all(&module);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn instructions_carry_the_exact_idioms_of_each_profile() {
        for profile in crate::modules::mcstudio::profiles::load_all(&temp("profiles")) {
            let meta = ProjectMeta {
                format: 1,
                id: "p".into(),
                name: "Dragon Realms".into(),
                mod_id: "dm".into(),
                package: "com.alix.dm".into(),
                main_class: "DragonRealms".into(),
                author: "Alix".into(),
                description: String::new(),
                mod_version: "1.0.0".into(),
                license: crate::modules::mcstudio::types::License::Mit,
                versions: fixtures::versions(&profile),
                java_home: None,
                created_at: String::new(),
            };
            let text = instructions(&profile, &meta, Path::new("/tmp/x"));
            assert!(
                text.contains(&format!("Minecraft {}", meta.versions.minecraft)),
                "{}",
                profile.id
            );
            assert!(text.contains("@mcstudio:items"), "{}", profile.id);
            let singular = profile.data_format >= DataFormat::V1_21;
            assert_eq!(text.contains("au singulier"), singular, "{}", profile.id);
            if profile.data_format >= DataFormat::V1_21_4 {
                assert!(text.contains("assets/dm/items/"), "{}", profile.id);
            }
        }
    }
}
