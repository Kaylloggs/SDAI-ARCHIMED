//! Documents du projet (§93) : GDD (game design) et TDD (technique), écrits à partir du graphe
//! et des réglages, sans IA : chaque ligne vient d'un système, d'une décision, d'une hypothèse
//! ou d'un réglage enregistré. Ils se régénèrent quand le graphe change ; la personne ou un
//! agent les complète ensuite.

use std::fmt::Write as _;

use serde::Serialize;
use ts_rs::TS;

use super::graph::consumers;
use super::types::*;

/// Aperçu des deux documents.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameDocuments {
    pub gdd: String,
    pub tdd: String,
}

pub const GDD_PATH: &str = "docs/GDD.md";
pub const TDD_PATH: &str = "docs/TDD.md";

fn category(c: GameSystemCategory) -> &'static str {
    use GameSystemCategory::*;
    match c {
        Core => "Fondations",
        Player => "Joueur",
        Camera => "Caméra",
        Combat => "Combat",
        Ai => "IA des ennemis",
        Npc => "PNJ et simulation",
        Rpg => "Progression",
        Items => "Objets et inventaire",
        Crafting => "Fabrication",
        Building => "Construction",
        Vehicles => "Véhicules",
        Narrative => "Quêtes et narration",
        Economy => "Économie",
        World => "Monde",
        Generation => "Génération procédurale",
        Environment => "Temps et météo",
        Multiplayer => "Multijoueur",
        Backend => "Services en ligne",
        Persistence => "Sauvegarde",
        Ui => "Interface",
        Audio => "Audio",
        Visual => "Rendu, animation et effets",
        Gameplay => "Règles de jeu",
        Platform => "Plateformes et accessibilité",
    }
}

/// Ordre de lecture : le cœur du jeu d'abord, les fondations à la fin.
const ORDER: [GameSystemCategory; 24] = {
    use GameSystemCategory::*;
    [
        Gameplay,
        Player,
        Camera,
        Combat,
        Ai,
        Npc,
        Rpg,
        Items,
        Crafting,
        Building,
        Vehicles,
        Narrative,
        Economy,
        World,
        Generation,
        Environment,
        Multiplayer,
        Backend,
        Persistence,
        Ui,
        Audio,
        Visual,
        Platform,
        Core,
    ]
};

fn status(s: GameSystemStatus) -> &'static str {
    match s {
        GameSystemStatus::Planned => "prévu",
        GameSystemStatus::InProgress => "en cours",
        GameSystemStatus::Implemented => "implémenté",
        GameSystemStatus::Validated => "validé",
        GameSystemStatus::Broken => "cassé",
        GameSystemStatus::Deprecated => "abandonné",
    }
}

fn net_mode(n: GameNetMode) -> &'static str {
    match n {
        GameNetMode::Local => "local",
        GameNetMode::ServerAuthority => "autorité serveur",
        GameNetMode::Replicated => "répliqué",
        GameNetMode::Predicted => "prédit côté client",
        GameNetMode::ClientOnly => "client seulement",
    }
}

fn platform(p: GamePlatform) -> &'static str {
    match p {
        GamePlatform::Windows => "Windows",
        GamePlatform::Linux => "Linux",
        GamePlatform::Macos => "macOS",
        GamePlatform::Android => "Android",
        GamePlatform::Ios => "iOS",
        GamePlatform::Web => "Web",
        GamePlatform::Console => "Consoles",
    }
}

fn mode(m: GameMode) -> &'static str {
    match m {
        GameMode::Prototype => "prototype rapide",
        GameMode::Standard => "standard",
        GameMode::Advanced => "avancé",
        GameMode::Production => "production",
        GameMode::Existing => "projet existant",
    }
}

fn phase_status(s: GamePhaseStatus) -> &'static str {
    match s {
        GamePhaseStatus::Planned => "prévue",
        GamePhaseStatus::Active => "en cours",
        GamePhaseStatus::Done => "terminée",
    }
}

fn header(out: &mut String, title: &str, project: &GameProject, graph: &GameGraph) {
    let _ = writeln!(out, "# {} — {title}\n", project.name);
    let _ = writeln!(
        out,
        "> Écrit par Game Studio à partir du graphe du projet (version {} du jeu, {} systèmes). Chaque section reflète les systèmes, décisions et hypothèses enregistrés : complétez librement, mais un changement d'architecture se fait dans le graphe, puis le document se régénère.\n",
        project.version,
        graph.systems.len()
    );
}

fn list(out: &mut String, items: &[String]) {
    for item in items {
        let _ = writeln!(out, "- {item}");
    }
}

fn names(graph: &GameGraph, ids: &[String]) -> String {
    ids.iter()
        .map(|id| {
            graph
                .systems
                .iter()
                .find(|s| &s.id == id)
                .map(|s| s.name.clone())
                .unwrap_or_else(|| id.clone())
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Document de game design.
pub fn gdd(project: &GameProject, graph: &GameGraph) -> String {
    let mut out = String::new();
    header(&mut out, "Document de game design", project, graph);

    out.push_str("## Vision\n\n");
    if project.idea.trim().is_empty() {
        out.push_str("_Idée à écrire (Conception)._\n\n");
    } else {
        let _ = writeln!(out, "{}\n", project.idea.trim());
    }
    let mut facts = vec![format!("Dimension : {}", project.dimension.label())];
    if !project.genres.is_empty() {
        facts.push(format!(
            "Genres (descriptifs) : {}",
            project.genres.join(", ")
        ));
    }
    if !project.targets.is_empty() {
        facts.push(format!(
            "Plateformes : {}",
            project
                .targets
                .iter()
                .map(|p| platform(*p))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    facts.push(format!("Ambition : {}", mode(project.mode)));
    list(&mut out, &facts);
    out.push('\n');

    out.push_str("## Systèmes de jeu\n\n");
    if graph.systems.is_empty() {
        out.push_str("_Aucun système dans le graphe._\n\n");
    }
    for cat in ORDER {
        let systems: Vec<&GameSystem> =
            graph.systems.iter().filter(|s| s.category == cat).collect();
        if systems.is_empty() {
            continue;
        }
        let _ = writeln!(out, "### {}\n", category(cat));
        for s in systems {
            let _ = writeln!(out, "**{}** ({}) — {}", s.name, status(s.status), s.role);
            if !s.tests.is_empty() {
                let _ = writeln!(out, "\n_Ce que la personne doit pouvoir vérifier :_");
                list(&mut out, &s.tests);
            }
            out.push('\n');
        }
    }

    if let Some(world) = &graph.world {
        out.push_str("## Monde\n\n");
        let _ = writeln!(out, "{} — {}\n", world.kind.label(), world.reason);
        if !world.traits.is_empty() {
            let _ = writeln!(
                out,
                "Traits : {}.\n",
                world
                    .traits
                    .iter()
                    .map(|t| t.label())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }
    if let Some(network) = &graph.network {
        out.push_str("## Multijoueur\n\n");
        let players = network
            .max_players
            .map(|n| format!(", jusqu'à {n} joueurs"))
            .unwrap_or_default();
        let _ = writeln!(
            out,
            "{}{players} — {}\n",
            network.topology.label(),
            network.reason
        );
    }

    let style = &project.style;
    let fields = [
        ("Style visuel", &style.visual_style),
        ("Matériaux", &style.materials),
        ("Personnages", &style.character_style),
        ("Environnements", &style.environment_style),
        ("Interface", &style.ui_style),
        ("Typographie", &style.typography),
        ("Effets", &style.vfx_style),
        ("Audio", &style.audio_style),
    ];
    let filled: Vec<String> = fields
        .iter()
        .filter(|(_, v)| !v.trim().is_empty())
        .map(|(k, v)| format!("{k} : {}", v.trim()))
        .collect();
    if !filled.is_empty() || !style.palette.is_empty() {
        out.push_str("## Direction artistique\n\n");
        list(&mut out, &filled);
        if !style.palette.is_empty() {
            let _ = writeln!(out, "- Palette : {}", style.palette.join(", "));
        }
        if !style.references.is_empty() {
            let _ = writeln!(out, "- Références : {}", style.references.join(", "));
        }
        out.push('\n');
    }

    let open: Vec<&GameAssumption> = graph
        .assumptions
        .iter()
        .filter(|a| a.status == GameAssumptionStatus::Editable)
        .collect();
    if !open.is_empty() {
        out.push_str("## Hypothèses à confirmer\n\n");
        for a in open {
            let _ = writeln!(out, "- **{}** : {} ({})", a.topic, a.value, a.reason);
        }
        out.push('\n');
    }

    if !graph.roadmap.is_empty() {
        out.push_str("## Feuille de route\n\n");
        for (i, phase) in graph.roadmap.iter().enumerate() {
            let _ = writeln!(
                out,
                "{}. **{}** ({})",
                i + 1,
                phase.title,
                phase_status(phase.status)
            );
            for goal in &phase.goals {
                let _ = writeln!(out, "   - {goal}");
            }
            if !phase.systems.is_empty() {
                let _ = writeln!(out, "   - Systèmes : {}", names(graph, &phase.systems));
            }
        }
        out.push('\n');
    }
    out
}

/// Document technique.
pub fn tdd(project: &GameProject, graph: &GameGraph, engine: Option<&GameEngineInfo>) -> String {
    let mut out = String::new();
    header(&mut out, "Document technique", project, graph);

    out.push_str("## Moteur et plateformes\n\n");
    let mut facts = Vec::new();
    match project.engine {
        Some(e) => facts.push(format!(
            "Moteur : {}{}",
            e.label(),
            project
                .engine_version
                .as_deref()
                .map(|v| format!(" {v}"))
                .unwrap_or_default()
        )),
        None => facts.push("Moteur : pas encore choisi".to_string()),
    }
    if let Some(info) = engine {
        if !info.languages.is_empty() {
            facts.push(format!("Langages : {}", info.languages.join(", ")));
        }
        if let Some(scene) = &info.main_scene {
            facts.push(format!("Scène de démarrage : `{scene}`"));
        }
    }
    if !project.targets.is_empty() {
        facts.push(format!(
            "Cibles de build : {}",
            project
                .targets
                .iter()
                .map(|p| platform(*p))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    list(&mut out, &facts);
    out.push('\n');

    let b = &project.budget;
    let budget: Vec<String> = [
        b.target_fps.map(|v| format!("{v} images par seconde")),
        b.resolution.as_ref().map(|v| format!("résolution {v}")),
        b.memory_mb.map(|v| format!("mémoire {v} Mo")),
        b.cpu_ms.map(|v| format!("CPU {v} ms par image")),
        b.gpu_ms.map(|v| format!("GPU {v} ms par image")),
        b.network_kbps
            .map(|v| format!("réseau {v} kb/s par joueur")),
    ]
    .into_iter()
    .flatten()
    .collect();
    if !budget.is_empty() {
        out.push_str("### Budget de performance\n\n");
        list(&mut out, &budget);
        out.push('\n');
    }

    out.push_str("## Architecture des systèmes\n\n");
    let ordered =
        super::service::dependency_order(&graph.systems).unwrap_or_else(|_| graph.systems.clone());
    if ordered.is_empty() {
        out.push_str("_Aucun système._\n\n");
    } else {
        out.push_str("Ordre de construction (chaque système après ce dont il dépend) :\n\n");
        for (i, s) in ordered.iter().enumerate() {
            let _ = writeln!(out, "{}. {}", i + 1, s.name);
        }
        out.push('\n');
    }
    for s in &ordered {
        let _ = writeln!(out, "### {} (`{}`)\n", s.name, s.id);
        let _ = writeln!(out, "{}\n", s.role);
        let mut rows = vec![format!("Statut : {}", status(s.status))];
        if !s.dependencies.is_empty() {
            rows.push(format!("Dépend de : {}", names(graph, &s.dependencies)));
        }
        let users: Vec<String> = consumers(graph, &s.id)
            .iter()
            .map(|c| c.name.clone())
            .collect();
        if !users.is_empty() {
            rows.push(format!("Utilisé par : {}", users.join(", ")));
        }
        if !s.interfaces.is_empty() {
            rows.push(format!(
                "Interfaces : {}",
                s.interfaces
                    .iter()
                    .map(|i| format!("`{i}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if !s.data.is_empty() {
            rows.push(format!(
                "Données : {}",
                s.data
                    .iter()
                    .map(|d| format!("`{d}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if !s.produces.is_empty() {
            rows.push(format!(
                "Événements : {}",
                s.produces
                    .iter()
                    .map(|e| format!("`{e}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if graph
            .network
            .as_ref()
            .is_some_and(|n| n.topology != GameNetTopology::None)
        {
            rows.push(format!("Réseau : {}", net_mode(s.network)));
        }
        if !s.files.is_empty() {
            rows.push(format!(
                "Fichiers : {}",
                s.files
                    .iter()
                    .map(|f| format!("`{f}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if let Some(risk) = &s.risk {
            rows.push(format!("Risque : {risk}"));
        }
        list(&mut out, &rows);
        out.push('\n');
    }

    if let Some(world) = &graph.world {
        if !world.concerns.is_empty() {
            out.push_str("## Contraintes du monde\n\n");
            list(&mut out, &world.concerns);
            out.push('\n');
        }
    }
    if let Some(network) = graph
        .network
        .as_ref()
        .filter(|n| n.topology != GameNetTopology::None)
    {
        out.push_str("## Réseau\n\n");
        let _ = writeln!(out, "Topologie : {}.\n", network.topology.label());
        list(&mut out, &network.features);
        list(&mut out, &network.notes);
        out.push('\n');
    }

    if !graph.decisions.is_empty() {
        out.push_str("## Décisions d'architecture\n\n");
        for d in &graph.decisions {
            let _ = writeln!(
                out,
                "### {}\n\n**{}** — {}\n",
                d.title, d.decision, d.reason
            );
            if !d.alternatives.is_empty() {
                let _ = writeln!(out, "Autres options : {}.\n", d.alternatives.join(" ; "));
            }
            if let Some(t) = &d.tradeoffs {
                let _ = writeln!(out, "Compromis : {t}\n");
            }
        }
    }

    out.push_str("## Vérification\n\n");
    out.push_str("Chaque modification passe par « Vérifier le code » et « Lancer les tests » (Game Studio › Build et tests). Vérifications attendues par système :\n\n");
    let checks: Vec<String> = ordered
        .iter()
        .flat_map(|s| s.tests.iter().map(move |t| format!("{} : {t}", s.name)))
        .collect();
    if checks.is_empty() {
        out.push_str("_Aucune vérification décrite._\n");
    } else {
        list(&mut out, &checks);
    }
    out.push('\n');

    let open: Vec<&GameIssue> = graph.issues.iter().filter(|i| i.open).collect();
    if !open.is_empty() {
        out.push_str("## Problèmes ouverts\n\n");
        for i in open {
            let _ = writeln!(out, "- {}", i.title);
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::game_studio::analysis::{analyze, Installed};

    #[test]
    fn documents_follow_the_graph() {
        let analysis = analyze(
            "Un jeu de pêche relaxant en 2D avec une ville, des PNJ qui ont des routines et une économie.",
            &Installed::default(),
        )
        .unwrap();
        let project = GameProject {
            id: "g-1".into(),
            name: "Marée basse".into(),
            root: "/jeux/maree".into(),
            engine: Some(GameEngine::Godot),
            engine_version: Some("4.4".into()),
            mode: analysis.mode,
            autonomy: GameAutonomy::Assisted,
            idea: analysis.idea.clone(),
            genres: analysis.genres.clone(),
            dimension: analysis.dimension,
            targets: vec![GamePlatform::Windows],
            budget: GameBudget {
                target_fps: Some(60),
                ..Default::default()
            },
            style: GameStyleGuide {
                visual_style: "Pixel art doux".into(),
                ..Default::default()
            },
            version: "0.1".into(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        let graph = GameGraph {
            revision: 3,
            systems: analysis.systems.iter().map(|s| s.system.clone()).collect(),
            decisions: analysis.decisions.clone(),
            assumptions: analysis.assumptions.clone(),
            roadmap: analysis.roadmap.clone(),
            world: Some(analysis.world.clone()),
            network: Some(analysis.network.clone()),
            ..Default::default()
        };
        let g = gdd(&project, &graph);
        assert!(g.starts_with("# Marée basse — Document de game design"));
        assert!(g.contains("version 0.1 du jeu"));
        assert!(g.contains("Un jeu de pêche relaxant"));
        assert!(g.contains("Pixel art doux"));
        assert!(g.contains("## Feuille de route"));
        let fishing = graph
            .systems
            .iter()
            .find(|s| s.id == "fishing")
            .expect("pêche détectée");
        assert!(g.contains(&format!("**{}**", fishing.name)));

        let t = tdd(&project, &graph, None);
        assert!(t.contains("Moteur : Godot 4.4"));
        assert!(t.contains("60 images par seconde"));
        assert!(t.contains("Ordre de construction"));
        // Un système apparaît après ses dépendances dans l'ordre de construction.
        let pos = |name: &str| t.find(&format!(". {name}\n")).unwrap_or(usize::MAX);
        for s in &graph.systems {
            for d in &s.dependencies {
                let dep = graph.systems.iter().find(|x| &x.id == d).unwrap();
                assert!(
                    pos(&dep.name) < pos(&s.name),
                    "{} avant {}",
                    dep.name,
                    s.name
                );
            }
        }
        assert!(t.contains("## Décisions d'architecture"));
    }
}
