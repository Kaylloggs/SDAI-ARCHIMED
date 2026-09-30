//! Analyse d'une idée de jeu (§4) : mots de la personne → systèmes, dépendances, monde,
//! réseau, hypothèses, décisions, choix du moteur, feuille de route.
//!
//! Déterministe et local : aucune IA n'est appelée ici. L'analyse sert de point de départ
//! vérifiable ; l'agent directeur l'affine ensuite dans le graphe du projet (il peut ajouter
//! des systèmes absents du catalogue). Les genres ne font qu'ajouter des systèmes.

use std::collections::{BTreeMap, HashMap, HashSet};

use regex::Regex;

use crate::core::AppResult;

use super::catalog::{catalog, fold, Catalog, GenreDef, Words};
use super::types::{
    GameAnalysis, GameAssumption, GameAssumptionStatus, GameDecision, GameDetectedSystem,
    GameDimension, GameEngine, GameEngineScore, GameMode, GameNetMode, GameNetTopology,
    GameNetworkPlan, GamePhase, GamePhaseStatus, GamePlatform, GameQuestion, GameSystem,
    GameSystemCategory, GameWorldKind, GameWorldPlan,
};

/// Moteurs installés, pour le choix du moteur.
#[derive(Debug, Clone, Default)]
pub struct Installed {
    pub engines: Vec<GameEngine>,
}

/// Réseau voulu par l'idée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NetIntent {
    None,
    Coop,
    Competitive,
    Massive,
}

struct Detection<'a> {
    catalog: &'a Catalog,
    words: Words,
    folded: String,
    now: String,
    evidence: BTreeMap<String, Vec<String>>,
    required_by: BTreeMap<String, Vec<String>>,
    excluded: BTreeMap<String, String>,
    genres: Vec<&'a GenreDef>,
    assumptions: Vec<GameAssumption>,
    decisions: Vec<GameDecision>,
}

impl<'a> Detection<'a> {
    fn add(&mut self, id: &str, why: String) {
        if self.excluded.contains_key(id) || self.catalog.get(id).is_none() {
            return;
        }
        let entry = self.evidence.entry(id.to_string()).or_default();
        if !entry.contains(&why) {
            entry.push(why);
        }
    }

    fn has(&self, id: &str) -> bool {
        self.evidence.contains_key(id) || self.required_by.contains_key(id)
    }

    fn assume(&mut self, topic: &str, value: String, reason: String) {
        self.assumptions.push(GameAssumption {
            id: format!("a-{}", topic),
            topic: topic.to_string(),
            value,
            reason,
            status: GameAssumptionStatus::Editable,
            at: self.now.clone(),
        });
    }

    fn decide(
        &mut self,
        id: &str,
        title: &str,
        decision: String,
        reason: String,
        alternatives: Vec<String>,
        tradeoffs: Option<String>,
    ) {
        self.decisions.push(GameDecision {
            id: format!("d-{id}"),
            title: title.to_string(),
            decision,
            reason,
            alternatives,
            tradeoffs,
            by: "analyse".to_string(),
            at: self.now.clone(),
        });
    }
}

/// Analyse une idée. `installed` : moteurs trouvés sur la machine.
pub fn analyze(idea: &str, installed: &Installed) -> AppResult<GameAnalysis> {
    let catalog = catalog()?;
    let mut d = Detection {
        catalog,
        words: Words::new(idea),
        folded: fold(idea),
        now: chrono::Utc::now().to_rfc3339(),
        evidence: BTreeMap::new(),
        required_by: BTreeMap::new(),
        excluded: BTreeMap::new(),
        genres: Vec::new(),
        assumptions: Vec::new(),
        decisions: Vec::new(),
    };

    // 1. Systèmes nommés, et ceux que la personne refuse (« sans combat »).
    for system in &catalog.systems {
        if let Some(hit) = d.words.find_any(&system.keywords) {
            if hit.negated {
                d.excluded.insert(system.id.clone(), hit.keyword.clone());
            } else {
                d.evidence
                    .entry(system.id.clone())
                    .or_default()
                    .push(format!("« {} »", hit.keyword));
            }
        }
    }

    // 2. Genres et références : ils ajoutent des systèmes, rien d'autre.
    for genre in &catalog.genres {
        if let Some(hit) = d.words.find_any(&genre.keywords) {
            if !hit.negated {
                d.genres.push(genre);
            }
        }
    }
    let genres: Vec<&GenreDef> = d.genres.clone();
    for genre in &genres {
        for id in &genre.systems {
            d.add(id, format!("genre {}", genre.label));
        }
    }

    // Idée sans aucun système reconnu (« Je veux créer un jeu. ») : fondations seulement.
    let blank = d.evidence.is_empty() && genres.is_empty();

    // 3. Multijoueur : nombre de joueurs, type de réseau.
    let players = player_count(&d.folded);
    let net = net_intent(&d, &genres, players);

    // 4. Dimension et caméra.
    let dimension = choose_dimension(&mut d, &genres);
    if dimension != GameDimension::TwoD {
        // « Comme Terraria mais en 3D » : les tuiles du genre deviennent des voxels.
        let tiles_from_genre = d
            .evidence
            .get("tilemap_world")
            .is_some_and(|e| e.iter().all(|x| x.starts_with("genre ")));
        if tiles_from_genre {
            d.evidence.remove("tilemap_world");
            d.add("voxel_world", "monde en blocs demandé en 3D".to_string());
            d.decide(
                "voxel",
                "Monde en blocs en 3D",
                "Le monde en tuiles du genre devient un monde en voxels.".to_string(),
                "Le genre reconnu est en 2D mais l'idée demande la 3D : les tuiles deviennent des blocs 3D, stockés par chunks.".to_string(),
                vec!["Rester en 2D avec des tuiles".to_string()],
                Some("Un monde en voxels demande un maillage et une sauvegarde par chunk.".to_string()),
            );
        }
    }
    let perspective = if blank {
        "À définir".to_string()
    } else {
        choose_camera(&mut d, &genres, dimension)
    };

    // 5. Monde.
    let world = plan_world(&mut d, &genres, dimension, net != NetIntent::None);

    // 6. Réseau.
    let network = plan_network(&mut d, net, players);
    let multiplayer = network.topology != GameNetTopology::None;

    // 7. Fondations, compagnons (`adds`) et dépendances.
    for system in &catalog.systems {
        if system.is_foundation(dimension) {
            d.add(&system.id, "présent dans tout jeu".to_string());
        }
    }
    close_dependencies(&mut d);

    // 8. Plateformes, budget, moteur, mode, feuille de route.
    let targets = choose_targets(&mut d);
    let engines = rank_engines(&d, dimension, &world, &network, &targets, installed);
    if let Some(best) = engines.first() {
        let alternatives = engines
            .iter()
            .skip(1)
            .map(|e| {
                format!(
                    "{} ({})",
                    e.engine.label(),
                    e.reasons.first().cloned().unwrap_or_default()
                )
            })
            .collect();
        let concerns = if best.concerns.is_empty() {
            None
        } else {
            Some(best.concerns.join(" "))
        };
        d.decide(
            "engine",
            "Moteur",
            best.engine.label().to_string(),
            best.reasons.join(" "),
            alternatives,
            concerns,
        );
    }
    let mode = if blank {
        GameMode::Prototype
    } else {
        choose_mode(&d, &network)
    };

    let mut systems = build_systems(&d, multiplayer);
    systems.sort_by(|a, b| {
        (
            a.foundation,
            category_rank(a.system.category),
            a.system.name.clone(),
        )
            .cmp(&(
                b.foundation,
                category_rank(b.system.category),
                b.system.name.clone(),
            ))
    });

    let data_types: Vec<String> = {
        let mut set: Vec<String> = systems.iter().flat_map(|s| s.system.data.clone()).collect();
        set.sort();
        set.dedup();
        set
    };
    if !data_types.is_empty() {
        d.decide(
            "data",
            "Contenu en données",
            format!("Le contenu est décrit en données : {}.", data_types.join(", ")),
            "Les agents peuvent créer des dizaines d'éléments (armes, ennemis, recettes) sans réécrire le code des systèmes (§60).".to_string(),
            vec!["Contenu écrit dans le code".to_string()],
            Some("Un peu plus de travail au départ pour les formats de données.".to_string()),
        );
    }
    d.decide(
        "events",
        "Communication entre systèmes",
        "Les systèmes communiquent par événements et interfaces, sans dépendance circulaire."
            .to_string(),
        "Un système modifié casse moins les autres, et chacun se teste seul (§61).".to_string(),
        vec!["Appels directs entre systèmes".to_string()],
        None,
    );

    let risks = collect_risks(&d, &systems, &world, &network, &targets);
    let questions = questions(&d, &network, players, blank);
    let roadmap = roadmap(&systems, multiplayer, mode);
    let content = content_needs(&d);
    let genre_labels: Vec<String> = genres.iter().map(|g| g.label.clone()).collect();

    for (id, keyword) in &d.excluded {
        if let Some(system) = catalog.get(id) {
            if !d.has(id) {
                d.decisions.push(GameDecision {
                    id: format!("d-exclude-{id}"),
                    title: format!("Sans {}", system.name.to_lowercase()),
                    decision: format!("{} n'est pas prévu.", system.name),
                    reason: format!("L'idée l'exclut (« {} » précédé d'une négation).", keyword),
                    alternatives: Vec::new(),
                    tradeoffs: None,
                    by: "analyse".to_string(),
                    at: d.now.clone(),
                });
            }
        }
    }

    Ok(GameAnalysis {
        idea: idea.trim().to_string(),
        name: suggest_name(idea),
        genres: genre_labels,
        dimension,
        perspective,
        systems,
        world,
        network,
        assumptions: d.assumptions,
        decisions: d.decisions,
        engines,
        mode,
        roadmap,
        content,
        risks,
        questions,
        targets,
    })
}

fn category_rank(category: GameSystemCategory) -> usize {
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
    .iter()
    .position(|c| *c == category)
    .unwrap_or(99)
}

// ─── Joueurs et réseau ────────────────────────────────────────────────────────────────────

fn number_word(word: &str) -> Option<u32> {
    Some(match word {
        "un" | "une" | "one" => 1,
        "deux" | "two" => 2,
        "trois" | "three" => 3,
        "quatre" | "four" => 4,
        "cinq" | "five" => 5,
        "six" => 6,
        "sept" | "seven" => 7,
        "huit" | "eight" => 8,
        "dix" | "ten" => 10,
        "douze" | "twelve" => 12,
        "vingt" | "twenty" => 20,
        "cent" | "hundred" => 100,
        "mille" | "thousand" => 1000,
        _ => return None,
    })
}

fn parse_number(text: &str) -> Option<u32> {
    let digits: String = text.chars().filter(char::is_ascii_digit).collect();
    if digits.is_empty() {
        number_word(text)
    } else {
        digits.parse().ok()
    }
}

/// Nombre de joueurs d'une partie, s'il est dit (« coop à 3 », « 5v5 », « 10 000 joueurs »,
/// « avec trois amis » = 4).
pub fn player_count(folded: &str) -> Option<u32> {
    let versus = Regex::new(r"\b(\d+)\s*(?:v|vs|contre)\s*(\d+)\b").ok()?;
    if let Some(c) = versus.captures(folded) {
        let a: u32 = c[1].parse().ok()?;
        let b: u32 = c[2].parse().ok()?;
        return Some(a + b);
    }
    let count = Regex::new(
        r"\b(\d{1,3}(?: \d{3})+|\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|douze|vingt|cent|mille|two|three|four|five|six|eight|ten|twelve|twenty|hundred|thousand)\s+(?:joueurs?|players?|personnes)\b",
    )
    .ok()?;
    let mut best: Option<u32> = None;
    for c in count.captures_iter(folded) {
        if let Some(n) = parse_number(&c[1]) {
            best = Some(best.map_or(n, |b| b.max(n)));
        }
    }
    if best.is_some() {
        return best;
    }
    let coop = Regex::new(r"\b(?:coop|co op|cooperatif|multijoueur|multiplayer)\s+(?:a|jusqu a|avec|for|up to)\s+(\d+|deux|trois|quatre|cinq|six|huit|two|three|four|five|six|eight)\b").ok()?;
    if let Some(c) = coop.captures(folded) {
        return parse_number(&c[1]);
    }
    let friends = Regex::new(
        r"\bavec\s+(un|deux|trois|quatre|cinq|six|sept|huit|\d+)\s+(?:amis|copains|potes)\b",
    )
    .ok()?;
    if let Some(c) = friends.captures(folded) {
        return parse_number(&c[1]).map(|n| n + 1);
    }
    let with = Regex::new(r"\bwith\s+(one|two|three|four|five|six|seven|\d+)\s+friends\b").ok()?;
    with.captures(folded)
        .and_then(|c| parse_number(&c[1]))
        .map(|n| n + 1)
}

fn net_intent(d: &Detection, genres: &[&GenreDef], players: Option<u32>) -> NetIntent {
    let mut intent = NetIntent::None;
    let mut raise = |next: NetIntent| {
        let rank = |n: NetIntent| match n {
            NetIntent::None => 0,
            NetIntent::Coop => 1,
            NetIntent::Competitive => 2,
            NetIntent::Massive => 3,
        };
        if rank(next) > rank(intent) {
            intent = next;
        }
    };
    if d.excluded.contains_key("networking") {
        return NetIntent::None;
    }
    if d.evidence.contains_key("networking") || d.evidence.contains_key("split_screen") {
        raise(NetIntent::Coop);
    }
    for genre in genres {
        match genre.network.as_deref() {
            Some("coop") => raise(NetIntent::Coop),
            Some("competitive") => raise(NetIntent::Competitive),
            Some("massive") => raise(NetIntent::Massive),
            _ => {}
        }
    }
    if d.words.has_any(&[
        "pvp",
        "competitif",
        "competitive",
        "mode classe",
        "parties classees",
        "ranked",
        "esport",
        "joueur contre joueur",
    ]) {
        raise(NetIntent::Competitive);
    }
    if d.words
        .has_any(&["mmo", "mmorpg", "monde persistant", "massivement"])
    {
        raise(NetIntent::Massive);
    }
    match players {
        Some(n) if n >= 200 => raise(NetIntent::Massive),
        Some(n) if n >= 2 => raise(NetIntent::Coop),
        _ => {}
    }
    intent
}

fn plan_network(d: &mut Detection, intent: NetIntent, players: Option<u32>) -> GameNetworkPlan {
    if intent == NetIntent::None {
        if d.excluded.contains_key("networking") {
            return GameNetworkPlan {
                topology: GameNetTopology::None,
                max_players: Some(1),
                reason: "L'idée exclut le multijoueur.".to_string(),
                features: Vec::new(),
                notes: Vec::new(),
            };
        }
        return GameNetworkPlan {
            topology: GameNetTopology::None,
            max_players: Some(1),
            reason: "Aucun multijoueur demandé : jeu solo. Les systèmes restent découplés pour l'ajouter plus tard.".to_string(),
            features: Vec::new(),
            notes: Vec::new(),
        };
    }

    let local_only = d.evidence.contains_key("split_screen")
        && !d
            .words
            .has_any(&["en ligne", "online", "internet", "serveur"]);
    let genre_players = d.genres.iter().filter_map(|g| g.players).max();
    let count = match players.or(genre_players) {
        Some(n) => n,
        None => {
            let n = if intent == NetIntent::Competitive {
                10
            } else {
                4
            };
            d.assume(
                "players",
                format!("{n} joueurs par partie"),
                "Le nombre de joueurs n'est pas précisé : valeur courante pour ce type de jeu."
                    .to_string(),
            );
            n
        }
    };
    if players.is_none() && genre_players.is_some() {
        d.assume(
            "players",
            format!("{count} joueurs par partie"),
            "Valeur typique du genre reconnu ; à ajuster.".to_string(),
        );
    }

    let explicit_dedicated = d.evidence.contains_key("dedicated_server");
    let topology = if local_only {
        GameNetTopology::Local
    } else if intent == NetIntent::Massive || count >= 200 {
        GameNetTopology::Persistent
    } else if intent == NetIntent::Competitive || count > 16 || explicit_dedicated {
        GameNetTopology::DedicatedServer
    } else {
        GameNetTopology::ListenServer
    };

    let realtime = ["player_controller", "vehicles", "shooting", "combat_core"]
        .iter()
        .any(|id| d.has(id));
    let mut features = Vec::new();
    let mut notes = Vec::new();
    if topology != GameNetTopology::Local {
        d.add("replication", "multijoueur en ligne".to_string());
        features.push("Réplication de l'état".to_string());
        if realtime {
            d.add(
                "client_prediction",
                "action en temps réel en ligne".to_string(),
            );
            features.push("Prédiction côté client et interpolation".to_string());
        }
        if topology != GameNetTopology::Persistent {
            d.add("lobby", "rejoindre une partie".to_string());
            features.push("Salon et invitations".to_string());
        }
    } else {
        d.add("split_screen", "multijoueur local".to_string());
    }
    if matches!(
        topology,
        GameNetTopology::DedicatedServer | GameNetTopology::Persistent
    ) {
        d.add("dedicated_server", "serveur qui fait autorité".to_string());
        features.push("Serveur dédié qui fait autorité".to_string());
    }
    if intent == NetIntent::Competitive {
        d.add("matchmaking", "jeu compétitif".to_string());
        d.add("anti_cheat", "jeu compétitif".to_string());
        features.push("Matchmaking".to_string());
        features.push("Validation serveur contre la triche".to_string());
        if d.has("shooting") {
            d.add("lag_compensation", "tir en ligne compétitif".to_string());
            features.push("Compensation de latence des tirs".to_string());
        }
    }
    if topology == GameNetTopology::Persistent {
        for id in ["persistent_world", "accounts", "chat"] {
            d.add(id, "monde persistant en ligne".to_string());
        }
        features.push("Comptes, persistance et découpage du monde en zones".to_string());
    }
    features.push("Reconnexion d'un joueur à la même partie".to_string());

    let tick = match (topology, intent) {
        (GameNetTopology::Persistent, _) => "10 à 20 mises à jour par seconde avec gestion d'intérêt (chaque client ne reçoit que ce qui l'entoure)",
        (_, NetIntent::Competitive) if d.has("shooting") => "60 mises à jour par seconde ou plus côté serveur pour des tirs justes",
        (_, NetIntent::Competitive) => "30 à 60 mises à jour par seconde",
        _ => "20 à 30 mises à jour par seconde suffisent en coopération",
    };
    notes.push(format!("Fréquence : {tick}."));
    // Ordre de grandeur : position + rotation compressées (~16 octets) par entité et par envoi.
    let rate: u32 = if intent == NetIntent::Competitive {
        60
    } else {
        30
    };
    let per_client_kbps = (count.min(64) * 16 * rate * 8) / 1000;
    notes.push(format!(
        "Bande passante des joueurs seuls : environ {per_client_kbps} kbit/s descendants par client pour {} joueurs visibles, avant ennemis et objets.",
        count.min(64)
    ));
    notes.push("Ne jamais faire confiance au client : dégâts, inventaire et économie sont validés par le serveur.".to_string());
    if topology == GameNetTopology::ListenServer {
        notes.push(
            "Hôte joueur : si l'hôte quitte, la partie s'arrête (ou migration d'hôte à prévoir)."
                .to_string(),
        );
    }

    let reason = match topology {
        GameNetTopology::Local => "Plusieurs joueurs sur la même machine, sans réseau.".to_string(),
        GameNetTopology::ListenServer => {
            format!("Coopération à {count} joueurs : un joueur héberge, aucun serveur à payer.")
        }
        GameNetTopology::DedicatedServer => format!(
            "{count} joueurs par partie et besoin d'équité : un serveur dédié fait autorité."
        ),
        GameNetTopology::Persistent => {
            "Monde partagé qui survit aux connexions : serveurs persistants et services en ligne."
                .to_string()
        }
        GameNetTopology::None => String::new(),
    };
    d.decide(
        "network",
        "Réseau",
        topology.label().to_string(),
        reason.clone(),
        match topology {
            GameNetTopology::ListenServer => {
                vec!["Serveur dédié (plus équitable, coûte un hébergement)".to_string()]
            }
            GameNetTopology::DedicatedServer => vec![
                "Hôte joueur (gratuit, mais l'hôte a l'avantage et la triche est plus facile)"
                    .to_string(),
            ],
            GameNetTopology::Persistent => vec![
                "Sessions séparées sur serveurs dédiés (plus simple, monde non partagé)"
                    .to_string(),
            ],
            _ => Vec::new(),
        },
        None,
    );

    GameNetworkPlan {
        topology,
        max_players: Some(count),
        reason,
        features,
        notes,
    }
}

// ─── Dimension, caméra ────────────────────────────────────────────────────────────────────

fn choose_dimension(d: &mut Detection, genres: &[&GenreDef]) -> GameDimension {
    let tokens = d.words.tokens();
    let has_token = |t: &str| tokens.iter().any(|w| w == t);
    if d.folded.contains("2 5d") || d.folded.contains("2 5 d") {
        return GameDimension::TwoAndHalfD;
    }
    if has_token("3d") && !has_token("2d") {
        return GameDimension::ThreeD;
    }
    if has_token("2d") && !has_token("3d") {
        return GameDimension::TwoD;
    }
    // « comme Terraria mais en 3D » : les deux sont écrits, la phrase « en 3d » tranche.
    if has_token("2d") && has_token("3d") {
        if d.folded.contains("en 3d") {
            return GameDimension::ThreeD;
        }
        if d.folded.contains("en 2d") {
            return GameDimension::TwoD;
        }
    }
    if d.words.has_any(&["pixel art", "sprite", "sprites"]) {
        return GameDimension::TwoD;
    }
    if d.has("voxel_world") {
        return GameDimension::ThreeD;
    }
    if let Some(dimension) = genres.iter().find_map(|g| g.dimension()) {
        d.assume(
            "dimension",
            dimension.label().to_string(),
            "Dimension habituelle du genre reconnu ; l'idée ne la précise pas.".to_string(),
        );
        return dimension;
    }
    let three_d_hints = [
        "camera_first_person",
        "camera_third_person",
        "vehicles",
        "aircraft",
        "open_world",
        "shooting",
    ];
    if three_d_hints.iter().any(|id| d.has(id)) {
        d.assume(
            "dimension",
            "3D".to_string(),
            "Caméra, véhicules ou monde ouvert demandés, plus naturels en 3D.".to_string(),
        );
        return GameDimension::ThreeD;
    }
    let reason = if d.evidence.is_empty() {
        "Aucune indication : la 2D est la plus rapide à prototyper."
    } else {
        "Dimension non précisée : la 2D est plus rapide à produire (art et animations)."
    };
    d.assume("dimension", "2D".to_string(), reason.to_string());
    GameDimension::TwoD
}

const CAMERAS: [&str; 5] = [
    "camera_first_person",
    "camera_third_person",
    "camera_top_down",
    "camera_side",
    "camera_strategy",
];

fn choose_camera(d: &mut Detection, genres: &[&GenreDef], dimension: GameDimension) -> String {
    let explicit: Vec<&str> = CAMERAS
        .iter()
        .copied()
        .filter(|id| d.evidence.contains_key(*id))
        .collect();
    let label = |id: &str| {
        d.catalog
            .get(id)
            .map(|s| s.name.clone())
            .unwrap_or_default()
    };
    if let Some(first) = explicit.first() {
        return label(first);
    }
    // Une caméra de profil n'a pas de sens pour un genre 2D demandé en 3D.
    let genre_camera = genres
        .iter()
        .filter_map(|g| g.camera.clone())
        .find(|c| dimension == GameDimension::TwoD || c != "camera_side");
    if let Some(camera) = genre_camera {
        let name = label(&camera);
        d.add(&camera, "caméra habituelle du genre".to_string());
        d.assume(
            "camera",
            name.clone(),
            "Caméra habituelle du genre reconnu ; l'idée ne la précise pas.".to_string(),
        );
        return name;
    }
    let ui_only = ["cards", "education", "narrative_choices", "turn_based"]
        .iter()
        .any(|id| d.has(id))
        && !d.has("player_controller");
    if ui_only {
        return "Interface (pas de caméra de jeu)".to_string();
    }
    let strategy = [
        "rts_units",
        "city_building",
        "management_sim",
        "tower_defense",
    ]
    .iter()
    .any(|id| d.has(id));
    let camera = if strategy {
        "camera_strategy"
    } else if dimension == GameDimension::TwoD {
        if ["platforming", "tilemap_world", "jumping"]
            .iter()
            .any(|id| d.has(id))
        {
            "camera_side"
        } else {
            "camera_top_down"
        }
    } else if d.has("shooting") && !d.has("vehicles") {
        "camera_first_person"
    } else {
        "camera_third_person"
    };
    let name = label(camera);
    d.add(camera, "caméra choisie par défaut".to_string());
    d.assume(
        "camera",
        name.clone(),
        "L'idée ne précise pas la caméra : choix le plus courant pour ces systèmes.".to_string(),
    );
    name
}

// ─── Monde ────────────────────────────────────────────────────────────────────────────────

fn plan_world(
    d: &mut Detection,
    genres: &[&GenreDef],
    dimension: GameDimension,
    multiplayer: bool,
) -> GameWorldPlan {
    let infinite = d.words.has_any(&[
        "infini",
        "infinie",
        "infinite",
        "sans limite",
        "sans limites",
        "illimite",
    ]) && (d.has("voxel_world")
        || d.has("world_generation")
        || d.has("tilemap_world")
        || d.has("open_world"));
    if infinite {
        d.add("world_generation", "monde infini".to_string());
    }
    if d.has("world_generation") && d.has("open_world") {
        d.add("terrain_generation", "monde ouvert généré".to_string());
    }
    let genre_world: Vec<GameWorldKind> = genres.iter().filter_map(|g| g.world).collect();

    let mut traits: Vec<GameWorldKind> = Vec::new();
    fn push_unique(traits: &mut Vec<GameWorldKind>, kind: GameWorldKind) {
        if !traits.contains(&kind) {
            traits.push(kind);
        }
    }
    if d.has("voxel_world") {
        push_unique(&mut traits, GameWorldKind::Voxel);
    }
    if d.has("tilemap_world") {
        push_unique(&mut traits, GameWorldKind::Tile);
    }
    if infinite {
        push_unique(&mut traits, GameWorldKind::Infinite);
    }
    if d.has("open_world") {
        push_unique(&mut traits, GameWorldKind::OpenWorld);
    }
    if d.has("world_generation") || d.has("dungeon_generation") {
        push_unique(&mut traits, GameWorldKind::Procedural);
    }
    for kind in &genre_world {
        push_unique(&mut traits, *kind);
    }
    if d.has("level_design") || d.has("platforming") {
        push_unique(&mut traits, GameWorldKind::LevelBased);
    }
    if d.has("destruction") || d.has("block_editing") {
        push_unique(&mut traits, GameWorldKind::Destructible);
    }
    let streaming = traits.iter().any(|k| {
        matches!(
            k,
            GameWorldKind::OpenWorld | GameWorldKind::Infinite | GameWorldKind::Voxel
        )
    });
    if streaming {
        push_unique(&mut traits, GameWorldKind::Streaming);
        d.add(
            "world_streaming",
            "monde trop grand pour être chargé d'un coup".to_string(),
        );
        if dimension != GameDimension::TwoD {
            d.add("lod_culling", "grand monde en 3D".to_string());
        }
    }
    if (traits.contains(&GameWorldKind::Tile) && infinite) || traits.contains(&GameWorldKind::Voxel)
    {
        d.add("chunk_streaming", "monde découpé en chunks".to_string());
    }

    let priority = [
        GameWorldKind::Voxel,
        GameWorldKind::Tile,
        GameWorldKind::Infinite,
        GameWorldKind::OpenWorld,
        GameWorldKind::Procedural,
        GameWorldKind::LevelBased,
        GameWorldKind::SceneBased,
    ];
    let primary = priority.iter().copied().find(|k| traits.contains(k));
    let handmade =
        traits.contains(&GameWorldKind::LevelBased) || traits.contains(&GameWorldKind::OpenWorld);
    let generated = traits.contains(&GameWorldKind::Procedural);
    let kind = match primary {
        Some(kind)
            if handmade
                && generated
                && !matches!(kind, GameWorldKind::Voxel | GameWorldKind::Tile) =>
        {
            GameWorldKind::Hybrid
        }
        Some(kind) => kind,
        None => {
            let fallback = if d.has("cards") || d.has("education") || d.has("narrative_choices") {
                GameWorldKind::SceneBased
            } else {
                GameWorldKind::LevelBased
            };
            d.assume(
                "world",
                fallback.label().to_string(),
                "Aucun type de monde demandé : le plus simple qui convient à ces systèmes (§48)."
                    .to_string(),
            );
            fallback
        }
    };
    let traits: Vec<GameWorldKind> = traits.into_iter().filter(|k| *k != kind).collect();

    let mut concerns = Vec::new();
    let voxel = kind == GameWorldKind::Voxel || traits.contains(&GameWorldKind::Voxel);
    let large = streaming || kind == GameWorldKind::Hybrid;
    if voxel {
        concerns.push("Mémoire : chunks chargés autour du joueur seulement, données de blocs compactées (palette par chunk).".to_string());
        concerns.push("Processeur : génération et maillage des chunks sur des fils de travail, jamais sur le fil principal.".to_string());
        concerns.push("Carte graphique : maillage glouton (greedy meshing) et faces cachées retirées ; un chunk = un maillage.".to_string());
        concerns.push(
            "Disque : seuls les chunks modifiés sont enregistrés, par régions compressées."
                .to_string(),
        );
    } else if large {
        concerns.push(
            "Mémoire : rayon de chargement réglable, niveaux de détail pour le décor lointain."
                .to_string(),
        );
        concerns.push(
            "Processeur : chargement asynchrone ; IA et simulation allégées loin du joueur."
                .to_string(),
        );
        concerns.push(
            "Carte graphique : LOD, élimination hors champ, instanciation de la végétation."
                .to_string(),
        );
        concerns.push("Disque : contenu empaqueté par zone pour charger vite.".to_string());
    } else if kind == GameWorldKind::Tile {
        concerns.push(
            "Mémoire et processeur : cartes découpées en blocs de tuiles si le monde grandit."
                .to_string(),
        );
    } else {
        concerns.push(
            "Mémoire : chaque niveau ou scène tient en mémoire ; écran de chargement entre deux."
                .to_string(),
        );
    }
    if generated {
        concerns.push(
            "Génération : même graine, même monde ; on n'enregistre que les différences."
                .to_string(),
        );
    }
    if traits.contains(&GameWorldKind::Destructible) || kind == GameWorldKind::Destructible {
        concerns.push(
            "Destruction : état persistant par zone, débris légers ou locaux pour tenir le budget."
                .to_string(),
        );
    }
    if multiplayer && (large || voxel) {
        concerns.push("Réseau : chaque client ne reçoit que ce qui l'entoure (gestion d'intérêt) ; on envoie les modifications, jamais le contenu régénérable.".to_string());
    }

    let reason = match kind {
        GameWorldKind::Voxel => {
            "Monde fait de blocs modifiables : stockage par chunks, pas une scène 3D classique."
                .to_string()
        }
        GameWorldKind::Tile => {
            "Monde en tuiles 2D, découpé en blocs s'il devient grand.".to_string()
        }
        GameWorldKind::Infinite => {
            "Monde sans limite : généré et chargé par morceaux autour du joueur.".to_string()
        }
        GameWorldKind::OpenWorld => {
            "Grand monde continu : chargé en streaming autour du joueur.".to_string()
        }
        GameWorldKind::Hybrid => {
            "Zones construites à la main et contenu généré, assemblés en streaming.".to_string()
        }
        GameWorldKind::Procedural => {
            "Contenu généré à partir d'une graine, reproductible.".to_string()
        }
        GameWorldKind::SceneBased => "Écrans et scènes successifs, sans monde continu.".to_string(),
        _ => "Niveaux construits à la main, chargés un par un.".to_string(),
    };
    let alternatives = match kind {
        GameWorldKind::OpenWorld => {
            vec!["Niveaux séparés (moins cher, moins de liberté)".to_string()]
        }
        GameWorldKind::LevelBased => {
            vec!["Monde ouvert (plus de liberté, beaucoup plus de contenu)".to_string()]
        }
        GameWorldKind::Voxel => {
            vec!["Terrain classique avec destructions ponctuelles (moins de liberté)".to_string()]
        }
        _ => Vec::new(),
    };
    d.decide(
        "world",
        "Architecture du monde",
        kind.label().to_string(),
        reason.clone(),
        alternatives,
        None,
    );

    GameWorldPlan {
        kind,
        traits,
        reason,
        concerns,
    }
}

// ─── Dépendances ──────────────────────────────────────────────────────────────────────────

fn close_dependencies(d: &mut Detection) {
    let mut queue: Vec<String> = d.evidence.keys().cloned().collect();
    let mut seen: HashSet<String> = queue.iter().cloned().collect();
    while let Some(id) = queue.pop() {
        let Some(def) = d.catalog.get(&id) else {
            continue;
        };
        for next in def.depends.iter().chain(&def.adds) {
            if d.excluded.contains_key(next) && !d.evidence.contains_key(next) {
                // Demandé « sans » mais nécessaire à un autre système : gardé et signalé.
                let note = format!("Nécessaire à {}", def.name);
                d.excluded.remove(next);
                d.required_by
                    .entry(next.clone())
                    .or_default()
                    .push(def.name.clone());
                if d.catalog.get(next).is_some() {
                    d.assume(
                        &format!("kept-{next}"),
                        format!(
                            "{} gardé",
                            d.catalog
                                .get(next)
                                .map(|s| s.name.clone())
                                .unwrap_or_default()
                        ),
                        format!("{note}, bien que l'idée l'exclue."),
                    );
                }
            } else if !d.evidence.contains_key(next) {
                let entry = d.required_by.entry(next.clone()).or_default();
                if !entry.contains(&def.name) {
                    entry.push(def.name.clone());
                }
            }
            if seen.insert(next.clone()) {
                queue.push(next.clone());
            }
        }
    }
}

fn build_systems(d: &Detection, multiplayer: bool) -> Vec<GameDetectedSystem> {
    let ids: HashSet<&String> = d.evidence.keys().chain(d.required_by.keys()).collect();
    let mut out = Vec::new();
    for id in ids {
        let Some(def) = d.catalog.get(id) else {
            continue;
        };
        let mut system: GameSystem = def.to_system();
        system.dependencies.retain(|dep| d.has(dep));
        if !multiplayer {
            system.network = GameNetMode::Local;
        }
        let evidence = d.evidence.get(id).cloned().unwrap_or_default();
        let foundation =
            evidence.iter().all(|e| e == "présent dans tout jeu") && !evidence.is_empty();
        out.push(GameDetectedSystem {
            system,
            evidence,
            required_by: d.required_by.get(id).cloned().unwrap_or_default(),
            foundation,
        });
    }
    out
}

// ─── Plateformes et moteur ────────────────────────────────────────────────────────────────

fn choose_targets(d: &mut Detection) -> Vec<GamePlatform> {
    let mut targets = Vec::new();
    let mut push = |p: GamePlatform| {
        if !targets.contains(&p) {
            targets.push(p);
        }
    };
    let w = &d.words;
    if w.has_any(&["pc", "windows", "steam"]) {
        push(GamePlatform::Windows);
    }
    if w.has_any(&["linux", "steam deck", "steamdeck"]) {
        push(GamePlatform::Linux);
    }
    if w.has_any(&["mac", "macos", "macbook"]) {
        push(GamePlatform::Macos);
    }
    if w.has_any(&["android"]) {
        push(GamePlatform::Android);
    }
    if w.has_any(&["ios", "iphone", "ipad"]) {
        push(GamePlatform::Ios);
    }
    if w.has_any(&[
        "mobile",
        "telephone",
        "smartphone",
        "tablette",
        "version mobile",
    ]) {
        push(GamePlatform::Android);
        push(GamePlatform::Ios);
    }
    if w.has_any(&["web", "navigateur", "browser", "html5", "itch io"]) {
        push(GamePlatform::Web);
    }
    if w.has_any(&[
        "console",
        "consoles",
        "ps5",
        "playstation",
        "xbox",
        "switch",
        "nintendo",
    ]) {
        push(GamePlatform::Console);
    }
    if targets.is_empty() {
        d.assume(
            "targets",
            "Windows".to_string(),
            "Aucune plateforme précisée : ARCHIMED tourne sous Windows, le jeu s'y teste directement.".to_string(),
        );
        targets.push(GamePlatform::Windows);
    }
    if targets
        .iter()
        .any(|t| matches!(t, GamePlatform::Android | GamePlatform::Ios))
    {
        d.add("touch_controls", "cible mobile".to_string());
    }
    targets
}

fn rank_engines(
    d: &Detection,
    dimension: GameDimension,
    world: &GameWorldPlan,
    network: &GameNetworkPlan,
    targets: &[GamePlatform],
    installed: &Installed,
) -> Vec<GameEngineScore> {
    let mut scores: HashMap<GameEngine, GameEngineScore> = GameEngine::ALL
        .iter()
        .map(|e| {
            (
                *e,
                GameEngineScore {
                    engine: *e,
                    score: 0,
                    reasons: Vec::new(),
                    concerns: Vec::new(),
                    installed: installed.engines.contains(e),
                },
            )
        })
        .collect();
    let mut plus = |engine: GameEngine, points: i32, reason: &str| {
        if let Some(s) = scores.get_mut(&engine) {
            s.score += points;
            if points > 0 {
                s.reasons.push(reason.to_string());
            } else {
                s.concerns.push(reason.to_string());
            }
        }
    };
    use GameEngine::*;
    let realistic = d.words.has_any(&[
        "realiste",
        "photorealiste",
        "aaa",
        "graphismes realistes",
        "hyper realiste",
        "cinematographique",
    ]);
    let voxel = world.kind == GameWorldKind::Voxel || world.traits.contains(&GameWorldKind::Voxel);
    let large = matches!(
        world.kind,
        GameWorldKind::OpenWorld | GameWorldKind::Infinite | GameWorldKind::Hybrid
    ) || world.traits.contains(&GameWorldKind::OpenWorld);

    if dimension == GameDimension::TwoD {
        plus(
            Godot,
            3,
            "Godot a un moteur 2D natif (pixels réels, tilemaps, animations) et reste très léger.",
        );
        plus(
            Unity,
            2,
            "Unity gère bien la 2D (Tilemap, Sprite Renderer) avec un grand écosystème.",
        );
        plus(
            Unreal,
            -3,
            "Unreal vise la 3D : ses outils 2D (Paper2D) sont limités.",
        );
    } else {
        plus(
            Unreal,
            2,
            "Unreal offre le meilleur rendu 3D d'origine et des outils de monde (World Partition).",
        );
        plus(
            Unity,
            2,
            "Unity est polyvalent en 3D, avec C# et un large magasin d'assets.",
        );
        plus(
            Godot,
            1,
            "Godot 4 fait de la 3D correcte, léger et libre, moins outillé pour les grands mondes.",
        );
    }
    if realistic {
        plus(
            Unreal,
            3,
            "Rendu réaliste demandé : Lumen et Nanite d'Unreal le donnent sans développement.",
        );
        plus(
            Godot,
            -2,
            "Le rendu réaliste de Godot demande plus de travail.",
        );
    }
    if large && dimension != GameDimension::TwoD {
        plus(
            Unreal,
            2,
            "Grand monde : World Partition charge le monde par cellules.",
        );
        plus(
            Unity,
            1,
            "Grand monde possible avec le chargement additif de scènes.",
        );
        plus(
            Godot,
            -1,
            "Grand monde : streaming à écrire soi-même dans Godot.",
        );
    }
    if voxel {
        plus(
            Unity,
            2,
            "Voxels : C#, Jobs et Burst accélèrent le maillage des chunks.",
        );
        plus(
            Godot,
            1,
            "Voxels possibles en C# ou GDExtension (GDScript trop lent pour le maillage).",
        );
        plus(
            Unreal,
            -1,
            "Voxels dans Unreal : C++ ou extension tierce nécessaire.",
        );
    }
    if network.topology != GameNetTopology::None {
        match network.topology {
            GameNetTopology::DedicatedServer | GameNetTopology::Persistent => {
                plus(
                    Unreal,
                    2,
                    "Multijoueur à serveur dédié : réplication et prédiction intégrées à Unreal.",
                );
                plus(Unreal, -1, "Un serveur dédié Unreal se compile depuis le moteur en sources (dépôt GitHub d'Epic).");
                plus(Unity, 1, "Multijoueur Unity avec Netcode for GameObjects ou Mirror (serveur dédié possible).");
                plus(Godot, 0, "");
            }
            _ => {
                plus(
                    Godot,
                    1,
                    "Coopération simple avec l'API multijoueur haut niveau de Godot.",
                );
                plus(
                    Unity,
                    1,
                    "Coopération avec Netcode for GameObjects et Unity Relay.",
                );
                plus(Unreal, 1, "Coopération avec la réplication d'Unreal.");
            }
        }
    }
    if targets.contains(&GamePlatform::Web) {
        plus(
            Godot,
            1,
            "Export web officiel (GDScript ; C# n'exporte pas encore vers le web en Godot 4).",
        );
        plus(Unity, 1, "Export WebGL officiel.");
        plus(Unreal, -4, "Unreal 5 n'a pas d'export web officiel.");
    }
    if targets
        .iter()
        .any(|t| matches!(t, GamePlatform::Android | GamePlatform::Ios))
    {
        plus(
            Unity,
            2,
            "Mobile : Unity est le plus utilisé et le mieux outillé.",
        );
        plus(
            Godot,
            1,
            "Mobile : export Android et iOS officiels, binaire léger.",
        );
        plus(
            Unreal,
            -1,
            "Mobile : Unreal est lourd pour les téléphones modestes.",
        );
    }
    if targets.contains(&GamePlatform::Console) {
        plus(Unity, 1, "Consoles : Unity et Unreal ont des exports officiels (licence développeur de chaque console requise).");
        plus(
            Unreal,
            1,
            "Consoles : export officiel (licence développeur de chaque console requise).",
        );
        plus(
            Godot,
            -1,
            "Consoles : Godot passe par des sociétés de portage tierces.",
        );
    }
    let prototype = d
        .words
        .has_any(&["prototype", "simple", "petit", "rapide", "game jam", "jam"]);
    if prototype {
        plus(
            Godot,
            1,
            "Prototype : Godot s'installe en 100 Mo et démarre en secondes.",
        );
    }
    for engine in &installed.engines {
        plus(*engine, 2, "Déjà installé sur cette machine.");
    }
    for engine in GameEngine::ALL {
        if !installed.engines.contains(&engine) {
            plus(
                engine,
                -1,
                "Pas encore installé : Game Studio guidera l'installation.",
            );
        }
    }
    let mut ranked: Vec<GameEngineScore> = scores.into_values().collect();
    for s in &mut ranked {
        s.reasons.retain(|r| !r.is_empty());
        s.concerns.retain(|r| !r.is_empty());
    }
    ranked.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(b.installed.cmp(&a.installed))
            .then(a.engine.label().cmp(b.engine.label()))
    });
    ranked
}

fn choose_mode(d: &Detection, network: &GameNetworkPlan) -> GameMode {
    let w = &d.words;
    if w.has_any(&[
        "prototype",
        "petit jeu",
        "game jam",
        "jam",
        "rapide a faire",
        "simple",
        "maquette",
    ]) {
        return GameMode::Prototype;
    }
    if w.has_any(&[
        "production",
        "commercial",
        "commercialiser",
        "vendre sur steam",
        "publier sur steam",
        "sortie commerciale",
    ]) {
        return GameMode::Production;
    }
    let count = d.evidence.len() + d.required_by.len();
    if matches!(
        network.topology,
        GameNetTopology::DedicatedServer | GameNetTopology::Persistent
    ) || count > 70
    {
        return GameMode::Advanced;
    }
    if d.evidence
        .iter()
        .all(|(_, e)| e.iter().all(|x| x == "présent dans tout jeu"))
    {
        return GameMode::Prototype;
    }
    GameMode::Standard
}

// ─── Risques, questions, contenu, feuille de route ────────────────────────────────────────

fn collect_risks(
    d: &Detection,
    systems: &[GameDetectedSystem],
    world: &GameWorldPlan,
    network: &GameNetworkPlan,
    targets: &[GamePlatform],
) -> Vec<String> {
    let mut risks: Vec<String> = systems
        .iter()
        .filter_map(|s| {
            s.system
                .risk
                .as_ref()
                .map(|r| format!("{} : {r}", s.system.name))
        })
        .collect();
    let multiplayer =
        network.topology != GameNetTopology::None && network.topology != GameNetTopology::Local;
    if multiplayer && d.has("destruction") {
        risks.push("Destruction en ligne : sans risque en prototype, risqué en production. Débris locaux ou destruction déterministe à prévoir.".to_string());
    }
    if multiplayer
        && (world.kind == GameWorldKind::Infinite
            || world.traits.contains(&GameWorldKind::Infinite))
    {
        risks.push("Monde infini partagé : le serveur génère et garde les zones de chaque joueur ; mémoire serveur à surveiller.".to_string());
    }
    if multiplayer && network.max_players.unwrap_or(0) >= 100 {
        risks.push(format!(
            "{} joueurs simultanés : sans risque en prototype, risqué en production. Réplication par pertinence et tests de charge dès la tranche verticale.",
            network.max_players.unwrap_or(0)
        ));
    }
    let mobile = targets
        .iter()
        .any(|t| matches!(t, GamePlatform::Android | GamePlatform::Ios));
    if mobile
        && matches!(
            world.kind,
            GameWorldKind::OpenWorld
                | GameWorldKind::Infinite
                | GameWorldKind::Voxel
                | GameWorldKind::Hybrid
        )
    {
        risks.push("Grand monde sur mobile : mémoire et chauffe à tenir ; distance de vue et détails réduits.".to_string());
    }
    if d.has("sandbox_physics") && multiplayer {
        risks.push(
            "Physique partagée en réseau : autorité serveur et nombre d'objets à plafonner."
                .to_string(),
        );
    }
    risks
}

fn questions(
    d: &Detection,
    network: &GameNetworkPlan,
    players: Option<u32>,
    blank: bool,
) -> Vec<GameQuestion> {
    let mut out = Vec::new();
    if blank {
        out.push(GameQuestion {
            topic: "gameplay".to_string(),
            question: "Que fait le joueur, minute par minute ?".to_string(),
            why: "Sans action principale, seuls les systèmes de base sont prévus. Une phrase suffit : « il pêche », « il construit une ville »…".to_string(),
            options: vec!["Explorer et combattre".to_string(), "Construire et gérer".to_string(), "Résoudre des énigmes".to_string(), "Courir et sauter".to_string()],
        });
    }
    if network.topology == GameNetTopology::Persistent && players.is_none_or(|n| n >= 1000) {
        out.push(GameQuestion {
            topic: "players".to_string(),
            question: "Combien de joueurs en même temps sur la même carte, au plus ?".to_string(),
            why: "Au-delà de quelques centaines, le monde doit être découpé entre plusieurs serveurs : l'architecture change complètement (§54).".to_string(),
            options: vec!["Moins de 100".to_string(), "100 à 1 000".to_string(), "Plus de 1 000".to_string()],
        });
    }
    if d.words.has_any(&[
        "console",
        "consoles",
        "ps5",
        "playstation",
        "xbox",
        "switch",
    ]) {
        out.push(GameQuestion {
            topic: "console".to_string(),
            question: "Avez-vous accès aux programmes développeurs des consoles visées ?".to_string(),
            why: "Compiler pour une console demande la licence et le kit du constructeur ; sans eux, Game Studio prépare le code mais ne peut pas produire de build console.".to_string(),
            options: vec!["Oui".to_string(), "Pas encore".to_string()],
        });
    }
    out
}

fn content_needs(d: &Detection) -> Vec<String> {
    let table: &[(&str, &str)] = &[
        ("player_controller", "Personnage jouable : modèle ou sprite, animations de base (repos, marche, course, saut)."),
        ("enemy_ai", "Ennemis : trois types au moins, décrits en données (EnemyData), avec leurs animations."),
        ("boss_ai", "Boss : arène, phases et attaques signalées."),
        ("weapons", "Armes : données, modèles ou icônes, sons et effets d'impact."),
        ("item_database", "Objets : icônes et données (ItemData)."),
        ("crafting", "Recettes de fabrication (RecipeData)."),
        ("tilemap_world", "Tilesets pour chaque biome ou zone."),
        ("voxel_world", "Atlas de textures des blocs et définitions de blocs (BlockData)."),
        ("level_design", "Niveaux : blocs de décor modulaires et placement des rencontres."),
        ("open_world", "Monde : régions, points d'intérêt, végétation et repères visuels."),
        ("quests", "Quêtes écrites en données (QuestData)."),
        ("dialogue", "Dialogues et personnages qui les portent."),
        ("npc_core", "PNJ : apparences, noms, rôles."),
        ("fishing", "Espèces de poissons (FishData) et lieux de pêche."),
        ("farming", "Cultures (CropData), outils et bâtiments de ferme."),
        ("vehicles", "Véhicules : modèles, sons de moteur, réglages de conduite."),
        ("music", "Pistes musicales et ambiances."),
        ("vfx", "Effets visuels : impacts, explosions, magie, météo."),
        ("hud", "Interface : icônes, polices, cadres dans le style du jeu."),
        ("cards", "Cartes : illustrations, textes et règles (CardData)."),
        ("weather", "Effets de météo : pluie, neige, brouillard, sons."),
        ("biomes", "Biomes : palettes, végétation et créatures propres."),
        ("building", "Pièces de construction (BuildPieceData) et leurs modèles."),
    ];
    table
        .iter()
        .filter(|(id, _)| d.has(id))
        .map(|(_, text)| text.to_string())
        .collect()
}

fn roadmap(systems: &[GameDetectedSystem], multiplayer: bool, mode: GameMode) -> Vec<GamePhase> {
    use GameSystemCategory::*;
    let pick = |categories: &[GameSystemCategory]| -> Vec<String> {
        systems
            .iter()
            .filter(|s| categories.contains(&s.system.category))
            .map(|s| s.system.id.clone())
            .collect()
    };
    let core_loop: Vec<String> = systems
        .iter()
        .filter(|s| {
            matches!(s.system.category, Core | Player | Camera)
                || (s.system.category == Gameplay && !s.foundation)
                || s.system.id == "combat_core"
        })
        .map(|s| s.system.id.clone())
        .collect();
    let phase =
        |id: &str, title: &str, goals: &[&str], systems: Vec<String>, status: GamePhaseStatus| {
            GamePhase {
                id: id.to_string(),
                title: title.to_string(),
                goals: goals.iter().map(|g| g.to_string()).collect(),
                systems,
                status,
            }
        };
    let mut phases = vec![phase(
        "p1",
        "Prototype jouable",
        &[
            "La boucle de jeu principale se joue en moins de cinq minutes",
            "Contrôles et caméra agréables",
            "Le jeu compile et démarre",
        ],
        core_loop,
        GamePhaseStatus::Active,
    )];
    let gameplay = pick(&[Combat, Items, Crafting, Building, Vehicles, Rpg]);
    if !gameplay.is_empty() {
        phases.push(phase(
            "p2",
            "Gameplay principal",
            &[
                "Chaque système principal fonctionne de bout en bout",
                "Tests des systèmes",
            ],
            gameplay,
            GamePhaseStatus::Planned,
        ));
    }
    if mode == GameMode::Prototype {
        phases.push(phase(
            "p-next",
            "Suite",
            &["Décider, après avoir joué au prototype, ce qui mérite d'être développé"],
            Vec::new(),
            GamePhaseStatus::Planned,
        ));
        return phases;
    }
    let world = pick(&[World, Generation, Environment]);
    if !world.is_empty() {
        phases.push(phase(
            "p3",
            "Monde",
            &["Le monde se charge et se parcourt dans le budget de performance"],
            world,
            GamePhaseStatus::Planned,
        ));
    }
    let content = pick(&[Narrative, Npc, Economy, Ai]);
    if !content.is_empty() {
        phases.push(phase(
            "p4",
            "Contenu",
            &["Contenu créé en données, cohérent avec le guide de style"],
            content,
            GamePhaseStatus::Planned,
        ));
    }
    if multiplayer {
        phases.push(phase(
            "p5",
            "Multijoueur",
            &[
                "Parties à plusieurs stables avec 150 ms de latence",
                "Reconnexion",
            ],
            pick(&[Multiplayer, Backend]),
            GamePhaseStatus::Planned,
        ));
    }
    phases.push(phase(
        "p6",
        "Optimisation",
        &[
            "Budget de performance tenu sur la plateforme la plus faible",
            "Profilage processeur, mémoire, carte graphique",
        ],
        Vec::new(),
        GamePhaseStatus::Planned,
    ));
    phases.push(phase(
        "p7",
        "Finitions",
        &[
            "Interface, audio et effets finalisés",
            "Accessibilité et traductions",
        ],
        pick(&[Ui, Audio, Visual, Platform, Persistence]),
        GamePhaseStatus::Planned,
    ));
    phases.push(phase(
        "p8",
        "Sortie",
        &[
            "Builds de release pour chaque plateforme",
            "Tests de non-régression complets",
        ],
        Vec::new(),
        GamePhaseStatus::Planned,
    ));
    phases
}

fn suggest_name(idea: &str) -> String {
    let named = Regex::new(r#"(?i)\b(?:appel[ée]e?s?|nomm[ée]e?s?|intitul[ée]e?s?|called|named)\s+[«"“']?\s*([^"»”',.;:!?\n]{2,40})"#).ok();
    if let Some(c) = named.and_then(|re| re.captures(idea)) {
        let name = c[1].trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }
    "Nouveau jeu".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(analysis: &GameAnalysis) -> HashSet<String> {
        analysis
            .systems
            .iter()
            .map(|s| s.system.id.clone())
            .collect()
    }

    fn has_all(analysis: &GameAnalysis, wanted: &[&str]) {
        let found = ids(analysis);
        for id in wanted {
            assert!(
                found.contains(*id),
                "système attendu : {id} (trouvés : {:?})",
                found
            );
        }
    }

    #[test]
    fn open_world_survival_with_friends() {
        let a = analyze(
            "Je veux faire un jeu où le joueur explore un monde ouvert, combat des ennemis, construit une base, pêche, fabrique des objets, conduit des véhicules et joue avec trois amis.",
            &Installed::default(),
        )
        .unwrap();
        has_all(
            &a,
            &[
                "player_controller",
                "open_world",
                "world_streaming",
                "combat_core",
                "enemy_ai",
                "health",
                "building",
                "fishing",
                "crafting",
                "inventory",
                "vehicles",
                "networking",
                "replication",
                "client_prediction",
                "lobby",
                "save_system",
                "hud",
                "audio_core",
                "animation",
            ],
        );
        assert_eq!(a.network.max_players, Some(4));
        assert_eq!(a.network.topology, GameNetTopology::ListenServer);
        assert_eq!(a.dimension, GameDimension::ThreeD);
        assert!(
            a.world.traits.contains(&GameWorldKind::Streaming)
                || a.world.kind == GameWorldKind::Streaming
        );
    }

    #[test]
    fn terraria_in_3d_is_voxel_infinite_coop() {
        let a = analyze(
            "Je veux un jeu comme Terraria mais en 3D, avec un monde procédural infini, du crafting, des boss, du multiplayer coopératif, des véhicules et de la construction.",
            &Installed::default(),
        )
        .unwrap();
        assert_eq!(a.dimension, GameDimension::ThreeD);
        has_all(
            &a,
            &[
                "world_generation",
                "crafting",
                "boss_ai",
                "vehicles",
                "building",
                "networking",
                "save_system",
                "inventory",
            ],
        );
        assert!(
            a.world.traits.contains(&GameWorldKind::Infinite)
                || a.world.kind == GameWorldKind::Infinite
        );
        assert!(a.risks.iter().any(|r| r.contains("infini")));
    }

    #[test]
    fn souls_like_open_world_coop_three() {
        let a = analyze(
            "Je veux un souls-like open world avec coop à 3 joueurs.",
            &Installed::default(),
        )
        .unwrap();
        has_all(
            &a,
            &[
                "camera_third_person",
                "stamina",
                "lock_on",
                "boss_ai",
                "enemy_ai",
                "open_world",
                "world_streaming",
                "inventory",
                "equipment",
                "stats",
                "leveling",
                "networking",
                "replication",
                "save_system",
            ],
        );
        assert_eq!(a.network.max_players, Some(3));
        assert_eq!(a.dimension, GameDimension::ThreeD);
    }

    #[test]
    fn competitive_five_versus_five_fps() {
        let a = analyze(
            "Je veux un FPS compétitif avec des parties 5v5.",
            &Installed::default(),
        )
        .unwrap();
        has_all(
            &a,
            &[
                "shooting",
                "weapons",
                "health",
                "damage",
                "teams",
                "match_rules",
                "dedicated_server",
                "replication",
                "client_prediction",
                "lag_compensation",
                "matchmaking",
                "anti_cheat",
                "camera_first_person",
            ],
        );
        assert_eq!(a.network.max_players, Some(10));
        assert_eq!(a.network.topology, GameNetTopology::DedicatedServer);
    }

    #[test]
    fn relaxing_fishing_town() {
        let a = analyze(
            "Je veux un jeu de pêche relaxant avec une ville, des PNJ qui ont des routines, des bateaux, une économie, de la météo et du multiplayer coop.",
            &Installed::default(),
        )
        .unwrap();
        has_all(
            &a,
            &[
                "fishing",
                "npc_core",
                "npc_schedules",
                "day_night",
                "boats",
                "vehicles",
                "economy",
                "weather",
                "networking",
                "inventory",
            ],
        );
        assert!(!ids(&a).contains("combat_core"), "aucun combat demandé");
    }

    #[test]
    fn negation_excludes_a_system() {
        let a = analyze(
            "Un jeu d'exploration relaxant en 2D, sans combat et sans multijoueur.",
            &Installed::default(),
        )
        .unwrap();
        let found = ids(&a);
        assert!(!found.contains("combat_core"));
        assert!(!found.contains("networking"));
        assert_eq!(a.network.topology, GameNetTopology::None);
        assert!(a.decisions.iter().any(|d| d.id == "d-exclude-combat_core"));
    }

    #[test]
    fn blank_idea_gets_foundations_and_one_question() {
        let a = analyze("Je veux créer un jeu.", &Installed::default()).unwrap();
        assert!(a
            .systems
            .iter()
            .all(|s| s.foundation || !s.required_by.is_empty()));
        assert!(a.questions.iter().any(|q| q.topic == "gameplay"));
        assert_eq!(a.mode, GameMode::Prototype);
    }

    #[test]
    fn massive_player_counts_raise_a_question() {
        let a = analyze(
            "Je veux un MMO avec 10 000 joueurs simultanés sur une carte persistante.",
            &Installed::default(),
        )
        .unwrap();
        assert_eq!(a.network.topology, GameNetTopology::Persistent);
        assert_eq!(a.network.max_players, Some(10_000));
        assert!(a.questions.iter().any(|q| q.topic == "players"));
        has_all(&a, &["persistent_world", "accounts", "dedicated_server"]);
    }

    #[test]
    fn engine_ranking_follows_needs_and_installs() {
        let two_d = analyze("Un platformer 2D en pixel art", &Installed::default()).unwrap();
        assert_eq!(two_d.engines[0].engine, GameEngine::Godot);
        let web = analyze(
            "Un jeu de cartes jouable dans le navigateur",
            &Installed::default(),
        )
        .unwrap();
        assert_ne!(web.engines[0].engine, GameEngine::Unreal);
        let realistic = analyze(
            "Un shooter réaliste en monde ouvert immense",
            &Installed {
                engines: vec![GameEngine::Unreal],
            },
        )
        .unwrap();
        assert_eq!(realistic.engines[0].engine, GameEngine::Unreal);
        assert!(realistic.decisions.iter().any(|d| d.id == "d-engine"));
    }

    #[test]
    fn player_counts_are_parsed() {
        assert_eq!(player_count(&fold("coop à 3")), Some(3));
        assert_eq!(player_count(&fold("des parties 5v5")), Some(10));
        assert_eq!(player_count(&fold("10 000 joueurs")), Some(10_000));
        assert_eq!(player_count(&fold("avec trois amis")), Some(4));
        assert_eq!(player_count(&fold("un jeu solo")), None);
    }

    #[test]
    fn every_dependency_is_present() {
        let a = analyze(
            "Un RPG avec crafting, quêtes, dialogues, météo et multijoueur",
            &Installed::default(),
        )
        .unwrap();
        let found = ids(&a);
        for s in &a.systems {
            for dep in &s.system.dependencies {
                assert!(
                    found.contains(dep),
                    "{} dépend de {dep}, absent",
                    s.system.id
                );
            }
        }
    }

    #[test]
    fn names_are_extracted() {
        assert_eq!(
            suggest_name("Un jeu appelé « Marée Basse », relaxant"),
            "Marée Basse"
        );
        assert_eq!(suggest_name("Un jeu de pêche"), "Nouveau jeu");
    }
}
