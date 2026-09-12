//! Workbench snapshot and agent history commands (PWS-1 / CLI-4).
//!
//! Both stores are Aster's own SQLite, so both pairs of commands live on this
//! side of the wall and never in `agent_bridge` — that module is the CLI's side,
//! and a CLI process must not be able to reach the database. The frontend owns
//! both models, so a snapshot crosses as its own serialized JSON.
//!
//! The history pair is `async` because it is blocking file I/O, which Tauri then
//! keeps off the main thread.

use serde::Deserialize;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::agent_history;
use crate::app_paths::get_aster_paths;
use crate::database::initialize_database;
use crate::workbench_store;

#[derive(Debug, Deserialize)]
pub(crate) struct SaveWorkbenchStateRequest {
    pub(crate) snapshot: String,
}

// CLI-4: camelCase like the agent bridge's own requests, because these two ride
// the same frontend boundary (`src/platform/agentCli/`), not the older library
// commands' snake_case one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadAgentMessagesRequest {
    pub(crate) session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveAgentMessagesRequest {
    pub(crate) messages: Vec<agent_history::AgentMessageRecord>,
}

/// PWS-1: the workbench snapshot lives in SQLite, but the frontend owns the
/// model, so both commands move its serialized JSON as-is. `None` means the
/// workbench has never been saved and the caller keeps its own empty state.
/// Bootstrap reads the saved workbench before React renders. SQLite setup stays
/// off the Tauri UI thread so a large or newly migrated database cannot freeze
/// the window during that read.
#[tauri::command(async)]
pub fn load_workbench_state(app: AppHandle) -> Result<Option<String>, String> {
    let _access = crate::library_access::operation()?;
    let database = workbench_database(&app)?;
    workbench_store::load_snapshot_json(&database)
}

// Preserve the frontend serialized save queue, but never perform SQLite I/O
// on the window thread.
#[tauri::command(async)]
pub fn save_workbench_state(
    app: AppHandle,
    request: SaveWorkbenchStateRequest,
) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let database = workbench_database(&app)?;
    workbench_store::save_snapshot_json(&database, &request.snapshot)
}

/// The workbench loads before the library, so the tables have to exist even
/// when `initialize_library` has not run yet in this launch.
pub(crate) fn workbench_database(app: &AppHandle) -> Result<PathBuf, String> {
    let paths = get_aster_paths(app.clone())?;
    let database = PathBuf::from(paths.database);
    initialize_database(&database)?;
    Ok(database)
}

/// CLI-4: Agent conversation history. These live here rather than in
/// `agent_bridge` on purpose — that module is the CLI's side of the wall and must
/// never touch Aster's SQLite, so a CLI process can never reach the database.
/// Both commands are blocking file I/O, hence `async` (Tauri then runs them off
/// the main thread), matching the agent commands next door.
#[tauri::command(async)]
pub fn load_agent_messages(
    app: AppHandle,
    request: LoadAgentMessagesRequest,
) -> Result<Vec<agent_history::AgentMessageRecord>, String> {
    let _access = crate::library_access::operation()?;
    let database = workbench_database(&app)?;
    agent_history::load_messages(&database, &request.session_id)
}

#[tauri::command(async)]
pub fn save_agent_messages(
    app: AppHandle,
    request: SaveAgentMessagesRequest,
) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let database = workbench_database(&app)?;
    agent_history::save_messages(&database, &request.messages)
}
