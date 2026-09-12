//! PDF annotations (P2-1).
//!
//! Every annotation is keyed by `paper_id + file_id`, so the source PDF and a
//! translated PDF of the same paper never show each other's marks.
//!
//! Restore takes the original id and timestamp instead of minting new ones: undo
//! has to give back the same annotation, or the reader's selection, the list and
//! any `@annotation(id)` reference in a note all lose their target. Delete is
//! idempotent for the same reason — undo/redo replays it.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::app_paths::app_data_root;
use crate::database::{current_timestamp_ms, initialize_database};

#[derive(Debug, Serialize)]
pub(crate) struct AnnotationSummary {
    pub(crate) id: String,
    pub(crate) file_id: String,
    pub(crate) page: i64,
    pub(crate) annotation_type: String,
    pub(crate) quote: String,
    pub(crate) comment: String,
    pub(crate) color: String,
    pub(crate) position_json: String,
    pub(crate) created_at: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateAnnotationRequest {
    pub(crate) paper_id: String,
    pub(crate) file_id: String,
    pub(crate) page: i64,
    pub(crate) annotation_type: String,
    pub(crate) quote: String,
    pub(crate) comment: String,
    pub(crate) color: String,
    pub(crate) position_json: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RestoreAnnotationRequest {
    pub(crate) annotation_id: String,
    pub(crate) paper_id: String,
    pub(crate) file_id: String,
    pub(crate) page: i64,
    pub(crate) annotation_type: String,
    pub(crate) quote: String,
    pub(crate) comment: String,
    pub(crate) color: String,
    pub(crate) position_json: String,
    pub(crate) created_at: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct CreateAnnotationResult {
    pub(crate) id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAnnotationCommentRequest {
    pub(crate) annotation_id: String,
    pub(crate) comment: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAnnotationColorRequest {
    pub(crate) annotation_id: String,
    pub(crate) color: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAnnotationPositionRequest {
    pub(crate) annotation_id: String,
    pub(crate) position_json: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DeleteAnnotationRequest {
    pub(crate) annotation_id: String,
}

#[tauri::command]
pub fn create_annotation(
    app: AppHandle,
    request: CreateAnnotationRequest,
) -> Result<CreateAnnotationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let id = insert_annotation(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult { id })
}

#[tauri::command]
pub fn restore_annotation(
    app: AppHandle,
    request: RestoreAnnotationRequest,
) -> Result<CreateAnnotationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    restore_annotation_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
pub fn update_annotation_comment(
    app: AppHandle,
    request: UpdateAnnotationCommentRequest,
) -> Result<CreateAnnotationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_annotation_comment_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
pub fn update_annotation_color(
    app: AppHandle,
    request: UpdateAnnotationColorRequest,
) -> Result<CreateAnnotationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_annotation_color_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
pub fn update_annotation_position(
    app: AppHandle,
    request: UpdateAnnotationPositionRequest,
) -> Result<CreateAnnotationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_annotation_position_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
pub fn delete_annotation(
    app: AppHandle,
    request: DeleteAnnotationRequest,
) -> Result<CreateAnnotationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    delete_annotation_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

pub(crate) fn insert_annotation(
    database_path: &Path,
    request: &CreateAnnotationRequest,
) -> Result<String, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let id = format!("anno-{}", Uuid::new_v4());
    connection
        .execute(
            "INSERT INTO annotations (id, paper_id, file_id, page, type, quote, comment, color, position_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![id, request.paper_id, request.file_id, request.page, request.annotation_type, request.quote, request.comment, request.color, request.position_json, now, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(id)
}

pub(crate) fn restore_annotation_in_database(
    database_path: &Path,
    request: &RestoreAnnotationRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    connection
        .execute(
            "INSERT OR REPLACE INTO annotations (id, paper_id, file_id, page, type, quote, comment, color, position_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                request.annotation_id,
                request.paper_id,
                request.file_id,
                request.page,
                request.annotation_type,
                request.quote,
                request.comment,
                request.color,
                request.position_json,
                request.created_at,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn update_annotation_comment_in_database(
    database_path: &Path,
    request: &UpdateAnnotationCommentRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let updated = connection
        .execute(
            "UPDATE annotations SET comment = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                request.comment,
                current_timestamp_ms(),
                request.annotation_id
            ],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err("Annotation not found".to_string());
    }
    Ok(())
}

pub(crate) fn update_annotation_color_in_database(
    database_path: &Path,
    request: &UpdateAnnotationColorRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let changed = connection
        .execute(
            "UPDATE annotations
             SET color = ?1, updated_at = ?2
             WHERE id = ?3",
            params![
                request.color.trim(),
                current_timestamp_ms(),
                request.annotation_id
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Annotation not found".to_string());
    }
    Ok(())
}

pub(crate) fn update_annotation_position_in_database(
    database_path: &Path,
    request: &UpdateAnnotationPositionRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let changed = connection
        .execute(
            "UPDATE annotations
             SET position_json = ?1, updated_at = ?2
             WHERE id = ?3",
            params![
                request.position_json.trim(),
                current_timestamp_ms(),
                request.annotation_id
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Annotation not found".to_string());
    }
    Ok(())
}

pub(crate) fn delete_annotation_in_database(
    database_path: &Path,
    request: &DeleteAnnotationRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM annotations WHERE id = ?1",
            params![request.annotation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn list_annotations_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<AnnotationSummary>, String> {
    let mut statement = connection
        .prepare_cached(
            "SELECT id, file_id, page, type, COALESCE(quote, ''), COALESCE(comment, ''), COALESCE(color, 'yellow'), position_json, created_at
             FROM annotations WHERE paper_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| {
            Ok(AnnotationSummary {
                id: row.get(0)?,
                file_id: row.get(1)?,
                page: row.get(2)?,
                annotation_type: row.get(3)?,
                quote: row.get(4)?,
                comment: row.get(5)?,
                color: row.get(6)?,
                position_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut annotations = Vec::new();
    for row in rows {
        annotations.push(row.map_err(|error| error.to_string())?);
    }
    Ok(annotations)
}
