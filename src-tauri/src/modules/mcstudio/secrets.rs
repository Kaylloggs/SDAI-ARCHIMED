//! Clés API des services d'image (OpenRouter, Google Gemini) : rangées dans le Gestionnaire
//! d'identifiants de Windows, jamais dans un fichier ni dans les journaux.

use crate::core::{AppError, AppResult};

/// Où une clé est rangée.
pub trait KeyStore: Send + Sync {
    fn load(&self) -> AppResult<Option<String>>;
    fn save(&self, key: &str) -> AppResult<()>;
    fn clear(&self) -> AppResult<()>;
}

/// Gestionnaire d'identifiants de Windows (« Informations d'identification Windows »,
/// entrée `<compte>.com.sdai.archimed`, ex. `mcstudio-openrouter`).
pub struct CredentialStore {
    account: &'static str,
}

impl CredentialStore {
    pub fn new(account: &'static str) -> Self {
        Self { account }
    }

    fn entry(&self) -> AppResult<keyring::Entry> {
        keyring::Entry::new("com.sdai.archimed", self.account).map_err(store_error)
    }
}

fn store_error(error: keyring::Error) -> AppError {
    AppError::internal(format!(
        "Gestionnaire d'identifiants inaccessible ({error})."
    ))
}

impl KeyStore for CredentialStore {
    fn load(&self) -> AppResult<Option<String>> {
        match self.entry()?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(store_error(error)),
        }
    }

    fn save(&self, key: &str) -> AppResult<()> {
        self.entry()?.set_password(key).map_err(store_error)
    }

    fn clear(&self) -> AppResult<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(store_error(error)),
        }
    }
}

/// Rangement en mémoire, pour les tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<Option<String>>);

#[cfg(test)]
impl KeyStore for MemoryStore {
    fn load(&self) -> AppResult<Option<String>> {
        Ok(self.0.lock().map(|k| k.clone()).unwrap_or(None))
    }

    fn save(&self, key: &str) -> AppResult<()> {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(key.to_string());
        }
        Ok(())
    }

    fn clear(&self) -> AppResult<()> {
        if let Ok(mut slot) = self.0.lock() {
            *slot = None;
        }
        Ok(())
    }
}

/// Forme d'une clé collée : ni vide, ni espace, taille raisonnable.
pub fn check_shape(key: &str, hint: &str) -> AppResult<()> {
    if key.is_empty() || key.len() > 512 || key.chars().any(char::is_whitespace) {
        return Err(AppError::invalid(format!("Clé invalide : {hint}")));
    }
    Ok(())
}
