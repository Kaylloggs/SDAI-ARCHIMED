//! Projets d'Image Maker sur le disque : `<données>/modules/image-maker/projects/<id>/`
//! - `project.json` : versions (arbre), références, derniers réglages ; chemins relatifs ;
//! - `images/<version>.<ext>` : chaque version, jamais réécrite ;
//! - `thumbs/<version>.png` : vignettes de l'historique ;
//! - `masks/<version>.png` : masque utilisé par une édition.
//!
//! Rien n'est effacé sans demande : supprimer une version ou un projet passe par la Corbeille.

use std::path::{Path, PathBuf};

use serde_json::Value;
use std::sync::{Mutex, MutexGuard};

use crate::core::imaging::http::sniff_mime;
use crate::core::{AppError, AppResult};

use super::local;
use super::types::{ImageNode, NodeKind, Project, ProjectSummary};

pub struct Store {
    root: PathBuf,
    /// Une écriture de `project.json` à la fois (plusieurs tâches peuvent finir ensemble).
    writing: Mutex<()>,
}

/// Ce qui décrit une nouvelle version (hors fichier).
#[derive(Debug, Clone)]
pub struct NewNode {
    pub parent: Option<String>,
    pub kind: NodeKind,
    pub label: String,
    pub prompt: Option<String>,
    pub negative_prompt: Option<String>,
    pub provider: Option<crate::core::imaging::ProviderId>,
    pub model: Option<String>,
    pub params: Value,
    pub mask_png: Option<Vec<u8>>,
    pub references: Vec<String>,
    pub usage: Option<crate::core::imaging::ImageUsage>,
    pub note: Option<String>,
}

impl NewNode {
    pub fn local(parent: &str, kind: NodeKind, label: impl Into<String>, params: Value) -> Self {
        Self {
            parent: Some(parent.to_string()),
            kind,
            label: label.into(),
            prompt: None,
            negative_prompt: None,
            provider: None,
            model: None,
            params,
            mask_png: None,
            references: Vec::new(),
            usage: None,
            note: None,
        }
    }
}

pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn short_id(prefix: &str) -> String {
    format!("{prefix}-{}", &uuid::Uuid::new_v4().simple().to_string()[..10])
}

fn extension(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        _ => "png",
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

impl Store {
    pub fn new(module_dir: &Path) -> Self {
        Self {
            root: module_dir.join("projects"),
            writing: Mutex::new(()),
        }
    }

    fn dir(&self, project: &str) -> AppResult<PathBuf> {
        let safe = project.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if project.is_empty() || !safe {
            return Err(AppError::invalid("Identifiant de projet invalide."));
        }
        Ok(self.root.join(project))
    }

    /// Chemins relatifs du fichier → absolus pour le frontend.
    fn absolute(&self, dir: &Path, mut project: Project) -> Project {
        let abs = |rel: &str| dir.join(rel).to_string_lossy().to_string();
        for node in &mut project.nodes {
            node.file = abs(&node.file);
            node.thumb = abs(&node.thumb);
            node.mask = node.mask.as_deref().map(abs);
        }
        project
    }

    fn relative(dir: &Path, mut project: Project) -> Project {
        let rel = |path: &str| {
            Path::new(path)
                .strip_prefix(dir)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| path.to_string())
        };
        for node in &mut project.nodes {
            node.file = rel(&node.file);
            node.thumb = rel(&node.thumb);
            node.mask = node.mask.as_deref().map(rel);
        }
        project
    }

    fn read(&self, id: &str) -> AppResult<Project> {
        let dir = self.dir(id)?;
        let raw = std::fs::read(dir.join("project.json"))
            .map_err(|_| AppError::not_found("Projet introuvable : il a peut-être été supprimé."))?;
        let project: Project = serde_json::from_slice(&raw)
            .map_err(|e| AppError::internal(format!("project.json illisible : {e}")))?;
        Ok(self.absolute(&dir, project))
    }

    fn write(&self, project: &Project) -> AppResult<()> {
        let dir = self.dir(&project.id)?;
        let stored = Self::relative(&dir, project.clone());
        write_atomic(&dir.join("project.json"), &serde_json::to_vec_pretty(&stored)?)
    }

    pub fn list(&self) -> Vec<ProjectSummary> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return out;
        };
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().to_string();
            if let Ok(project) = self.read(&id) {
                let cover = project
                    .current
                    .as_ref()
                    .and_then(|c| project.nodes.iter().find(|n| &n.id == c))
                    .or(project.nodes.last())
                    .map(|n| n.thumb.clone());
                out.push(ProjectSummary {
                    id: project.id,
                    name: project.name,
                    updated_at: project.updated_at,
                    images: project.nodes.len() as u32,
                    cover,
                });
            }
        }
        out.sort_by_key(|summary| std::cmp::Reverse(summary.updated_at));
        out
    }

    fn lock(&self) -> MutexGuard<'_, ()> {
        self.writing.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn create(&self, name: &str) -> AppResult<Project> {
        let name = name.trim();
        let project = Project {
            id: short_id("p"),
            name: if name.is_empty() { "Sans titre".into() } else { name.chars().take(80).collect() },
            created_at: now(),
            updated_at: now(),
            nodes: Vec::new(),
            current: None,
            references: Vec::new(),
            ai_settings: Value::Object(Default::default()),
        };
        let _guard = self.lock();
        self.write(&project)?;
        Ok(project)
    }

    pub fn load(&self, id: &str) -> AppResult<Project> {
        self.read(id)
    }

    /// Modifie un projet sous verrou et l'enregistre.
    pub fn update<T>(&self, id: &str, change: impl FnOnce(&mut Project) -> AppResult<T>) -> AppResult<(Project, T)> {
        let _guard = self.lock();
        let mut project = self.read(id)?;
        let result = change(&mut project)?;
        project.updated_at = now();
        self.write(&project)?;
        Ok((project, result))
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let dir = self.dir(id)?;
        let _guard = self.lock();
        if dir.exists() {
            trash::delete(&dir).map_err(|e| AppError::internal(format!("mise à la Corbeille impossible : {e}")))?;
        }
        Ok(())
    }

    pub fn node(&self, project: &Project, node: &str) -> AppResult<ImageNode> {
        project
            .nodes
            .iter()
            .find(|n| n.id == node)
            .cloned()
            .ok_or_else(|| AppError::not_found("Version introuvable dans ce projet."))
    }

    pub fn bytes(&self, node: &ImageNode) -> AppResult<Vec<u8>> {
        std::fs::read(&node.file).map_err(|_| AppError::not_found("Fichier de la version introuvable."))
    }

    pub fn rgba(&self, node: &ImageNode) -> AppResult<image::RgbaImage> {
        Ok(local::decode(&self.bytes(node)?)?.to_rgba8())
    }

    /// Ajoute une version : image (octets tels quels, jamais recompressés), vignette, masque.
    pub fn add_node(&self, project_id: &str, bytes: &[u8], new: NewNode) -> AppResult<(Project, ImageNode)> {
        let image = local::decode(bytes)?.to_rgba8();
        let mime = sniff_mime(bytes).to_string();
        let id = short_id("n");
        let dir = self.dir(project_id)?;
        // Vérifié avant d'écrire, pour ne pas laisser de fichier orphelin (revérifié sous verrou).
        if let Some(parent) = &new.parent {
            if !self.read(project_id)?.nodes.iter().any(|n| &n.id == parent) {
                return Err(AppError::not_found("Version d'origine introuvable."));
            }
        }
        let file = dir.join("images").join(format!("{id}.{}", extension(&mime)));
        let thumb = dir.join("thumbs").join(format!("{id}.png"));
        write_atomic(&file, bytes)?;
        write_atomic(&thumb, &local::thumbnail(&image, 320)?)?;
        let mask = match &new.mask_png {
            Some(png) => {
                let path = dir.join("masks").join(format!("{id}.png"));
                write_atomic(&path, png)?;
                Some(path.to_string_lossy().to_string())
            }
            None => None,
        };
        let node = ImageNode {
            id: id.clone(),
            parent: new.parent,
            kind: new.kind,
            label: new.label,
            file: file.to_string_lossy().to_string(),
            thumb: thumb.to_string_lossy().to_string(),
            width: image.width(),
            height: image.height(),
            mime,
            created_at: now(),
            prompt: new.prompt,
            negative_prompt: new.negative_prompt,
            provider: new.provider,
            model: new.model,
            params: new.params,
            mask,
            references: new.references,
            usage: new.usage,
            note: new.note,
            favorite: false,
        };
        let added = node.clone();
        let (project, ()) = self
            .update(project_id, move |project| {
                if let Some(parent) = &added.parent {
                    if !project.nodes.iter().any(|n| &n.id == parent) {
                        return Err(AppError::not_found("Version d'origine introuvable."));
                    }
                }
                project.current = Some(added.id.clone());
                project.nodes.push(added);
                Ok(())
            })?;
        Ok((project, node))
    }

    /// Met une version à la Corbeille ; ses descendantes se rattachent à son parent.
    pub fn delete_node(&self, project_id: &str, node_id: &str) -> AppResult<Project> {
        let (project, removed) = self
            .update(project_id, |project| {
                let index = project
                    .nodes
                    .iter()
                    .position(|n| n.id == node_id)
                    .ok_or_else(|| AppError::not_found("Version introuvable."))?;
                let removed = project.nodes.remove(index);
                for node in &mut project.nodes {
                    if node.parent.as_deref() == Some(node_id) {
                        node.parent = removed.parent.clone();
                    }
                }
                project.references.retain(|r| r != node_id);
                if project.current.as_deref() == Some(node_id) {
                    project.current = removed.parent.clone().or_else(|| project.nodes.last().map(|n| n.id.clone()));
                }
                Ok(removed)
            })?;
        for path in [Some(removed.file), Some(removed.thumb), removed.mask].into_iter().flatten() {
            if Path::new(&path).exists() {
                let _ = trash::delete(&path);
            }
        }
        Ok(project)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        local::png(&image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]))).unwrap()
    }

    #[test]
    fn versions_form_a_tree_and_survive_a_reload() {
        let dir = std::env::temp_dir().join(format!("image-maker-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::new(&dir);
        let project = store.create("  Affiche  ").unwrap();
        assert_eq!(project.name, "Affiche");
        let (_, original) = store
            .add_node(&project.id, &png(8, 6), NewNode { parent: None, ..NewNode::local("x", NodeKind::Import, "Import", Value::Null) })
            .unwrap();
        let (_, cropped) = store
            .add_node(&project.id, &png(4, 3), NewNode::local(&original.id, NodeKind::Crop, "Recadrage", serde_json::json!({"x":0})))
            .unwrap();
        let reloaded = store.load(&project.id).unwrap();
        assert_eq!(reloaded.nodes.len(), 2);
        assert_eq!(reloaded.current.as_deref(), Some(cropped.id.as_str()));
        assert!(Path::new(&reloaded.nodes[1].file).is_absolute());
        let raw = std::fs::read_to_string(dir.join("projects").join(&project.id).join("project.json")).unwrap();
        assert!(raw.contains("\"images/"), "chemins relatifs sur le disque : {raw}");
        assert_eq!((reloaded.nodes[1].width, reloaded.nodes[1].height), (4, 3));
        assert_eq!(store.list()[0].images, 2);
        // Parent inconnu : refusé, rien n'est ajouté.
        assert!(store.add_node(&project.id, &png(2, 2), NewNode::local("n-nope", NodeKind::Crop, "x", Value::Null)).is_err());
        assert!(store.load("../etc").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
