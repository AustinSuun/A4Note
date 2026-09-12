//! Papers: the list the library page renders, and the mutations on one row (P2-1).
//!
//! `list_papers_in_database` is the one read that assembles a whole paper —
//! files, tags, notes, annotations and thread ids — because the library page and
//! the reader both want the same object and neither should stitch it itself.
//!
//! Deleting a paper removes its rows and its copied files under `files/papers`.
//! It never touches the user's original PDF, which lives wherever they chose.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::app_paths::app_data_root;
use crate::database::{
    collect_string_rows, current_timestamp_ms, initialize_database, normalized_tags, stable_tag_id,
};
use crate::library_ai::list_ai_threads_for_paper;
use crate::library_annotations::{list_annotations_for_paper, AnnotationSummary};
use crate::library_notes::{list_notes_for_paper, NoteSummary};

#[derive(Debug, Serialize)]
pub(crate) struct PaperSummary {
    pub(crate) paper_id: String,
    pub(crate) title: String,
    pub(crate) authors: String,
    pub(crate) year: Option<i64>,
    pub(crate) venue: String,
    pub(crate) doi: String,
    pub(crate) folder_id: Option<String>,
    pub(crate) source_file_id: Option<String>,
    pub(crate) source_pdf: Option<String>,
    pub(crate) translated_file_ids: Vec<String>,
    pub(crate) translated_pdfs: Vec<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) notes: Vec<NoteSummary>,
    pub(crate) annotations: Vec<AnnotationSummary>,
    pub(crate) ai_threads: Vec<String>,
    pub(crate) created_at: i64,
    pub(crate) last_viewed_at: Option<i64>,
    pub(crate) is_read: bool,
    pub(crate) is_favorite: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdatePaperMetadataRequest {
    pub(crate) paper_id: String,
    pub(crate) title: String,
    pub(crate) authors: String,
    pub(crate) year: Option<i64>,
    pub(crate) venue: String,
    pub(crate) doi: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdatePaperTagsRequest {
    pub(crate) paper_id: String,
    pub(crate) tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PaperMutationResult {
    pub(crate) paper_id: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct FolderSummary {
    pub(crate) folder_id: String,
    pub(crate) name: String,
    pub(crate) parent_id: Option<String>,
    pub(crate) paper_count: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateFolderRequest {
    pub(crate) name: String,
    pub(crate) parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RenameFolderRequest {
    pub(crate) folder_id: String,
    pub(crate) name: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MovePapersToFolderRequest {
    pub(crate) paper_ids: Vec<String>,
    pub(crate) folder_id: Option<String>,
}

/// Startup loads every paper's local relations, which can be substantial on a
/// mature library. It must not share Tauri's UI thread.
#[tauri::command(async)]
pub fn list_papers(app: AppHandle) -> Result<Vec<PaperSummary>, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    list_papers_in_database(&root.join("aster.db"))
}

#[tauri::command(async)]
pub fn list_folders(app: AppHandle) -> Result<Vec<FolderSummary>, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    list_folders_in_database(&root.join("aster.db"))
}

#[tauri::command]
pub fn create_folder(app: AppHandle, request: CreateFolderRequest) -> Result<FolderSummary, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    create_folder_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn rename_folder(app: AppHandle, request: RenameFolderRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    rename_folder_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn delete_folder(app: AppHandle, folder_id: String) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    delete_folder_in_database(&root.join("aster.db"), &folder_id)
}

#[tauri::command]
pub fn move_papers_to_folder(app: AppHandle, request: MovePapersToFolderRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    move_papers_to_folder_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn update_paper_metadata(
    app: AppHandle,
    request: UpdatePaperMetadataRequest,
) -> Result<PaperMutationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_paper_metadata_in_database(&root.join("aster.db"), &request)?;
    Ok(PaperMutationResult {
        paper_id: request.paper_id,
    })
}

#[tauri::command]
pub fn update_paper_tags(
    app: AppHandle,
    request: UpdatePaperTagsRequest,
) -> Result<PaperMutationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_paper_tags_in_database(&root.join("aster.db"), &request.paper_id, &request.tags)?;
    Ok(PaperMutationResult {
        paper_id: request.paper_id,
    })
}

#[tauri::command]
pub fn delete_paper(app: AppHandle, paper_id: String) -> Result<PaperMutationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    delete_paper_in_root(&root, &paper_id)?;
    Ok(PaperMutationResult { paper_id })
}

pub(crate) fn update_paper_metadata_in_database(
    database_path: &Path,
    request: &UpdatePaperMetadataRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let title = if request.title.trim().is_empty() {
        "Untitled document"
    } else {
        request.title.trim()
    };
    let changed = connection
        .execute(
            "UPDATE papers
             SET title = ?1, authors = ?2, year = ?3, venue = ?4, doi = ?5, updated_at = ?6
             WHERE id = ?7",
            params![
                title,
                request.authors.trim(),
                request.year,
                request.venue.trim(),
                request.doi.trim(),
                current_timestamp_ms(),
                request.paper_id
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Document does not exist; cannot save".to_string());
    }
    Ok(())
}

pub(crate) fn update_paper_tags_in_database(
    database_path: &Path,
    paper_id: &str,
    tags: &[String],
) -> Result<(), String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM papers WHERE id = ?1",
            params![paper_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists == 0 {
        return Err("Document does not exist; cannot save tags".to_string());
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM paper_tags WHERE paper_id = ?1",
            params![paper_id],
        )
        .map_err(|error| error.to_string())?;
    for tag in normalized_tags(tags) {
        let tag_id = stable_tag_id(&tag);
        transaction
            .execute(
                "INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
                params![tag_id, tag, now],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT OR IGNORE INTO paper_tags (paper_id, tag_id) VALUES (?1, ?2)",
                params![paper_id, tag_id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction
        .execute(
            "UPDATE papers SET updated_at = ?1 WHERE id = ?2",
            params![now, paper_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn delete_paper_in_root(root: &Path, paper_id: &str) -> Result<(), String> {
    let _summary_mutation = crate::library_summaries::mutation()?;
    crate::library_import::validate_paper_storage_id(paper_id)?;
    let database_path = root.join("aster.db");
    initialize_database(&database_path)?;
    let mut connection = Connection::open(&database_path).map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_messages WHERE thread_id IN (SELECT id FROM ai_threads WHERE paper_id = ?1)", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM ai_threads WHERE paper_id = ?1",
            params![paper_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM annotations WHERE paper_id = ?1",
            params![paper_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM notes WHERE paper_id = ?1", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM paper_files WHERE paper_id = ?1",
            params![paper_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM paper_tags WHERE paper_id = ?1",
            params![paper_id],
        )
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute("DELETE FROM papers WHERE id = ?1", params![paper_id])
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Document does not exist; cannot delete".to_string());
    }
    transaction.commit().map_err(|error| error.to_string())?;
    let paper_dir = root.join("files").join("papers").join(paper_id);
    if paper_dir.exists() {
        fs::remove_dir_all(&paper_dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn list_papers_in_database(database_path: &Path) -> Result<Vec<PaperSummary>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT p.id, p.title, COALESCE(p.authors, ''), p.year, COALESCE(p.venue, ''), COALESCE(p.doi, ''), p.folder_id,
                    (SELECT pf.id FROM paper_files pf WHERE pf.paper_id = p.id AND pf.type = 'source_pdf' ORDER BY pf.created_at DESC LIMIT 1),
                    (SELECT pf.path FROM paper_files pf WHERE pf.paper_id = p.id AND pf.type = 'source_pdf' ORDER BY pf.created_at DESC LIMIT 1),
                    p.created_at, p.last_viewed_at, COALESCE(p.status, 'unread') = 'read', p.is_favorite <> 0
             FROM papers p
             ORDER BY p.updated_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(PaperSummary {
                paper_id: row.get(0)?,
                title: row.get(1)?,
                authors: row.get(2)?,
                year: row.get(3)?,
                venue: row.get(4)?,
                doi: row.get(5)?,
                folder_id: row.get(6)?,
                source_file_id: row.get(7)?,
                source_pdf: row.get(8)?,
                translated_file_ids: Vec::new(),
                translated_pdfs: Vec::new(),
                tags: Vec::new(),
                notes: Vec::new(),
                annotations: Vec::new(),
                ai_threads: Vec::new(),
                created_at: row.get(9)?,
                last_viewed_at: row.get(10)?,
                is_read: row.get(11)?,
                is_favorite: row.get(12)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut papers = Vec::new();
    for row in rows {
        let mut paper = row.map_err(|error| error.to_string())?;
        paper.tags = list_tags_for_paper(&connection, &paper.paper_id)?;
        paper.translated_file_ids =
            list_translated_file_ids_for_paper(&connection, &paper.paper_id)?;
        paper.translated_pdfs = list_translated_pdfs_for_paper(&connection, &paper.paper_id)?;
        paper.notes = list_notes_for_paper(&connection, &paper.paper_id)?;
        paper.annotations = list_annotations_for_paper(&connection, &paper.paper_id)?;
        paper.ai_threads = list_ai_threads_for_paper(&connection, &paper.paper_id)?;
        papers.push(paper);
    }
    Ok(papers)
}

pub(crate) fn list_folders_in_database(database_path: &Path) -> Result<Vec<FolderSummary>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT f.id, f.name, f.parent_id,
                    (SELECT COUNT(*) FROM papers p WHERE COALESCE(p.folder_id, 'library') = f.id)
             FROM folders f
             ORDER BY CASE WHEN f.id = 'library' THEN 0 ELSE 1 END, LOWER(f.name), f.id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(FolderSummary {
                folder_id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                paper_count: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string())).collect()
}

pub(crate) fn create_folder_in_database(
    database_path: &Path,
    request: &CreateFolderRequest,
) -> Result<FolderSummary, String> {
    initialize_database(database_path)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    if let Some(parent_id) = request.parent_id.as_deref() {
        let exists: i64 = connection
            .query_row("SELECT COUNT(*) FROM folders WHERE id = ?1", [parent_id], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if exists == 0 {
            return Err("父文件夹不存在".to_string());
        }
    }
    let duplicate: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM folders WHERE COALESCE(parent_id, '') = COALESCE(?1, '') AND LOWER(name) = LOWER(?2)",
            rusqlite::params![request.parent_id, name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if duplicate > 0 {
        return Err("同级文件夹名称已存在".to_string());
    }
    let folder_id = format!("folder-{}", Uuid::new_v4());
    let now = current_timestamp_ms();
    connection
        .execute(
            "INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![folder_id, name, request.parent_id, now, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(FolderSummary { folder_id, name: name.to_string(), parent_id: request.parent_id.clone(), paper_count: 0 })
}

pub(crate) fn rename_folder_in_database(
    database_path: &Path,
    request: &RenameFolderRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    if request.folder_id == "library" {
        return Err("默认资料库不能重命名".to_string());
    }
    let name = request.name.trim();
    if name.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let parent_id: Option<String> = connection
        .query_row("SELECT parent_id FROM folders WHERE id = ?1", [&request.folder_id], |row| row.get(0))
        .map_err(|_| "文件夹不存在".to_string())?;
    let duplicate: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM folders WHERE id <> ?1 AND COALESCE(parent_id, '') = COALESCE(?2, '') AND LOWER(name) = LOWER(?3)",
            rusqlite::params![request.folder_id, parent_id, name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if duplicate > 0 {
        return Err("同级文件夹名称已存在".to_string());
    }
    let changed = connection
        .execute("UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3", rusqlite::params![name, current_timestamp_ms(), request.folder_id])
        .map_err(|error| error.to_string())?;
    if changed == 0 { return Err("文件夹不存在".to_string()); }
    Ok(())
}

pub(crate) fn delete_folder_in_database(database_path: &Path, folder_id: &str) -> Result<(), String> {
    initialize_database(database_path)?;
    if folder_id == "library" {
        return Err("默认资料库不能删除".to_string());
    }
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let exists: i64 = connection
        .query_row("SELECT COUNT(*) FROM folders WHERE id = ?1", [folder_id], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if exists == 0 { return Err("文件夹不存在".to_string()); }
    let parent_id: Option<String> = connection
        .query_row("SELECT parent_id FROM folders WHERE id = ?1", [folder_id], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let fallback_parent = parent_id.unwrap_or_else(|| "library".to_string());
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("UPDATE papers SET folder_id = ?1, updated_at = ?2 WHERE folder_id = ?3", rusqlite::params![fallback_parent, current_timestamp_ms(), folder_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("UPDATE folders SET parent_id = ?1, updated_at = ?2 WHERE parent_id = ?3", rusqlite::params![fallback_parent, current_timestamp_ms(), folder_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM folders WHERE id = ?1", [folder_id])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn move_papers_to_folder_in_database(
    database_path: &Path,
    request: &MovePapersToFolderRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    if request.paper_ids.is_empty() { return Ok(()); }
    let target = request.folder_id.as_deref().unwrap_or("library");
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let folder_exists: i64 = connection
        .query_row("SELECT COUNT(*) FROM folders WHERE id = ?1", [target], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if folder_exists == 0 { return Err("目标文件夹不存在".to_string()); }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    for paper_id in &request.paper_ids {
        let changed = transaction
            .execute("UPDATE papers SET folder_id = ?1, updated_at = ?2 WHERE id = ?3", rusqlite::params![target, current_timestamp_ms(), paper_id])
            .map_err(|error| error.to_string())?;
        if changed == 0 { return Err(format!("文献不存在: {paper_id}")); }
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn list_tags_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare_cached("SELECT t.name FROM tags t INNER JOIN paper_tags pt ON pt.tag_id = t.id WHERE pt.paper_id = ?1 ORDER BY t.name")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    collect_string_rows(rows)
}

pub(crate) fn list_translated_pdfs_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare_cached("SELECT path FROM paper_files WHERE paper_id = ?1 AND type = 'translated_pdf' ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    collect_string_rows(rows)
}

pub(crate) fn list_translated_file_ids_for_paper(
    connection: &Connection,
    paper_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare_cached("SELECT id FROM paper_files WHERE paper_id = ?1 AND type = 'translated_pdf' ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    collect_string_rows(rows)
}
