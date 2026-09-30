//! Consignes des agents (§40, §52, §84) : un brief du projet tiré du graphe (moteur, systèmes,
//! tâches, décisions, problèmes), les règles de Game Studio, et le rôle de l'agent (Directeur ou
//! spécialiste). Elles sont passées en prompt système aux CLI lancées par Game Studio ; les
//! agents agissent sur le projet avec leurs propres outils et sur Game Studio par les commandes
//! du module (serveur MCP d'ARCHIMED : `search_commands`, puis `run_action`).

use std::fmt::Write as _;

use super::types::*;

/// Au-delà, le brief renvoie aux commandes de lecture (list_systems, list_tasks) : le contexte
/// d'un agent ne doit pas être rempli par la liste complète d'un gros projet.
const MAX_SYSTEMS: usize = 60;
const MAX_TASKS: usize = 25;
const MAX_ASSETS: usize = 30;

/// Nom tel que les commandes l'attendent (`inProgress`, `programming`).
fn slug<T: serde::Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn role_focus(role: GameAgentRole) -> &'static str {
    use GameAgentRole::*;
    match role {
        Director => "Tu es le Directeur : tu tiens le plan, découpes les demandes en tâches (add_task, avec rôle, dépendances, résultat attendu et vérification), tranches les conflits entre systèmes et notes chaque choix d'architecture (add_decision). Tu peux faire toi-même une petite modification ; pour une grosse, crée les tâches et propose de les confier aux spécialistes.",
        GameDesign => "Tu es game designer : règles, boucle de jeu, équilibrage, sensations. Tu écris des règles testables et tu mets à jour les hypothèses (set_assumption) plutôt que de les contredire en silence.",
        Architecture => "Tu es architecte : découpage en systèmes, interfaces publiques, données, événements. Tu gardes les dépendances du graphe à jour (add_system, link_system_files) et refuses les dépendances circulaires.",
        Programming => "Tu es programmeur de gameplay : tu écris le code des systèmes dans le style du projet, rattaches les fichiers créés au système (link_system_files) et vérifies ton travail (check_game_code, run_tests).",
        World => "Tu t'occupes du monde : niveaux, génération procédurale, streaming, environnement. Tu respectes le plan du monde (découpage, LOD, budgets) décrit dans le projet.",
        AiNpc => "Tu t'occupes de l'IA et des PNJ : perception, décision, navigation, routines. Tu gardes les comportements lisibles et configurables par des données.",
        Modeling => "Tu t'occupes des modèles 3D : échelle et orientation du moteur, UV, noms de fichiers stables. Avec Blender sans fenêtre : un script Python du projet crée ou modifie le .blend (run_blender_script), read_blend_file le vérifie (triangles, échelle appliquée, textures), export_blend_model l'exporte (GLB pour Godot, FBX pour Unity et Unreal), puis import_assets_in_engine.",
        Texture => "Tu t'occupes des textures et matériaux : cohérence avec la charte graphique, tailles en puissances de deux, formats du moteur. generate_game_image produit une image suivant la charte (payant selon le fournisseur : la personne confirme) ; add_game_assets inscrit les fichiers existants.",
        Animation => "Tu t'occupes des animations : squelettes, machines à états, transitions, IK ; tu nommes les états comme le code qui les pilote.",
        Vfx => "Tu t'occupes des effets visuels : particules, shaders d'effets ; tu respectes le budget de performance.",
        UiUx => "Tu t'occupes de l'interface : menus, HUD, navigation au clavier et à la manette, lisibilité, accessibilité (tailles, contrastes, sous-titres).",
        Audio => "Tu t'occupes de l'audio : musique, ambiances, effets, mixage par bus ; chaque son est déclenché par un événement nommé.",
        Network => "Tu t'occupes du réseau : autorité, réplication, prédiction, latence. Tu respectes le mode réseau de chaque système et ne fais jamais confiance au client pour une règle du jeu.",
        Backend => "Tu t'occupes des services en ligne : comptes, sauvegardes distantes, classements. Aucun secret dans le code du jeu ni dans le dépôt : ils vont côté serveur ou dans le coffre du système.",
        Build => "Tu t'occupes des builds : préparation du projet, exports par plateforme, préréglages d'export ; tu lances export_build et expliques ce qui manque sur la machine plutôt que de contourner.",
        Qa => "Tu es chargé de la qualité : tests automatisés (test de démarrage, tests unitaires du moteur), vérifications des systèmes touchés et de ceux qui en dépendent ; tu notes les problèmes trouvés.",
        Debug => "Tu débogues : tu pars de l'erreur exacte (fichier, ligne, message), cherches la cause racine avant de corriger, corriges le minimum, puis relances la même vérification pour prouver la correction. Jamais de test désactivé ni d'erreur masquée.",
        Optimization => "Tu optimises : mesure d'abord (profileur du moteur), puis LOD, culling, regroupement, pools ; tu compares au budget de performance et gardes le comportement identique.",
    }
}

fn engine_rules(engine: Option<GameEngine>) -> &'static str {
    match engine {
        Some(GameEngine::Godot) => "Godot 4 : GDScript typé (`var x: int`), une scène `.tscn` par objet réutilisable, signaux plutôt que dépendances directes, `@onready` pour les nœuds. Les `.tscn` et `.tres` sont du texte : modifiables avec soin, en gardant les `uid` et `ExtResource` cohérents. Ne touche pas au dossier `.godot/` (généré).",
        Some(GameEngine::Unity) => "Unity : scripts C# dans `Assets/Scripts`, un `MonoBehaviour` par responsabilité, données dans des `ScriptableObject`. Les scènes et prefabs (`.unity`, `.prefab`) ne se modifient pas à la main : passe par un script d'éditeur ou demande à la personne. Chaque fichier d'`Assets/` a son `.meta` : ne les supprime pas. Ne touche pas à `Library/` ni `Temp/`.",
        Some(GameEngine::Unreal) => "Unreal : C++ dans `Source/<Module>/` (classes `U`/`A` avec `UCLASS`/`UPROPERTY`), dépendances de modules dans le `.Build.cs`. Les Blueprints et les `.uasset` sont binaires : on ne les écrit pas à la main (script Python d'éditeur ou demande à la personne). Ne touche pas à `Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/`.",
        None => "Le moteur n'est pas encore choisi : travaille sur la conception (systèmes, décisions, tâches) sans écrire de code moteur.",
    }
}

/// Consignes complètes d'un agent pour ce projet (prompt système).
pub fn instructions(
    project: &GameProject,
    graph: &GameGraph,
    role: GameAgentRole,
    engine_info: Option<&GameEngineInfo>,
) -> String {
    let mut out = String::new();
    let engine = project
        .engine
        .map(|e| {
            format!(
                "{}{}",
                e.label(),
                project
                    .engine_version
                    .as_deref()
                    .map(|v| format!(" {v}"))
                    .unwrap_or_default()
            )
        })
        .unwrap_or_else(|| "aucun moteur choisi".to_string());
    let _ = writeln!(
        out,
        "Tu travailles dans Game Studio (application ARCHIMED) sur le jeu « {} » : {engine}, {}, dossier de travail = racine du projet.",
        project.name,
        project.dimension.label()
    );
    let _ = writeln!(out, "\n{}", role_focus(role));

    out.push_str(
        "\nRègles de Game Studio :\n\
         - N'invente rien : pas de fonction, de capacité du moteur ou de résultat de build supposés. Si tu n'as pas vérifié, dis-le.\n\
         - Tu peux piloter Game Studio avec les outils MCP d'ARCHIMED : `search_commands` (module game-studio) puis `run_action`. Utiles : check_game_code, run_tests, engine_action_result, list_systems, describe_system, add_system, link_system_files, set_system_status, add_task, update_task, set_task_status, add_decision, set_assumption, list_game_issues, resolve_game_issue, create_checkpoint, list_game_assets, add_game_assets, import_assets_in_engine.\n\
         - Après avoir modifié du code : lance check_game_code (et run_tests si des tests existent) et corrige jusqu'à ce que ça passe. Sans ces outils, demande à la personne de cliquer « Vérifier le code » dans Build et tests.\n\
         - Rattache chaque fichier créé ou modifié au système concerné (link_system_files) et mets son statut à jour (set_system_status : inProgress, implemented ; validated seulement après une vérification réussie).\n\
         - Un choix d'architecture (structure de données, autorité réseau, découpage) se note avec add_decision : quoi, pourquoi, autres options.\n\
         - Avant une modification risquée ou étendue, prends un point de restauration (create_checkpoint). Ne supprime jamais de fichier du projet sans le dire.\n\
         - Aucun secret (clé d'API, jeton, mot de passe) dans le code du jeu, le dépôt ou les journaux.\n\
         - Réponds en français, brièvement : ce qui a été fait, ce qui a été vérifié, ce qui reste.\n",
    );
    let _ = writeln!(out, "\nMoteur : {}", engine_rules(project.engine));
    if let Some(info) = engine_info {
        if !info.languages.is_empty() {
            let _ = writeln!(out, "Langages du projet : {}.", info.languages.join(", "));
        }
        if let Some(scene) = &info.main_scene {
            let _ = writeln!(out, "Scène de démarrage : {scene}.");
        }
    }

    if !project.idea.trim().is_empty() {
        let _ = writeln!(out, "\nIdée du jeu : {}", project.idea.trim());
    }

    let _ = writeln!(
        out,
        "\nSystèmes du jeu ({}) — id : nom [statut] ← dépendances ; fichiers :",
        graph.systems.len()
    );
    for s in graph.systems.iter().take(MAX_SYSTEMS) {
        let deps = if s.dependencies.is_empty() {
            String::new()
        } else {
            format!(" ← {}", s.dependencies.join(", "))
        };
        let files = if s.files.is_empty() {
            String::new()
        } else {
            format!(" ; {}", s.files.join(", "))
        };
        let _ = writeln!(
            out,
            "- {} : {} [{}]{deps}{files}",
            s.id,
            s.name,
            slug(s.status)
        );
    }
    if graph.systems.len() > MAX_SYSTEMS {
        let _ = writeln!(
            out,
            "- … {} autres : list_systems.",
            graph.systems.len() - MAX_SYSTEMS
        );
    }

    let open: Vec<&GameTask> = graph
        .tasks
        .iter()
        .filter(|t| !matches!(t.status, GameTaskStatus::Done | GameTaskStatus::Cancelled))
        .collect();
    if !open.is_empty() {
        let _ = writeln!(out, "\nTâches ouvertes ({}) :", open.len());
        for t in open.iter().take(MAX_TASKS) {
            let _ = writeln!(
                out,
                "- {} : {} [{}, {}]",
                t.id,
                t.title,
                slug(t.status),
                slug(t.role)
            );
        }
        if open.len() > MAX_TASKS {
            let _ = writeln!(out, "- … list_tasks pour la suite.");
        }
    }
    if !graph.decisions.is_empty() {
        out.push_str(
            "\nDécisions déjà prises (à respecter, ou à remettre en cause explicitement) :\n",
        );
        for d in &graph.decisions {
            let _ = writeln!(out, "- {} : {}", d.title, d.decision);
        }
    }
    if !graph.assets.is_empty() {
        let _ = writeln!(
            out,
            "\nRessources du registre ({}) — nom : fichier [statut] :",
            graph.assets.len()
        );
        for a in graph.assets.iter().take(MAX_ASSETS) {
            let _ = writeln!(
                out,
                "- {} : {} [{}]",
                a.name,
                a.path.as_deref().unwrap_or("pas encore produit"),
                slug(a.status)
            );
        }
        if graph.assets.len() > MAX_ASSETS {
            let _ = writeln!(out, "- … list_game_assets pour la suite.");
        }
    }
    let issues: Vec<&GameIssue> = graph.issues.iter().filter(|i| i.open).collect();
    if !issues.is_empty() {
        out.push_str("\nProblèmes ouverts :\n");
        for i in issues {
            let _ = writeln!(out, "- {} : {}", i.id, i.title);
        }
    }
    out
}

/// Premier message d'un agent chargé d'une tâche.
pub fn task_request(task: &GameTask, graph: &GameGraph) -> String {
    let mut out = format!("Tâche {} : {}\n", task.id, task.title);
    if !task.description.trim().is_empty() {
        let _ = writeln!(out, "\n{}", task.description.trim());
    }
    if !task.systems.is_empty() {
        let names: Vec<String> = task
            .systems
            .iter()
            .map(|id| {
                graph
                    .systems
                    .iter()
                    .find(|s| &s.id == id)
                    .map(|s| format!("{} ({id})", s.name))
                    .unwrap_or_else(|| id.clone())
            })
            .collect();
        let _ = writeln!(out, "\nSystèmes : {}.", names.join(", "));
    }
    if !task.files.is_empty() {
        let _ = writeln!(out, "Fichiers : {}.", task.files.join(", "));
    }
    if !task.expected.trim().is_empty() {
        let _ = writeln!(out, "\nRésultat attendu : {}", task.expected.trim());
    }
    if !task.validation.trim().is_empty() {
        let _ = writeln!(out, "Vérification : {}", task.validation.trim());
    }
    let _ = write!(
        out,
        "\nQuand c'est fait et vérifié, passe la tâche à « review » (set_task_status) avec un compte rendu court ; si tu es bloqué, passe-la à « blocked » en disant pourquoi."
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(engine: Option<GameEngine>) -> GameProject {
        GameProject {
            id: "g-1".into(),
            name: "Nuit des Crocs".into(),
            root: "/jeux/crocs".into(),
            engine,
            engine_version: Some("4.4".into()),
            mode: GameMode::Standard,
            autonomy: GameAutonomy::Assisted,
            idea: "Survie coopérative la nuit.".into(),
            genres: vec![],
            dimension: GameDimension::ThreeD,
            targets: vec![GamePlatform::Windows],
            budget: GameBudget::default(),
            style: GameStyleGuide::default(),
            version: "0.1".into(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn instructions_carry_role_rules_and_graph() {
        let mut graph = GameGraph::default();
        let mut inventory = super::super::catalog::catalog()
            .unwrap()
            .get("inventory")
            .unwrap()
            .to_system();
        inventory.files = vec!["scripts/inventory.gd".into()];
        graph.systems.push(inventory);
        graph.issues.push(GameIssue {
            id: "i-1".into(),
            title: "Vérification échouée".into(),
            detail: String::new(),
            severity: GameIssueSeverity::Error,
            systems: vec![],
            open: true,
            at: String::new(),
            source: Some("run:check".into()),
        });
        let text = instructions(
            &project(Some(GameEngine::Godot)),
            &graph,
            GameAgentRole::Debug,
            None,
        );
        assert!(text.contains("« Nuit des Crocs » : Godot 4.4"));
        assert!(text.contains("cause racine"), "consigne du rôle");
        assert!(text.contains("GDScript typé"), "règles du moteur");
        assert!(text.contains("inventory : "));
        assert!(text.contains("scripts/inventory.gd"));
        assert!(text.contains("i-1 : Vérification échouée"));
        assert!(text.contains("check_game_code"));
        let design_only = instructions(&project(None), &graph, GameAgentRole::Director, None);
        assert!(design_only.contains("sans écrire de code moteur"));
    }

    #[test]
    fn task_request_states_expectations() {
        let graph = GameGraph::default();
        let task = GameTask {
            id: "t-2".into(),
            title: "Implémenter : Inventaire".into(),
            description: "Emplacements et piles.".into(),
            status: GameTaskStatus::Todo,
            role: GameAgentRole::Programming,
            depends_on: vec![],
            systems: vec!["inventory".into()],
            files: vec![],
            expected: "On ramasse un objet et il apparaît.".into(),
            validation: "Test de démarrage vert.".into(),
            phase: None,
            conversation_id: None,
            result: None,
            order: 2,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let text = task_request(&task, &graph);
        assert!(text.starts_with("Tâche t-2 : Implémenter : Inventaire"));
        assert!(text.contains("Résultat attendu : On ramasse"));
        assert!(text.contains("Vérification : Test de démarrage vert."));
        assert!(text.contains("set_task_status"));
    }
}
