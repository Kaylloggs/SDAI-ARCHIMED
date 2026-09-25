//! Mode compte, vue navigateur intégrée : le site officiel (Gemini, ChatGPT, Higgsfield)
//! s'affiche dans la fenêtre d'ARCHIMED, dans une vue web à part, posée sur la zone que le
//! studio lui réserve.
//!
//! Sécurité : une page distante ne peut appeler aucune commande de l'application (Tauri
//! refuse toute commande d'une origine distante sans capacité `remote`, et aucune n'est
//! déclarée). Rien n'est injecté dans les pages : ce que la personne tape (mot de passe
//! compris) reste entre elle et le site. Les téléchargements vont où le navigateur les met
//! (dossier Téléchargements) ; le studio propose ensuite de les importer.

use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{DownloadEvent, PageLoadEvent};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, Rect, Runtime, Url, WebviewBuilder, WebviewUrl};
use ts_rs::TS;

use crate::core::{AppError, AppResult};

/// Étiquette de la vue web (unique dans l'application).
pub const LABEL: &str = "image-maker-browser";
/// Page chargée, titre, téléchargement terminé.
pub const EVENT: &str = "image-maker:browser";
/// Seule la fenêtre de l'application reçoit les événements (jamais la page distante).
const MAIN: &str = "main";

/// Sites officiels où créer avec son abonnement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum AccountSite {
    /// Application Gemini (images « Nano Banana »), pas Google AI Studio.
    Gemini,
    Chatgpt,
    Higgsfield,
}

impl AccountSite {
    pub fn url(self) -> &'static str {
        match self {
            Self::Gemini => "https://gemini.google.com/",
            Self::Chatgpt => "https://chatgpt.com/",
            Self::Higgsfield => "https://higgsfield.ai/",
        }
    }
}

/// Zone réservée par le studio, en pixels CSS de la fenêtre.
#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl BrowserBounds {
    fn checked(self) -> AppResult<Rect> {
        let finite = [self.x, self.y, self.width, self.height].iter().all(|v| v.is_finite());
        if !finite || self.width < 1.0 || self.height < 1.0 {
            return Err(AppError::invalid("Zone d'affichage du site invalide."));
        }
        Ok(Rect {
            position: LogicalPosition::new(self.x.max(0.0), self.y.max(0.0)).into(),
            size: LogicalSize::new(self.width, self.height).into(),
        })
    }
}

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum BrowserAction {
    Back,
    Forward,
    Reload,
    /// Retour à la page d'accueil du site ouvert.
    Home,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BrowserEvent {
    /// Page en cours (adresse affichée pour que la personne sache où elle tape).
    #[serde(rename_all = "camelCase")]
    Page { url: String, loading: bool },
    Title { title: String },
    /// Téléchargement terminé ; `image` : format que le studio sait importer.
    #[serde(rename_all = "camelCase")]
    Download { path: String, name: String, success: bool, image: bool },
}

/// Site ouvert en dernier (la vue est gardée cachée entre deux visites).
static CURRENT: Mutex<Option<AccountSite>> = Mutex::new(None);

fn tauri_error(error: tauri::Error) -> AppError {
    AppError::internal(format!("Vue navigateur : {error}"))
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff"
            )
        })
        .unwrap_or(false)
}

fn emit<R: Runtime>(app: &tauri::AppHandle<R>, event: BrowserEvent) {
    let _ = app.emit_to(MAIN, EVENT, event);
}

/// Affiche le site dans la zone donnée : crée la vue au premier appel, la réutilise ensuite
/// (la session du site est gardée), change de site si besoin.
pub fn open<R: Runtime>(window: &tauri::Window<R>, site: AccountSite, bounds: BrowserBounds) -> AppResult<()> {
    let rect = bounds.checked()?;
    let url = Url::parse(site.url()).map_err(|e| AppError::internal(e.to_string()))?;
    let app = window.app_handle().clone();
    let mut current = CURRENT.lock().map_err(|_| AppError::internal("Vue navigateur indisponible."))?;
    if let Some(webview) = app.get_webview(LABEL) {
        if *current != Some(site) {
            webview.navigate(url).map_err(tauri_error)?;
        }
        webview.set_bounds(rect).map_err(tauri_error)?;
        webview.show().map_err(tauri_error)?;
        let _ = webview.set_focus();
        *current = Some(site);
        return Ok(());
    }

    let pages = app.clone();
    let titles = app.clone();
    let downloads = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .on_page_load(move |_webview, payload| {
            emit(
                &pages,
                BrowserEvent::Page {
                    url: payload.url().to_string(),
                    loading: matches!(payload.event(), PageLoadEvent::Started),
                },
            );
        })
        .on_document_title_changed(move |_webview, title| emit(&titles, BrowserEvent::Title { title }))
        .on_download(move |_webview, event| {
            // Emplacement laissé au navigateur (dossier Téléchargements) : rien n'est redirigé.
            if let DownloadEvent::Finished { path: Some(path), success, .. } = event {
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                emit(
                    &downloads,
                    BrowserEvent::Download {
                        image: is_image(&path),
                        path: path.to_string_lossy().into_owned(),
                        name,
                        success,
                    },
                );
            }
            true
        });
    let webview = window
        .add_child(builder, rect.position, rect.size)
        .map_err(tauri_error)?;
    let _ = webview.set_focus();
    *current = Some(site);
    Ok(())
}

pub fn set_bounds<R: Runtime>(app: &tauri::AppHandle<R>, bounds: BrowserBounds) -> AppResult<()> {
    let rect = bounds.checked()?;
    if let Some(webview) = app.get_webview(LABEL) {
        webview.set_bounds(rect).map_err(tauri_error)?;
    }
    Ok(())
}

/// Cache la vue (studio quitté, fenêtre modale au-dessus) ; le site reste chargé.
pub fn hide<R: Runtime>(app: &tauri::AppHandle<R>) -> AppResult<()> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview.hide().map_err(tauri_error)?;
    }
    Ok(())
}

/// Ferme la vue : la page est déchargée (la session du site reste dans le profil WebView2).
pub fn close<R: Runtime>(app: &tauri::AppHandle<R>) -> AppResult<()> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview.close().map_err(tauri_error)?;
    }
    if let Ok(mut current) = CURRENT.lock() {
        *current = None;
    }
    Ok(())
}

pub fn act<R: Runtime>(app: &tauri::AppHandle<R>, action: BrowserAction) -> AppResult<()> {
    let Some(webview) = app.get_webview(LABEL) else {
        return Ok(());
    };
    match action {
        // Navigation de l'historique du site, sans rien lire de la page.
        BrowserAction::Back => webview.eval("history.back()").map_err(tauri_error),
        BrowserAction::Forward => webview.eval("history.forward()").map_err(tauri_error),
        BrowserAction::Reload => webview.reload().map_err(tauri_error),
        BrowserAction::Home => {
            let site = CURRENT.lock().ok().and_then(|c| *c).unwrap_or(AccountSite::Gemini);
            let url = Url::parse(site.url()).map_err(|e| AppError::internal(e.to_string()))?;
            webview.navigate(url).map_err(tauri_error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sites_are_the_official_https_pages() {
        for site in [AccountSite::Gemini, AccountSite::Chatgpt, AccountSite::Higgsfield] {
            let url = Url::parse(site.url()).unwrap();
            assert_eq!(url.scheme(), "https");
        }
        assert_eq!(AccountSite::Gemini.url(), "https://gemini.google.com/");
        assert_eq!(AccountSite::Chatgpt.url(), "https://chatgpt.com/");
    }

    #[test]
    fn bounds_are_validated() {
        let ok = BrowserBounds { x: 10.0, y: 20.0, width: 800.0, height: 600.0 };
        assert!(ok.checked().is_ok());
        assert!(BrowserBounds { width: 0.0, ..ok }.checked().is_err());
        assert!(BrowserBounds { x: f64::NAN, ..ok }.checked().is_err());
    }

    #[test]
    fn downloads_are_recognised_as_images() {
        assert!(is_image(Path::new("C:/Users/a/Downloads/Gemini_Generated_Image.PNG")));
        assert!(is_image(Path::new("/x/y.webp")));
        assert!(!is_image(Path::new("/x/y.pdf")));
    }
}
