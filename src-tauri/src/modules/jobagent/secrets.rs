//! Mot de passe d'envoi, chiffré par Windows.
//!
//! Le mot de passe d'application du compte mail est confié à DPAPI (`CryptProtectData`) :
//! il est lié à la session Windows de la personne, illisible par un autre compte, et ne
//! traverse jamais l'interface. Il n'est déchiffré qu'au moment d'un envoi, pour être
//! passé au moteur par l'entrée standard.

use crate::core::{AppError, AppResult};

/// Chiffre un secret et renvoie sa forme hexadécimale, stockable dans un JSON.
pub fn protect(plain: &str) -> AppResult<String> {
    platform::protect(plain.as_bytes()).map(|bytes| to_hex(&bytes))
}

/// Opération inverse de [`protect`].
pub fn reveal(encoded: &str) -> AppResult<String> {
    let bytes = from_hex(encoded).ok_or_else(|| AppError::internal("secret illisible"))?;
    let plain = platform::reveal(&bytes)?;
    String::from_utf8(plain).map_err(|_| AppError::internal("secret illisible"))
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn from_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(text.get(index..index + 2)?, 16).ok())
        .collect()
}

#[cfg(windows)]
mod platform {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    use crate::core::{AppError, AppResult};

    /// Étiquette visible dans les journaux de Windows, pour savoir d'où vient le secret.
    const LABEL: &str = "SDAI ARCHIMED — JobAgent";

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        }
    }

    /// Copie le résultat puis rend la mémoire allouée par Windows.
    unsafe fn take(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let copied = slice.to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        copied
    }

    pub fn protect(plain: &[u8]) -> AppResult<Vec<u8>> {
        let input = blob(plain);
        let mut output = CRYPT_INTEGER_BLOB::default();
        let label: Vec<u16> = LABEL.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            CryptProtectData(
                &input,
                windows::core::PCWSTR(label.as_ptr()),
                None,
                None,
                None,
                0,
                &mut output,
            )
            .map_err(|error| AppError::internal(format!("chiffrement impossible : {error}")))?;
            Ok(take(output))
        }
    }

    pub fn reveal(encrypted: &[u8]) -> AppResult<Vec<u8>> {
        let input = blob(encrypted);
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut output).map_err(|error| {
                AppError::internal(format!(
                    "mot de passe illisible ({error}). Il a été chiffré pour une autre session Windows : saisissez-le à nouveau."
                ))
            })?;
            Ok(take(output))
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use crate::core::{AppError, AppResult};

    pub fn protect(_plain: &[u8]) -> AppResult<Vec<u8>> {
        Err(AppError::internal(
            "le stockage protégé des mots de passe n'existe que sous Windows",
        ))
    }

    pub fn reveal(_encrypted: &[u8]) -> AppResult<Vec<u8>> {
        Err(AppError::internal(
            "le stockage protégé des mots de passe n'existe que sous Windows",
        ))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn a_secret_survives_a_round_trip() {
        let encoded = protect("mot-de-passe-d'application").expect("chiffrement");
        // La forme stockée ne contient rien de lisible.
        assert!(!encoded.contains("mot-de-passe"));
        assert!(encoded.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(reveal(&encoded).expect("déchiffrement"), "mot-de-passe-d'application");
    }

    #[test]
    fn a_damaged_secret_does_not_panic() {
        assert!(reveal("pas de l'hexadécimal").is_err());
        assert!(reveal("00ff").is_err());
    }
}
