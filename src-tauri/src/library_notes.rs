//! Markdown notes bound to a paper (P2-1).
//!
//! A paper can have many notes; `note_id` is optional on the way in so the first
//! save can create one and later saves update it. Content is stored verbatim,
//! because the note is the user's text and rendering belongs to the frontend.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::app_paths::app_data_root;
use crate::database::{current_timestamp_ms, initialize_database};

#[derive(Debug, Serialize)]
pub(crate) struct NoteSummary {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ExpectedNoteContent { pub(crate) title: String, pub(crate) content: String }

#[derive(Debug, Deserialize)]
pub(crate) struct UpsertNoteRequest {
    pub(crate) paper_id: String,
    pub(crate) note_id: Option<String>,
    pub(crate) expected: Option<ExpectedNoteContent>,
    pub(crate) title: String,
    pub(crate) content: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct UpsertNoteResult {
    pub(crate) id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct DeleteNoteResult {
    pub(crate) id: String,
}

#[tauri::command]
pub fn upsert_note(app: AppHandle, request: UpsertNoteRequest) -> Result<UpsertNoteResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let id = upsert_note_in_database(&root.join("aster.db"), request)?;
    Ok(UpsertNoteResult { id })
}

#[tauri::command]
pub fn delete_note(app: AppHandle, note_id: String) -> Result<DeleteNoteResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    delete_note_in_database(&root.join("aster.db"), &note_id)?;
    Ok(DeleteNoteResult { id: note_id })
}

pub(crate) fn delete_note_in_database(database_path: &Path, note_id: &str) -> Result<(), String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let existing: Option<(i64, Option<i64>)> = transaction
        .query_row(
            "SELECT COALESCE(server_version, 0), deleted_at FROM notes WHERE id = ?1",
            params![note_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    // Deleting twice is a no-op: retain the original tombstone and operation ID.
    let Some((base_version, None)) = existing else { return Ok(()); };
    transaction
        .execute(
            "UPDATE notes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, note_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM sync_outbox WHERE entity = 'note' AND entity_id = ?1 AND state IN ('pending', 'failed')",
            params![note_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO sync_outbox (operation_id, entity, entity_id, operation, base_version, payload_json, state, created_at, updated_at)
             VALUES (?1, 'note', ?2, 'delete', ?3, '{}', 'pending', ?4, ?4)",
            params![Uuid::new_v4().to_string(), note_id, base_version, now],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn upsert_note_in_database(
    database_path: &Path,
    request: UpsertNoteRequest,
) -> Result<String, String> {
    upsert_note_in_database_with_sync(database_path, request, true)
}

fn upsert_note_in_database_with_sync(
    database_path: &Path,
    request: UpsertNoteRequest,
    enqueue_sync: bool,
) -> Result<String, String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let id = request
        .note_id
        .unwrap_or_else(|| format!("note-{}", Uuid::new_v4()));
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let parent_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM papers WHERE id = ?1)", params![request.paper_id], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if !parent_exists { return Err("文献不存在，无法保存笔记".to_string()); }
    let existing: Option<(String, i64, Option<i64>, String, String)> = transaction.query_row(
        "SELECT paper_id, COALESCE(server_version, 0), deleted_at, COALESCE(title, '阅读笔记'), content FROM notes WHERE id = ?1",
        params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).optional().map_err(|error| error.to_string())?;
    let base_version = match existing {
        Some((owner, version, deleted_at, old_title, old_content)) => {
            if owner != request.paper_id { return Err("笔记不属于当前文献，拒绝覆盖".to_string()); }
            if deleted_at.is_some() { return Err("笔记已删除，拒绝旧编辑覆盖；请另存为新笔记".to_string()); }
            if let Some(expected) = &request.expected {
                if (expected.title != old_title || expected.content != old_content)
                    && (request.title != old_title || request.content != old_content) { return Err("笔记已被其他编辑修改，拒绝覆盖；请导出草稿并重新打开原笔记进行合并".into()); }
            }
            version
        }
        None => 0,
    };
    transaction
        .execute(
            "INSERT INTO notes (id, paper_id, title, content, format, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, format = excluded.format, updated_at = excluded.updated_at",
            params![id, request.paper_id, request.title, request.content, "markdown", now, now],
        )
        .map_err(|error| error.to_string())?;
    if enqueue_sync {
        let payload = json!({
            "title": request.title,
            "content": request.content,
            "format": "markdown",
            "paperId": request.paper_id,
        })
        .to_string();
        // Coalesce unsent edits for the same note. The earliest base version is
        // retained so the server still detects a remote edit made meanwhile.
        transaction
            .execute(
                "DELETE FROM sync_outbox WHERE entity = 'note' AND entity_id = ?1 AND state IN ('pending', 'failed')",
                params![id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO sync_outbox (operation_id, entity, entity_id, operation, base_version, payload_json, state, created_at, updated_at)
                 VALUES (?1, 'note', ?2, 'upsert', ?3, ?4, 'pending', ?5, ?5)",
                params![Uuid::new_v4().to_string(), id, base_version, payload, now],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(id)
}

pub(crate) fn list_notes_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<NoteSummary>, String> {
    let mut statement = connection
        .prepare_cached("SELECT id, COALESCE(title, '阅读笔记'), content, updated_at FROM notes WHERE paper_id = ?1 AND deleted_at IS NULL ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| {
            Ok(NoteSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut notes = Vec::new();
    for row in rows {
        notes.push(row.map_err(|error| error.to_string())?);
    }
    Ok(notes)
}
