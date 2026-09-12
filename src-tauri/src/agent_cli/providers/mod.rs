//! Provider adapters: one CLI per file, each behind [`ProviderSession`].
//!
//! An adapter only speaks its CLI's dialect. Processes, threads, run isolation and
//! event emission stay in `supervisor`/`process`, and nothing here may reach Tauri,
//! SQLite or the UI — that is what let the second adapter (CLI-3, Claude Code) land
//! without reopening any of it.

use std::sync::{Arc, Mutex};

pub mod claude;
pub mod codex;

pub use claude::{ClaudeSession, CLAUDE_PROGRAM};
pub use codex::{CodexSession, CODEX_PROGRAM};

/// The conversation id the CLI minted for a session, readable from off the session
/// thread. The adapter itself is moved into the supervisor by `start`, so this is how
/// the caller learns the id it has to hand back to resume the same conversation
/// later — codex calls it a thread, `claude` calls it a session, and A4Note stores
/// either one in `AgentSession.providerSessionId`.
#[derive(Debug, Clone, Default)]
pub struct ProviderHandle(Arc<Mutex<Option<String>>>);

impl ProviderHandle {
    pub fn conversation_id(&self) -> Option<String> {
        self.0.lock().ok().and_then(|slot| slot.clone())
    }

    /// Idempotent on purpose: `claude` repeats its `system/init` frame on every turn.
    pub(super) fn publish(&self, conversation_id: &str) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(conversation_id.to_string());
        }
    }
}
