//! Annotations attached to generic PDF Resources (PDF-1).
//!
//! Literature annotations remain in `annotations` and keep their paper/file
//! foreign keys. Resource annotations use a separate table so old databases and
//! paper workflows remain unchanged.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

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
) -> Result<Vec<ResourceAnnotationSummary>, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    list_resource_annotations_in_database(&root.join("aster.db"), &resource_id)
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
    connection.execute(
        "INSERT OR REPLACE INTO resource_annotations (id, resource_id, page, type, quote, comment, color, position_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![request.annotation_id, request.resource_id, request.page, request.annotation_type, request.quote, request.comment, request.color, request.position_json, request.created_at, current_timestamp_ms()],
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
    let id = format!("resource-anno-{}", Uuid::new_v4());
    let now = current_timestamp_ms();
    connection.execute(
        "INSERT INTO resource_annotations (id, resource_id, page, type, quote, comment, color, position_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, request.resource_id, request.page, request.annotation_type, request.quote, request.comment, request.color, request.position_json, now, now],
    ).map_err(|error| error.to_string())?;
    Ok(id)
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
    let mut statement = connection
        .prepare(
            "SELECT id, resource_id, page, type, quote, comment, color, position_json, created_at
         FROM resource_annotations WHERE resource_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![resource_id], |row| {
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
            })
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
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
        };
        let id = insert_resource_annotation(&path, &request).expect("insert");
        let rows = list_resource_annotations_in_database(&path, "resource-1").expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].resource_id, "resource-1");
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
