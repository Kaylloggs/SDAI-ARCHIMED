//! Faux serveur HTTP local pour tester les fournisseurs sans réseau.

use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub struct Reply {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn json(status: u16, body: &str) -> Self {
        Self { status, content_type: "application/json", body: body.as_bytes().to_vec() }
    }

    pub fn bytes(content_type: &'static str, body: Vec<u8>) -> Self {
        Self { status: 200, content_type, body }
    }
}

/// Démarre le serveur ; `handler(première ligne, en-têtes, corps)` décide de la réponse.
/// Chaque requête est notée dans `seen` (« ligne\ncorps »). Renvoie `http://127.0.0.1:port`.
pub async fn fake_server<F>(seen: Arc<Mutex<Vec<String>>>, handler: F) -> String
where
    F: Fn(&str, &str, &str) -> Reply + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("port local");
    let address = listener.local_addr().expect("adresse locale");
    let handler = Arc::new(handler);
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let seen = seen.clone();
            let handler = handler.clone();
            tokio::spawn(async move {
                let mut raw = Vec::new();
                let mut buffer = [0u8; 16384];
                let (head, body) = loop {
                    let n = socket.read(&mut buffer).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    raw.extend_from_slice(&buffer[..n]);
                    let Some(split) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
                        continue;
                    };
                    let head = String::from_utf8_lossy(&raw[..split]).to_string();
                    let length = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if raw.len() >= split + 4 + length {
                        let body = String::from_utf8_lossy(&raw[split + 4..split + 4 + length]).to_string();
                        break (head, body);
                    }
                };
                let line = head.lines().next().unwrap_or("").to_string();
                seen.lock().expect("journal").push(format!("{line}\n{body}"));
                let reply = handler(&line, &head, &body);
                let mut response = format!(
                    "HTTP/1.1 {} X\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    reply.status,
                    reply.content_type,
                    reply.body.len()
                )
                .into_bytes();
                response.extend_from_slice(&reply.body);
                let _ = socket.write_all(&response).await;
            });
        }
    });
    format!("http://{address}")
}

/// PNG 4 × 4 (un pixel rouge).
pub fn tiny_png() -> Vec<u8> {
    let mut image = image::RgbaImage::new(4, 4);
    image.put_pixel(1, 1, image::Rgba([255, 0, 0, 255]));
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut out, image::ImageFormat::Png)
        .expect("encodage PNG");
    out.into_inner()
}
