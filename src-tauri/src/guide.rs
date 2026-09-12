//! The built-in guide seeded on first launch (P2-1).
//!
//! It enters the library as a real paper, not a special-cased placeholder, so the
//! first thing the user opens exercises the same import, notes and annotation
//! paths their own PDFs will. Seeding is idempotent: an existing guide row is
//! left alone, including any edits the user made to it.

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;

use crate::app_paths::path_to_string;
use crate::database::{current_timestamp_ms, initialize_database, stable_tag_id};

pub(crate) const GUIDE_PAPER_ID: &str = "paper-aster-guide";

pub(crate) const GUIDE_FILE_ID: &str = "file-aster-guide-source";

pub(crate) const GUIDE_NOTE_ID: &str = "note-aster-guide";

pub(crate) const GUIDE_TITLE: &str = "A4 Note 使用指南";

pub(crate) const GUIDE_AUTHORS: &str = "A4 Note";

pub(crate) const GUIDE_YEAR: i64 = 2026;

pub(crate) const GUIDE_VENUE: &str = "内置指南";

pub(crate) const GUIDE_PDF: &[u8] = include_bytes!("../assets/aster-guide.pdf");

pub(crate) const GUIDE_MARKDOWN: &str = include_str!("../assets/aster-guide.md");

pub(crate) fn seed_default_guide(root: &Path, database_path: &Path) -> Result<(), String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    if guide_exists(&connection)? {
        return repair_missing_builtin_pdf(&connection, root);
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    // Multiple windows/processes can initialize at once; never replace an
    // existing guide's metadata, tags, note, state or timestamps.
    if guide_exists(&transaction)? {
        return repair_missing_builtin_pdf(&transaction, root);
    }
    let pdf_path = root.join("files").join("papers").join(GUIDE_PAPER_ID).join("source.pdf");
    create_missing_pdf(&pdf_path)?;
    let now = current_timestamp_ms();
    transaction.execute(
        "INSERT INTO papers (id,title,authors,year,venue,doi,status,folder_id,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,'','unread','library',?6,?6)",
        params![GUIDE_PAPER_ID, GUIDE_TITLE, GUIDE_AUTHORS, GUIDE_YEAR, GUIDE_VENUE, now],
    ).map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO paper_files (id,paper_id,type,path,language,created_at) VALUES (?1,?2,'source_pdf',?3,'',?4)",
        params![GUIDE_FILE_ID, GUIDE_PAPER_ID, path_to_string(&pdf_path), now],
    ).map_err(|error| error.to_string())?;
    for tag in ["指南", "入门", "A4 Note"] {
        transaction.execute("INSERT OR IGNORE INTO tags (id,name,created_at) VALUES (?1,?2,?3)",
            params![stable_tag_id(tag), tag, now]).map_err(|error| error.to_string())?;
        // An existing same-name tag may have been imported with another id.
        transaction.execute("INSERT INTO paper_tags (paper_id,tag_id) SELECT ?1,id FROM tags WHERE name = ?2",
            params![GUIDE_PAPER_ID, tag]).map_err(|error| error.to_string())?;
    }
    transaction.execute(
        "INSERT OR IGNORE INTO notes (id,paper_id,title,content,format,created_at,updated_at)
         VALUES (?1,?2,'A4 Note 使用指南笔记',?3,'markdown',?4,?4)",
        params![GUIDE_NOTE_ID, GUIDE_PAPER_ID, GUIDE_MARKDOWN, now],
    ).map_err(|error| error.to_string())?;
    // Seed all related rows together, without touching the sync outbox.
    transaction.commit().map_err(|error| error.to_string())
}

fn guide_exists(connection: &Connection) -> Result<bool, String> {
    connection.query_row("SELECT EXISTS(SELECT 1 FROM papers WHERE id = ?1)",
        [GUIDE_PAPER_ID], |row| row.get(0)).map_err(|error| error.to_string())
}

fn repair_missing_builtin_pdf(connection: &Connection, root: &Path) -> Result<(), String> {
    let path = root.join("files").join("papers").join(GUIDE_PAPER_ID).join("source.pdf");
    let bound_path: Option<String> = connection.query_row(
        "SELECT path FROM paper_files WHERE id = ?1 AND paper_id = ?2 AND type = 'source_pdf'",
        params![GUIDE_FILE_ID, GUIDE_PAPER_ID], |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?;
    // Only repair the known missing bundled asset; never rewrite an existing
    // PDF, or resurrect a deleted/changed user file binding or guide note.
    if bound_path.as_deref() == Some(path_to_string(&path).as_str()) && !path.exists() {
        create_missing_pdf(&path)?;
    }
    Ok(())
}

fn create_missing_pdf(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let mut file = match fs::OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::AlreadyExists && path.is_file() => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if let Err(error) = file.write_all(GUIDE_PDF).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path); // Only the new file this call created.
        return Err(error.to_string());
    }
    Ok(())
}
