//! File des tâches IA : en attente, en cours, terminée, en échec ou annulée.
//! Chaque fournisseur a sa propre limite de tâches simultanées ; une tâche en attente ou en
//! cours s'annule à tout moment. La file vit en mémoire : les résultats, eux, sont déjà
//! enregistrés dans le projet au fil de l'eau.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{watch, Semaphore};

use crate::core::imaging::{cancel_pair, Cancel, ProviderId};
use crate::core::{AppError, AppResult};

use super::types::{Job, JobStatus};

/// Tâches terminées gardées pour l'historique de la file.
const KEEP_FINISHED: usize = 200;

struct Entry {
    job: Job,
    cancel: watch::Sender<bool>,
}

pub struct Queue {
    entries: Mutex<Vec<Entry>>,
    limits: Mutex<HashMap<ProviderId, Arc<Semaphore>>>,
    parallel: Mutex<u32>,
}

pub fn finished(status: JobStatus) -> bool {
    matches!(status, JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled)
}

impl Queue {
    pub fn new(parallel: u32) -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            limits: Mutex::new(HashMap::new()),
            parallel: Mutex::new(parallel.clamp(1, 8)),
        }
    }

    /// Nouvelle limite : vaut pour les tâches qui n'ont pas encore commencé.
    pub fn set_parallel(&self, parallel: u32) {
        let parallel = parallel.clamp(1, 8);
        let mut current = self.parallel.lock().unwrap_or_else(|e| e.into_inner());
        if *current != parallel {
            *current = parallel;
            self.limits.lock().unwrap_or_else(|e| e.into_inner()).clear();
        }
    }

    pub fn limit(&self, provider: ProviderId) -> Arc<Semaphore> {
        let parallel = *self.parallel.lock().unwrap_or_else(|e| e.into_inner());
        self.limits
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(provider)
            .or_insert_with(|| Arc::new(Semaphore::new(parallel as usize)))
            .clone()
    }

    /// Ajoute une tâche ; renvoie son signal d'annulation.
    pub fn add(&self, job: Job) -> Cancel {
        let (cancel, receiver) = cancel_pair();
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.push(Entry { job, cancel });
        let done = entries.iter().filter(|e| finished(e.job.status)).count();
        if done > KEEP_FINISHED {
            let mut extra = done - KEEP_FINISHED;
            entries.retain(|e| {
                if extra > 0 && finished(e.job.status) {
                    extra -= 1;
                    false
                } else {
                    true
                }
            });
        }
        receiver
    }

    /// Modifie une tâche et renvoie son nouvel état. Une tâche finie ne change plus.
    pub fn update(&self, id: &str, change: impl FnOnce(&mut Job)) -> Option<Job> {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let entry = entries.iter_mut().find(|e| e.job.id == id)?;
        if !finished(entry.job.status) {
            change(&mut entry.job);
        }
        Some(entry.job.clone())
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.iter().find(|e| e.job.id == id).map(|e| e.job.clone())
    }

    pub fn list(&self, project: Option<&str>) -> Vec<Job> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries
            .iter()
            .filter(|e| project.is_none_or(|p| e.job.project_id == p))
            .map(|e| e.job.clone())
            .collect()
    }

    /// Demande l'arrêt d'une tâche en attente ou en cours.
    pub fn cancel(&self, id: &str) -> AppResult<()> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let entry = entries
            .iter()
            .find(|e| e.job.id == id)
            .ok_or_else(|| AppError::not_found("Tâche introuvable."))?;
        if finished(entry.job.status) {
            return Err(AppError::invalid("Cette tâche est déjà terminée."));
        }
        let _ = entry.cancel.send(true);
        Ok(())
    }

    /// Retire les tâches finies d'un projet.
    pub fn clear_finished(&self, project: &str) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.retain(|e| e.job.project_id != project || !finished(e.job.status));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::image_maker::types::{AiOperation, AiSettings};

    fn job(id: &str, project: &str) -> Job {
        Job {
            id: id.into(),
            group: "g".into(),
            project_id: project.into(),
            label: "Génération".into(),
            status: JobStatus::Waiting,
            provider: ProviderId::Gemini,
            model: "m".into(),
            created_at: 0,
            started_at: None,
            finished_at: None,
            results: Vec::new(),
            error: None,
            failure: None,
            usage: None,
            operation: AiOperation::Generate { references: Vec::new() },
            settings: AiSettings {
                provider: ProviderId::Gemini,
                model: "m".into(),
                prompt: "x".into(),
                negative_prompt: None,
                aspect_ratio: None,
                resolution: None,
                count: 1,
                seed: None,
                quality: None,
                transparent_background: false,
            },
        }
    }

    #[test]
    fn cancelling_signals_the_task_and_finished_tasks_stay_put() {
        let queue = Queue::new(2);
        let cancel = queue.add(job("a", "p1"));
        queue.add(job("b", "p2"));
        assert!(!*cancel.borrow());
        queue.cancel("a").unwrap();
        assert!(*cancel.borrow(), "le signal d'annulation est passé");
        queue.update("a", |j| j.status = JobStatus::Cancelled);
        // Une tâche finie ne change plus et ne s'annule plus.
        assert_eq!(queue.update("a", |j| j.status = JobStatus::Running).unwrap().status, JobStatus::Cancelled);
        assert!(queue.cancel("a").is_err());
        assert_eq!(queue.list(Some("p1")).len(), 1);
        queue.clear_finished("p1");
        assert!(queue.list(Some("p1")).is_empty());
        assert_eq!(queue.list(None).len(), 1, "l'autre projet n'est pas touché");
    }

    #[test]
    fn each_provider_has_its_own_limit() {
        let queue = Queue::new(1);
        let gemini = queue.limit(ProviderId::Gemini);
        let _held = gemini.clone().try_acquire_owned().unwrap();
        assert!(gemini.try_acquire().is_err(), "une seule tâche Gemini à la fois");
        assert!(queue.limit(ProviderId::Openrouter).try_acquire().is_ok());
        queue.set_parallel(3);
        assert_eq!(queue.limit(ProviderId::Gemini).available_permits(), 3);
    }
}
