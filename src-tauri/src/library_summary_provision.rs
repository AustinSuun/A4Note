//! Add missing summary notes without replacing an existing summary source.
use std::path::Path;
use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use tauri::AppHandle;
use crate::{library_summaries::SummaryFile, library_summary_notes};

const BATCH_SIZE: usize = 50;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatedSummary { pub paper_id: String, pub file: SummaryFile }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SummaryFailure { pub paper_id: String, pub message: String }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProvisionResult {
    pub scanned: usize,
    pub preserved: usize,
    pub created: Vec<CreatedSummary>,
    pub failures: Vec<SummaryFailure>,
    pub next_after: Option<String>,
}

/// The UI calls bounded batches before refreshing the library, including after imports.
/// Failure does not undo an already imported PDF or prevent other papers being processed.
#[tauri::command(async)]
pub fn provision_summary_notes(app: AppHandle, content: String, after_id: Option<String>) -> Result<ProvisionResult, String> {
    let _access = crate::library_access::operation()?;
    provision_in_root(&crate::app_paths::app_data_root(&app)?, &content, after_id.as_deref())
}

pub(crate) fn provision_in_root(root: &Path, content: &str, after_id: Option<&str>) -> Result<ProvisionResult, String> {
    library_summary_notes::validate_content(content)?;
    let c = Connection::open_with_flags(root.join("aster.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|e| e.to_string())?;
    // Keyset pagination keeps failure/retry and concurrent inserts independent of offsets.
    let ids = c.prepare("SELECT id FROM papers WHERE (?1 IS NULL OR id > ?1) ORDER BY id LIMIT ?2")
        .map_err(|e| e.to_string())?
        .query_map(rusqlite::params![after_id, BATCH_SIZE as i64], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let mut result = ProvisionResult {
        scanned: ids.len(), preserved: 0, created: vec![], failures: vec![],
        next_after: if ids.len() == BATCH_SIZE { ids.last().cloned() } else { None },
    };
    for id in ids {
        match ensure_missing(root, &id, content) {
            Ok(Some(file)) => result.created.push(CreatedSummary { paper_id: id, file }),
            Ok(None) => result.preserved += 1,
            Err(message) => result.failures.push(SummaryFailure { paper_id: id, message }),
        }
    }
    Ok(result)
}

fn ensure_missing(root: &Path, paper_id: &str, content: &str) -> Result<Option<SummaryFile>, String> {
    let _lock = crate::library_summaries::mutation()?;
    let mut c = Connection::open_with_flags(root.join("aster.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|e| e.to_string())?;
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    // Recheck inside the same lock/transaction used by explicit creation. A deleted or
    // invalid binding errors here instead of being silently replaced by an empty note.
    if library_summary_notes::bound(&tx, paper_id)?.is_some() { return Ok(None); }
    // Old 总结.md is already an implicit paper-ID binding and stays the active source.
    if crate::library_summaries::legacy_summary_exists(root, paper_id)? { return Ok(None); }
    let file = library_summary_notes::insert_summary_note(&tx, paper_id, content)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Some(file))
}

#[cfg(test)]
#[path = "library_summary_provision_tests.rs"]
mod tests;
