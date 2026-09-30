//! Opérations sur le graphe de connaissance (§5, §6), partagées par l'interface et les agents.
//!
//! Le graphe reste cohérent : une dépendance désigne toujours un système présent, aucun cycle
//! n'est accepté (§61), un système utilisé par d'autres ne se retire pas sans eux, et une
//! hypothèse remplacée garde sa trace (§55).

use std::collections::{BTreeSet, HashMap, HashSet};

use crate::core::{AppError, AppResult};

use super::catalog::catalog;
use super::types::{
    GameAssumption, GameAssumptionStatus, GameDecision, GameGraph, GameGraphOp, GameIssue,
    GameSystem, GameSystemOrigin, GameTask, GameTaskStatus, GameVersion,
};

/// Identifiant court et unique : `t-3f9a1c2b`.
pub fn new_id(prefix: &str) -> String {
    let id = uuid::Uuid::new_v4().simple().to_string();
    format!("{prefix}-{}", &id[..8])
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// `snake_case` ASCII : lettres minuscules, chiffres, `_`, commence par une lettre.
pub fn valid_system_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Systèmes qui dépendent directement de `id` (« utilisé par »).
pub fn consumers<'a>(graph: &'a GameGraph, id: &str) -> Vec<&'a GameSystem> {
    graph
        .systems
        .iter()
        .filter(|s| s.dependencies.iter().any(|d| d == id))
        .collect()
}

/// Tous les systèmes touchés si `id` change (dépendants directs et indirects), pour les tests
/// de non-régression (§84).
#[allow(dead_code)] // outils MCP de Game Studio (phase 3)
pub fn impact(graph: &GameGraph, id: &str) -> Vec<String> {
    let mut out: BTreeSet<String> = BTreeSet::new();
    let mut stack = vec![id.to_string()];
    while let Some(current) = stack.pop() {
        for consumer in consumers(graph, &current) {
            if out.insert(consumer.id.clone()) {
                stack.push(consumer.id.clone());
            }
        }
    }
    out.into_iter().collect()
}

/// Chemin de dépendances qui reviendrait sur lui-même si `system` entrait dans le graphe.
fn cycle_with(graph: &GameGraph, system: &GameSystem) -> Option<Vec<String>> {
    let deps: HashMap<&str, Vec<&str>> = graph
        .systems
        .iter()
        .filter(|s| s.id != system.id)
        .map(|s| {
            (
                s.id.as_str(),
                s.dependencies.iter().map(String::as_str).collect(),
            )
        })
        .chain(std::iter::once((
            system.id.as_str(),
            system.dependencies.iter().map(String::as_str).collect(),
        )))
        .collect();
    fn walk<'a>(
        node: &'a str,
        target: &str,
        deps: &HashMap<&'a str, Vec<&'a str>>,
        path: &mut Vec<String>,
        seen: &mut HashSet<&'a str>,
    ) -> bool {
        if !seen.insert(node) {
            return false;
        }
        for next in deps.get(node).cloned().unwrap_or_default() {
            path.push(next.to_string());
            if next == target || walk(next, target, deps, path, seen) {
                return true;
            }
            path.pop();
        }
        false
    }
    let mut path = vec![system.id.clone()];
    let mut seen = HashSet::new();
    for dep in &system.dependencies {
        path.push(dep.clone());
        if dep == &system.id || walk(dep, &system.id, &deps, &mut path, &mut seen) {
            return Some(path);
        }
        path.pop();
    }
    None
}

fn find_system<'a>(graph: &'a mut GameGraph, id: &str) -> AppResult<&'a mut GameSystem> {
    graph
        .systems
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::not_found(format!("Système inconnu : {id}.")))
}

fn upsert_system(graph: &mut GameGraph, mut system: GameSystem) -> AppResult<String> {
    system.id = system.id.trim().to_string();
    if !valid_system_id(&system.id) {
        return Err(AppError::invalid(format!(
            "Identifiant de système invalide : « {} » (snake_case, ex. combat_melee).",
            system.id
        )));
    }
    if system.name.trim().is_empty() {
        return Err(AppError::invalid("Un système a besoin d'un nom."));
    }
    system.dependencies.retain(|d| !d.trim().is_empty());
    system.dependencies.dedup();
    let missing: Vec<&String> = system
        .dependencies
        .iter()
        .filter(|d| *d != &system.id && !graph.systems.iter().any(|s| &s.id == *d))
        .collect();
    if !missing.is_empty() {
        return Err(AppError::invalid(format!(
            "Dépendances inconnues : {}. Ajoutez d'abord ces systèmes.",
            missing
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    if let Some(path) = cycle_with(graph, &system) {
        return Err(AppError::invalid(format!(
            "Dépendance circulaire refusée : {}. Faites-les communiquer par événement (§61).",
            path.join(" → ")
        )));
    }
    let message = match graph.systems.iter_mut().find(|s| s.id == system.id) {
        Some(existing) => {
            *existing = system.clone();
            format!("Système « {} » mis à jour.", system.name)
        }
        None => {
            let name = system.name.clone();
            graph.systems.push(system);
            format!("Système « {name} » ajouté.")
        }
    };
    Ok(message)
}

/// Ajoute un système du catalogue avec ses dépendances manquantes, dans l'ordre.
fn add_catalog_system(graph: &mut GameGraph, id: &str) -> AppResult<String> {
    let known = catalog()?;
    let root = known
        .get(id)
        .ok_or_else(|| AppError::not_found(format!("Système absent du catalogue : {id}.")))?;
    let mut order: Vec<String> = Vec::new();
    fn visit(
        id: &str,
        graph: &GameGraph,
        order: &mut Vec<String>,
        seen: &mut HashSet<String>,
    ) -> AppResult<()> {
        if !seen.insert(id.to_string()) || graph.systems.iter().any(|s| s.id == id) {
            return Ok(());
        }
        let def = catalog()?
            .get(id)
            .ok_or_else(|| AppError::not_found(format!("Système absent du catalogue : {id}.")))?;
        for dep in &def.depends {
            visit(dep, graph, order, seen)?;
        }
        order.push(id.to_string());
        // Compagnons (souvent l'interface, qui dépend de ce système) : après lui.
        for companion in &def.adds {
            visit(companion, graph, order, seen)?;
        }
        Ok(())
    }
    visit(id, graph, &mut order, &mut HashSet::new())?;
    if order.is_empty() {
        return Ok(format!("« {} » est déjà dans le projet.", root.name));
    }
    let added = order.len();
    for sid in order {
        if let Some(def) = known.get(&sid) {
            let mut system = def.to_system();
            system.origin = GameSystemOrigin::Catalog;
            // `adds` peut viser un système qui dépend de celui-ci : ajouté après, sans cycle.
            system
                .dependencies
                .retain(|d| graph.systems.iter().any(|s| &s.id == d));
            graph.systems.push(system);
        }
    }
    Ok(if added == 1 {
        format!("« {} » ajouté.", root.name)
    } else {
        format!(
            "« {} » ajouté avec {} système(s) nécessaire(s).",
            root.name,
            added - 1
        )
    })
}

/// Applique une opération ; rend une phrase qui dit ce qui a été fait.
pub fn apply(graph: &mut GameGraph, op: GameGraphOp, by: &str) -> AppResult<String> {
    let message = match op {
        GameGraphOp::UpsertSystem { system } => upsert_system(graph, system)?,
        GameGraphOp::AddCatalogSystem { id } => add_catalog_system(graph, &id)?,
        GameGraphOp::RemoveSystem { id } => {
            let users: Vec<String> = consumers(graph, &id)
                .iter()
                .map(|s| s.name.clone())
                .collect();
            if !users.is_empty() {
                return Err(AppError::invalid(format!(
                    "« {id} » est utilisé par : {}. Retirez-les ou changez leurs dépendances d'abord.",
                    users.join(", ")
                )));
            }
            let before = graph.systems.len();
            graph.systems.retain(|s| s.id != id);
            if graph.systems.len() == before {
                return Err(AppError::not_found(format!("Système inconnu : {id}.")));
            }
            for task in &mut graph.tasks {
                task.systems.retain(|s| s != &id);
            }
            format!("Système « {id} » retiré du graphe (les fichiers du jeu ne sont pas touchés).")
        }
        GameGraphOp::SetSystemStatus { id, status } => {
            let system = find_system(graph, &id)?;
            system.status = status;
            format!("« {} » : état mis à jour.", system.name)
        }
        GameGraphOp::LinkFiles { id, files } => {
            let system = find_system(graph, &id)?;
            let mut added = 0;
            for file in files {
                let file = file.trim().replace('\\', "/");
                if !file.is_empty() && !system.files.contains(&file) {
                    system.files.push(file);
                    added += 1;
                }
            }
            format!("{added} fichier(s) rattaché(s) à « {} ».", system.name)
        }
        GameGraphOp::AddDecision {
            title,
            decision,
            reason,
            alternatives,
            tradeoffs,
        } => {
            if title.trim().is_empty() || decision.trim().is_empty() {
                return Err(AppError::invalid(
                    "Une décision a besoin d'un titre et d'un contenu.",
                ));
            }
            graph.decisions.push(GameDecision {
                id: new_id("d"),
                title: title.trim().to_string(),
                decision: decision.trim().to_string(),
                reason: reason.trim().to_string(),
                alternatives,
                tradeoffs,
                by: by.to_string(),
                at: now(),
            });
            format!("Décision « {} » enregistrée.", title.trim())
        }
        GameGraphOp::RemoveDecision { id } => {
            let before = graph.decisions.len();
            graph.decisions.retain(|d| d.id != id);
            if before == graph.decisions.len() {
                return Err(AppError::not_found("Décision introuvable."));
            }
            "Décision retirée.".to_string()
        }
        GameGraphOp::AddAssumption {
            topic,
            value,
            reason,
        } => {
            graph.assumptions.push(GameAssumption {
                id: new_id("a"),
                topic: topic.trim().to_string(),
                value: value.trim().to_string(),
                reason: reason.trim().to_string(),
                status: GameAssumptionStatus::Editable,
                at: now(),
            });
            format!("Hypothèse « {} » notée.", value.trim())
        }
        GameGraphOp::SetAssumption { id, value, status } => {
            let index = graph
                .assumptions
                .iter()
                .position(|a| a.id == id)
                .ok_or_else(|| AppError::not_found("Hypothèse introuvable."))?;
            match value
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
            {
                Some(value) if value != graph.assumptions[index].value => {
                    let old = &mut graph.assumptions[index];
                    old.status = GameAssumptionStatus::Replaced;
                    let replacement = GameAssumption {
                        id: new_id("a"),
                        topic: old.topic.clone(),
                        value: value.clone(),
                        reason: format!("Changé par {by} (avant : {}).", old.value),
                        status: if status == GameAssumptionStatus::Replaced {
                            GameAssumptionStatus::Confirmed
                        } else {
                            status
                        },
                        at: now(),
                    };
                    let topic = replacement.topic.clone();
                    graph.assumptions.push(replacement);
                    format!("Hypothèse « {topic} » : {value}.")
                }
                _ => {
                    graph.assumptions[index].status = status;
                    format!(
                        "Hypothèse « {} » {}.",
                        graph.assumptions[index].value,
                        if status == GameAssumptionStatus::Confirmed {
                            "confirmée"
                        } else {
                            "mise à jour"
                        }
                    )
                }
            }
        }
        GameGraphOp::UpsertTask { mut task } => {
            if task.title.trim().is_empty() {
                return Err(AppError::invalid("Une tâche a besoin d'un titre."));
            }
            if task.id.trim().is_empty() {
                task.id = new_id("t");
            }
            let unknown: Vec<String> = task
                .depends_on
                .iter()
                .filter(|d| *d != &task.id && !graph.tasks.iter().any(|t| &t.id == *d))
                .cloned()
                .collect();
            if !unknown.is_empty() {
                return Err(AppError::invalid(format!(
                    "Tâches préalables inconnues : {}.",
                    unknown.join(", ")
                )));
            }
            task.updated_at = now();
            match graph.tasks.iter_mut().find(|t| t.id == task.id) {
                Some(existing) => {
                    task.created_at = existing.created_at.clone();
                    *existing = task.clone();
                    format!("Tâche « {} » mise à jour.", task.title)
                }
                None => {
                    if task.created_at.is_empty() {
                        task.created_at = task.updated_at.clone();
                    }
                    if task.order == 0 {
                        task.order = graph.tasks.iter().map(|t| t.order).max().unwrap_or(0) + 1;
                    }
                    let title = task.title.clone();
                    graph.tasks.push(task);
                    format!("Tâche « {title} » ajoutée.")
                }
            }
        }
        GameGraphOp::SetTaskStatus {
            id,
            status,
            result,
            conversation_id,
        } => {
            let blocked_by = {
                let task = graph
                    .tasks
                    .iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| AppError::not_found("Tâche introuvable."))?;
                task.depends_on
                    .iter()
                    .filter(|d| {
                        graph
                            .tasks
                            .iter()
                            .any(|t| &t.id == *d && t.status != GameTaskStatus::Done)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            };
            if status == GameTaskStatus::Running && !blocked_by.is_empty() {
                return Err(AppError::invalid(
                    "Cette tâche attend d'autres tâches non terminées.",
                ));
            }
            let task = graph
                .tasks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or_else(|| AppError::not_found("Tâche introuvable."))?;
            task.status = status;
            if result.is_some() {
                task.result = result;
            }
            if conversation_id.is_some() {
                task.conversation_id = conversation_id;
            }
            task.updated_at = now();
            format!("Tâche « {} » : {}.", task.title, task_label(status))
        }
        GameGraphOp::RemoveTask { id } => {
            if graph.tasks.iter().any(|t| t.depends_on.contains(&id)) {
                return Err(AppError::invalid(
                    "D'autres tâches attendent celle-ci : retirez d'abord ce lien.",
                ));
            }
            let before = graph.tasks.len();
            graph.tasks.retain(|t| t.id != id);
            if before == graph.tasks.len() {
                return Err(AppError::not_found("Tâche introuvable."));
            }
            "Tâche retirée.".to_string()
        }
        GameGraphOp::AddIssue {
            title,
            detail,
            severity,
            systems,
        } => {
            graph.issues.push(GameIssue {
                id: new_id("i"),
                title: title.clone(),
                detail,
                severity,
                systems,
                open: true,
                at: now(),
            });
            format!("Problème noté : {title}.")
        }
        GameGraphOp::SetIssueOpen { id, open } => {
            let issue = graph
                .issues
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or_else(|| AppError::not_found("Problème introuvable."))?;
            issue.open = open;
            format!(
                "« {} » {}.",
                issue.title,
                if open { "rouvert" } else { "résolu" }
            )
        }
        GameGraphOp::AddChange { mut change } => {
            if change.id.is_empty() {
                change.id = new_id("c");
            }
            if change.at.is_empty() {
                change.at = now();
            }
            if change.by.is_empty() {
                change.by = by.to_string();
            }
            let title = change.title.clone();
            graph.changes.push(change);
            format!("Modification « {title} » tracée.")
        }
        GameGraphOp::AddVersion {
            version,
            label,
            summary,
            checkpoint,
        } => {
            if graph.versions.iter().any(|v| v.version == version) {
                return Err(AppError::invalid(format!(
                    "La version {version} existe déjà."
                )));
            }
            graph.versions.push(GameVersion {
                version: version.clone(),
                label,
                summary,
                checkpoint,
                at: now(),
            });
            format!("Version {version} notée.")
        }
        GameGraphOp::UpsertPhase { phase } => {
            let title = phase.title.clone();
            match graph.roadmap.iter_mut().find(|p| p.id == phase.id) {
                Some(existing) => *existing = phase,
                None => graph.roadmap.push(phase),
            }
            format!("Phase « {title} » enregistrée.")
        }
        GameGraphOp::RemovePhase { id } => {
            graph.roadmap.retain(|p| p.id != id);
            "Phase retirée.".to_string()
        }
        GameGraphOp::SetWorld { world } => {
            let label = world.kind.label();
            graph.world = Some(world);
            format!("Architecture du monde : {label}.")
        }
        GameGraphOp::SetNetwork { network } => {
            let label = network.topology.label();
            graph.network = Some(network);
            format!("Réseau : {label}.")
        }
        GameGraphOp::UpsertAsset { mut asset } => {
            if asset.id.is_empty() {
                asset.id = new_id("as");
            }
            asset.updated_at = now();
            let name = asset.name.clone();
            match graph.assets.iter_mut().find(|a| a.id == asset.id) {
                Some(existing) => *existing = asset,
                None => graph.assets.push(asset),
            }
            format!("Asset « {name} » enregistré.")
        }
        GameGraphOp::RemoveAsset { id } => {
            graph.assets.retain(|a| a.id != id);
            for system in &mut graph.systems {
                system.assets.retain(|a| a != &id);
            }
            "Asset retiré du registre (le fichier reste sur le disque).".to_string()
        }
    };
    graph.revision += 1;
    Ok(message)
}

pub fn task_label(status: GameTaskStatus) -> &'static str {
    match status {
        GameTaskStatus::Todo => "à faire",
        GameTaskStatus::Running => "en cours",
        GameTaskStatus::Blocked => "bloquée",
        GameTaskStatus::Review => "à relire",
        GameTaskStatus::Done => "terminée",
        GameTaskStatus::Failed => "en échec",
        GameTaskStatus::Cancelled => "annulée",
    }
}

/// Tâches prêtes : à faire, et dont toutes les tâches préalables sont terminées.
#[allow(dead_code)] // outils MCP de Game Studio (phase 3)
pub fn ready_tasks(graph: &GameGraph) -> Vec<&GameTask> {
    let mut ready: Vec<&GameTask> = graph
        .tasks
        .iter()
        .filter(|t| t.status == GameTaskStatus::Todo)
        .filter(|t| {
            t.depends_on.iter().all(|d| {
                graph
                    .tasks
                    .iter()
                    .any(|o| &o.id == d && o.status == GameTaskStatus::Done)
            })
        })
        .collect();
    ready.sort_by_key(|t| t.order);
    ready
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::game_studio::types::{
        GameAgentRole, GameNetMode, GameSystemCategory, GameSystemStatus,
    };

    fn system(id: &str, deps: &[&str]) -> GameSystem {
        GameSystem {
            id: id.to_string(),
            name: id.to_string(),
            category: GameSystemCategory::Gameplay,
            role: "rôle".to_string(),
            origin: GameSystemOrigin::Custom,
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
            produces: vec![],
            files: vec![],
            assets: vec![],
            interfaces: vec![],
            data: vec![],
            constraints: vec![],
            tests: vec![],
            status: GameSystemStatus::Planned,
            network: GameNetMode::Local,
            risk: None,
            notes: None,
        }
    }

    fn task(id: &str, deps: &[&str]) -> GameTask {
        GameTask {
            id: id.to_string(),
            title: id.to_string(),
            description: String::new(),
            status: GameTaskStatus::Todo,
            role: GameAgentRole::Programming,
            depends_on: deps.iter().map(|d| d.to_string()).collect(),
            systems: vec![],
            files: vec![],
            expected: String::new(),
            validation: String::new(),
            phase: None,
            conversation_id: None,
            result: None,
            order: 0,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn keeps_dependencies_known_and_acyclic() {
        let mut g = GameGraph::default();
        apply(
            &mut g,
            GameGraphOp::UpsertSystem {
                system: system("health", &[]),
            },
            "test",
        )
        .unwrap();
        apply(
            &mut g,
            GameGraphOp::UpsertSystem {
                system: system("combat", &["health"]),
            },
            "test",
        )
        .unwrap();
        assert!(apply(
            &mut g,
            GameGraphOp::UpsertSystem {
                system: system("loot", &["inventory"])
            },
            "test"
        )
        .is_err());
        let cycle = apply(
            &mut g,
            GameGraphOp::UpsertSystem {
                system: system("health", &["combat"]),
            },
            "test",
        )
        .unwrap_err();
        assert!(cycle.message.contains("circulaire"), "{}", cycle.message);
        assert!(apply(
            &mut g,
            GameGraphOp::UpsertSystem {
                system: system("Bad Id", &[])
            },
            "test"
        )
        .is_err());
        assert_eq!(consumers(&g, "health").len(), 1);
        assert!(apply(
            &mut g,
            GameGraphOp::RemoveSystem {
                id: "health".into()
            },
            "test"
        )
        .is_err());
        apply(
            &mut g,
            GameGraphOp::RemoveSystem {
                id: "combat".into(),
            },
            "test",
        )
        .unwrap();
        apply(
            &mut g,
            GameGraphOp::RemoveSystem {
                id: "health".into(),
            },
            "test",
        )
        .unwrap();
        assert!(g.systems.is_empty());
        assert!(g.revision >= 4);
    }

    #[test]
    fn impact_follows_indirect_dependents() {
        let mut g = GameGraph::default();
        for (id, deps) in [
            ("items", vec![]),
            ("inventory", vec!["items"]),
            ("crafting", vec!["inventory"]),
            ("shop", vec!["inventory"]),
            ("music", vec![]),
        ] {
            apply(
                &mut g,
                GameGraphOp::UpsertSystem {
                    system: system(id, &deps),
                },
                "test",
            )
            .unwrap();
        }
        assert_eq!(impact(&g, "items"), vec!["crafting", "inventory", "shop"]);
        assert!(impact(&g, "music").is_empty());
    }

    #[test]
    fn catalog_systems_bring_their_dependencies() {
        let mut g = GameGraph::default();
        let message = apply(
            &mut g,
            GameGraphOp::AddCatalogSystem {
                id: "crafting".into(),
            },
            "test",
        )
        .unwrap();
        assert!(message.contains("nécessaire"), "{message}");
        let ids: Vec<&str> = g.systems.iter().map(|s| s.id.as_str()).collect();
        for id in [
            "crafting",
            "inventory",
            "item_database",
            "game_data",
            "crafting_ui",
        ] {
            assert!(ids.contains(&id), "{id} manquant : {ids:?}");
        }
        for s in &g.systems {
            for d in &s.dependencies {
                assert!(ids.contains(&d.as_str()), "{} → {d} absent", s.id);
            }
        }
    }

    #[test]
    fn replaced_assumptions_keep_history() {
        let mut g = GameGraph::default();
        apply(
            &mut g,
            GameGraphOp::AddAssumption {
                topic: "camera".into(),
                value: "Troisième personne".into(),
                reason: "non précisé".into(),
            },
            "analyse",
        )
        .unwrap();
        let id = g.assumptions[0].id.clone();
        apply(
            &mut g,
            GameGraphOp::SetAssumption {
                id,
                value: Some("Première personne".into()),
                status: GameAssumptionStatus::Confirmed,
            },
            "vous",
        )
        .unwrap();
        assert_eq!(g.assumptions.len(), 2);
        assert_eq!(g.assumptions[0].status, GameAssumptionStatus::Replaced);
        assert_eq!(g.assumptions[1].value, "Première personne");
        assert_eq!(g.assumptions[1].status, GameAssumptionStatus::Confirmed);
    }

    #[test]
    fn tasks_wait_for_their_prerequisites() {
        let mut g = GameGraph::default();
        apply(
            &mut g,
            GameGraphOp::UpsertTask {
                task: task("t1", &[]),
            },
            "test",
        )
        .unwrap();
        apply(
            &mut g,
            GameGraphOp::UpsertTask {
                task: task("t2", &["t1"]),
            },
            "test",
        )
        .unwrap();
        assert!(apply(
            &mut g,
            GameGraphOp::UpsertTask {
                task: task("t3", &["t9"])
            },
            "test"
        )
        .is_err());
        assert_eq!(
            ready_tasks(&g)
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["t1"]
        );
        assert!(apply(
            &mut g,
            GameGraphOp::SetTaskStatus {
                id: "t2".into(),
                status: GameTaskStatus::Running,
                result: None,
                conversation_id: None
            },
            "test"
        )
        .is_err());
        apply(
            &mut g,
            GameGraphOp::SetTaskStatus {
                id: "t1".into(),
                status: GameTaskStatus::Done,
                result: Some("fait".into()),
                conversation_id: None,
            },
            "test",
        )
        .unwrap();
        assert_eq!(
            ready_tasks(&g)
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["t2"]
        );
        assert!(apply(&mut g, GameGraphOp::RemoveTask { id: "t1".into() }, "test").is_err());
        assert!(g.tasks[1].order > g.tasks[0].order);
    }
}
