//! The settings page's diagnostics panel (P2-1).
//!
//! Counts and sizes only, read straight from the tables and the files directory.
//! A missing file is counted rather than repaired: the panel's job is to tell the
//! user that a row lost its PDF, not to decide what to do about it.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::app_paths::get_aster_paths;
use crate::database::initialize_database;

#[derive(Debug, Serialize)]
pub(crate) struct AppDiagnostics {
    pub(crate) product_name: String,
    pub(crate) version: String,
    pub(crate) identifier: String,
    pub(crate) platform: String,
    pub(crate) data_root: String,
    pub(crate) paper_count: i64,
    pub(crate) source_pdf_count: i64,
    pub(crate) translated_pdf_count: i64,
    pub(crate) note_count: i64,
    pub(crate) annotation_count: i64,
    pub(crate) ai_thread_count: i64,
    pub(crate) missing_file_count: i64,
    pub(crate) database_size_bytes: u64,
    pub(crate) files_size_bytes: u64,
}

pub(crate) struct LibraryFileStats {
    pub(crate) paper_count: i64,
    pub(crate) source_pdf_count: i64,
    pub(crate) translated_pdf_count: i64,
    pub(crate) note_count: i64,
    pub(crate) annotation_count: i64,
    pub(crate) ai_thread_count: i64,
    pub(crate) missing_file_count: i64,
}

#[tauri::command]
pub fn get_app_diagnostics(app: AppHandle) -> Result<AppDiagnostics, String> {
    let _access = crate::library_access::operation()?;
    let paths = get_aster_paths(app)?;
    let database_path = PathBuf::from(&paths.database);
    let file_stats = library_file_stats(&database_path)?;
    Ok(AppDiagnostics {
        product_name: "A4 Note".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        identifier: "app.aster.research".to_string(),
        platform: std::env::consts::OS.to_string(),
        data_root: paths.root.clone(),
        paper_count: file_stats.paper_count,
        source_pdf_count: file_stats.source_pdf_count,
        translated_pdf_count: file_stats.translated_pdf_count,
        note_count: file_stats.note_count,
        annotation_count: file_stats.annotation_count,
        ai_thread_count: file_stats.ai_thread_count,
        missing_file_count: file_stats.missing_file_count,
        database_size_bytes: fs::metadata(&database_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0),
        files_size_bytes: dir_size(Path::new(&paths.files_root)).unwrap_or(0),
    })
}

pub(crate) fn library_file_stats(database_path: &Path) -> Result<LibraryFileStats, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let paper_count = count_rows(&connection, "papers")?;
    let source_pdf_count = count_file_type(&connection, "source_pdf")?;
    let translated_pdf_count = count_file_type(&connection, "translated_pdf")?;
    let note_count = count_rows(&connection, "notes")?;
    let annotation_count = count_rows(&connection, "annotations")?;
    let ai_thread_count = count_rows(&connection, "ai_threads")?;
    let mut statement = connection
        .prepare("SELECT path FROM paper_files")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut missing_file_count = 0;
    for row in rows {
        let path = row.map_err(|error| error.to_string())?;
        if !PathBuf::from(path).exists() {
            missing_file_count += 1;
        }
    }
    Ok(LibraryFileStats {
        paper_count,
        source_pdf_count,
        translated_pdf_count,
        note_count,
        annotation_count,
        ai_thread_count,
        missing_file_count,
    })
}

pub(crate) fn count_rows(connection: &Connection, table: &str) -> Result<i64, String> {
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())
}

pub(crate) fn count_file_type(connection: &Connection, file_type: &str) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM paper_files WHERE type = ?1",
            params![file_type],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn dir_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut size = 0;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            size += dir_size(&entry.path())?;
        } else if metadata.is_file() {
            size += metadata.len();
        }
    }
    Ok(size)
}
