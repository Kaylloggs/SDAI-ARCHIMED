//! Outils HTTP communs aux fournisseurs : client, téléchargement borné, formats d'image.

use std::time::Duration;

use base64::Engine;

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

/// Taille maximale d'une image reçue ou envoyée (les modèles actuels restent sous 20 Mo).
pub const MAX_IMAGE_BYTES: usize = 48 * 1024 * 1024;

pub fn client(builder: reqwest::ClientBuilder) -> Option<reqwest::Client> {
    builder
        .connect_timeout(Duration::from_secs(15))
        .user_agent(concat!("SDAI-ARCHIMED/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| tracing::warn!("client HTTP indisponible : {e}"))
        .ok()
}

/// Erreur réseau → message lisible, au nom du fournisseur.
pub fn unreachable(provider: &str, error: reqwest::Error) -> AppError {
    let message = if error.is_timeout() {
        format!("{provider} n'a pas répondu à temps : réessayez, ou choisissez un modèle plus rapide.")
    } else {
        format!("{provider} injoignable ({error}) : une connexion Internet est nécessaire.")
    };
    AppError::new(AppErrorCode::Network, message)
}

/// Télécharge une image renvoyée par lien (HTTPS seulement, taille bornée).
pub async fn download(http: &reqwest::Client, provider: &str, url: &str) -> AppResult<Vec<u8>> {
    if !url.starts_with("https://") {
        return Err(AppError::invalid(format!(
            "{provider} a renvoyé un lien d'image non sécurisé : ignoré."
        )));
    }
    let response = http
        .get(url)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| unreachable(provider, e))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            AppErrorCode::Network,
            format!("Image introuvable à l'adresse fournie par {provider} ({}).", response.status()),
        ));
    }
    if response
        .content_length()
        .is_some_and(|len| len > MAX_IMAGE_BYTES as u64)
    {
        return Err(AppError::invalid("Image trop lourde (48 Mo au plus)."));
    }
    let bytes = response.bytes().await.map_err(|e| unreachable(provider, e))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::invalid("Image trop lourde (48 Mo au plus)."));
    }
    Ok(bytes.to_vec())
}

/// Type MIME d'après les premiers octets (PNG, JPEG, WebP, GIF, BMP, TIFF).
pub fn sniff_mime(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        [b'G', b'I', b'F', b'8', ..] => "image/gif",
        [b'B', b'M', ..] => "image/bmp",
        [b'I', b'I', 42, 0, ..] | [b'M', b'M', 0, 42, ..] => "image/tiff",
        _ => "application/octet-stream",
    }
}

pub fn data_url(bytes: &[u8], mime: &str) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

pub fn decode_base64(encoded: &str) -> AppResult<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| AppError::internal(format!("image reçue illisible : {e}")))
}

/// `data:image/png;base64,…` → octets.
pub fn decode_data_url(url: &str) -> AppResult<Vec<u8>> {
    let data = url
        .strip_prefix("data:")
        .ok_or_else(|| AppError::internal("image reçue dans un format inattendu"))?;
    let (_, encoded) = data
        .split_once(";base64,")
        .ok_or_else(|| AppError::internal("image reçue dans un format inattendu"))?;
    decode_base64(encoded)
}

/// Premier message d'erreur lisible d'un corps JSON (`error.message`, `detail`, `message`).
pub fn error_detail(body: &str) -> String {
    let value: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    let text = value["error"]["message"]
        .as_str()
        .or_else(|| value["detail"].as_str())
        .or_else(|| value["message"].as_str())
        .map(str::to_string)
        .or_else(|| {
            // Erreurs de validation : `detail: [{ msg, loc }]`.
            value["detail"].as_array().map(|list| {
                list.iter()
                    .filter_map(|d| {
                        let msg = d["msg"].as_str()?;
                        let field = d["loc"]
                            .as_array()
                            .and_then(|loc| loc.last())
                            .and_then(|l| l.as_str())
                            .unwrap_or("");
                        Some(if field.is_empty() { msg.to_string() } else { format!("{field} : {msg}") })
                    })
                    .collect::<Vec<_>>()
                    .join(" ; ")
            })
        })
        .unwrap_or_default();
    text.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_are_recognised_from_their_first_bytes() {
        assert_eq!(sniff_mime(b"\x89PNG\r\n\x1a\n...."), "image/png");
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(sniff_mime(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
        assert_eq!(sniff_mime(b"GIF89a"), "image/gif");
        assert_eq!(sniff_mime(b"nope"), "application/octet-stream");
    }

    #[test]
    fn error_details_are_read_from_the_usual_shapes() {
        assert_eq!(error_detail(r#"{"error":{"message":"bad size"}}"#), "bad size");
        assert_eq!(error_detail(r#"{"detail":"Not enough credits"}"#), "Not enough credits");
        assert_eq!(
            error_detail(r#"{"detail":[{"loc":["body","aspect_ratio"],"msg":"invalid value"}]}"#),
            "aspect_ratio : invalid value"
        );
        assert_eq!(error_detail("oops"), "");
        let url = data_url(b"\x89PNG", "image/png");
        assert_eq!(decode_data_url(&url).unwrap(), b"\x89PNG");
    }
}
