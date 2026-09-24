//! État du module : offres retenues, candidatures, profil et CV.
//!
//! Le schéma des offres appartient au moteur Python et au frontend ; côté Rust, l'état
//! reste du JSON opaque, écrit de façon atomique. Le CV, lui, est copié dans le dossier
//! du module et son texte extrait à côté : c'est ce texte que lisent les IA.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use crate::core::paths::Paths;
use crate::core::{AppError, AppResult};

use super::engine::{Engine, EngineStatus};

/// Langues de CV gérées : une candidature hors zone francophone part avec le CV anglais.
pub const CV_LANGUAGES: &[&str] = &["fr", "en"];

pub struct JobAgentService {
    engine: Engine,
    /// Déclaration lue par le moteur pour donner les outils aux CLI (`core::mcp`).
    mcp_file: PathBuf,
    state_file: PathBuf,
    profile_file: PathBuf,
    /// Dossier du module : les textes de CV vivent à côté du profil.
    home: PathBuf,
    /// Réglages d'envoi (le mot de passe y est chiffré par Windows).
    mail_file: PathBuf,
    cv_dir: PathBuf,
}

impl JobAgentService {
    pub fn new(paths: &Paths) -> AppResult<Self> {
        let home = paths.module_dir("jobagent");
        std::fs::create_dir_all(&home)?;
        let cv_dir = home.join("cv");
        std::fs::create_dir_all(&cv_dir)?;
        Ok(Self {
            mcp_file: paths.mcp().join("jobagent.json"),
            state_file: home.join("state.json"),
            profile_file: home.join("profile.json"),
            mail_file: home.join("mail.json"),
            home: home.clone(),
            cv_dir,
            engine: Engine::new(home)?,
        })
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    pub async fn status(&self) -> EngineStatus {
        let mut status = self.engine.status().await;
        status.mcp_enabled = self.mcp_file.exists();
        status
    }

    pub async fn install<R: Runtime>(&self, app: AppHandle<R>) -> AppResult<EngineStatus> {
        self.engine.install(app).await
    }

    /// Recherche complète. `on_progress` relaie l'avancement pendant l'exécution.
    pub async fn search(
        &self,
        request: Value,
        on_progress: impl Fn(Value),
    ) -> AppResult<Value> {
        let payload = serde_json::to_string(&request)?;
        let done = self
            .engine
            .cli(&["search", "--request", "-"], Some(payload), on_progress)
            .await?;
        Ok(done.get("offers").cloned().unwrap_or_else(|| json!([])))
    }

    /// Texte complet d'une annonce.
    pub async fn detail(&self, url: &str) -> AppResult<Value> {
        let done = self.engine.cli(&["detail", "--url", url], None, |_| {}).await?;
        Ok(done.get("offer").cloned().unwrap_or(Value::Null))
    }

    /// Plateformes, pays, niveaux d'études et contrats disponibles.
    pub async fn sources(&self) -> AppResult<Value> {
        self.engine.cli(&["sources"], None, |_| {}).await
    }

    pub fn load_state(&self) -> AppResult<Value> {
        read_json(&self.state_file).map(|value| {
            value.unwrap_or_else(|| json!({ "offers": [], "applications": [], "searches": [] }))
        })
    }

    pub fn save_state(&self, state: Value) -> AppResult<()> {
        write_atomic(&self.state_file, &state)
    }

    /// Fichier où est rangé le texte extrait d'un CV.
    fn cv_text_file(&self, language: &str) -> PathBuf {
        self.home.join(format!("cv-{language}.txt"))
    }

    pub fn load_profile(&self) -> AppResult<Value> {
        let mut profile = migrate_profile(read_json(&self.profile_file)?.unwrap_or_else(|| json!({})));
        for language in CV_LANGUAGES {
            if let Ok(text) = std::fs::read_to_string(self.cv_text_file(language)) {
                profile["cvs"][*language]["text"] = Value::String(text);
            }
        }
        Ok(profile)
    }

    /// Enregistre le profil. Les textes de CV vivent dans leurs propres fichiers : ils sont
    /// relus par le serveur MCP, et n'ont pas à être recopiés dans le JSON à chaque sauvegarde.
    pub fn save_profile(&self, mut profile: Value) -> AppResult<()> {
        if let Some(cvs) = profile.get_mut("cvs").and_then(Value::as_object_mut) {
            for entry in cvs.values_mut() {
                if let Some(object) = entry.as_object_mut() {
                    object.remove("text");
                }
            }
        }
        write_atomic(&self.profile_file, &profile)
    }

    /// Copie un CV dans le module et en extrait le texte. `language` : `fr` ou `en`.
    pub async fn import_cv(&self, source: &str, language: &str) -> AppResult<Value> {
        let language = normalize_language(language)?;
        let source = Path::new(source);
        let name = source
            .file_name()
            .ok_or_else(|| AppError::invalid("chemin de CV invalide"))?;
        // Un dossier par langue : deux CV peuvent porter le même nom de fichier.
        let folder = self.cv_dir.join(&language);
        std::fs::create_dir_all(&folder)?;
        let target = folder.join(name);
        if source != target {
            std::fs::copy(source, &target)?;
        }

        let extracted = self
            .engine
            .cli(&["cv", "--file", &target.display().to_string()], None, |_| {})
            .await?;
        if let Some(error) = extracted.get("error").and_then(Value::as_str) {
            return Err(AppError::invalid(format!("CV illisible : {error}")));
        }
        let text = extracted
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default();
        std::fs::write(self.cv_text_file(&language), text)?;

        let mut profile = migrate_profile(read_json(&self.profile_file)?.unwrap_or_else(|| json!({})));
        profile["cvs"][&language] = json!({
            "file": target.display().to_string(),
            "name": name.to_string_lossy(),
            "pages": extracted.get("pages").cloned().unwrap_or(Value::Null),
            "imported_at": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
        });
        write_atomic(&self.profile_file, &profile)?;

        self.load_profile()
    }

    pub fn clear_cv(&self, language: &str) -> AppResult<Value> {
        let language = normalize_language(language)?;
        let _ = std::fs::remove_file(self.cv_text_file(&language));
        let mut profile = migrate_profile(read_json(&self.profile_file)?.unwrap_or_else(|| json!({})));
        if let Some(path) = profile["cvs"][&language]
            .get("file")
            .and_then(Value::as_str)
        {
            let _ = std::fs::remove_file(path);
        }
        if let Some(cvs) = profile.get_mut("cvs").and_then(Value::as_object_mut) {
            cvs.remove(&language);
        }
        write_atomic(&self.profile_file, &profile)?;
        self.load_profile()
    }

    /// Réglages d'envoi, **sans** le mot de passe : l'interface n'a pas à le connaître,
    /// elle sait seulement s'il est enregistré.
    pub fn mail_settings(&self) -> AppResult<Value> {
        let mut settings = read_json(&self.mail_file)?.unwrap_or_else(|| json!({}));
        let has_password = settings
            .get("password")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty());
        if let Some(object) = settings.as_object_mut() {
            object.remove("password");
        }
        settings["has_password"] = Value::Bool(has_password);
        Ok(settings)
    }

    /// Enregistre les réglages d'envoi. Un mot de passe fourni est chiffré aussitôt ;
    /// un champ laissé vide garde celui déjà enregistré.
    pub fn save_mail_settings(&self, mut settings: Value) -> AppResult<Value> {
        let previous = read_json(&self.mail_file)?.unwrap_or_else(|| json!({}));
        let typed = settings
            .get("password")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        let stored = if typed.is_empty() {
            previous
                .get("password")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        } else {
            super::secrets::protect(&typed)?
        };

        if let Some(object) = settings.as_object_mut() {
            object.remove("has_password");
            object.insert("password".to_string(), Value::String(stored));
        }
        write_atomic(&self.mail_file, &settings)?;
        self.mail_settings()
    }

    /// Réglages d'envoi complets, mot de passe déchiffré : usage interne, juste avant un envoi.
    fn smtp(&self) -> AppResult<Value> {
        let settings = read_json(&self.mail_file)?.ok_or_else(|| {
            AppError::invalid("Envoi non configuré : renseignez votre compte d'envoi dans l'onglet Profil.")
        })?;
        let host = settings.get("host").and_then(Value::as_str).unwrap_or_default();
        if host.is_empty() {
            return Err(AppError::invalid(
                "Serveur d'envoi manquant : renseignez votre compte d'envoi dans l'onglet Profil.",
            ));
        }
        let password = match settings.get("password").and_then(Value::as_str) {
            Some(stored) if !stored.is_empty() => super::secrets::reveal(stored)?,
            _ => String::new(),
        };
        Ok(json!({
            "host": host,
            "port": settings.get("port").cloned().unwrap_or(json!(587)),
            "ssl": settings.get("ssl").cloned().unwrap_or(Value::Bool(false)),
            "starttls": settings.get("starttls").cloned().unwrap_or(Value::Bool(true)),
            "user": settings.get("user").cloned().unwrap_or(Value::Null),
            "password": password,
        }))
    }

    /// Envoie une candidature préparée. `message` porte destinataire, objet, corps et
    /// pièces jointes ; les identifiants sont ajoutés ici, jamais transmis par l'interface.
    pub async fn send_application(&self, mut message: Value) -> AppResult<Value> {
        let settings = read_json(&self.mail_file)?.unwrap_or_else(|| json!({}));
        message["smtp"] = self.smtp()?;
        if message.get("from").and_then(Value::as_str).unwrap_or_default().is_empty() {
            message["from"] = settings
                .get("from")
                .cloned()
                .filter(|value| value.as_str().is_some_and(|text| !text.is_empty()))
                .ok_or_else(|| AppError::invalid("Adresse d'expéditeur manquante."))?;
        }
        if let Some(reply_to) = settings.get("reply_to") {
            message["reply_to"] = reply_to.clone();
        }

        let payload = serde_json::to_string(&message)?;
        let done = self
            .engine
            .cli(&["send", "--payload", "-"], Some(payload), |_| {})
            .await?;
        if let Some(error) = done.get("error").and_then(Value::as_str) {
            return Err(AppError::internal(error.to_string()));
        }
        Ok(done)
    }

    /// Réglages SMTP connus pour une adresse (Gmail, Outlook, Orange…).
    pub async fn smtp_hint(&self, address: &str) -> AppResult<Value> {
        let done = self
            .engine
            .cli(&["smtp", "--address", address], None, |_| {})
            .await?;
        Ok(done.get("smtp").cloned().unwrap_or(Value::Null))
    }

    /// Branche (ou débranche) les outils de recherche sur les agents d'ARCHIMED.
    ///
    /// Une fois branchés, ils sont chargés à chaque session Claude ouverte dans
    /// l'application : plus rien à taper dans un terminal. La commande équivalente reste
    /// renvoyée, pour un usage en dehors d'ARCHIMED.
    pub fn set_mcp(&self, enabled: bool) -> AppResult<Value> {
        if enabled {
            let config = self.engine.mcp_config();
            write_atomic(&self.mcp_file, &config)?;
        } else if self.mcp_file.exists() {
            std::fs::remove_file(&self.mcp_file)?;
        }
        Ok(json!({
            "enabled": enabled,
            "path": self.mcp_file.display().to_string(),
            "command": format!("claude --mcp-config \"{}\"", self.mcp_file.display()),
        }))
    }
}

fn read_json(path: &Path) -> AppResult<Option<Value>> {
    match std::fs::read_to_string(path) {
        Ok(raw) => Ok(Some(serde_json::from_str(&raw)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Écriture atomique : une coupure pendant la sauvegarde ne corrompt pas le fichier.
fn write_atomic(path: &Path, value: &Value) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, serde_json::to_string_pretty(value)?)?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}

/// `fr` ou `en`, rien d'autre : le reste viendrait d'un appel mal formé.
fn normalize_language(language: &str) -> AppResult<String> {
    let language = language.trim().to_lowercase();
    if CV_LANGUAGES.contains(&language.as_str()) {
        Ok(language)
    } else {
        Err(AppError::invalid(format!(
            "langue de CV inconnue : {language} (attendu : fr ou en)"
        )))
    }
}

/// Profil écrit avant l'arrivée du CV anglais : un seul CV, à plat. Il devient le CV français.
fn migrate_profile(mut profile: Value) -> Value {
    if profile.get("cvs").is_some() {
        return profile;
    }
    let legacy = profile.get("cv_file").and_then(Value::as_str).map(|file| {
        json!({
            "file": file,
            "name": profile.get("cv_name").cloned().unwrap_or(Value::Null),
            "pages": profile.get("cv_pages").cloned().unwrap_or(Value::Null),
            "imported_at": profile.get("cv_imported_at").cloned().unwrap_or(Value::Null),
        })
    });
    if let Some(object) = profile.as_object_mut() {
        for key in ["cv_file", "cv_name", "cv_pages", "cv_imported_at", "cv_text"] {
            object.remove(key);
        }
    }
    profile["cvs"] = match legacy {
        Some(entry) => json!({ "fr": entry }),
        None => json!({}),
    };
    profile
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_profile_becomes_the_french_cv() {
        let migrated = migrate_profile(json!({
            "name": "Camille",
            "cv_file": "C:/cv/Main.pdf",
            "cv_name": "Main.pdf",
            "cv_pages": 1,
            "cv_text": "ancien texte"
        }));
        assert_eq!(migrated["cvs"]["fr"]["name"], "Main.pdf");
        assert_eq!(migrated["cvs"]["fr"]["pages"], 1);
        assert_eq!(migrated["name"], "Camille");
        // Les anciens champs disparaissent, texte compris (il vit dans son fichier).
        assert!(migrated.get("cv_file").is_none());
        assert!(migrated.get("cv_text").is_none());
    }

    #[test]
    fn a_profile_without_cv_gets_an_empty_shelf() {
        let migrated = migrate_profile(json!({ "name": "Camille" }));
        assert_eq!(migrated["cvs"], json!({}));
    }

    #[test]
    fn a_new_profile_is_left_alone() {
        let already = json!({ "cvs": { "en": { "name": "resume.pdf" } } });
        assert_eq!(migrate_profile(already.clone()), already);
    }

    #[test]
    fn only_known_languages_are_accepted() {
        assert_eq!(normalize_language(" FR ").unwrap(), "fr");
        assert_eq!(normalize_language("en").unwrap(), "en");
        assert!(normalize_language("de").is_err());
    }
}
