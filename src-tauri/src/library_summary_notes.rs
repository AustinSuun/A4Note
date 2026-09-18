//! Local designation of one summary note; shared by explicit and automatic creation.
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use tauri::AppHandle;
use crate::{app_paths::app_data_root, library_notes::{UpsertNoteRequest, upsert_note_in_transaction}, library_summaries::SummaryFile};

pub(crate) fn bound(connection: &Connection, paper_id: &str) -> Result<Option<SummaryFile>, String> {
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='paper_summary_notes')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !exists { return Ok(None); }
    let id: Option<String> = connection.query_row("SELECT note_id FROM paper_summary_notes WHERE paper_id=?1", [paper_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let Some(id) = id else { return Ok(None); };
    let (title, content): (String, String) = connection.query_row(
        "SELECT COALESCE(n.title, '总结笔记'), n.content FROM notes n JOIN papers p ON p.id=n.paper_id WHERE n.id=?1 AND n.paper_id=?2 AND n.deleted_at IS NULL",
        params![id, paper_id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| "指定总结笔记已删除或关系失效；为保护旧内容，不会自动回退或重建。".to_string())?;
    Ok(Some(SummaryFile { path: format!("summary-note://{paper_id}/{id}"), content, exists: true, note_id: Some(id), title: Some(title) }))
}

pub(crate) fn read_bound(root: &Path, paper_id: &str) -> Result<Option<SummaryFile>, String> {
    let c = Connection::open_with_flags(root.join("aster.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    bound(&c, paper_id)
}

#[tauri::command]
pub fn create_paper_summary_note(app: AppHandle, paper_id: String, content: String) -> Result<SummaryFile, String> {
    let _access = crate::library_access::operation()?;
    validate_content(&content)?;
    let root = app_data_root(&app)?;
    let _lock = crate::library_summaries::mutation()?;
    let mut c = Connection::open(root.join("aster.db")).map_err(|e| e.to_string())?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    if let Some(existing) = bound(&tx, &paper_id)? { return Ok(existing); }
    let result = insert_summary_note(&tx, &paper_id, &content)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

pub(crate) fn validate_content(content: &str) -> Result<(), String> {
    if content.len() > 2 * 1024 * 1024 || content.contains('\0') { return Err("总结内容超过限制".into()); }
    Ok(())
}

/// Caller owns the Immediate transaction; note, binding and outbox commit together.
pub(crate) fn insert_summary_note(tx: &rusqlite::Transaction<'_>, paper_id: &str, content: &str) -> Result<SummaryFile, String> {
    validate_content(content)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS paper_summary_notes (paper_id TEXT PRIMARY KEY NOT NULL REFERENCES papers(id) ON DELETE CASCADE, note_id TEXT UNIQUE NOT NULL REFERENCES notes(id) ON DELETE CASCADE);").map_err(|e| e.to_string())?;
    let id = upsert_note_in_transaction(tx, UpsertNoteRequest { paper_id: paper_id.into(), note_id: None, expected: None, title: "总结笔记".into(), content: content.into() }, true)?;
    tx.execute("INSERT INTO paper_summary_notes(paper_id,note_id) VALUES (?1,?2)", params![paper_id,id]).map_err(|e| e.to_string())?;
    bound(tx, paper_id)?.ok_or("总结绑定创建失败".into())
}
