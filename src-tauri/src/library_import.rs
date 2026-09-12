//! Importing PDFs into the library and reading them back (P2-1).
//!
//! Import copies the file into `files/papers/{paper_id}/` rather than linking it,
//! so moving or deleting the original cannot break the library. A duplicate is
//! detected by content hash and reported instead of silently re-imported.
//!
//! Source and translated PDFs are separate rows with separate `file_id`s, which
//! is what keeps their annotations apart everywhere else.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// Serialize duplicate detection and registration, not just the file copy.
pub(crate) static IMPORT_LOCK: Mutex<()> = Mutex::new(());
use tauri::AppHandle;
use uuid::Uuid;

use crate::app_paths::{
    app_data_root, open_file_with_default_app, open_path_in_file_manager, path_to_string,
};
use crate::database::{
    current_timestamp_ms, initialize_database, normalized_tags, paper_exists, stable_tag_id,
};

#[derive(Debug, Deserialize)]
pub(crate) struct ImportPdfRequest {
    pub(crate) original_path: String,
    pub(crate) paper_id: Option<String>,
    pub(crate) title: String,
    pub(crate) authors: String,
    pub(crate) year: Option<i64>,
    pub(crate) venue: String,
    pub(crate) doi: String,
    pub(crate) tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ImportPdfResult {
    pub(crate) paper_id: String,
    pub(crate) file_id: String,
    pub(crate) source_pdf: String,
    pub(crate) copied: bool,
    pub(crate) duplicate: bool,
    pub(crate) existing_paper_id: Option<String>,
    pub(crate) duplicate_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ImportTranslationRequest {
    pub(crate) paper_id: String,
    pub(crate) original_path: String,
    pub(crate) language: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ImportTranslationResult {
    pub(crate) paper_id: String,
    pub(crate) file_id: String,
    pub(crate) translated_pdf: String,
    pub(crate) copied: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LoadPaperFileRequest {
    pub(crate) paper_id: String,
    pub(crate) kind: String,
    pub(crate) file_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RevealPaperFileRequest {
    pub(crate) paper_id: String,
    pub(crate) kind: String,
    pub(crate) file_id: Option<String>,
}

#[tauri::command]
pub fn import_pdf_to_library(
    app: AppHandle,
    request: ImportPdfRequest,
) -> Result<ImportPdfResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    import_pdf_into_root(&root, request)
}

#[tauri::command]
pub fn import_translated_pdf_to_library(
    app: AppHandle,
    request: ImportTranslationRequest,
) -> Result<ImportTranslationResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    import_translation_into_root(&root, request)
}

#[tauri::command]
pub fn load_paper_file_bytes(
    app: AppHandle,
    request: LoadPaperFileRequest,
) -> Result<Vec<u8>, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    load_paper_file_bytes_from_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn reveal_paper_file(app: AppHandle, request: RevealPaperFileRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let path = paper_file_path_from_database(
        &root.join("aster.db"),
        &request.paper_id,
        &request.kind,
        request.file_id.as_deref(),
    )?;
    let target = path.parent().map(Path::to_path_buf).unwrap_or(path);
    open_path_in_file_manager(&target)
}

#[tauri::command]
pub fn open_paper_file(app: AppHandle, request: RevealPaperFileRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let path = paper_file_path_from_database(
        &root.join("aster.db"),
        &request.paper_id,
        &request.kind,
        request.file_id.as_deref(),
    )?;
    open_file_with_default_app(&path)
}

pub(crate) fn import_pdf_into_root(
    root: &Path,
    request: ImportPdfRequest,
) -> Result<ImportPdfResult, String> {
    let _import_guard = IMPORT_LOCK.lock().map_err(|_| "Import lock unavailable".to_string())?;
    let source_path = PathBuf::from(&request.original_path);
    if !source_path.exists() {
        return Err("PDF file not found; cannot import".to_string());
    }
    let source_bytes =
        fs::read(&source_path).map_err(|error| format!("Failed to read PDF file: {error}"))?;
    let content_hash = sha256_hex(&source_bytes);
    if let Some(existing_paper_id) =
        find_duplicate_paper(&root.join("aster.db"), &content_hash, request.doi.trim())?
    {
        return Ok(ImportPdfResult {
            paper_id: existing_paper_id.clone(),
            file_id: String::new(),
            source_pdf: String::new(),
            copied: false,
            duplicate: true,
            existing_paper_id: Some(existing_paper_id),
            duplicate_reason: Some(
                if request.doi.trim().is_empty() {
                    "file_hash"
                } else {
                    "doi_or_file_hash"
                }
                .to_string(),
            ),
        });
    }

    let paper_id = request
        .paper_id
        .clone()
        .unwrap_or_else(|| format!("paper-{}", Uuid::new_v4()));
    let file_id = format!("file-{}", Uuid::new_v4());
    let paper_dir = root.join("files").join("papers").join(&paper_id);
    validate_paper_storage_id(&paper_id)?;
    if paper_exists(&root.join("aster.db"), &paper_id)? {
        return Err("文献ID已存在，拒绝覆盖原文献".to_string());
    }
    fs::create_dir_all(root.join("files").join("papers")).map_err(|error| error.to_string())?;
    // Own a fresh directory exclusively; never overwrite unregistered leftovers.
    fs::create_dir(&paper_dir).map_err(|error| format!("无法创建文献目录（不会覆盖已有文件）：{error}"))?;

    let target_path = paper_dir.join("source.pdf");
    if let Err(error) = fs::write(&target_path, &source_bytes) {
        let _ = fs::remove_dir_all(&paper_dir);
        return Err(format!("无法写入文献副本：{error}"));
    }

    let source_pdf = path_to_string(&target_path);
    let registered = insert_imported_document(
        &root.join("aster.db"),
        &paper_id,
        &file_id,
        &source_pdf,
        Some(&content_hash),
        &request,
    );
    if let Err(error) = registered {
        return match fs::remove_dir_all(&paper_dir) {
            Ok(()) => Err(error),
            Err(cleanup) => Err(format!("{error}；未登记文件清理失败：{} ({cleanup})", paper_dir.display())),
        };
    }
    Ok(ImportPdfResult {
        paper_id,
        file_id,
        source_pdf,
        copied: true,
        duplicate: false,
        existing_paper_id: None,
        duplicate_reason: None,
    })
}

pub(crate) fn import_translation_into_root(
    root: &Path,
    request: ImportTranslationRequest,
) -> Result<ImportTranslationResult, String> {
    let _import_guard = IMPORT_LOCK.lock().map_err(|_| "Import lock unavailable".to_string())?;
    let source_path = PathBuf::from(&request.original_path);
    if !source_path.exists() {
        return Err("Translated PDF file not found; cannot import".to_string());
    }

    let database_path = root.join("aster.db");
    if !paper_exists(&database_path, &request.paper_id)? {
        return Err("Document does not exist; cannot bind translated PDF".to_string());
    }

    validate_paper_storage_id(&request.paper_id)?;
    let file_id = format!("file-{}", Uuid::new_v4());
    let paper_dir = root.join("files").join("papers").join(&request.paper_id);
    fs::create_dir_all(&paper_dir).map_err(|error| error.to_string())?;
    let language = normalized_file_token(request.language.as_deref().unwrap_or("manual"));
    let target_path = paper_dir.join(format!("translated.{language}.{file_id}.pdf"));
    if let Err(error) = fs::copy(&source_path, &target_path) {
        let _ = fs::remove_file(&target_path);
        return Err(format!("无法写入译文副本：{error}"));
    }
    let translated_pdf = path_to_string(&target_path);
    let registered = insert_paper_file(
        &database_path,
        &file_id,
        &request.paper_id,
        "translated_pdf",
        &translated_pdf,
        &language,
        None,
    );
    if let Err(error) = registered {
        return match fs::remove_file(&target_path) {
            Ok(()) => Err(error),
            Err(cleanup) => Err(format!("{error}；未登记译文清理失败：{} ({cleanup})", target_path.display())),
        };
    }
    Ok(ImportTranslationResult {
        paper_id: request.paper_id,
        file_id,
        translated_pdf,
        copied: true,
    })
}

pub(crate) fn normalized_file_token(value: &str) -> String {
    let token = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
        })
        .collect::<String>();
    if token.trim().is_empty() {
        "manual".to_string()
    } else {
        token
    }
}

pub(crate) fn load_paper_file_bytes_from_database(
    database_path: &Path,
    request: &LoadPaperFileRequest,
) -> Result<Vec<u8>, String> {
    let path = paper_file_path_from_database(
        database_path,
        &request.paper_id,
        &request.kind,
        request.file_id.as_deref(),
    )?;
    fs::read(&path).map_err(|error| format!("Failed to read PDF file: {error}"))
}

pub(crate) fn paper_file_path_from_database(
    database_path: &Path,
    paper_id: &str,
    kind: &str,
    file_id: Option<&str>,
) -> Result<PathBuf, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let file_type = if kind == "translated" {
        "translated_pdf"
    } else {
        "source_pdf"
    };
    let path: String = if let Some(file_id) = file_id {
        connection
            .query_row(
                "SELECT path FROM paper_files WHERE paper_id = ?1 AND type = ?2 AND id = ?3 LIMIT 1",
                params![paper_id, file_type, file_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                if kind == "translated" {
                    "Selected translated PDF is not bound to current paper".to_string()
                } else {
                    "Selected source PDF is not bound to current paper".to_string()
                }
            })?
    } else {
        let query = if kind == "translated" {
            "SELECT path FROM paper_files WHERE paper_id = ?1 AND type = ?2 ORDER BY created_at DESC LIMIT 1"
        } else {
            "SELECT path FROM paper_files WHERE paper_id = ?1 AND type = ?2 LIMIT 1"
        };
        connection
            .query_row(query, params![paper_id, file_type], |row| row.get(0))
            .map_err(|_| {
                if kind == "translated" {
                    "Current paper has no bound translated PDF yet".to_string()
                } else {
                    "Current paper has no bound source PDF yet".to_string()
                }
            })?
    };
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("PDF file not found; check the library file path".to_string());
    }
    Ok(path)
}

pub(crate) fn insert_paper_file(
    database_path: &Path,
    file_id: &str,
    paper_id: &str,
    file_type: &str,
    path: &str,
    language: &str,
    content_hash: Option<&str>,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO paper_files (id, paper_id, type, path, language, content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![file_id, paper_id, file_type, path, language, content_hash, current_timestamp_ms()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn find_duplicate_paper(
    database_path: &Path,
    content_hash: &str,
    doi: &str,
) -> Result<Option<String>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    if !content_hash.trim().is_empty() {
        let found = connection.query_row(
            "SELECT paper_id FROM paper_files WHERE content_hash = ?1 AND type = \"source_pdf\" LIMIT 1",
            params![content_hash],
            |row| row.get::<_, String>(0),
        ).optional().map_err(|error| error.to_string())?;
        if let Some(paper_id) = found {
            return Ok(Some(paper_id));
        }
    }
    if !doi.trim().is_empty() {
        let found = connection.query_row(
            "SELECT id FROM papers WHERE lower(doi) = lower(?1) LIMIT 1",
            params![doi.trim()],
            |row| row.get::<_, String>(0),
        ).optional().map_err(|error| error.to_string())?;
        if let Some(paper_id) = found {
            return Ok(Some(paper_id));
        }
    }
    Ok(None)
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

pub(crate) fn insert_imported_document(
    database_path: &Path,
    paper_id: &str,
    file_id: &str,
    source_pdf: &str,
    content_hash: Option<&str>,
    request: &ImportPdfRequest,
) -> Result<(), String> {
    initialize_database(database_path)?;
    let now = current_timestamp_ms();
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let title = if request.title.trim().is_empty() {
        "Untitled document"
    } else {
        request.title.trim()
    };

    transaction
        .execute(
            "INSERT INTO papers (id, title, authors, year, venue, doi, status, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![paper_id, title, request.authors.trim(), request.year, request.venue.trim(), request.doi.trim(), "unread", "library", now, now],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO paper_files (id, paper_id, type, path, language, content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![file_id, paper_id, "source_pdf", source_pdf, "", content_hash, now],
        )
        .map_err(|error| error.to_string())?;

    for tag in normalized_tags(&request.tags) {
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

    crate::capture::ingest::record_local(&transaction, paper_id, file_id, request)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

/// IDs become directory names; apply Windows-safe validation on every platform.
pub(crate) fn validate_paper_storage_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id == "." || id == ".." || id.ends_with(['.', ' '])
        || id.chars().any(|ch| ch.is_control() || "/\\:<>\"|?*".contains(ch)) {
        return Err("Invalid paper ID: unsafe storage directory".to_string());
    }
    Ok(())
}
