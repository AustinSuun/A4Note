//! New folder-workspace snapshot namespace. Never reads or rewrites legacy tables.
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub(super) fn load(path: &Path) -> Result<Option<String>, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    read(&connection)
}

pub(super) fn save(path: &Path, raw: &str) -> Result<(), String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    write(&connection, raw)
}

fn read(connection: &Connection) -> Result<Option<String>, String> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='folder_workbench_snapshot_v2')",
        [], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if !exists { return Ok(None); }
    connection.query_row("SELECT snapshot FROM folder_workbench_snapshot_v2 WHERE id = 1", [], |row| row.get(0))
        .optional().map_err(|error| error.to_string())
}

fn write(connection: &Connection, raw: &str) -> Result<(), String> {
    // Validate before any write; keep the same wire shape used by the workbench.
    let _: crate::workbench_store::WorkbenchSnapshot = serde_json::from_str(raw)
        .map_err(|error| format!("工作台快照解析失败：{error}"))?;
    connection.execute_batch("CREATE TABLE IF NOT EXISTS folder_workbench_snapshot_v2 (
        id INTEGER PRIMARY KEY CHECK(id = 1), snapshot TEXT NOT NULL
    )").map_err(|error| error.to_string())?;
    connection.execute("INSERT INTO folder_workbench_snapshot_v2(id, snapshot) VALUES(1, ?1)
        ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot", params![raw])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_namespace_ignores_legacy_and_roundtrips() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE workbench_state(id INTEGER, snapshot TEXT);
            INSERT INTO workbench_state VALUES(1, 'legacy-sentinel');").unwrap();
        assert_eq!(read(&db).unwrap(), None);
        let raw = r#"{"version":1,"projects":[],"workspaces":[],"resources":[],"agentSessions":[]}"#;
        write(&db, raw).unwrap();
        assert_eq!(read(&db).unwrap().as_deref(), Some(raw));
        assert!(write(&db, "not json").is_err());
        assert_eq!(read(&db).unwrap().as_deref(), Some(raw));
        let old: String = db.query_row("SELECT snapshot FROM workbench_state", [], |row| row.get(0)).unwrap();
        assert_eq!(old, "legacy-sentinel");
    }
}
