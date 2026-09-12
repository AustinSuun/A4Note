//! Authorized library classification metadata, never filesystem paths.
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;

pub fn requested(envelope: &Value) -> Result<&str, String> {
    match envelope.get("targetFolderId") {
        None => Ok("library"), // Already queued captures / legacy clients.
        Some(value) => value.as_str().filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
            .ok_or_else(|| "invalid_target_folder".into()),
    }
}

pub fn ensure_exists(connection: &Connection, id: &str) -> Result<(), String> {
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM folders WHERE id=?1)", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
    if exists { Ok(()) } else { Err("folder_not_found".into()) }
}

pub fn validate_selection(root: &Path, envelope: &Value) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let id = requested(envelope)?;
    let db = root.join("aster.db");
    crate::database::initialize_database(&db)?;
    let connection = Connection::open(db).map_err(|e| e.to_string())?;
    ensure_exists(&connection, id)
}

pub fn list(root: &Path) -> Result<Value, String> {
    let _access = crate::library_access::operation()?;
    let db = root.join("aster.db");
    crate::database::initialize_database(&db)?;
    let connection = Connection::open(db).map_err(|e| e.to_string())?;
    // Avoid reading paper contents or computing whole-library counts.
    let mut statement = connection.prepare("SELECT id,name,parent_id FROM folders ORDER BY created_at,id LIMIT 2001").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"parentId":r.get::<_,Option<String>>(2)?}))).map_err(|e| e.to_string())?;
    let folders = rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    if folders.len() > 2000 { return Err("分类超过2000个，请在桌面整理后重试".into()); }
    Ok(json!({"folders":folders}))
}

pub fn paper_folder(connection: &Connection, paper: &str) -> Result<Value, String> {
    let folder: Option<(String,String)> = connection.query_row(
        "SELECT COALESCE(p.folder_id,'library'),COALESCE(f.name,'未分类') FROM papers p LEFT JOIN folders f ON f.id=COALESCE(p.folder_id,'library') WHERE p.id=?1",
        [paper], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
    let (id,name) = folder.ok_or("目标文献不存在")?;
    Ok(json!({"id":id,"name":name}))
}
