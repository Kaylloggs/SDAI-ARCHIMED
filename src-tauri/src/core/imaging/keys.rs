//! Clés API des fournisseurs d'images : Gestionnaire d'identifiants de Windows, jamais un
//! fichier ni un journal ; la clé ne revient jamais entière vers l'interface.
//!
//! Chaque module range ses clés sous `<module>-<fournisseur>` (déclaré dans son `module.toml`,
//! effacé s'il est supprimé). Sans clé à lui, un module peut **relire** celle qu'un autre module
//! a déjà rangée pour le même fournisseur (même suffixe) : elle n'est jamais recopiée, et
//! disparaît pour lui si l'autre module est supprimé.

use crate::core::{AppError, AppResult};

use super::types::{KeySource, ProviderId};

/// Où une clé est rangée.
pub trait KeyStore: Send + Sync {
    fn load(&self) -> AppResult<Option<String>>;
    fn save(&self, key: &str) -> AppResult<()>;
    fn clear(&self) -> AppResult<()>;
}

/// Gestionnaire d'identifiants de Windows (entrée `<compte>.com.sdai.archimed`).
pub struct CredentialStore {
    account: String,
}

impl CredentialStore {
    pub fn new(account: impl Into<String>) -> Self {
        Self {
            account: account.into(),
        }
    }

    fn entry(&self) -> AppResult<keyring::Entry> {
        keyring::Entry::new("com.sdai.archimed", &self.account).map_err(store_error)
    }
}

fn store_error(error: keyring::Error) -> AppError {
    AppError::internal(format!("Gestionnaire d'identifiants inaccessible ({error})."))
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

/// Rangement en mémoire (tests).
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<Option<String>>);

#[cfg(test)]
impl MemoryStore {
    pub fn with(key: &str) -> Self {
        Self(std::sync::Mutex::new(Some(key.to_string())))
    }
}

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

/// Clé d'un fournisseur pour un module : la sienne, sinon celle d'un autre module.
pub struct KeyRing {
    own: Box<dyn KeyStore>,
    shared: Vec<(String, Box<dyn KeyStore>)>,
}

impl KeyRing {
    /// Compte propre `<owner>-<fournisseur>` et comptes des autres modules au même suffixe,
    /// lus dans la table générée par `build.rs` (aucun module n'est nommé ici).
    pub fn for_module(owner: &str, provider: ProviderId) -> Self {
        let suffix = format!("-{}", provider.slug());
        let shared = crate::modules::all_credentials()
            .iter()
            .filter(|(module, account)| *module != owner && account.ends_with(&suffix))
            .map(|(module, account)| {
                (
                    (*module).to_string(),
                    Box::new(CredentialStore::new(*account)) as Box<dyn KeyStore>,
                )
            })
            .collect();
        Self {
            own: Box::new(CredentialStore::new(format!("{owner}{suffix}"))),
            shared,
        }
    }

    #[cfg(test)]
    pub fn with_stores(own: Box<dyn KeyStore>, shared: Vec<(String, Box<dyn KeyStore>)>) -> Self {
        Self { own, shared }
    }

    /// La clé à utiliser et d'où elle vient. Un compte illisible ne bloque pas les suivants.
    pub fn resolve(&self) -> AppResult<Option<(String, KeySource)>> {
        if let Some(key) = self.own.load()? {
            return Ok(Some((key, KeySource::Own)));
        }
        for (module, store) in &self.shared {
            match store.load() {
                Ok(Some(key)) => {
                    return Ok(Some((
                        key,
                        KeySource::Shared {
                            module: module.clone(),
                        },
                    )))
                }
                Ok(None) => {}
                Err(error) => tracing::warn!(module = %module, "clé partagée illisible : {}", error.message),
            }
        }
        Ok(None)
    }

    pub fn save_own(&self, key: &str) -> AppResult<()> {
        self.own.save(key)
    }

    /// Retire la clé de ce module ; une clé partagée par un autre module reste chez lui.
    pub fn clear_own(&self) -> AppResult<()> {
        self.own.clear()
    }
}

/// Forme d'une clé collée : ni vide, ni espace, taille raisonnable.
pub fn check_shape(key: &str, hint: &str) -> AppResult<()> {
    if key.is_empty() || key.len() > 512 || key.chars().any(char::is_whitespace) {
        return Err(AppError::invalid(format!("Clé invalide : {hint}")));
    }
    Ok(())
}

/// « sk-or-v1-…3f9a » : de quoi reconnaître une clé sans la montrer.
pub fn mask(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 10 {
        return "•".repeat(chars.len().max(4));
    }
    let head: String = chars[..6].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_key_first_then_another_module_key_read_in_place() {
        let ring = KeyRing::with_stores(
            Box::new(MemoryStore::default()),
            vec![
                ("empty".into(), Box::new(MemoryStore::default())),
                ("studio".into(), Box::new(MemoryStore::with("sk-shared"))),
            ],
        );
        let (key, source) = ring.resolve().unwrap().unwrap();
        assert_eq!(key, "sk-shared");
        assert_eq!(source, KeySource::Shared { module: "studio".into() });
        ring.save_own("sk-own").unwrap();
        assert_eq!(ring.resolve().unwrap().unwrap(), ("sk-own".into(), KeySource::Own));
        ring.clear_own().unwrap();
        // La clé de l'autre module n'a pas bougé.
        assert_eq!(ring.resolve().unwrap().unwrap().0, "sk-shared");
    }

    #[test]
    fn keys_are_masked_and_checked() {
        assert_eq!(mask("sk-or-v1-0123456789abcdef"), "sk-or-…cdef");
        assert_eq!(mask("short"), "•••••");
        assert!(!mask("sk-or-v1-0123456789abcdef").contains("0123456789"));
        assert!(check_shape("", "x").is_err());
        assert!(check_shape("a b", "x").is_err());
        assert!(check_shape("abc:def", "x").is_ok());
    }
}
