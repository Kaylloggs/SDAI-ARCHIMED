use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::core::{AppError, AppResult};

use super::session::{SessionCommand, SessionHandle};

#[derive(Default, Clone)]
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, SessionHandle>>>,
}

impl SessionManager {
    pub async fn insert(&self, handle: SessionHandle) {
        self.sessions.write().await.insert(handle.id.clone(), handle);
    }

    pub async fn send(&self, session_id: &str, command: SessionCommand) -> AppResult<()> {
        let sessions = self.sessions.read().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| AppError::not_found(format!("session {session_id} introuvable")))?;
        handle
            .tx
            .send(command)
            .map_err(|_| AppError::internal("session terminée"))
    }

    pub async fn remove(&self, session_id: &str) {
        self.sessions.write().await.remove(session_id);
    }
}
