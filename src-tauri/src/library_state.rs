//! Small, independent user-state mutations. Never rewrite notes or metadata.
use std::path::Path;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use crate::{app_paths::app_data_root, database::{initialize_database, current_timestamp_ms}};

#[derive(Debug, Deserialize, Default)]
pub(crate) struct UpdatePaperStateRequest {
    pub paper_id: String,
    pub is_read: Option<bool>,
    pub is_favorite: Option<bool>,
    #[serde(default)]
    pub mark_viewed: bool,
}
#[derive(Debug, Serialize)]
pub(crate) struct PaperState {
    pub paper_id: String,
    pub is_read: bool,
    pub is_favorite: bool,
    pub last_viewed_at: Option<i64>,
}
#[tauri::command(async)]
pub fn update_paper_state(app: AppHandle, request: UpdatePaperStateRequest) -> Result<PaperState, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_paper_state_in_database(&root.join("aster.db"), &request)
}
pub(crate) fn update_paper_state_in_database(path: &Path, request: &UpdatePaperStateRequest) -> Result<PaperState, String> {
    initialize_database(path)?;
    let mut connection = Connection::open(path).map_err(|e| e.to_string())?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let now = current_timestamp_ms();
    let status = request.is_read.map(|read| if read { "read" } else { "unread" });
    let changed = transaction.execute(
        "UPDATE papers SET status = COALESCE(?1, status), is_favorite = COALESCE(?2, is_favorite),
         last_viewed_at = CASE WHEN ?3 THEN MAX(COALESCE(last_viewed_at, 0), ?4) ELSE last_viewed_at END,
         updated_at = ?4 WHERE id = ?5",
        params![status, request.is_favorite, request.mark_viewed, now, request.paper_id],
    ).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("文献不存在，无法更新阅读或收藏状态".to_string()); }
    let result = transaction.query_row(
        "SELECT id, COALESCE(status, 'unread') = 'read', is_favorite <> 0, last_viewed_at FROM papers WHERE id = ?1",
        [&request.paper_id], |row| Ok(PaperState { paper_id: row.get(0)?, is_read: row.get(1)?, is_favorite: row.get(2)?, last_viewed_at: row.get(3)? }),
    ).map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?; Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn library_state_persists_and_survives_reopen_without_touching_metadata() {
        let root = std::env::temp_dir().join(format!("a4note-state-{}", uuid::Uuid::new_v4()));
        let db = root.join("aster.db"); initialize_database(&db).unwrap();
        let connection = Connection::open(&db).unwrap();
        connection.execute("INSERT INTO papers (id,title,authors,created_at,updated_at) VALUES ('paper','Title','Author',123,123)", []).unwrap(); drop(connection);
        let result = update_paper_state_in_database(&db, &UpdatePaperStateRequest { paper_id: "paper".into(), is_read: Some(true), is_favorite: Some(true), mark_viewed: true }).unwrap();
        assert!(result.is_read && result.is_favorite && result.last_viewed_at.is_some());
        let timestamp = result.last_viewed_at;
        let result = update_paper_state_in_database(&db, &UpdatePaperStateRequest { paper_id: "paper".into(), is_read: Some(false), ..Default::default() }).unwrap();
        assert!(!result.is_read); assert!(result.is_favorite); assert_eq!(result.last_viewed_at, timestamp);
        let papers = crate::library_papers::list_papers_in_database(&db).unwrap();
        assert_eq!(papers[0].created_at, 123); assert!(!papers[0].is_read); assert!(papers[0].is_favorite); assert_eq!(papers[0].authors, "Author");
        assert!(update_paper_state_in_database(&db, &UpdatePaperStateRequest { paper_id: "missing".into(), is_read: Some(true), ..Default::default() }).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn library_state_migrates_legacy_database_idempotently() {
        let root = std::env::temp_dir().join(format!("a4note-state-migrate-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap(); let db = root.join("aster.db");
        let connection = Connection::open(&db).unwrap();
        connection.execute_batch("CREATE TABLE papers (id TEXT PRIMARY KEY,title TEXT NOT NULL,authors TEXT,year INTEGER,venue TEXT,doi TEXT,folder_id TEXT,status TEXT DEFAULT 'unread',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL); INSERT INTO papers(id,title,status,created_at,updated_at) VALUES ('old','Old','read',42,42);").unwrap(); drop(connection);
        initialize_database(&db).unwrap(); initialize_database(&db).unwrap();
        let papers = crate::library_papers::list_papers_in_database(&db).unwrap();
        assert!(papers[0].is_read); assert!(!papers[0].is_favorite); assert_eq!(papers[0].last_viewed_at, None); assert_eq!(papers[0].created_at, 42);
        std::fs::remove_dir_all(root).unwrap();
    }
}
