//! AI conversation threads bound to a paper (P2-1).
//!
//! Storage only — no provider is called from here. A thread is created lazily by
//! the first message so an opened panel with nothing typed leaves no rows.
//!
//! This is the literature-scoped conversation, not an Agent CLI session: those
//! are keyed by workbench session and live in `agent_history`.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::app_paths::app_data_root;
use crate::database::{collect_string_rows, current_timestamp_ms, initialize_database};
use crate::library_papers::PaperMutationResult;

#[derive(Debug, Serialize)]
pub(crate) struct AiThreadSummary {
    pub(crate) id: String,
    pub(crate) paper_id: String,
    pub(crate) title: String,
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    pub(crate) messages: Vec<AiMessageSummary>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AiMessageSummary {
    pub(crate) id: String,
    pub(crate) role: String,
    pub(crate) content: String,
    pub(crate) created_at: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AppendAiMessageRequest {
    pub(crate) paper_id: String,
    pub(crate) thread_id: Option<String>,
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AppendAiMessageResult {
    pub(crate) thread_id: String,
    pub(crate) message_id: String,
}

#[tauri::command]
pub fn list_ai_threads(app: AppHandle, paper_id: String) -> Result<Vec<AiThreadSummary>, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    list_ai_threads_with_messages(&root.join("aster.db"), &paper_id)
}

#[tauri::command]
pub fn append_ai_message(
    app: AppHandle,
    request: AppendAiMessageRequest,
) -> Result<AppendAiMessageResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    append_ai_message_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn clear_ai_threads(app: AppHandle, paper_id: String) -> Result<PaperMutationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    clear_ai_threads_in_database(&root.join("aster.db"), &paper_id)?;
    Ok(PaperMutationResult { paper_id })
}

pub(crate) fn list_ai_threads_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare_cached("SELECT id FROM ai_threads WHERE paper_id = ?1 ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    collect_string_rows(rows)
}

pub(crate) fn list_ai_threads_with_messages(
    database_path: &Path,
    paper_id: &str,
) -> Result<Vec<AiThreadSummary>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, COALESCE(paper_id, ''), title, COALESCE(provider, ''), COALESCE(model, ''), created_at, updated_at
             FROM ai_threads
             WHERE paper_id = ?1
             ORDER BY updated_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| {
            Ok(AiThreadSummary {
                id: row.get(0)?,
                paper_id: row.get(1)?,
                title: row.get(2)?,
                provider: row.get(3)?,
                model: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                messages: Vec::new(),
            })
        })
        .map_err(|error| error.to_string())?;

    let mut threads = Vec::new();
    for row in rows {
        let mut thread = row.map_err(|error| error.to_string())?;
        thread.messages = list_ai_messages_for_thread(&connection, &thread.id)?;
        threads.push(thread);
    }
    Ok(threads)
}

pub(crate) fn list_ai_messages_for_thread(
    connection: &Connection,
    thread_id: &str,
) -> Result<Vec<AiMessageSummary>, String> {
    let mut statement = connection
        .prepare("SELECT id, role, content, created_at FROM ai_messages WHERE thread_id = ?1 ORDER BY created_at ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![thread_id], |row| {
            Ok(AiMessageSummary {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|error| error.to_string())?);
    }
    Ok(messages)
}

pub(crate) fn append_ai_message_in_database(
    database_path: &Path,
    request: &AppendAiMessageRequest,
) -> Result<AppendAiMessageResult, String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let thread_id = match request
        .thread_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
    {
        Some(existing) => existing.to_string(),
        None => {
            let id = format!("thread-{}", Uuid::new_v4());
            transaction
                .execute(
                    "INSERT INTO ai_threads (id, paper_id, title, provider, model, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![id, request.paper_id, "文献对话", "local", "context-draft", now, now],
                )
                .map_err(|error| error.to_string())?;
            id
        }
    };
    let message_id = format!("msg-{}", Uuid::new_v4());
    transaction
        .execute(
            "INSERT INTO ai_messages (id, thread_id, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                message_id,
                thread_id,
                request.role.trim(),
                request.content.trim(),
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE ai_threads SET updated_at = ?1 WHERE id = ?2",
            params![now, thread_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(AppendAiMessageResult {
        thread_id,
        message_id,
    })
}

pub(crate) fn clear_ai_threads_in_database(
    database_path: &Path,
    paper_id: &str,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_messages WHERE thread_id IN (SELECT id FROM ai_threads WHERE paper_id = ?1)", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM ai_threads WHERE paper_id = ?1",
            params![paper_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}
