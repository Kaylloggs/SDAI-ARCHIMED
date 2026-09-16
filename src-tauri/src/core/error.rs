use serde::Serialize;
use ts_rs::TS;

#[allow(dead_code)] // variantes utilisées au fil des modules
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    NotFound,
    PermissionDenied,
    CliNotInstalled,
    ProcessCrashed,
    PolicyBlocked,
    PromptExpired,
    InvalidInput,
    Io,
    Network,
    Internal,
}

/// Erreur unique exposée au frontend : `{ code, message }`.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::NotFound, message)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::InvalidInput, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::Internal, message)
    }

    pub fn cli_missing(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::CliNotInstalled, message)
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", &self.code)?;
        state.serialize_field("message", &self.message)?;
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::new(AppErrorCode::Io, error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(AppErrorCode::Internal, error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::new(AppErrorCode::Internal, error.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
