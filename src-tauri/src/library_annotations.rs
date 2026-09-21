//! PDF annotations (P2-1).
//!
//! Every annotation is keyed by `paper_id + file_id`, so the source PDF and a
//! translated PDF of the same paper never show each other's marks.
//!
//! Restore takes the original id and timestamp instead of minting new ones: undo
//! has to give back the same annotation, or the reader's selection, the list and
//! any `@annotation(id)` reference in a note all lose their target. Delete is
//! idempotent for the same reason — undo/redo replays it.
//!
//! Every row belongs to an annotation layer (fb5e3f2f). Writes name the layer they
//! target and are refused for locked/archived layers; list queries are bounded by
//! the layers a caller asks for (by default the owner's visible layers).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::annotation_layers::{active_layer_id, assert_annotation_writable, assert_layer_writable_for, visible_layer_ids, LayerOwner};
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
    pub(crate) layer_id: String,
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
    /// Target layer captured by the client when the write started; empty means the owner's active layer.
    #[serde(default)]
    pub(crate) layer_id: String,
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
    /// Layer recorded in the undo snapshot, so a restore never lands in a layer chosen later.
    #[serde(default)]
    pub(crate) layer_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CreateAnnotationResult {
    pub(crate) id: String,
}

/// Additive create response: legacy callers may continue reading only `id`.
#[derive(Debug, Serialize)]
pub(crate) struct CreatedAnnotation {
    pub(crate) id: String,
    pub(crate) created_at: i64,
    pub(crate) layer_id: String,
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
) -> Result<CreatedAnnotation, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    insert_annotation_with_timestamp(&root.join("aster.db"), &request)
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

/// Bounded read: the annotations of one paper in the given layers only (an empty list means the
/// owner's currently visible layers). The reader calls this when a hidden layer is shown.
#[tauri::command]
pub fn list_paper_annotations(
    app: AppHandle,
    paper_id: String,
    layer_ids: Vec<String>,
) -> Result<Vec<AnnotationSummary>, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let database_path = root.join("aster.db");
    initialize_database(&database_path)?;
    let connection = Connection::open(&database_path).map_err(|error| error.to_string())?;
    if layer_ids.is_empty() {
        list_visible_annotations_for_paper(&connection, &paper_id)
    } else {
        list_annotations_for_paper_in_layers(&connection, &paper_id, &layer_ids)
    }
}

/// Resolves one annotation regardless of layer visibility (note references may point into hidden layers).
#[tauri::command]
pub fn get_annotation(app: AppHandle, annotation_id: String) -> Result<Option<AnnotationSummary>, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let database_path = root.join("aster.db");
    initialize_database(&database_path)?;
    let connection = Connection::open(&database_path).map_err(|error| error.to_string())?;
    let mut rows = query_annotations(&connection, "WHERE id = ?1", params![annotation_id])?;
    Ok(rows.pop())
}

pub(crate) fn insert_annotation(
    database_path: &Path,
    request: &CreateAnnotationRequest,
) -> Result<String, String> {
    insert_annotation_with_timestamp(database_path, request).map(|created| created.id)
}

fn insert_annotation_with_timestamp(
    database_path: &Path,
    request: &CreateAnnotationRequest,
) -> Result<CreatedAnnotation, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let owner = LayerOwner::paper(&request.paper_id)?;
    let layer_id = resolve_layer(&connection, &owner, &request.layer_id)?;
    let now = current_timestamp_ms();
    let id = format!("anno-{}", Uuid::new_v4());
    connection
        .execute(
            "INSERT INTO annotations (id, paper_id, file_id, page, type, quote, comment, color, position_json, created_at, updated_at, layer_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![id, request.paper_id, request.file_id, request.page, request.annotation_type, request.quote, request.comment, request.color, request.position_json, now, now, layer_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(CreatedAnnotation { id, created_at: now, layer_id })
}

/// The layer a write goes to: the one the client captured, or the owner's active layer for legacy
/// callers. Either way it must belong to the owner and accept writes.
fn resolve_layer(connection: &Connection, owner: &LayerOwner, requested: &str) -> Result<String, String> {
    let layer_id = if requested.trim().is_empty() { active_layer_id(connection, owner)? } else { requested.trim().to_string() };
    assert_layer_writable_for(connection, owner, &layer_id)?;
    Ok(layer_id)
}

pub(crate) fn restore_annotation_in_database(
    database_path: &Path,
    request: &RestoreAnnotationRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let owner = LayerOwner::paper(&request.paper_id)?;
    let layer_id = resolve_layer(&connection, &owner, &request.layer_id)?;
    let now = current_timestamp_ms();
    connection
        .execute(
            "INSERT OR REPLACE INTO annotations (id, paper_id, file_id, page, type, quote, comment, color, position_json, created_at, updated_at, layer_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
                now,
                layer_id
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
    assert_annotation_writable(&connection, "annotations", &request.annotation_id)?;
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
    assert_annotation_writable(&connection, "annotations", &request.annotation_id)?;
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
    assert_annotation_writable(&connection, "annotations", &request.annotation_id)?;
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
    assert_annotation_writable(&connection, "annotations", &request.annotation_id)?;
    connection
        .execute(
            "DELETE FROM annotations WHERE id = ?1",
            params![request.annotation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Every annotation of the paper across all layers (diagnostics, migrations and tests).
pub(crate) fn list_annotations_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<AnnotationSummary>, String> {
    query_annotations(connection, "WHERE paper_id = ?1 ORDER BY created_at DESC", params![paper_id])
}

/// The bounded startup/reader read: only the layers the owner currently shows. Hidden and archived
/// layers stay in the database and are fetched on demand with `list_annotations_for_paper_in_layers`.
pub(crate) fn list_visible_annotations_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<AnnotationSummary>, String> {
    let owner = LayerOwner::paper(paper_id)?;
    let layers = visible_layer_ids(connection, &owner)?;
    list_annotations_for_paper_in_layers(connection, paper_id, &layers)
}

pub(crate) fn list_annotations_for_paper_in_layers(
    connection: &Connection,
    paper_id: &str,
    layer_ids: &[String],
) -> Result<Vec<AnnotationSummary>, String> {
    let mut annotations = Vec::new();
    // One indexed query per requested layer keeps the plan on (paper_id, layer_id, ...).
    for layer_id in layer_ids {
        annotations.extend(query_annotations(
            connection,
            "WHERE paper_id = ?1 AND layer_id = ?2 ORDER BY created_at DESC",
            params![paper_id, layer_id],
        )?);
    }
    annotations.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id)));
    Ok(annotations)
}

fn query_annotations(
    connection: &Connection,
    clause: &str,
    parameters: impl rusqlite::Params,
) -> Result<Vec<AnnotationSummary>, String> {
    let mut statement = connection
        .prepare_cached(&format!(
            "SELECT id, file_id, page, type, COALESCE(quote, ''), COALESCE(comment, ''), COALESCE(color, 'yellow'), position_json, created_at, layer_id
             FROM annotations {clause}"
        ))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(parameters, |row| {
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
                layer_id: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut annotations = Vec::new();
    for row in rows {
        annotations.push(row.map_err(|error| error.to_string())?);
    }
    Ok(annotations)
}

#[cfg(test)]
mod timestamp_tests {
    use super::*;

    #[test]
    fn create_response_matches_database_and_restore_for_all_tools() {
        let root = std::env::temp_dir().join(format!("a4note-created-time-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db = root.join("test.sqlite");
        initialize_database(&db).unwrap();
        let seed = Connection::open(&db).unwrap();
        seed.execute("INSERT INTO papers(id,title,created_at,updated_at) VALUES ('synthetic-paper','Synthetic timestamp test',1,1)", []).unwrap();
        seed.execute("INSERT INTO paper_files(id,paper_id,type,path,created_at) VALUES ('synthetic-file','synthetic-paper','source_pdf','/synthetic/test.pdf',1)", []).unwrap();
        drop(seed);
        for kind in ["highlight", "underline", "text", "rect", "arrow", "ink"] {
            let request = CreateAnnotationRequest {
                paper_id: "synthetic-paper".into(), file_id: "synthetic-file".into(),
                page: 1, annotation_type: kind.into(), quote: "timestamp fixture".into(),
                comment: "synthetic only".into(), color: "blue".into(), position_json: "{}".into(), layer_id: String::new(),
            };
            let created = insert_annotation_with_timestamp(&db, &request).unwrap();
            let connection = Connection::open(&db).unwrap();
            let stored: i64 = connection.query_row("SELECT created_at FROM annotations WHERE id=?1", [&created.id], |r| r.get(0)).unwrap();
            assert_eq!(created.created_at, stored);
            let payload = serde_json::to_value(&created).unwrap();
            assert_eq!(payload["id"], created.id);
            assert_eq!(payload["created_at"], stored);
            for _ in 0..3 {
                delete_annotation_in_database(&db, &DeleteAnnotationRequest { annotation_id: created.id.clone() }).unwrap();
                restore_annotation_in_database(&db, &RestoreAnnotationRequest {
                    annotation_id: created.id.clone(), paper_id: request.paper_id.clone(), file_id: request.file_id.clone(),
                    page: 1, annotation_type: kind.into(), quote: request.quote.clone(), comment: request.comment.clone(),
                    color: request.color.clone(), position_json: request.position_json.clone(), created_at: created.created_at, layer_id: created.layer_id.clone(),
                }).unwrap();
                let restored: i64 = connection.query_row("SELECT created_at FROM annotations WHERE id=?1", [&created.id], |r| r.get(0)).unwrap();
                assert_eq!(restored, stored);
            }
            assert!(insert_annotation_with_timestamp(&root, &request).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
