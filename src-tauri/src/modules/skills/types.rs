use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SkillSource {
    /// Dans la bibliothèque ARCHIMED.
    Library,
    /// Détecté dans le dossier d'une CLI, laissé en place.
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: SkillSource,
    pub enabled: bool,
    /// CLI vers lesquelles le skill est synchronisé.
    pub targets: Vec<String>,
}
