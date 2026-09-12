//! The library schema and the SQLite primitives the domain modules share (P2-1).
//!
//! `schema.sql` is the single source of truth for the tables; nothing here
//! duplicates a `CREATE TABLE`. Every entry checks the actual database ledger,
//! but only a new schema/migration version performs DDL or historical repairs.
//! No path-only process cache: replacing/restoring a database must work immediately.

use rusqlite::{params, Connection, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::fs;
use std::path::Path;

pub(crate) const FALLBACK_TAG: &str = "未分类";

pub(crate) fn schema_sql() -> &'static str {
    include_str!("../schema.sql")
}

// Bump this when Rust-only migrations change; schema.sql changes invalidate
// the key automatically. This caches only a build constant, never DB readiness.
const MIGRATION_REVISION: &str = "startup-1";
fn schema_key() -> &'static str {
    static KEY: OnceLock<String> = OnceLock::new();
    KEY.get_or_init(|| {
        let mut hash = Sha256::new();
        hash.update(MIGRATION_REVISION.as_bytes());
        hash.update(schema_sql().as_bytes());
        format!("{:x}", hash.finalize())
    })
}

fn schema_is_current(connection: &Connection) -> Result<bool, String> {
    let has_ledger: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'aster_schema_migrations')",
        [], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if !has_ledger { return Ok(false); }
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM aster_schema_migrations WHERE schema_key = ?1)",
        [schema_key()], |row| row.get(0),
    ).map_err(|error| error.to_string())
}

pub(crate) fn initialize_database(database_path: &Path) -> Result<(), String> {
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    // Warm reads do not acquire a write transaction, scan all papers, or run DDL.
    if schema_is_current(&connection)? { return Ok(()); }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    // Another startup reader may have completed migration while we waited.
    if schema_is_current(&transaction)? { return Ok(()); }
    transaction.execute_batch(schema_sql()).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    transaction.execute(
        "INSERT OR IGNORE INTO folders (id, name, parent_id, created_at, updated_at) VALUES ('library', '默认资料库', NULL, ?1, ?1)",
        [now],
    ).map_err(|error| error.to_string())?;
    // Upgrade legacy folder ids once, without renaming existing folders.
    transaction.execute(
        "INSERT OR IGNORE INTO folders (id, name, parent_id, created_at, updated_at)
         SELECT DISTINCT p.folder_id, p.folder_id, 'library', ?1, ?1 FROM papers p
         WHERE p.folder_id IS NOT NULL AND p.folder_id <> 'library'",
        [now],
    ).map_err(|error| error.to_string())?;
    ensure_column(&transaction, "papers", "is_favorite", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&transaction, "papers", "last_viewed_at", "INTEGER")?;
    ensure_column(&transaction, "paper_files", "content_hash", "TEXT")?;
    ensure_column(&transaction, "notes", "server_version", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&transaction, "notes", "deleted_at", "INTEGER")?;
    // DDL, data repair and the completion mark commit together. A failed upgrade
    // leaves no success mark and retries cleanly on the next call.
    transaction.execute(
        "INSERT INTO aster_schema_migrations (schema_key, applied_at) VALUES (?1, ?2)",
        params![schema_key(), now],
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn paper_exists(database_path: &Path, paper_id: &str) -> Result<bool, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM papers WHERE id = ?1",
            params![paper_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

pub(crate) fn normalized_tags(tags: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut cleaned = Vec::new();
    for tag in tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
    {
        if tag == FALLBACK_TAG {
            continue;
        }
        let key = tag.to_lowercase();
        if seen.insert(key) {
            cleaned.push(tag.to_string());
        }
    }
    if cleaned.is_empty() {
        cleaned.push(FALLBACK_TAG.to_string());
    }
    cleaned.sort_by(|left, right| left.to_lowercase().cmp(&right.to_lowercase()));
    cleaned.dedup();
    cleaned
}

pub(crate) fn collect_string_rows(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<String>>,
) -> Result<Vec<String>, String> {
    let mut values = Vec::new();
    for row in rows {
        values.push(row.map_err(|error| error.to_string())?);
    }
    Ok(values)
}

pub(crate) fn stable_tag_id(tag: &str) -> String {
    let encoded = tag
        .as_bytes()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("tag-{encoded}")
}

pub(crate) fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

// Identifiers/definitions below are fixed Rust literals, never user input.
fn ensure_column(connection: &Connection, table: &str, name: &str, definition: &str) -> Result<(), String> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})")).map_err(|e| e.to_string())?;
    let names = statement.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
    for column in names {
        if column.map_err(|e| e.to_string())? == name { return Ok(()); }
    }
    connection.execute(&format!("ALTER TABLE {table} ADD COLUMN {name} {definition}"), [])
        .map_err(|error| format!("无法迁移数据库字段 {table}.{name}：{error}"))?;
    Ok(())
}
