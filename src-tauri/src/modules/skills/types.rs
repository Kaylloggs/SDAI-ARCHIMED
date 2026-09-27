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

/// Brouillon de l'atelier : nouveau skill, ou copie d'un skill existant à améliorer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DraftKind {
    New,
    Edit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftInfo {
    pub id: String,
    /// Nom lu dans l'en-tête du SKILL.md du brouillon (vide tant qu'il n'est pas écrit).
    pub name: String,
    pub description: String,
    /// Dossier du brouillon : dossier de travail de l'IA.
    pub path: String,
    /// Dossier du skill dans le brouillon (`<path>/skill`).
    pub skill_path: String,
    pub kind: DraftKind,
    /// Skill d'origine (brouillon « améliorer »).
    pub source_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// Nom sous lequel il a été enregistré la dernière fois, et quand.
    pub saved_as: Option<String>,
    pub saved_at: Option<u64>,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftFile {
    /// Chemin relatif au dossier du skill, séparateurs `/`.
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CheckLevel {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckIssue {
    pub level: CheckLevel,
    pub code: String,
    pub message: String,
    pub file: Option<String>,
    pub line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftReport {
    pub name: Option<String>,
    pub description: Option<String>,
    pub body_lines: usize,
    pub files: usize,
    pub bytes: u64,
    pub scripts: Vec<String>,
    pub issues: Vec<CheckIssue>,
    /// Aucune erreur : le skill peut entrer dans la bibliothèque.
    pub ready: bool,
    /// Un skill de ce nom existe déjà dans la bibliothèque (il sera remplacé, avec sauvegarde).
    pub target_exists: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Created,
    Modified,
    Deleted,
}

/// Différence entre le brouillon et le skill d'origine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftChange {
    pub path: String,
    pub kind: ChangeKind,
    pub before: Option<String>,
    pub after: Option<String>,
    pub binary: bool,
}
