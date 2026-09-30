//! Catalogue des systèmes de jeu et des genres (`catalog/*.toml`, embarqués) et
//! reconnaissance des mots d'une idée : accents, casse et pluriels ignorés, négations
//! (« sans combat ») respectées.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::core::{AppError, AppResult};

use super::types::{
    GameDimension, GameNetMode, GameSystem, GameSystemCategory, GameSystemOrigin, GameSystemStatus,
    GameWorldKind,
};

const SYSTEMS: &str = include_str!("catalog/systems.toml");
const GENRES: &str = include_str!("catalog/genres.toml");

/// Système du catalogue.
#[derive(Debug, Clone, Deserialize)]
pub struct SystemDef {
    pub id: String,
    pub name: String,
    pub category: GameSystemCategory,
    pub role: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub depends: Vec<String>,
    #[serde(default)]
    pub adds: Vec<String>,
    #[serde(default)]
    pub produces: Vec<String>,
    #[serde(default)]
    pub data: Vec<String>,
    pub network: GameNetMode,
    #[serde(default)]
    pub tests: Vec<String>,
    /// `all`, `2d` ou `3d` : présent d'office dans tout jeu (de cette dimension).
    #[serde(default)]
    pub foundation: Option<String>,
    #[serde(default)]
    pub risk: Option<String>,
}

impl SystemDef {
    /// Système du graphe, tel qu'il entre dans un projet.
    pub fn to_system(&self) -> GameSystem {
        GameSystem {
            id: self.id.clone(),
            name: self.name.clone(),
            category: self.category,
            role: self.role.clone(),
            origin: GameSystemOrigin::Catalog,
            dependencies: self.depends.clone(),
            produces: self.produces.clone(),
            files: Vec::new(),
            assets: Vec::new(),
            interfaces: Vec::new(),
            data: self.data.clone(),
            constraints: Vec::new(),
            tests: self.tests.clone(),
            status: GameSystemStatus::Planned,
            network: self.network,
            risk: self.risk.clone(),
            notes: None,
        }
    }

    pub fn is_foundation(&self, dimension: GameDimension) -> bool {
        match self.foundation.as_deref() {
            Some("all") => true,
            Some("2d") => dimension == GameDimension::TwoD,
            Some("3d") => dimension != GameDimension::TwoD,
            _ => false,
        }
    }
}

/// Genre ou référence reconnue dans une idée (descriptif, jamais limitant).
#[derive(Debug, Clone, Deserialize)]
pub struct GenreDef {
    pub label: String,
    pub keywords: Vec<String>,
    #[serde(default)]
    pub systems: Vec<String>,
    #[serde(default)]
    pub dimension: Option<String>,
    #[serde(default)]
    pub camera: Option<String>,
    #[serde(default)]
    pub world: Option<GameWorldKind>,
    /// `coop`, `competitive`, `massive`.
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub players: Option<u32>,
}

impl GenreDef {
    pub fn dimension(&self) -> Option<GameDimension> {
        parse_dimension(self.dimension.as_deref()?)
    }
}

pub fn parse_dimension(text: &str) -> Option<GameDimension> {
    match text {
        "2d" => Some(GameDimension::TwoD),
        "2.5d" => Some(GameDimension::TwoAndHalfD),
        "3d" => Some(GameDimension::ThreeD),
        _ => None,
    }
}

#[derive(Deserialize)]
struct SystemsFile {
    system: Vec<SystemDef>,
}

#[derive(Deserialize)]
struct GenresFile {
    genre: Vec<GenreDef>,
}

pub struct Catalog {
    pub systems: Vec<SystemDef>,
    pub genres: Vec<GenreDef>,
    index: HashMap<String, usize>,
}

impl Catalog {
    fn parse(systems: &str, genres: &str) -> AppResult<Self> {
        let systems: SystemsFile = toml::from_str(systems)
            .map_err(|e| AppError::internal(format!("catalogue des systèmes illisible : {e}")))?;
        let genres: GenresFile = toml::from_str(genres)
            .map_err(|e| AppError::internal(format!("catalogue des genres illisible : {e}")))?;
        let index = systems
            .system
            .iter()
            .enumerate()
            .map(|(i, s)| (s.id.clone(), i))
            .collect();
        Ok(Self {
            systems: systems.system,
            genres: genres.genre,
            index,
        })
    }

    pub fn get(&self, id: &str) -> Option<&SystemDef> {
        self.index.get(id).and_then(|i| self.systems.get(*i))
    }
}

/// Catalogue embarqué (lu une fois).
pub fn catalog() -> AppResult<&'static Catalog> {
    static CATALOG: OnceLock<Result<Catalog, String>> = OnceLock::new();
    CATALOG
        .get_or_init(|| Catalog::parse(SYSTEMS, GENRES).map_err(|e| e.message))
        .as_ref()
        .map_err(|e| AppError::internal(e.clone()))
}

// ─── Reconnaissance des mots ──────────────────────────────────────────────────────────────

/// Minuscules, sans accents, ponctuation en espaces : « Jeu d'Action ! » → « jeu d action ».
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars().flat_map(char::to_lowercase) {
        let mapped: &str = match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' | 'å' => "a",
            'ç' => "c",
            'é' | 'è' | 'ê' | 'ë' => "e",
            'î' | 'ï' | 'í' | 'ì' => "i",
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' => "o",
            'ù' | 'û' | 'ü' | 'ú' => "u",
            'ÿ' | 'ý' => "y",
            'ñ' => "n",
            'œ' => "oe",
            'æ' => "ae",
            _ => "",
        };
        if !mapped.is_empty() {
            out.push_str(mapped);
        } else if c.is_alphanumeric() {
            out.push(c);
        } else {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Mots qui annulent ce qui suit : « sans combat », « pas de multijoueur ».
const NEGATIONS: &[&str] = &[
    "sans", "pas", "aucun", "aucune", "no", "without", "ni", "jamais", "non",
];
/// Mots d'unité qui ne comptent pas après un nombre (« 60 fps » n'est pas un genre).
const UNITS_AFTER_NUMBER: &[&str] = &["fps"];

/// Texte découpé, prêt à chercher des mots-clés.
pub struct Words {
    tokens: Vec<String>,
}

/// Une occurrence de mot-clé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub keyword: String,
    pub negated: bool,
}

impl Words {
    pub fn new(text: &str) -> Self {
        Self {
            tokens: fold(text)
                .split(' ')
                .filter(|t| !t.is_empty())
                .map(str::to_string)
                .collect(),
        }
    }

    pub fn tokens(&self) -> &[String] {
        &self.tokens
    }

    /// Le mot du texte est-il ce mot-clé, au singulier ou au pluriel ?
    fn same(word: &str, keyword: &str) -> bool {
        if word == keyword {
            return true;
        }
        if word.len() == keyword.len() + 1
            && word.starts_with(keyword)
            && (word.ends_with('s') || word.ends_with('x'))
        {
            return true;
        }
        // cheval → chevaux, animal → animaux
        keyword.len() > 3
            && keyword.ends_with("al")
            && word == format!("{}aux", &keyword[..keyword.len() - 2])
    }

    /// Premières occurrences d'un mot-clé (plusieurs mots possibles).
    pub fn find(&self, keyword: &str) -> Option<Hit> {
        let parts: Vec<String> = fold(keyword)
            .split(' ')
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .collect();
        if parts.is_empty() || parts.len() > self.tokens.len() {
            return None;
        }
        let mut negated_hit = None;
        for start in 0..=self.tokens.len() - parts.len() {
            let matches = parts
                .iter()
                .enumerate()
                .all(|(i, part)| Self::same(&self.tokens[start + i], part));
            if !matches {
                continue;
            }
            let previous = &self.tokens[start.saturating_sub(3)..start];
            if parts.len() == 1
                && UNITS_AFTER_NUMBER.contains(&parts[0].as_str())
                && previous
                    .last()
                    .is_some_and(|w| w.chars().all(|c| c.is_ascii_digit()))
            {
                continue;
            }
            let negated = previous.iter().any(|w| NEGATIONS.contains(&w.as_str()));
            let hit = Hit {
                keyword: keyword.to_string(),
                negated,
            };
            if !negated {
                return Some(hit);
            }
            negated_hit.get_or_insert(hit);
        }
        negated_hit
    }

    /// Premier mot-clé présent parmi `keywords` (affirmé avant nié).
    pub fn find_any<'a>(&self, keywords: impl IntoIterator<Item = &'a String>) -> Option<Hit> {
        let mut negated = None;
        for keyword in keywords {
            if let Some(hit) = self.find(keyword) {
                if !hit.negated {
                    return Some(hit);
                }
                negated.get_or_insert(hit);
            }
        }
        negated
    }

    pub fn has(&self, keyword: &str) -> bool {
        self.find(keyword).is_some_and(|h| !h.negated)
    }

    pub fn has_any(&self, keywords: &[&str]) -> bool {
        keywords.iter().any(|k| self.has(k))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_consistent() {
        let catalog = catalog().unwrap();
        assert!(catalog.systems.len() >= 150, "catalogue trop court");
        let mut seen = std::collections::HashSet::new();
        for system in &catalog.systems {
            assert!(
                seen.insert(system.id.clone()),
                "identifiant en double : {}",
                system.id
            );
            assert!(!system.role.is_empty(), "{} sans rôle", system.id);
            for dep in system.depends.iter().chain(&system.adds) {
                assert!(
                    catalog.get(dep).is_some(),
                    "{} dépend de {dep}, inconnu",
                    system.id
                );
            }
        }
        for genre in &catalog.genres {
            for id in &genre.systems {
                assert!(
                    catalog.get(id).is_some(),
                    "genre {} : système inconnu {id}",
                    genre.label
                );
            }
            if let Some(camera) = &genre.camera {
                assert!(
                    catalog.get(camera).is_some(),
                    "genre {} : caméra inconnue",
                    genre.label
                );
            }
        }
    }

    #[test]
    fn no_dependency_cycle() {
        let catalog = catalog().unwrap();
        fn visit(
            id: &str,
            catalog: &Catalog,
            stack: &mut Vec<String>,
            done: &mut std::collections::HashSet<String>,
        ) {
            if done.contains(id) {
                return;
            }
            assert!(
                !stack.contains(&id.to_string()),
                "cycle : {:?} → {id}",
                stack
            );
            stack.push(id.to_string());
            if let Some(system) = catalog.get(id) {
                for dep in &system.depends {
                    visit(dep, catalog, stack, done);
                }
            }
            stack.pop();
            done.insert(id.to_string());
        }
        let mut done = std::collections::HashSet::new();
        for system in &catalog.systems {
            visit(&system.id, catalog, &mut Vec::new(), &mut done);
        }
    }

    #[test]
    fn folds_accents_and_punctuation() {
        assert_eq!(
            fold("Jeu d'Action — Pêche & Forêt !"),
            "jeu d action peche foret"
        );
        assert_eq!(fold("Souls-like"), "souls like");
    }

    #[test]
    fn matches_plurals_and_phrases() {
        let words = Words::new("Des armes, des chevaux et un monde ouvert.");
        assert!(words.has("arme"));
        assert!(words.has("cheval"));
        assert!(words.has("monde ouvert"));
        assert!(!words.has("ouvert monde"));
    }

    #[test]
    fn respects_negations() {
        let words = Words::new("Un jeu relaxant sans combat, pas de multijoueur.");
        assert!(!words.has("combat"));
        assert!(words.find("combat").is_some_and(|h| h.negated));
        assert!(!words.has("multijoueur"));
        assert!(words.has("relaxant"));
    }

    #[test]
    fn frame_rates_are_not_cameras() {
        assert!(!Words::new("Un jeu de course à 60 fps").has("fps"));
        assert!(Words::new("Un FPS compétitif").has("fps"));
    }
}
