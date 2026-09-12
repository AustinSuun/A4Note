//! Local persistence for the SYNC-S2 note synchronization protocol.
//!
//! Network requests stay in the TypeScript platform layer. This module only
//! owns the device cursor, durable outbox and atomic application of server
//! changes so offline edits remain safe.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use uuid::Uuid;

use crate::app_paths::app_data_root;
use crate::database::{current_timestamp_ms, initialize_database};

#[derive(Debug, Serialize)]
pub(crate) struct SyncState {
    pub(crate) device_id: String,
    pub(crate) cursor: String,
    pub(crate) last_success_at: Option<i64>,
    pub(crate) last_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SyncOutboxRecord {
    pub(crate) operation_id: String,
    pub(crate) entity: String,
    pub(crate) entity_id: String,
    pub(crate) operation: String,
    pub(crate) base_version: i64,
    pub(crate) payload_json: String,
    pub(crate) state: String,
    pub(crate) retry_count: i64,
    pub(crate) next_retry_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SyncOutboxQuery {
    pub(crate) limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SyncOperationAck {
    pub(crate) operation_id: String,
    pub(crate) entity_id: String,
    pub(crate) status: String,
    pub(crate) version: Option<i64>,
    pub(crate) error: Option<String>,
    pub(crate) server_payload_json: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SyncOperationAckRequest {
    pub(crate) operations: Vec<SyncOperationAck>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SyncRetryRequest {
    pub(crate) operation_id: String,
    pub(crate) error: String,
    pub(crate) next_retry_at: i64,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct SyncNoteData {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) paper_id: Option<String>,
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) content: String,
    #[serde(default = "default_format")]
    pub(crate) format: String,
    #[serde(default)]
    pub(crate) created_at: Option<i64>,
    #[serde(default)]
    pub(crate) updated_at: Option<i64>,
    #[serde(default)]
    pub(crate) deleted_at: Option<i64>,
}

fn default_format() -> String {
    "markdown".to_string()
}

#[derive(Debug, Deserialize)]
pub(crate) struct SyncPullChange {
    pub(crate) entity: String,
    pub(crate) entity_id: String,
    pub(crate) operation: String,
    pub(crate) version: i64,
    #[serde(default)]
    pub(crate) data: Option<SyncNoteData>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SyncPullRequest {
    pub(crate) cursor: String,
    pub(crate) changes: Vec<SyncPullChange>,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_root(app)?.join("aster.db"))
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    initialize_database(&path)?;
    Connection::open(path).map_err(|error| error.to_string())
}

fn ensure_state(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO sync_state (id, device_id, cursor) VALUES (1, ?1, '0')",
            params![Uuid::new_v4().to_string()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_sync_state(app: AppHandle) -> Result<SyncState, String> {
    let _access = crate::library_access::operation()?;
    let connection = open_database(&app)?;
    ensure_state(&connection)?;
    connection
        .query_row(
            "SELECT device_id, cursor, last_success_at, last_error FROM sync_state WHERE id = 1",
            [],
            |row| {
                Ok(SyncState {
                    device_id: row.get(0)?,
                    cursor: row.get(1)?,
                    last_success_at: row.get(2)?,
                    last_error: row.get(3)?,
                })
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_sync_outbox(
    app: AppHandle,
    query: Option<SyncOutboxQuery>,
) -> Result<Vec<SyncOutboxRecord>, String> {
    let _access = crate::library_access::operation()?;
    let connection = open_database(&app)?;
    ensure_state(&connection)?;
    let limit = query
        .and_then(|value| value.limit)
        .unwrap_or(50)
        .clamp(1, 200);
    let now = current_timestamp_ms();
    let mut statement = connection
        .prepare(
            "SELECT operation_id, entity, entity_id, operation, base_version, payload_json,
                    state, retry_count, next_retry_at
             FROM sync_outbox
             WHERE state IN ('pending', 'failed')
               AND (next_retry_at IS NULL OR next_retry_at <= ?1)
             ORDER BY created_at ASC LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![now, limit], |row| {
            Ok(SyncOutboxRecord {
                operation_id: row.get(0)?,
                entity: row.get(1)?,
                entity_id: row.get(2)?,
                operation: row.get(3)?,
                base_version: row.get(4)?,
                payload_json: row.get(5)?,
                state: row.get(6)?,
                retry_count: row.get(7)?,
                next_retry_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|error| error.to_string())?);
    }
    Ok(records)
}

#[tauri::command]
pub(crate) fn reconcile_sync_operations(
    app: AppHandle,
    request: SyncOperationAckRequest,
) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    for operation in request.operations {
        if operation.status == "accepted" {
            transaction
                .execute(
                    "DELETE FROM sync_outbox WHERE operation_id = ?1",
                    params![operation.operation_id],
                )
                .map_err(|error| error.to_string())?;
            if let Some(version) = operation.version {
                transaction
                    .execute(
                        "UPDATE notes SET server_version = MAX(server_version, ?1) WHERE id = ?2",
                        params![version, operation.entity_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
        } else if operation.status == "conflict" {
            let payload = operation
                .server_payload_json
                .unwrap_or_else(|| "{}".to_string());
            transaction
                .execute(
                    "UPDATE sync_outbox
                     SET state = 'conflict', last_error = ?1, updated_at = ?2
                     WHERE operation_id = ?3",
                    params![operation.error, now, operation.operation_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO sync_conflicts (operation_id, entity, entity_id, server_version, server_payload_json, created_at)
                     VALUES (?1, 'note', ?2, ?3, ?4, ?5)
                     ON CONFLICT(operation_id) DO UPDATE SET server_version = excluded.server_version,
                       server_payload_json = excluded.server_payload_json, created_at = excluded.created_at",
                    params![operation.operation_id, operation.entity_id, operation.version.unwrap_or(0), payload, now],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn mark_sync_retry(app: AppHandle, request: SyncRetryRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let connection = open_database(&app)?;
    connection
        .execute(
            "UPDATE sync_outbox SET state = 'failed', retry_count = retry_count + 1,
                    next_retry_at = ?1, last_error = ?2, updated_at = ?3
             WHERE operation_id = ?4",
            params![
                request.next_retry_at,
                request.error,
                current_timestamp_ms(),
                request.operation_id
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn apply_sync_pull(app: AppHandle, request: SyncPullRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let incoming_cursor = request
        .cursor
        .trim()
        .parse::<i64>()
        .map_err(|_| "sync cursor must be a decimal sequence".to_string())?;
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    ensure_state(&transaction)?;
    let current_cursor: String = transaction
        .query_row("SELECT cursor FROM sync_state WHERE id = 1", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    let current_cursor = current_cursor
        .trim()
        .parse::<i64>()
        .map_err(|_| "stored sync cursor is invalid".to_string())?;
    if incoming_cursor < current_cursor {
        return Err("sync cursor cannot move backwards".to_string());
    }
    let now = current_timestamp_ms();
    for change in request.changes {
        if change.entity != "note" {
            return Err(format!("unsupported sync entity: {}", change.entity));
        }
        if change.operation != "upsert" && change.operation != "delete" {
            return Err(format!("unsupported sync operation: {}", change.operation));
        }
        if change.version < 1 {
            return Err("sync change version must be positive".to_string());
        }
        let pending_operation_id = pending_note_operation_id(&transaction, &change.entity_id)?;
        if change.operation == "delete" {
            let preserved_local_edit = transaction
                .execute(
                    "UPDATE notes SET server_version = ?1
                     WHERE id = ?2 AND server_version < ?1",
                    params![change.version, change.entity_id],
                )
                .map_err(|error| error.to_string())?;
            if preserved_local_edit > 0 {
                if let Some(operation_id) = pending_operation_id {
                    record_pull_conflict(
                        &transaction,
                        &operation_id,
                        &change.entity_id,
                        change.version,
                        "{}",
                        now,
                    )?;
                }
                continue;
            }
            transaction
                .execute(
                    "UPDATE notes SET deleted_at = ?1, updated_at = ?1, server_version = ?2
                     WHERE id = ?3 AND server_version < ?2",
                    params![now, change.version, change.entity_id],
                )
                .map_err(|error| error.to_string())?;
            continue;
        }
        let Some(data) = change.data else {
            return Err("upsert sync change is missing data".to_string());
        };
        let server_payload = serde_json::to_string(&data).map_err(|error| error.to_string())?;
        if let Some(operation_id) = pending_operation_id {
            let preserved_local_edit = transaction
                .execute(
                    "UPDATE notes SET server_version = ?1
                     WHERE id = ?2 AND server_version < ?1",
                    params![change.version, change.entity_id],
                )
                .map_err(|error| error.to_string())?;
            if preserved_local_edit > 0 {
                record_pull_conflict(
                    &transaction,
                    &operation_id,
                    &change.entity_id,
                    change.version,
                    &server_payload,
                    now,
                )?;
                continue;
            }
        }
        let created_at = data.created_at.unwrap_or(now);
        let updated_at = data.updated_at.unwrap_or(now);
        transaction
            .execute(
                "INSERT INTO notes (id, paper_id, title, content, format, created_at, updated_at, server_version, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET paper_id = excluded.paper_id, title = excluded.title,
                   content = excluded.content, format = excluded.format, updated_at = excluded.updated_at,
                   server_version = excluded.server_version, deleted_at = excluded.deleted_at
                 WHERE notes.server_version < excluded.server_version",
                params![
                    data.id,
                    data.paper_id.unwrap_or_default(),
                    data.title,
                    data.content,
                    data.format,
                    created_at,
                    updated_at,
                    change.version,
                    data.deleted_at,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction
        .execute(
            "UPDATE sync_state SET cursor = ?1, last_success_at = ?2, last_error = NULL WHERE id = 1",
            params![incoming_cursor.to_string(), now],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

fn pending_note_operation_id(
    connection: &Connection,
    entity_id: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT operation_id FROM sync_outbox
             WHERE entity = 'note' AND entity_id = ?1 AND state IN ('pending', 'failed')
             ORDER BY created_at ASC LIMIT 1",
            params![entity_id],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| {
            if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
                Ok(None)
            } else {
                Err(error.to_string())
            }
        })
}

fn record_pull_conflict(
    connection: &Connection,
    operation_id: &str,
    entity_id: &str,
    version: i64,
    server_payload: &str,
    now: i64,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO sync_conflicts (operation_id, entity, entity_id, server_version, server_payload_json, created_at)
             VALUES (?1, 'note', ?2, ?3, ?4, ?5)
             ON CONFLICT(operation_id) DO UPDATE SET server_version = excluded.server_version,
               server_payload_json = excluded.server_payload_json, created_at = excluded.created_at",
            params![operation_id, entity_id, version, server_payload, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn record_sync_error(app: AppHandle, error: String) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let connection = open_database(&app)?;
    ensure_state(&connection)?;
    connection
        .execute(
            "UPDATE sync_state SET last_error = ?1 WHERE id = 1",
            params![error],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
