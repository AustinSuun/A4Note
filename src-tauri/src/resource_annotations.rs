//! Annotations attached to generic PDF Resources (PDF-1).
//!
//! Literature annotations remain in `annotations` and keep their paper/file
//! foreign keys. Resource annotations use a separate table so old databases and
//! paper workflows remain unchanged.
//!
//! Resource annotations follow the same layer rules as paper annotations (fb5e3f2f):
//! the owner is `(resource, resource_id)`, writes target a writable layer and the
//! default list is bounded by the owner's visible layers.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::annotation_layers::{active_layer_id, assert_annotation_writable, assert_layer_writable_for, visible_layer_ids, LayerOwner};
use crate::app_paths::app_data_root;
use crate::database::{current_timestamp_ms, initialize_database};

#[derive(Debug, Serialize)]
pub(crate) struct ResourceAnnotationSummary {
    pub(crate) id: String,
    pub(crate) resource_id: String,
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
pub(crate) struct CreateResourceAnnotationRequest {
    pub(crate) resource_id: String,
    pub(crate) page: i64,
    pub(crate) annotation_type: String,
    pub(crate) quote: String,
    pub(crate) comment: String,
    pub(crate) color: String,
    pub(crate) position_json: String,
    #[serde(default)]
    pub(crate) layer_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RestoreResourceAnnotationRequest {
    pub(crate) annotation_id: String,
    pub(crate) resource_id: String,
    pub(crate) page: i64,
    pub(crate) annotation_type: String,
    pub(crate) quote: String,
    pub(crate) comment: String,
    pub(crate) color: String,
    pub(crate) position_json: String,
    pub(crate) created_at: i64,
    #[serde(default)]
    pub(crate) layer_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ResourceAnnotationIdRequest {
    pub(crate) annotation_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ResourceAnnotationCommentRequest {
    pub(crate) annotation_id: String,
    pub(crate) comment: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ResourceAnnotationColorRequest {
    pub(crate) annotation_id: String,
    pub(crate) color: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ResourceAnnotationPositionRequest {
    pub(crate) annotation_id: String,
    pub(crate) position_json: String,
}

#[tauri::command]
pub fn list_resource_annotations(
    app: AppHandle,
    resource_id: String,
    layer_ids: Option<Vec<String>>,
) -> Result<Vec<ResourceAnnotationSummary>, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    match layer_ids {
        Some(layers) if !layers.is_empty() => list_resource_annotations_in_layers(&root.join("aster.db"), &resource_id, &layers),
        _ => list_resource_annotations_in_database(&root.join("aster.db"), &resource_id),
    }
}

#[tauri::command]
pub fn create_resource_annotation(
    app: AppHandle,
    request: CreateResourceAnnotationRequest,
) -> Result<String, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    insert_resource_annotation(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn restore_resource_annotation(
    app: AppHandle,
    request: RestoreResourceAnnotationRequest,
) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    initialize_database(&root.join("aster.db"))?;
    let connection = Connection::open(root.join("aster.db")).map_err(|error| error.to_string())?;
    let owner = LayerOwner::resource(&request.resource_id)?;
    let layer_id = resolve_layer(&connection, &owner, &request.layer_id)?;
    connection.execute(
        "INSERT OR REPLACE INTO resource_annotations (id, resource_id, page, type, quote, comment, color, position_json, created_at, updated_at, layer_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![request.annotation_id, request.resource_id, request.page, request.annotation_type, request.quote, request.comment, request.color, request.position_json, request.created_at, current_timestamp_ms(), layer_id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_resource_annotation_comment(
    app: AppHandle,
    request: ResourceAnnotationCommentRequest,
) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_field(
        &root.join("aster.db"),
        "comment",
        &request.annotation_id,
        &request.comment,
    )
}

#[tauri::command]
pub fn update_resource_annotation_color(
    app: AppHandle,
    request: ResourceAnnotationColorRequest,
) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_field(
        &root.join("aster.db"),
        "color",
        &request.annotation_id,
        &request.color,
    )
}

#[tauri::command]
pub fn update_resource_annotation_position(
    app: AppHandle,
    request: ResourceAnnotationPositionRequest,
) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_field(
        &root.join("aster.db"),
        "position_json",
        &request.annotation_id,
        &request.position_json,
    )
}

#[tauri::command]
pub fn delete_resource_annotation(
    app: AppHandle,
    request: ResourceAnnotationIdRequest,
) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    initialize_database(&root.join("aster.db"))?;
    let connection = Connection::open(root.join("aster.db")).map_err(|error| error.to_string())?;
    assert_annotation_writable(&connection, "resource_annotations", &request.annotation_id)?;
    connection
        .execute(
            "DELETE FROM resource_annotations WHERE id = ?1",
            params![request.annotation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_resource_annotation(
    database_path: &Path,
    request: &CreateResourceAnnotationRequest,
) -> Result<String, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let owner = LayerOwner::resource(&request.resource_id)?;
    let layer_id = resolve_layer(&connection, &owner, &request.layer_id)?;
    let id = format!("resource-anno-{}", Uuid::new_v4());
    let now = current_timestamp_ms();
    connection.execute(
        "INSERT INTO resource_annotations (id, resource_id, page, type, quote, comment, color, position_json, created_at, updated_at, layer_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![id, request.resource_id, request.page, request.annotation_type, request.quote, request.comment, request.color, request.position_json, now, now, layer_id],
    ).map_err(|error| error.to_string())?;
    Ok(id)
}

fn resolve_layer(connection: &Connection, owner: &LayerOwner, requested: &str) -> Result<String, String> {
    let layer_id = if requested.trim().is_empty() { active_layer_id(connection, owner)? } else { requested.trim().to_string() };
    assert_layer_writable_for(connection, owner, &layer_id)?;
    Ok(layer_id)
}

fn update_field(
    database_path: &Path,
    field: &str,
    annotation_id: &str,
    value: &str,
) -> Result<(), String> {
    let column = match field {
        "comment" | "color" | "position_json" => field,
        _ => return Err("Unsupported resource annotation field".to_string()),
    };
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    assert_annotation_writable(&connection, "resource_annotations", annotation_id)?;
    let sql =
        format!("UPDATE resource_annotations SET {column} = ?1, updated_at = ?2 WHERE id = ?3");
    let changed = connection
        .execute(&sql, params![value, current_timestamp_ms(), annotation_id])
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Resource annotation not found".to_string());
    }
    Ok(())
}

pub(crate) fn list_resource_annotations_in_database(
    database_path: &Path,
    resource_id: &str,
) -> Result<Vec<ResourceAnnotationSummary>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let owner = LayerOwner::resource(resource_id)?;
    let layers = visible_layer_ids(&connection, &owner)?;
    query_resource_annotations(&connection, resource_id, &layers)
}

pub(crate) fn list_resource_annotations_in_layers(
    database_path: &Path,
    resource_id: &str,
    layer_ids: &[String],
) -> Result<Vec<ResourceAnnotationSummary>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    query_resource_annotations(&connection, resource_id, layer_ids)
}

fn query_resource_annotations(
    connection: &Connection,
    resource_id: &str,
    layer_ids: &[String],
) -> Result<Vec<ResourceAnnotationSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, resource_id, page, type, quote, comment, color, position_json, created_at, layer_id
         FROM resource_annotations WHERE resource_id = ?1 AND layer_id = ?2 ORDER BY created_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let mut annotations = Vec::new();
    for layer_id in layer_ids {
        let rows = statement
            .query_map(params![resource_id, layer_id], |row| {
                Ok(ResourceAnnotationSummary {
                    id: row.get(0)?,
                    resource_id: row.get(1)?,
                    page: row.get(2)?,
                    annotation_type: row.get(3)?,
                    quote: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    comment: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    color: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    position_json: row.get(7)?,
                    created_at: row.get(8)?,
                    layer_id: row.get(9)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            annotations.push(row.map_err(|error| error.to_string())?);
        }
    }
    annotations.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id)));
    Ok(annotations)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "a4note-resource-annotations-{name}-{}.db",
            Uuid::new_v4()
        ))
    }

    #[test]
    fn resource_annotations_round_trip_without_paper_rows() {
        let path = test_path("roundtrip");
        let request = CreateResourceAnnotationRequest {
            resource_id: "resource-1".to_string(),
            page: 2,
            annotation_type: "highlight".to_string(),
            quote: "hello".to_string(),
            comment: "note".to_string(),
            color: "yellow".to_string(),
            position_json: "{}".to_string(),
            layer_id: String::new(),
        };
        let id = insert_resource_annotation(&path, &request).expect("insert");
        let rows = list_resource_annotations_in_database(&path, "resource-1").expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].resource_id, "resource-1");
        assert_eq!(rows[0].layer_id, "layer-default-resource-1", "resources get a default layer on first write");
        update_field(&path, "comment", &id, "updated").expect("update");
        delete_row(&path, &id).expect("delete");
        assert!(list_resource_annotations_in_database(&path, "resource-1")
            .expect("list after delete")
            .is_empty());
        let _ = std::fs::remove_file(path);
    }

    fn delete_row(database_path: &Path, annotation_id: &str) -> Result<(), String> {
        initialize_database(database_path)?;
        let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM resource_annotations WHERE id = ?1",
                params![annotation_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}
