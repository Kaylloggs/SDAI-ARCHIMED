//! Service d'Image Maker : connexions aux fournisseurs, projets et versions, opérations
//! locales, file des tâches IA, export. Les commandes Tauri (`commands.rs`) ne font que
//! relayer ; le travail disque et image passe hors du fil asynchrone (guidelines §10).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::core::error::AppErrorCode;
use crate::core::imaging::http::MAX_IMAGE_BYTES;
use crate::core::imaging::{
    is_cancelled, wait_or_cancel, Cancel, CapabilitySource, ImageRequest, ImageUsage, Imaging, InputImage,
    ModelList, PriceLine, PromptSuggestion, ProviderId, ProviderModel, ProviderStatus,
};
use crate::core::{AppError, AppResult};

use super::jobs::{finished, Queue};
use super::local;
use super::pipeline::{self, Finish, Inputs};
use super::store::{now, NewNode, Store};
use super::types::{
    AiOperation, AiSettings, BatchOutcome, DownloadedImage, ExportRequest, ExportResult, FailureKind,
    ImageMakerSettings, Job, JobStatus, LocalOperation, NodeKind, Project, ProjectSummary,
};

/// Ce que le service signale au frontend (événements `image-maker:*`).
pub enum Event {
    Job(Box<Job>),
    Project(Box<Project>),
}

pub type Notify = Arc<dyn Fn(Event) + Send + Sync>;

/// Durée pendant laquelle une liste de modèles est reprise sans redemander au fournisseur.
const MODELS_TTL: Duration = Duration::from_secs(600);
/// Délai au-delà duquel `wait_jobs` rend la main (les tâches, elles, continuent).
const WAIT_LIMIT: Duration = Duration::from_secs(20 * 60);
/// Au-delà, une image est réencodée avant l'envoi (voir `pipeline::sendable`).
const SEND_BYTES: usize = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"];

/// Ce qu'une tâche garde pour enregistrer ses résultats.
struct Plan {
    project_id: String,
    provider: ProviderId,
    model: String,
    prompt: Option<String>,
    negative_prompt: Option<String>,
    finish: Finish,
    kind: NodeKind,
    label: String,
    parent: Option<String>,
    references: Vec<String>,
    mask_png: Option<Vec<u8>>,
    params: Value,
}

pub struct ImageMaker {
    imaging: Imaging,
    store: Store,
    queue: Queue,
    settings: RwLock<ImageMakerSettings>,
    settings_path: PathBuf,
    models: tokio::sync::Mutex<HashMap<ProviderId, (Instant, ModelList)>>,
    notify: Notify,
}

impl ImageMaker {
    pub fn new(module_dir: &Path, notify: Notify) -> Self {
        Self::with_imaging(module_dir, Imaging::new(super::ID, module_dir), notify)
    }

    fn with_imaging(module_dir: &Path, imaging: Imaging, notify: Notify) -> Self {
        let settings_path = module_dir.join("settings.json");
        let settings: ImageMakerSettings = std::fs::read(&settings_path)
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default();
        imaging.set_higgsfield_models(settings.higgsfield_models.clone());
        Self {
            imaging,
            store: Store::new(module_dir),
            queue: Queue::new(settings.parallel_per_provider),
            settings: RwLock::new(settings),
            settings_path,
            models: tokio::sync::Mutex::new(HashMap::new()),
            notify,
        }
    }

    async fn blocking<T: Send + 'static>(
        self: &Arc<Self>,
        work: impl FnOnce(&ImageMaker) -> AppResult<T> + Send + 'static,
    ) -> AppResult<T> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || work(&this))
            .await
            .map_err(|e| AppError::internal(e.to_string()))?
    }

    fn emit_project(&self, project: &Project) {
        (self.notify)(Event::Project(Box::new(project.clone())));
    }

    // ── Réglages ────────────────────────────────────────────────────────────────────────

    pub fn settings(&self) -> ImageMakerSettings {
        self.settings.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub async fn save_settings(&self, mut settings: ImageMakerSettings) -> AppResult<ImageMakerSettings> {
        for preset in &settings.format_presets {
            if preset.name.trim().is_empty() {
                return Err(AppError::invalid("Chaque format a besoin d'un nom."));
            }
            if preset.width == 0 || preset.height == 0 || preset.width > local::MAX_SIDE || preset.height > local::MAX_SIDE {
                return Err(AppError::invalid(format!(
                    "« {} » : largeur et hauteur entre 1 et {} pixels.",
                    preset.name,
                    local::MAX_SIDE
                )));
            }
        }
        for preset in &mut settings.export_presets {
            if preset.name.trim().is_empty() || preset.naming.trim().is_empty() {
                return Err(AppError::invalid("Chaque préréglage d'export a besoin d'un nom et d'un modèle de nom de fichier."));
            }
            preset.quality = preset.quality.clamp(1, 100);
        }
        for model in &mut settings.higgsfield_models {
            if !valid_application(&model.id) {
                return Err(AppError::invalid(format!(
                    "« {} » n'est pas un identifiant d'application Higgsfield (ex. bytedance/seedream/v4/text-to-image).",
                    model.id
                )));
            }
            if model.extra.as_ref().is_some_and(|extra| !extra.is_object()) {
                return Err(AppError::invalid("Les arguments fixes d'un modèle Higgsfield forment un objet JSON."));
            }
            if model.name.trim().is_empty() {
                model.name = model.id.clone();
            }
            model.source = CapabilitySource::User;
        }
        settings.parallel_per_provider = settings.parallel_per_provider.clamp(1, 8);
        if let Some(dir) = self.settings_path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&self.settings_path, serde_json::to_vec_pretty(&settings)?)?;
        self.imaging.set_higgsfield_models(settings.higgsfield_models.clone());
        self.queue.set_parallel(settings.parallel_per_provider);
        self.models.lock().await.remove(&ProviderId::Higgsfield);
        *self.settings.write().unwrap_or_else(|e| e.into_inner()) = settings.clone();
        Ok(settings)
    }

    // ── Connexions ──────────────────────────────────────────────────────────────────────

    pub async fn statuses(&self, check: bool) -> Vec<ProviderStatus> {
        let tasks: Vec<_> = self
            .imaging
            .all()
            .iter()
            .cloned()
            .map(|provider| tokio::spawn(async move { provider.status(check).await }))
            .collect();
        let mut out = Vec::new();
        for task in tasks {
            if let Ok(status) = task.await {
                out.push(status);
            }
        }
        out
    }

    pub async fn set_key(&self, provider: ProviderId, key: &str) -> AppResult<ProviderStatus> {
        let status = self.imaging.provider(provider)?.set_key(key).await?;
        self.models.lock().await.remove(&provider);
        Ok(status)
    }

    pub async fn clear_key(&self, provider: ProviderId) -> AppResult<ProviderStatus> {
        let handle = self.imaging.provider(provider)?;
        handle.clear_key()?;
        self.models.lock().await.remove(&provider);
        Ok(handle.status(false).await)
    }

    pub async fn models(&self, provider: ProviderId, refresh: bool) -> AppResult<ModelList> {
        if !refresh {
            if let Some((at, list)) = self.models.lock().await.get(&provider) {
                if at.elapsed() < MODELS_TTL {
                    return Ok(list.clone());
                }
            }
        }
        let list = self.imaging.provider(provider)?.models().await?;
        if !list.offline {
            self.models.lock().await.insert(provider, (Instant::now(), list.clone()));
        }
        Ok(list)
    }

    /// Le modèle choisi, tel que le décrit son fournisseur (liste relue une fois s'il manque).
    pub async fn model(&self, provider: ProviderId, id: &str) -> AppResult<ProviderModel> {
        for refresh in [false, true] {
            let list = self.models(provider, refresh).await?;
            if let Some(model) = list.models.into_iter().find(|m| m.id == id) {
                return Ok(model);
            }
        }
        Err(AppError::not_found(format!(
            "Le modèle « {id} » n'est pas proposé par {} : choisissez-en un autre.",
            provider.label()
        )))
    }

    pub async fn pricing(&self, provider: ProviderId, model: &str) -> AppResult<Vec<PriceLine>> {
        self.imaging.provider(provider)?.pricing(model).await
    }

    /// Réécrit une description avec un modèle de texte du fournisseur (texte envoyé, pas d'image).
    pub async fn improve_prompt(&self, provider: ProviderId, prompt: &str, structured: bool) -> AppResult<PromptSuggestion> {
        if prompt.trim().is_empty() {
            return Err(AppError::invalid("Écrivez d'abord une idée, même courte."));
        }
        let instructions = if structured {
            STRUCTURED_INSTRUCTIONS
        } else {
            PROMPT_INSTRUCTIONS
        };
        self.imaging.provider(provider)?.improve_prompt(prompt.trim(), instructions).await
    }

    // ── Projets ─────────────────────────────────────────────────────────────────────────

    pub async fn list_projects(self: &Arc<Self>) -> AppResult<Vec<ProjectSummary>> {
        self.blocking(|s| Ok(s.store.list())).await
    }

    pub async fn create_project(self: &Arc<Self>, name: String) -> AppResult<Project> {
        self.blocking(move |s| s.store.create(&name)).await
    }

    pub async fn project(self: &Arc<Self>, id: String) -> AppResult<Project> {
        self.blocking(move |s| s.store.load(&id)).await
    }

    pub async fn delete_project(self: &Arc<Self>, id: String) -> AppResult<()> {
        self.blocking(move |s| s.store.delete(&id)).await
    }

    /// Change un projet sous verrou (nom, version affichée, favoris, références…).
    pub async fn change_project(
        self: &Arc<Self>,
        id: String,
        change: impl FnOnce(&mut Project) -> AppResult<()> + Send + 'static,
    ) -> AppResult<Project> {
        let project = self.blocking(move |s| s.store.update(&id, change).map(|(p, ())| p)).await?;
        self.emit_project(&project);
        Ok(project)
    }

    pub async fn delete_node(self: &Arc<Self>, project_id: String, node_id: String) -> AppResult<Project> {
        let project = self.blocking(move |s| s.store.delete_node(&project_id, &node_id)).await?;
        self.emit_project(&project);
        Ok(project)
    }

    /// Projet qui reçoit les images demandées par d'autres modules (créé au besoin).
    pub async fn integration_project(self: &Arc<Self>) -> AppResult<Project> {
        let known = self.settings().integration_project;
        if let Some(id) = known {
            if let Ok(project) = self.project(id).await {
                return Ok(project);
            }
        }
        let project = self.create_project("Demandes des autres modules".into()).await?;
        let mut settings = self.settings();
        settings.integration_project = Some(project.id.clone());
        self.save_settings(settings).await?;
        Ok(project)
    }

    // ── Import ──────────────────────────────────────────────────────────────────────────

    /// Ajoute des fichiers image au projet (glisser-déposer, sélecteur, Téléchargements).
    pub async fn import_files(self: &Arc<Self>, project_id: String, paths: Vec<String>) -> AppResult<BatchOutcome> {
        if paths.is_empty() {
            return Err(AppError::invalid("Aucun fichier à importer."));
        }
        let outcome = self
            .blocking(move |s| {
                let mut outcome = BatchOutcome::default();
                for path in paths {
                    let name = file_label(&path);
                    let added = read_image_file(Path::new(&path)).and_then(|bytes| {
                        s.store.add_node(
                            &project_id,
                            &bytes,
                            NewNode {
                                parent: None,
                                ..NewNode::local("", NodeKind::Import, name.clone(), json!({ "file": name }))
                            },
                        )
                    });
                    match added {
                        Ok((project, node)) => {
                            outcome.created.push(node.id);
                            outcome.project = Some(project);
                        }
                        Err(error) => outcome.skipped.push(format!("{name} : {}", error.message)),
                    }
                }
                Ok(outcome)
            })
            .await?;
        self.finish_batch(outcome)
    }

    /// Image collée depuis le presse-papiers (PNG en base64 ou adresse `data:`).
    pub async fn import_data(self: &Arc<Self>, project_id: String, data: String, name: String) -> AppResult<Project> {
        let project = self
            .blocking(move |s| {
                let bytes = local::decode_transport(&data)?;
                let label = if name.trim().is_empty() { "Image collée".to_string() } else { name.trim().to_string() };
                s.store
                    .add_node(&project_id, &bytes, NewNode { parent: None, ..NewNode::local("", NodeKind::Import, label, json!({})) })
                    .map(|(p, _)| p)
            })
            .await?;
        self.emit_project(&project);
        Ok(project)
    }

    fn finish_batch(&self, outcome: BatchOutcome) -> AppResult<BatchOutcome> {
        match &outcome.project {
            Some(project) => {
                self.emit_project(project);
                Ok(outcome)
            }
            None => Err(AppError::invalid(if outcome.skipped.is_empty() {
                "Rien n'a été fait.".to_string()
            } else {
                outcome.skipped.join(" · ")
            })),
        }
    }

    // ── Opérations locales ──────────────────────────────────────────────────────────────

    pub async fn apply_local(self: &Arc<Self>, project_id: String, node_id: String, operation: LocalOperation) -> AppResult<Project> {
        let project = self.blocking(move |s| s.local_operation(&project_id, &node_id, &operation)).await?;
        self.emit_project(&project);
        Ok(project)
    }

    /// Même opération sur plusieurs versions (redimensionnement, détourage d'une couleur…).
    pub async fn apply_local_batch(
        self: &Arc<Self>,
        project_id: String,
        nodes: Vec<String>,
        operation: LocalOperation,
    ) -> AppResult<BatchOutcome> {
        let outcome = self
            .blocking(move |s| {
                let mut outcome = BatchOutcome::default();
                for node in nodes {
                    match s.local_operation(&project_id, &node, &operation) {
                        Ok(project) => {
                            if let Some(current) = &project.current {
                                outcome.created.push(current.clone());
                            }
                            outcome.project = Some(project);
                        }
                        Err(error) => outcome.skipped.push(error.message),
                    }
                }
                Ok(outcome)
            })
            .await?;
        self.finish_batch(outcome)
    }

    /// Image retouchée au pinceau dans l'éditeur (PNG complet).
    pub async fn save_paint(self: &Arc<Self>, project_id: String, parent: String, data: String) -> AppResult<Project> {
        let project = self
            .blocking(move |s| {
                let bytes = local::decode_transport(&data)?;
                s.store
                    .add_node(&project_id, &bytes, NewNode::local(&parent, NodeKind::Paint, "Retouche au pinceau", json!({})))
                    .map(|(p, _)| p)
            })
            .await?;
        self.emit_project(&project);
        Ok(project)
    }

    fn local_operation(&self, project_id: &str, node_id: &str, operation: &LocalOperation) -> AppResult<Project> {
        let project = self.store.load(project_id)?;
        let node = self.store.node(&project, node_id)?;
        let image = self.store.rgba(&node)?;
        let mut mask_png = None;
        let (result, kind, label, params) = match operation {
            LocalOperation::Crop { x, y, width, height } => (
                local::crop(&image, *x, *y, *width, *height)?,
                NodeKind::Crop,
                format!("Recadrage {width} × {height}"),
                json!({ "x": x, "y": y, "width": width, "height": height }),
            ),
            LocalOperation::Resize { width, height } => (
                local::resize(&image, *width, *height)?,
                NodeKind::Resize,
                format!("Taille {width} × {height}"),
                json!({ "width": width, "height": height }),
            ),
            LocalOperation::Upscale { factor, sharpen } => (
                local::upscale(&image, *factor, *sharpen)?,
                NodeKind::Upscale,
                format!("Agrandissement ×{} (sur la machine)", trim_float(*factor)),
                json!({ "factor": factor, "sharpen": sharpen, "local": true }),
            ),
            LocalOperation::Rotate { degrees } => (
                local::rotate(&image, *degrees),
                NodeKind::Rotate,
                format!("Rotation {}°", trim_float(*degrees)),
                json!({ "degrees": degrees }),
            ),
            LocalOperation::Flip { horizontal } => (
                local::flip(&image, *horizontal),
                NodeKind::Flip,
                if *horizontal { "Miroir horizontal" } else { "Miroir vertical" }.to_string(),
                json!({ "horizontal": horizontal }),
            ),
            LocalOperation::Adjust { brightness, contrast, hue } => (
                local::adjust(&image, *brightness, *contrast, *hue),
                NodeKind::Adjust,
                "Réglages de l'image".to_string(),
                json!({ "brightness": brightness, "contrast": contrast, "hue": hue }),
            ),
            LocalOperation::Blur { sigma, mask_png: mask, inside } => {
                let mask = match mask {
                    Some(data) => {
                        let bytes = local::decode_transport(data)?;
                        let decoded = local::mask(&bytes, image.width(), image.height())?;
                        mask_png = Some(bytes);
                        Some(decoded)
                    }
                    None => None,
                };
                let label = match (&mask, inside) {
                    (None, _) => "Flou",
                    (Some(_), true) => "Flou de la zone",
                    (Some(_), false) => "Fond flouté",
                };
                (
                    local::blur(&image, *sigma, mask.as_ref(), *inside),
                    NodeKind::Blur,
                    label.to_string(),
                    json!({ "sigma": sigma, "inside": inside }),
                )
            }
            LocalOperation::Move { mask_png: mask, dx, dy } => {
                let bytes = local::decode_transport(mask)?;
                let decoded = local::mask(&bytes, image.width(), image.height())?;
                if local::mask_is_empty(&decoded) {
                    return Err(AppError::invalid("Sélectionnez d'abord ce qu'il faut déplacer."));
                }
                let (moved, hole) = local::move_region(&image, &decoded, *dx, *dy);
                // Le masque gardé est la zone quittée : « Combler » la reprend telle quelle.
                mask_png = Some(local::mask_png(&hole)?);
                (moved, NodeKind::Move, "Déplacement".to_string(), json!({ "dx": dx, "dy": dy }))
            }
            LocalOperation::ChromaKey { color, tolerance } => (
                local::chroma_key(&image, *color, *tolerance),
                NodeKind::ChromaKey,
                "Fond uni rendu transparent".to_string(),
                json!({ "color": color, "tolerance": tolerance }),
            ),
        };
        let bytes = local::png(&result)?;
        let (project, _) = self
            .store
            .add_node(project_id, &bytes, NewNode { mask_png, ..NewNode::local(node_id, kind, label, params) })?;
        Ok(project)
    }

    // ── Tâches IA ───────────────────────────────────────────────────────────────────────

    /// Prépare l'opération, la découpe en demandes et les place dans la file.
    pub async fn submit(self: &Arc<Self>, project_id: String, operation: AiOperation, settings: AiSettings) -> AppResult<Vec<Job>> {
        let model = self.model(settings.provider, &settings.model).await?;
        let caps = model.capabilities.clone();
        if let AiOperation::Generate { references } = &operation {
            if references.is_empty() && !caps.text_to_image {
                return Err(AppError::invalid(
                    "Ce modèle part toujours d'une image : ajoutez une référence, ou choisissez un modèle texte vers image.",
                ));
            }
        }
        let (op, st, pid) = (operation.clone(), settings.clone(), project_id.clone());
        let prepared = self
            .blocking(move |s| {
                let project = s.store.load(&pid)?;
                let inputs = s.inputs(&project, &op)?;
                pipeline::prepare(&op, &st, &caps, &inputs)
            })
            .await?;
        if let (Some(max), Some(first)) = (model.capabilities.max_input_images, prepared.requests.first()) {
            if first.images.len() as u32 > max {
                return Err(AppError::invalid(format!(
                    "{} reçoit au plus {max} image(s) par demande : retirez des références.",
                    model.name
                )));
            }
        }
        let plan = Arc::new(Plan {
            project_id: project_id.clone(),
            provider: settings.provider,
            model: settings.model.clone(),
            prompt: Some(settings.prompt.trim().to_string()).filter(|p| !p.is_empty()),
            negative_prompt: prepared.requests.first().and_then(|r| r.negative_prompt.clone()),
            finish: prepared.finish,
            kind: prepared.kind,
            label: prepared.label.clone(),
            parent: prepared.parent,
            references: prepared.references,
            mask_png: prepared.mask_png,
            params: prepared.params,
        });
        let group = short_id("g");
        let total = prepared.requests.len();
        let mut jobs = Vec::new();
        for (index, request) in prepared.requests.into_iter().enumerate() {
            let job = Job {
                id: short_id("j"),
                group: group.clone(),
                project_id: project_id.clone(),
                label: if total > 1 { format!("{} · {}/{total}", prepared.label, index + 1) } else { prepared.label.clone() },
                status: JobStatus::Waiting,
                provider: settings.provider,
                model: settings.model.clone(),
                created_at: now(),
                started_at: None,
                finished_at: None,
                results: Vec::new(),
                error: None,
                failure: None,
                usage: None,
                operation: operation.clone(),
                settings: AiSettings { count: request.count, ..settings.clone() },
            };
            let cancel = self.queue.add(job.clone());
            (self.notify)(Event::Job(Box::new(job.clone())));
            let (this, plan, id) = (self.clone(), plan.clone(), job.id.clone());
            tokio::spawn(async move { this.run(id, request, plan, cancel).await });
            jobs.push(job);
        }
        Ok(jobs)
    }

    /// Images d'entrée d'une opération, prêtes à envoyer.
    fn inputs(&self, project: &Project, operation: &AiOperation) -> AppResult<Inputs> {
        let source = match source_of(operation) {
            Some(id) => {
                let node = self.store.node(project, id)?;
                let bytes = self.store.bytes(&node)?;
                let image = local::decode(&bytes)?.to_rgba8();
                let sent = sendable(bytes, &node.mime, &image)?;
                Some((image, sent.bytes, sent.mime))
            }
            None => None,
        };
        let roles = match operation {
            AiOperation::Generate { references } | AiOperation::Edit { references, .. } => references.as_slice(),
            _ => &[],
        };
        let mut references = Vec::new();
        for reference in roles {
            let node = self.store.node(project, &reference.node)?;
            let bytes = self.store.bytes(&node)?;
            let image = local::decode(&bytes)?.to_rgba8();
            let sent = sendable(bytes, &node.mime, &image)?;
            references.push((sent.bytes, sent.mime, reference.role.clone()));
        }
        Ok(Inputs { source, references })
    }

    fn update_job(&self, id: &str, change: impl FnOnce(&mut Job)) {
        if let Some(job) = self.queue.update(id, change) {
            (self.notify)(Event::Job(Box::new(job)));
        }
    }

    async fn run(self: Arc<Self>, id: String, request: ImageRequest, plan: Arc<Plan>, cancel: Cancel) {
        let outcome = self.execute(&id, request, plan, cancel).await;
        self.update_job(&id, |job| {
            job.finished_at = Some(now());
            match outcome {
                Ok(usage) => {
                    job.status = JobStatus::Completed;
                    job.usage = Some(usage);
                }
                Err(error) if is_cancelled(&error) => job.status = JobStatus::Cancelled,
                Err(error) => {
                    job.status = JobStatus::Failed;
                    job.failure = Some(failure_kind(&error));
                    job.error = Some(error.message);
                }
            }
        });
    }

    async fn execute(self: &Arc<Self>, id: &str, request: ImageRequest, plan: Arc<Plan>, cancel: Cancel) -> AppResult<ImageUsage> {
        let limit = self.queue.limit(plan.provider);
        let permit = wait_or_cancel(limit.acquire_owned(), cancel.clone())
            .await?
            .map_err(|_| AppError::internal("file des tâches fermée"))?;
        self.update_job(id, |job| {
            job.status = JobStatus::Running;
            job.started_at = Some(now());
        });
        let provider = self.imaging.provider(plan.provider)?;
        let response = provider.generate(&request, cancel).await?;
        drop(permit);
        if response.images.is_empty() {
            return Err(AppError::invalid("Le fournisseur n'a renvoyé aucune image : reformulez ou changez de modèle."));
        }
        let count = response.images.len();
        let usage = share(&response.usage, count);
        let note = (!response.dropped.is_empty())
            .then(|| format!("Réglage non accepté par le modèle, retiré : {}.", response.dropped.join(", ")));
        // Les images sont déjà produites (et facturées) : on les garde même si l'annulation
        // arrive maintenant.
        for image in response.images {
            let (plan, usage, note) = (plan.clone(), usage.clone(), note.clone());
            let project = self
                .blocking(move |s| {
                    let bytes = pipeline::finish(&plan.finish, &image.bytes)?;
                    let new = NewNode {
                        parent: plan.parent.clone(),
                        kind: plan.kind,
                        label: plan.label.clone(),
                        prompt: plan.prompt.clone(),
                        negative_prompt: plan.negative_prompt.clone(),
                        provider: Some(plan.provider),
                        model: Some(plan.model.clone()),
                        params: plan.params.clone(),
                        mask_png: plan.mask_png.clone(),
                        references: plan.references.clone(),
                        usage: Some(usage),
                        note,
                    };
                    s.store.add_node(&plan.project_id, &bytes, new)
                })
                .await;
            let (project, node) = project?;
            self.update_job(id, |job| job.results.push(node.id.clone()));
            self.emit_project(&project);
        }
        Ok(response.usage)
    }

    pub fn jobs(&self, project_id: Option<&str>) -> Vec<Job> {
        self.queue.list(project_id)
    }

    pub fn cancel_job(&self, id: &str) -> AppResult<()> {
        self.queue.cancel(id)
    }

    /// Relance une tâche en échec ou annulée, avec la même source et la même consigne.
    pub async fn retry_job(self: &Arc<Self>, id: &str) -> AppResult<Vec<Job>> {
        let job = self.queue.get(id).ok_or_else(|| AppError::not_found("Tâche introuvable."))?;
        if !matches!(job.status, JobStatus::Failed | JobStatus::Cancelled) {
            return Err(AppError::invalid("Seule une tâche en échec ou annulée se relance."));
        }
        self.submit(job.project_id, job.operation, job.settings).await
    }

    pub fn clear_jobs(&self, project_id: &str) {
        self.queue.clear_finished(project_id);
    }

    /// Attend la fin des tâches (pour les autres modules) et les renvoie.
    pub async fn wait_jobs(&self, ids: &[String]) -> AppResult<Vec<Job>> {
        let started = Instant::now();
        loop {
            let jobs: Vec<Job> = ids.iter().filter_map(|id| self.queue.get(id)).collect();
            if jobs.len() < ids.len() {
                return Err(AppError::not_found("Tâche introuvable."));
            }
            if jobs.iter().all(|job| finished(job.status)) {
                return Ok(jobs);
            }
            if started.elapsed() > WAIT_LIMIT {
                return Err(AppError::new(AppErrorCode::Network, "Les tâches continuent dans Image Maker : trop longues pour attendre ici."));
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    }

    // ── Export ──────────────────────────────────────────────────────────────────────────

    pub async fn export(self: &Arc<Self>, request: ExportRequest) -> AppResult<ExportResult> {
        self.blocking(move |s| s.export_now(&request)).await
    }

    fn export_now(&self, request: &ExportRequest) -> AppResult<ExportResult> {
        if request.nodes.is_empty() {
            return Err(AppError::invalid("Choisissez au moins une image à exporter."));
        }
        let directory = PathBuf::from(&request.directory);
        if !directory.is_absolute() || !directory.is_dir() {
            return Err(AppError::invalid("Choisissez un dossier de destination existant."));
        }
        let project = self.store.load(&request.project_id)?;
        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let mut files = Vec::new();
        let mut notes: Vec<String> = Vec::new();
        for (index, id) in request.nodes.iter().enumerate() {
            let node = self.store.node(&project, id)?;
            let mut image = self.store.rgba(&node)?;
            if let Some(side) = request.max_side.filter(|s| *s > 0) {
                image = local::fit_within(&image, side);
            }
            let (bytes, said) = local::encode(&image, request.format, request.quality, request.matte)?;
            for note in said {
                if !notes.contains(&note) {
                    notes.push(note);
                }
            }
            let name = file_name(&request.naming, &project.name, &node.label, index + 1, request.nodes.len(), &date);
            let path = unique_path(&directory, &name, request.format.extension());
            std::fs::write(&path, bytes)?;
            files.push(path.to_string_lossy().to_string());
        }
        Ok(ExportResult { files, notes })
    }

    /// Images arrivées récemment dans Téléchargements (mode compte : site officiel, puis import).
    pub async fn recent_downloads(self: &Arc<Self>, since: i64) -> AppResult<Vec<DownloadedImage>> {
        self.blocking(move |_| Ok(downloads(since))).await
    }
}

const PROMPT_INSTRUCTIONS: &str = "You improve prompts for an image generation model. Keep the person's intent and write in the same language as their text. Make it precise and visual: subject, environment, composition, lighting, camera and lens, materials, colors, atmosphere, style and level of detail. Do not add text or logos to the image unless asked. Answer with the improved prompt only, as one paragraph, without preamble, quotes or markdown.";

const STRUCTURED_INSTRUCTIONS: &str = "You improve prompts for an image generation model. Keep the person's intent and write the values in the same language as their text. Answer with exactly these ten lines and nothing else, each line starting with its English key followed by a colon: subject, environment, composition, lighting, camera, materials, colors, atmosphere, style, quality. Leave a value empty when it does not apply. No preamble, no markdown.";

/// Identifiant de la version source d'une opération.
fn source_of(operation: &AiOperation) -> Option<&str> {
    match operation {
        AiOperation::Generate { .. } => None,
        AiOperation::Edit { source, .. }
        | AiOperation::Inpaint { source, .. }
        | AiOperation::Outpaint { source, .. }
        | AiOperation::Variation { source, .. }
        | AiOperation::Restyle { source, .. }
        | AiOperation::Upscale { source }
        | AiOperation::Background { source, .. }
        | AiOperation::Restore { source } => Some(source),
    }
}

/// Octets d'origine s'ils conviennent, sinon image réduite et réencodée.
fn sendable(bytes: Vec<u8>, mime: &str, image: &image::RgbaImage) -> AppResult<InputImage> {
    let accepted = matches!(mime, "image/png" | "image/jpeg" | "image/webp");
    if accepted && image.width().max(image.height()) <= pipeline::SEND_SIDE && bytes.len() <= SEND_BYTES {
        return Ok(InputImage { bytes, mime: mime.to_string() });
    }
    pipeline::sendable(image)
}

fn failure_kind(error: &AppError) -> FailureKind {
    let message = error.message.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| message.contains(w));
    if has(&["crédit", "quota", "facturation"]) {
        FailureKind::Credit
    } else if has(&["modération", "filtre de sécurité"]) {
        FailureKind::Moderation
    } else if has(&["clé", "identifiant"]) {
        FailureKind::Key
    } else if has(&["modèle introuvable", "n'est pas proposé", "application higgsfield", "ne reçoit pas d'image", "arguments refusés"]) {
        FailureKind::Model
    } else if matches!(error.code, AppErrorCode::Network) {
        FailureKind::Network
    } else if matches!(error.code, AppErrorCode::InvalidInput) {
        FailureKind::Input
    } else {
        FailureKind::Other
    }
}

/// Part d'une demande qui a produit plusieurs images.
fn share(usage: &ImageUsage, count: usize) -> ImageUsage {
    if count <= 1 {
        return usage.clone();
    }
    ImageUsage {
        cost_usd: usage.cost_usd.map(|cost| cost / count as f64),
        input_tokens: None,
        output_tokens: None,
        note: Some(match &usage.note {
            Some(note) => format!("Part d'une demande de {count} images. {note}"),
            None => format!("Part d'une demande de {count} images."),
        }),
    }
}

fn short_id(prefix: &str) -> String {
    format!("{prefix}-{}", &uuid::Uuid::new_v4().simple().to_string()[..10])
}

fn trim_float(value: f32) -> String {
    let text = format!("{value:.2}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Chemin d'application Higgsfield (« bytedance/seedream/v4/text-to-image »).
fn valid_application(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && !id.starts_with('/')
        && !id.ends_with('/')
        && !id.contains("//")
        && !id.split('/').any(|part| part == "." || part == "..")
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
}

fn read_image_file(path: &Path) -> AppResult<Vec<u8>> {
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::invalid("format non pris en charge (PNG, JPEG, WebP, GIF, BMP, TIFF)"));
    }
    let size = std::fs::metadata(path).map_err(|_| AppError::not_found("fichier introuvable"))?.len();
    if size as usize > MAX_IMAGE_BYTES {
        return Err(AppError::invalid("fichier trop lourd (48 Mo au plus)"));
    }
    Ok(std::fs::read(path)?)
}

fn file_label(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Image".to_string())
}

/// Nom de fichier sûr sur Windows, macOS et Linux.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '-' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    let cleaned: String = cleaned.chars().take(120).collect();
    if cleaned.is_empty() {
        "image".to_string()
    } else {
        cleaned
    }
}

/// `{projet}`, `{version}`, `{n}` (numéro sur 2 chiffres ou plus), `{date}`.
fn file_name(template: &str, project: &str, version: &str, index: usize, total: usize, date: &str) -> String {
    let width = total.to_string().len().max(2);
    let mut name = template
        .replace("{projet}", project)
        .replace("{version}", version)
        .replace("{n}", &format!("{index:0width$}"))
        .replace("{date}", date);
    if total > 1 && !template.contains("{n}") {
        name = format!("{name}-{index:0width$}");
    }
    sanitize(&name)
}

/// Ne remplace jamais un fichier existant : « nom (2).png », « nom (3).png »…
fn unique_path(directory: &Path, name: &str, extension: &str) -> PathBuf {
    let first = directory.join(format!("{name}.{extension}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| directory.join(format!("{name} ({n}).{extension}")))
        .find(|path| !path.exists())
        .unwrap_or(first)
}

fn downloads(since: i64) -> Vec<DownloadedImage> {
    let Some(dir) = crate::core::paths::dirs_home().map(|home| home.join("Downloads")) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut found: Vec<DownloadedImage> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_string_lossy().to_lowercase();
            if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as i64;
            (meta.is_file() && modified >= since).then(|| DownloadedImage {
                path: path.to_string_lossy().to_string(),
                name: entry.file_name().to_string_lossy().to_string(),
                modified,
                bytes: meta.len(),
            })
        })
        .collect();
    found.sort_by_key(|image| std::cmp::Reverse(image.modified));
    found.truncate(30);
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::imaging::http::data_url;
    use crate::core::imaging::{
        ConnectionState, GeneratedImage, ImageProvider, ImageResponse, ModelCapabilities,
    };
    use crate::modules::image_maker::types::InpaintMode;
    use image::{GrayImage, Luma, Rgba, RgbaImage};
    use std::sync::Mutex;

    /// Faux fournisseur : renvoie une image rouge à la taille de la première image reçue.
    struct Fake {
        fail: Option<String>,
        delay: Duration,
    }

    #[async_trait::async_trait]
    impl ImageProvider for Fake {
        fn id(&self) -> ProviderId {
            ProviderId::Gemini
        }
        async fn status(&self, _check: bool) -> ProviderStatus {
            ProviderStatus {
                provider: ProviderId::Gemini,
                name: "Faux".into(),
                state: ConnectionState::Connected,
                key_source: None,
                masked_key: None,
                detail: None,
                credits: None,
                key_hint: String::new(),
                key_url: String::new(),
            }
        }
        async fn set_key(&self, _key: &str) -> AppResult<ProviderStatus> {
            Ok(self.status(false).await)
        }
        fn clear_key(&self) -> AppResult<()> {
            Ok(())
        }
        async fn models(&self) -> AppResult<ModelList> {
            let mut capabilities = ModelCapabilities::minimal(CapabilitySource::Api);
            capabilities.image_input = true;
            capabilities.aspect_ratios = vec!["1:1".into(), "3:2".into(), "16:9".into()];
            Ok(ModelList {
                provider: ProviderId::Gemini,
                models: vec![ProviderModel {
                    provider: ProviderId::Gemini,
                    id: "fake".into(),
                    name: "Faux modèle".into(),
                    description: String::new(),
                    capabilities,
                    pricing: Vec::new(),
                    free: false,
                }],
                offline: false,
                note: None,
            })
        }
        async fn generate(&self, request: &ImageRequest, cancel: Cancel) -> AppResult<ImageResponse> {
            wait_or_cancel(tokio::time::sleep(self.delay), cancel).await?;
            if let Some(message) = &self.fail {
                return Err(AppError::invalid(message.clone()));
            }
            let (w, h) = request
                .images
                .first()
                .map(|i| local::decode(&i.bytes).unwrap().to_rgba8().dimensions())
                .unwrap_or((64, 64));
            let red = local::png(&RgbaImage::from_pixel(w, h, Rgba([255, 0, 0, 255])))?;
            Ok(ImageResponse {
                images: vec![GeneratedImage { bytes: red }; request.count as usize],
                usage: ImageUsage { cost_usd: Some(0.04), ..Default::default() },
                dropped: Vec::new(),
            })
        }
    }

    fn maker(name: &str, fake: Fake) -> (Arc<ImageMaker>, PathBuf, Arc<Mutex<Vec<String>>>) {
        let dir = std::env::temp_dir().join(format!("image-maker-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        let notify: Notify = Arc::new(move |event| {
            let text = match event {
                Event::Job(job) => format!("{:?}", job.status),
                Event::Project(_) => "project".into(),
            };
            seen.lock().unwrap().push(text);
        });
        let imaging = Imaging::with_providers(vec![Arc::new(fake)]);
        (Arc::new(ImageMaker::with_imaging(&dir, imaging, notify)), dir, events)
    }

    fn settings(count: u32) -> AiSettings {
        AiSettings {
            provider: ProviderId::Gemini,
            model: "fake".into(),
            prompt: "un dragon".into(),
            negative_prompt: None,
            aspect_ratio: None,
            resolution: None,
            count,
            seed: None,
            quality: None,
            transparent_background: false,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_inpainting_goes_through_the_queue_and_only_the_area_changes() {
        let (maker, dir, events) = maker("inpaint", Fake { fail: None, delay: Duration::ZERO });
        let project = maker.create_project("Voiture".into()).await.unwrap();
        let source = RgbaImage::from_fn(96, 64, |x, y| Rgba([x as u8, y as u8, 200, 255]));
        let project = maker
            .import_data(project.id, data_url(&local::png(&source).unwrap(), "image/png"), String::new())
            .await
            .unwrap();
        let source_id = project.nodes[0].id.clone();
        let mut mask = GrayImage::new(96, 64);
        for x in 40..56 {
            for y in 20..40 {
                mask.put_pixel(x, y, Luma([255]));
            }
        }
        let operation = AiOperation::Inpaint {
            source: source_id.clone(),
            mask_png: data_url(&local::mask_png(&mask).unwrap(), "image/png"),
            mode: InpaintMode::Replace,
        };
        let jobs = maker.submit(project.id.clone(), operation, settings(2)).await.unwrap();
        assert_eq!(jobs.len(), 2, "une demande par résultat");
        let ids: Vec<String> = jobs.iter().map(|j| j.id.clone()).collect();
        let done = maker.wait_jobs(&ids).await.unwrap();
        assert!(done.iter().all(|j| j.status == JobStatus::Completed && j.results.len() == 1), "{done:?}");
        assert_eq!(done[0].usage.as_ref().and_then(|u| u.cost_usd), Some(0.04));

        let project = maker.project(project.id).await.unwrap();
        assert_eq!(project.nodes.len(), 3);
        let result = project.nodes.iter().find(|n| n.kind == NodeKind::Inpaint).unwrap();
        assert_eq!(result.parent.as_deref(), Some(source_id.as_str()));
        assert_eq!(result.prompt.as_deref(), Some("un dragon"));
        assert!(result.mask.is_some(), "le masque utilisé est gardé");
        let pixels = local::decode(&std::fs::read(&result.file).unwrap()).unwrap().to_rgba8();
        assert_eq!(pixels.get_pixel(2, 2), source.get_pixel(2, 2), "hors de la zone : identique");
        assert_eq!(pixels.get_pixel(90, 60), source.get_pixel(90, 60));
        assert_eq!(pixels.get_pixel(48, 30).0, [255, 0, 0, 255], "dans la zone : le résultat");
        let events = events.lock().unwrap();
        assert!(events.contains(&"Running".to_string()) && events.contains(&"Completed".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_waiting_task_can_be_cancelled_and_a_failure_says_what_to_fix() {
        let (maker, dir, _) = maker("queue", Fake { fail: None, delay: Duration::from_millis(400) });
        let mut current = maker.settings();
        current.parallel_per_provider = 1;
        maker.save_settings(current).await.unwrap();
        let project = maker.create_project(String::new()).await.unwrap();
        assert_eq!(project.name, "Sans titre");
        let jobs = maker
            .submit(project.id.clone(), AiOperation::Generate { references: Vec::new() }, settings(2))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let waiting = jobs
            .iter()
            .find(|j| maker.queue.get(&j.id).unwrap().status == JobStatus::Waiting)
            .expect("une seule tâche à la fois : l'autre attend");
        maker.cancel_job(&waiting.id).unwrap();
        let ids: Vec<String> = jobs.iter().map(|j| j.id.clone()).collect();
        let done = maker.wait_jobs(&ids).await.unwrap();
        let statuses: Vec<JobStatus> = done.iter().map(|j| j.status).collect();
        assert!(statuses.contains(&JobStatus::Completed) && statuses.contains(&JobStatus::Cancelled), "{statuses:?}");
        // Relancer une tâche annulée : même demande, nouvelle tâche.
        let again = maker.retry_job(&waiting.id).await.unwrap();
        assert_eq!(again[0].settings.prompt, "un dragon");
        maker.wait_jobs(&[again[0].id.clone()]).await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);

        let (maker, dir, _) = maker_failing();
        let project = maker.create_project("x".into()).await.unwrap();
        let jobs = maker
            .submit(project.id.clone(), AiOperation::Generate { references: Vec::new() }, settings(1))
            .await
            .unwrap();
        let done = maker.wait_jobs(&[jobs[0].id.clone()]).await.unwrap();
        assert_eq!(done[0].status, JobStatus::Failed);
        assert_eq!(done[0].failure, Some(FailureKind::Key));
        assert!(done[0].error.as_deref().unwrap().contains("Clé"));
        assert!(maker.project(project.id).await.unwrap().nodes.is_empty(), "rien n'est ajouté");
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn maker_failing() -> (Arc<ImageMaker>, PathBuf, Arc<Mutex<Vec<String>>>) {
        maker(
            "failing",
            Fake { fail: Some("Clé Google refusée : vérifiez-la.".into()), delay: Duration::ZERO },
        )
    }

    #[tokio::test]
    async fn an_unknown_model_or_a_missing_image_input_is_refused_before_sending() {
        let (maker, dir, _) = maker("refuse", Fake { fail: None, delay: Duration::ZERO });
        let project = maker.create_project("x".into()).await.unwrap();
        let mut wrong = settings(1);
        wrong.model = "retired".into();
        let error = maker
            .submit(project.id.clone(), AiOperation::Generate { references: Vec::new() }, wrong)
            .await
            .unwrap_err();
        assert!(error.message.contains("choisissez-en un autre"), "{}", error.message);
        let error = maker
            .submit(project.id, AiOperation::Upscale { source: "n-none".into() }, settings(1))
            .await
            .unwrap_err();
        assert!(error.message.contains("introuvable"), "{}", error.message);
        assert!(maker.jobs(None).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_names_are_safe_numbered_and_never_overwrite() {
        assert_eq!(file_name("{projet}-{n}", "Affiche: été", "v", 3, 12, "2026-09-25"), "Affiche- été-03");
        assert_eq!(file_name("{projet}", "A", "v", 2, 2, "d"), "A-02", "plusieurs fichiers : numéro ajouté");
        assert_eq!(file_name("{version}", "A", "..", 1, 1, "d"), "image");
        let dir = std::env::temp_dir().join(format!("image-maker-names-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a", "png"), dir.join("a (2).png"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn higgsfield_application_ids_cannot_escape_the_api_path() {
        assert!(valid_application("bytedance/seedream/v4/text-to-image"));
        assert!(valid_application("nano-banana-pro"));
        for bad in ["", "/x", "a/../b", "a//b", "a?b=1", "https://evil", "a b"] {
            assert!(!valid_application(bad), "{bad}");
        }
    }

    #[test]
    fn failures_point_to_the_right_fix() {
        let kind = |code, message: &str| failure_kind(&AppError::new(code, message));
        assert_eq!(kind(AppErrorCode::InvalidInput, "Clé OpenRouter refusée : vérifiez-la"), FailureKind::Key);
        assert_eq!(
            kind(AppErrorCode::Network, "Quota Gemini atteint : activez la facturation sur le projet de la clé"),
            FailureKind::Credit
        );
        assert_eq!(kind(AppErrorCode::InvalidInput, "Demande refusée par la modération"), FailureKind::Moderation);
        assert_eq!(kind(AppErrorCode::NotFound, "Modèle introuvable sur OpenRouter"), FailureKind::Model);
        assert_eq!(kind(AppErrorCode::Network, "OpenRouter injoignable"), FailureKind::Network);
    }

    #[test]
    fn a_shared_cost_is_split_between_images() {
        let usage = ImageUsage { cost_usd: Some(0.12), input_tokens: Some(10), output_tokens: Some(20), note: None };
        let part = share(&usage, 4);
        assert!((part.cost_usd.unwrap() - 0.03).abs() < 1e-9);
        assert!(part.note.unwrap().contains("4 images"));
        assert_eq!(share(&usage, 1), usage);
    }
}
