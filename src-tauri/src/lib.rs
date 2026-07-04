use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const FALLBACK_TAG: &str = "未分类";
const GUIDE_PAPER_ID: &str = "paper-aster-guide";
const GUIDE_FILE_ID: &str = "file-aster-guide-source";
const GUIDE_NOTE_ID: &str = "note-aster-guide";
const GUIDE_TITLE: &str = "Aster 使用指南";
const GUIDE_AUTHORS: &str = "Aster";
const GUIDE_YEAR: i64 = 2026;
const GUIDE_VENUE: &str = "内置指南";
const GUIDE_PDF: &[u8] = include_bytes!("../assets/aster-guide.pdf");
const GUIDE_MARKDOWN: &str = include_str!("../assets/aster-guide.md");

#[derive(Debug, Serialize)]
struct AsterPaths {
    root: String,
    database: String,
    files_root: String,
}

#[derive(Debug, Serialize)]
struct BackupResult {
    backup_path: String,
}

#[derive(Debug, Serialize)]
struct RestoreBackupResult {
    restored_from: String,
    safety_backup_path: String,
}

#[derive(Debug, Serialize)]
struct AppDiagnostics {
    product_name: String,
    version: String,
    identifier: String,
    platform: String,
    data_root: String,
    paper_count: i64,
    source_pdf_count: i64,
    translated_pdf_count: i64,
    note_count: i64,
    annotation_count: i64,
    ai_thread_count: i64,
    missing_file_count: i64,
    database_size_bytes: u64,
    files_size_bytes: u64,
}

struct LibraryFileStats {
    paper_count: i64,
    source_pdf_count: i64,
    translated_pdf_count: i64,
    note_count: i64,
    annotation_count: i64,
    ai_thread_count: i64,
    missing_file_count: i64,
}

#[derive(Debug, Deserialize)]
struct RevealPathRequest {
    kind: String,
}

#[derive(Debug, Deserialize)]
struct ImportPdfRequest {
    original_path: String,
    paper_id: Option<String>,
    title: String,
    authors: String,
    year: Option<i64>,
    venue: String,
    doi: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ImportPdfResult {
    paper_id: String,
    file_id: String,
    source_pdf: String,
    copied: bool,
    duplicate: bool,
    existing_paper_id: Option<String>,
    duplicate_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImportTranslationRequest {
    paper_id: String,
    original_path: String,
    language: Option<String>,
}

#[derive(Debug, Serialize)]
struct ImportTranslationResult {
    paper_id: String,
    file_id: String,
    translated_pdf: String,
    copied: bool,
}

#[derive(Debug, Deserialize)]
struct LoadPaperFileRequest {
    paper_id: String,
    kind: String,
    file_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RevealPaperFileRequest {
    paper_id: String,
    kind: String,
    file_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct MetadataDraft {
    title: String,
    authors: String,
    year: Option<i64>,
    venue: String,
    doi: String,
    tags: Vec<String>,
    source: String,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
struct PaperSummary {
    paper_id: String,
    title: String,
    authors: String,
    year: Option<i64>,
    venue: String,
    doi: String,
    source_file_id: Option<String>,
    source_pdf: Option<String>,
    translated_file_ids: Vec<String>,
    translated_pdfs: Vec<String>,
    tags: Vec<String>,
    notes: Vec<NoteSummary>,
    annotations: Vec<AnnotationSummary>,
    ai_threads: Vec<String>,
}

#[derive(Debug, Serialize)]
struct NoteSummary {
    id: String,
    title: String,
    content: String,
    updated_at: i64,
}

#[derive(Debug, Serialize)]
struct AnnotationSummary {
    id: String,
    file_id: String,
    page: i64,
    annotation_type: String,
    quote: String,
    comment: String,
    color: String,
    position_json: String,
    created_at: i64,
}

#[derive(Debug, Deserialize)]
struct CreateAnnotationRequest {
    paper_id: String,
    file_id: String,
    page: i64,
    annotation_type: String,
    quote: String,
    comment: String,
    color: String,
    position_json: String,
}

#[derive(Debug, Deserialize)]
struct RestoreAnnotationRequest {
    annotation_id: String,
    paper_id: String,
    file_id: String,
    page: i64,
    annotation_type: String,
    quote: String,
    comment: String,
    color: String,
    position_json: String,
    created_at: i64,
}

#[derive(Debug, Serialize)]
struct CreateAnnotationResult {
    id: String,
}

#[derive(Debug, Deserialize)]
struct UpdateAnnotationCommentRequest {
    annotation_id: String,
    comment: String,
}

#[derive(Debug, Deserialize)]
struct UpdateAnnotationColorRequest {
    annotation_id: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct UpdateAnnotationPositionRequest {
    annotation_id: String,
    position_json: String,
}

#[derive(Debug, Deserialize)]
struct DeleteAnnotationRequest {
    annotation_id: String,
}

#[derive(Debug, Deserialize)]
struct UpsertNoteRequest {
    paper_id: String,
    note_id: Option<String>,
    title: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct UpsertNoteResult {
    id: String,
}

#[derive(Debug, Deserialize)]
struct UpdatePaperMetadataRequest {
    paper_id: String,
    title: String,
    authors: String,
    year: Option<i64>,
    venue: String,
    doi: String,
}

#[derive(Debug, Deserialize)]
struct UpdatePaperTagsRequest {
    paper_id: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
struct PaperMutationResult {
    paper_id: String,
}

#[derive(Debug, Serialize)]
struct AiThreadSummary {
    id: String,
    paper_id: String,
    title: String,
    provider: String,
    model: String,
    created_at: i64,
    updated_at: i64,
    messages: Vec<AiMessageSummary>,
}

#[derive(Debug, Serialize)]
struct AiMessageSummary {
    id: String,
    role: String,
    content: String,
    created_at: i64,
}

#[derive(Debug, Deserialize)]
struct AppendAiMessageRequest {
    paper_id: String,
    thread_id: Option<String>,
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct AppendAiMessageResult {
    thread_id: String,
    message_id: String,
}

#[derive(Debug, Clone)]
struct ScoredLine {
    index: usize,
    line: String,
    score: i32,
}

#[tauri::command]
fn get_aster_paths(app: AppHandle) -> Result<AsterPaths, String> {
    let root = app_data_root(&app)?;
    let files_root = root.join("files").join("papers");
    let database = root.join("aster.db");
    fs::create_dir_all(&files_root).map_err(|error| error.to_string())?;
    Ok(AsterPaths {
        root: path_to_string(&root),
        database: path_to_string(&database),
        files_root: path_to_string(&files_root),
    })
}

#[tauri::command]
fn initialize_library(app: AppHandle) -> Result<AsterPaths, String> {
    let paths = get_aster_paths(app)?;
    let database = Path::new(&paths.database);
    initialize_database(database)?;
    seed_default_guide(Path::new(&paths.root), database)?;
    Ok(paths)
}

#[tauri::command]
fn get_app_diagnostics(app: AppHandle) -> Result<AppDiagnostics, String> {
    let paths = get_aster_paths(app)?;
    let database_path = PathBuf::from(&paths.database);
    let file_stats = library_file_stats(&database_path)?;
    Ok(AppDiagnostics {
        product_name: "Aster".to_string(),
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
        database_size_bytes: fs::metadata(&database_path).map(|metadata| metadata.len()).unwrap_or(0),
        files_size_bytes: dir_size(Path::new(&paths.files_root)).unwrap_or(0),
    })
}

#[tauri::command]
fn reveal_aster_path(app: AppHandle, request: RevealPathRequest) -> Result<(), String> {
    let paths = get_aster_paths(app)?;
    let target = match request.kind.as_str() {
        "root" => PathBuf::from(paths.root),
        "files" => PathBuf::from(paths.files_root),
        "backups" => PathBuf::from(paths.root).join("backups"),
        "database" => {
            let database = PathBuf::from(paths.database);
            database.parent().map(Path::to_path_buf).unwrap_or(database)
        }
        _ => return Err("鏈煡鐨勮祫鏂欏簱璺緞绫诲瀷".to_string()),
    };
    fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    open_path_in_file_manager(&target)
}

#[tauri::command]
fn create_library_backup(app: AppHandle) -> Result<BackupResult, String> {
    let paths = get_aster_paths(app)?;
    let root = PathBuf::from(&paths.root);
    let backup_path = create_backup_for_root(&root, "aster-backup")?;

    Ok(BackupResult {
        backup_path: path_to_string(&backup_path),
    })
}

#[tauri::command]
fn restore_library_backup(app: AppHandle, backup_path: String) -> Result<RestoreBackupResult, String> {
    let paths = get_aster_paths(app)?;
    let root = PathBuf::from(&paths.root);
    let backup_path = PathBuf::from(backup_path);
    restore_backup_into_root(&root, &backup_path)
}

#[tauri::command]
fn extract_pdf_metadata(original_path: String) -> Result<MetadataDraft, String> {
    Ok(extract_metadata_from_pdf_path(&original_path))
}

#[tauri::command]
fn import_pdf_to_library(app: AppHandle, request: ImportPdfRequest) -> Result<ImportPdfResult, String> {
    let root = app_data_root(&app)?;
    import_pdf_into_root(&root, request)
}

#[tauri::command]
fn import_translated_pdf_to_library(app: AppHandle, request: ImportTranslationRequest) -> Result<ImportTranslationResult, String> {
    let root = app_data_root(&app)?;
    import_translation_into_root(&root, request)
}

#[tauri::command]
fn load_paper_file_bytes(app: AppHandle, request: LoadPaperFileRequest) -> Result<Vec<u8>, String> {
    let root = app_data_root(&app)?;
    load_paper_file_bytes_from_database(&root.join("aster.db"), &request)
}

#[tauri::command]
fn reveal_paper_file(app: AppHandle, request: RevealPaperFileRequest) -> Result<(), String> {
    let root = app_data_root(&app)?;
    let path = paper_file_path_from_database(&root.join("aster.db"), &request.paper_id, &request.kind, request.file_id.as_deref())?;
    let target = path.parent().map(Path::to_path_buf).unwrap_or(path);
    open_path_in_file_manager(&target)
}

#[tauri::command]
fn open_paper_file(app: AppHandle, request: RevealPaperFileRequest) -> Result<(), String> {
    let root = app_data_root(&app)?;
    let path = paper_file_path_from_database(&root.join("aster.db"), &request.paper_id, &request.kind, request.file_id.as_deref())?;
    open_file_with_default_app(&path)
}

#[tauri::command]
fn list_papers(app: AppHandle) -> Result<Vec<PaperSummary>, String> {
    let root = app_data_root(&app)?;
    list_papers_in_database(&root.join("aster.db"))
}

#[tauri::command]
fn create_annotation(app: AppHandle, request: CreateAnnotationRequest) -> Result<CreateAnnotationResult, String> {
    let root = app_data_root(&app)?;
    let id = insert_annotation(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult { id })
}

#[tauri::command]
fn restore_annotation(app: AppHandle, request: RestoreAnnotationRequest) -> Result<CreateAnnotationResult, String> {
    let root = app_data_root(&app)?;
    restore_annotation_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
fn update_annotation_comment(app: AppHandle, request: UpdateAnnotationCommentRequest) -> Result<CreateAnnotationResult, String> {
    let root = app_data_root(&app)?;
    update_annotation_comment_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
fn update_annotation_color(app: AppHandle, request: UpdateAnnotationColorRequest) -> Result<CreateAnnotationResult, String> {
    let root = app_data_root(&app)?;
    update_annotation_color_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
fn update_annotation_position(app: AppHandle, request: UpdateAnnotationPositionRequest) -> Result<CreateAnnotationResult, String> {
    let root = app_data_root(&app)?;
    update_annotation_position_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
fn delete_annotation(app: AppHandle, request: DeleteAnnotationRequest) -> Result<CreateAnnotationResult, String> {
    let root = app_data_root(&app)?;
    delete_annotation_in_database(&root.join("aster.db"), &request)?;
    Ok(CreateAnnotationResult {
        id: request.annotation_id,
    })
}

#[tauri::command]
fn upsert_note(app: AppHandle, request: UpsertNoteRequest) -> Result<UpsertNoteResult, String> {
    let root = app_data_root(&app)?;
    let id = upsert_note_in_database(&root.join("aster.db"), request)?;
    Ok(UpsertNoteResult { id })
}

#[tauri::command]
fn update_paper_metadata(app: AppHandle, request: UpdatePaperMetadataRequest) -> Result<PaperMutationResult, String> {
    let root = app_data_root(&app)?;
    update_paper_metadata_in_database(&root.join("aster.db"), &request)?;
    Ok(PaperMutationResult {
        paper_id: request.paper_id,
    })
}

#[tauri::command]
fn update_paper_tags(app: AppHandle, request: UpdatePaperTagsRequest) -> Result<PaperMutationResult, String> {
    let root = app_data_root(&app)?;
    update_paper_tags_in_database(&root.join("aster.db"), &request.paper_id, &request.tags)?;
    Ok(PaperMutationResult {
        paper_id: request.paper_id,
    })
}

#[tauri::command]
fn delete_paper(app: AppHandle, paper_id: String) -> Result<PaperMutationResult, String> {
    let root = app_data_root(&app)?;
    delete_paper_in_root(&root, &paper_id)?;
    Ok(PaperMutationResult { paper_id })
}

#[tauri::command]
fn list_ai_threads(app: AppHandle, paper_id: String) -> Result<Vec<AiThreadSummary>, String> {
    let root = app_data_root(&app)?;
    list_ai_threads_with_messages(&root.join("aster.db"), &paper_id)
}

#[tauri::command]
fn append_ai_message(app: AppHandle, request: AppendAiMessageRequest) -> Result<AppendAiMessageResult, String> {
    let root = app_data_root(&app)?;
    append_ai_message_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
fn clear_ai_threads(app: AppHandle, paper_id: String) -> Result<PaperMutationResult, String> {
    let root = app_data_root(&app)?;
    clear_ai_threads_in_database(&root.join("aster.db"), &paper_id)?;
    Ok(PaperMutationResult { paper_id })
}

fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let root = base.join("AsterData");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open path: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("鏃犳硶鎵撳紑璺緞锛歿error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("鏃犳硶鎵撳紑璺緞锛歿error}"))?;
        return Ok(());
    }
}

fn open_file_with_default_app(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path_to_string(path)])
            .spawn()
            .map_err(|error| format!("Failed to open file: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open file: {error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open file: {error}"))?;
        return Ok(());
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path).map_err(|error| format!("Failed to copy file: {error}"))?;
        }
    }
    Ok(())
}

fn create_backup_for_root(root: &Path, prefix: &str) -> Result<PathBuf, String> {
    let database = root.join("aster.db");
    initialize_database(&database)?;

    let backups_root = root.join("backups");
    fs::create_dir_all(&backups_root).map_err(|error| error.to_string())?;
    let backup_path = backups_root.join(format!("{prefix}-{}", current_timestamp_ms()));
    fs::create_dir_all(&backup_path).map_err(|error| error.to_string())?;

    fs::copy(&database, backup_path.join("aster.db")).map_err(|error| format!("鏃犳硶澶囦唤鏁版嵁搴擄細{error}"))?;

    let files_root = root.join("files").join("papers");
    if files_root.exists() {
        copy_dir_recursive(&files_root, &backup_path.join("files").join("papers"))?;
    }

    Ok(backup_path)
}

fn restore_backup_into_root(root: &Path, backup_path: &Path) -> Result<RestoreBackupResult, String> {
    let backup_database = backup_path.join("aster.db");
    if !backup_database.exists() {
        return Err("Invalid backup directory: missing aster.db".to_string());
    }
    initialize_database(&backup_database)?;

    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let safety_backup_path = create_backup_for_root(root, "aster-pre-restore")?;

    let database = root.join("aster.db");
    fs::copy(&backup_database, &database).map_err(|error| format!("Failed to restore database: {error}"))?;

    let files_root = root.join("files").join("papers");
    if files_root.exists() {
        fs::remove_dir_all(&files_root).map_err(|error| format!("Failed to clear old files: {error}"))?;
    }
    let backup_files_root = backup_path.join("files").join("papers");
    if backup_files_root.exists() {
        copy_dir_recursive(&backup_files_root, &files_root)?;
    } else {
        fs::create_dir_all(&files_root).map_err(|error| error.to_string())?;
    }
    seed_default_guide(root, &database)?;

    Ok(RestoreBackupResult {
        restored_from: path_to_string(backup_path),
        safety_backup_path: path_to_string(&safety_backup_path),
    })
}

fn schema_sql() -> &'static str {
    include_str!("../schema.sql")
}

fn initialize_database(database_path: &Path) -> Result<(), String> {
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    connection.execute_batch(schema_sql()).map_err(|error| error.to_string())?;
    let _ = connection.execute("ALTER TABLE paper_files ADD COLUMN content_hash TEXT", []);
    Ok(())
}

fn library_file_stats(database_path: &Path) -> Result<LibraryFileStats, String> {
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

fn count_rows(connection: &Connection, table: &str) -> Result<i64, String> {
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn count_file_type(connection: &Connection, file_type: &str) -> Result<i64, String> {
    connection
        .query_row("SELECT COUNT(*) FROM paper_files WHERE type = ?1", params![file_type], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn dir_size(path: &Path) -> Result<u64, String> {
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

fn seed_default_guide(root: &Path, database_path: &Path) -> Result<(), String> {
    initialize_database(database_path)?;
    let paper_dir = root.join("files").join("papers").join(GUIDE_PAPER_ID);
    fs::create_dir_all(&paper_dir).map_err(|error| error.to_string())?;
    let pdf_path = paper_dir.join("source.pdf");
    fs::write(&pdf_path, GUIDE_PDF).map_err(|error| error.to_string())?;

    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let exists: i64 = connection
        .query_row("SELECT COUNT(*) FROM papers WHERE id = ?1", params![GUIDE_PAPER_ID], |row| row.get(0))
        .map_err(|error| error.to_string())?;

    let request = ImportPdfRequest {
        original_path: path_to_string(&pdf_path),
        paper_id: Some(GUIDE_PAPER_ID.to_string()),
        title: GUIDE_TITLE.to_string(),
        authors: GUIDE_AUTHORS.to_string(),
        year: Some(GUIDE_YEAR),
        venue: GUIDE_VENUE.to_string(),
        doi: String::new(),
        tags: vec!["指南".to_string(), "入门".to_string(), "Aster".to_string()],
    };
    if exists == 0 {
        insert_imported_document(database_path, GUIDE_PAPER_ID, GUIDE_FILE_ID, &path_to_string(&pdf_path), None, &request)?;
    } else {
        let now = current_timestamp_ms();
        connection
            .execute(
                "UPDATE papers
                 SET title = ?1, authors = ?2, year = ?3, venue = ?4, doi = ?5, updated_at = ?6
                 WHERE id = ?7",
                params![GUIDE_TITLE, GUIDE_AUTHORS, GUIDE_YEAR, GUIDE_VENUE, "", now, GUIDE_PAPER_ID],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO paper_files (id, paper_id, type, path, language, content_hash, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET path = excluded.path, language = excluded.language, content_hash = excluded.content_hash",
                params![GUIDE_FILE_ID, GUIDE_PAPER_ID, "source_pdf", path_to_string(&pdf_path), "", Option::<String>::None, now],
            )
            .map_err(|error| error.to_string())?;
        update_paper_tags_in_database(database_path, GUIDE_PAPER_ID, &request.tags)?;
    }
    upsert_note_in_database(
        database_path,
        UpsertNoteRequest {
            paper_id: GUIDE_PAPER_ID.to_string(),
            note_id: Some(GUIDE_NOTE_ID.to_string()),
            title: "Aster 使用指南笔记".to_string(),
            content: GUIDE_MARKDOWN.to_string(),
        },
    )?;
    Ok(())
}

fn import_pdf_into_root(root: &Path, request: ImportPdfRequest) -> Result<ImportPdfResult, String> {
    let source_path = PathBuf::from(&request.original_path);
    if !source_path.exists() {
        return Err("PDF file not found; cannot import".to_string());
    }
     let source_bytes = fs::read(&source_path).map_err(|error| format!("Failed to read PDF file: {error}"))?;
    let content_hash = sha256_hex(&source_bytes);
    if let Some(existing_paper_id) = find_duplicate_paper(&root.join("aster.db"), &content_hash, request.doi.trim())? {
        return Ok(ImportPdfResult {
            paper_id: existing_paper_id.clone(),
            file_id: String::new(),
            source_pdf: String::new(),
            copied: false,
            duplicate: true,
            existing_paper_id: Some(existing_paper_id),
            duplicate_reason: Some(if request.doi.trim().is_empty() { "file_hash" } else { "doi_or_file_hash" }.to_string()),
        });
    }

    let paper_id = request.paper_id.clone().unwrap_or_else(|| format!("paper-{}", Uuid::new_v4()));
    let file_id = format!("file-{}", Uuid::new_v4());
    let paper_dir = root.join("files").join("papers").join(&paper_id);
    fs::create_dir_all(&paper_dir).map_err(|error| error.to_string())?;

    let target_path = paper_dir.join("source.pdf");
    fs::copy(&source_path, &target_path).map_err(|error| error.to_string())?;

    let source_pdf = path_to_string(&target_path);
    insert_imported_document(&root.join("aster.db"), &paper_id, &file_id, &source_pdf, Some(&content_hash), &request)?;
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

fn import_translation_into_root(root: &Path, request: ImportTranslationRequest) -> Result<ImportTranslationResult, String> {
    let source_path = PathBuf::from(&request.original_path);
    if !source_path.exists() {
        return Err("Translated PDF file not found; cannot import".to_string());
    }

    let database_path = root.join("aster.db");
    if !paper_exists(&database_path, &request.paper_id)? {
        return Err("Document does not exist; cannot bind translated PDF".to_string());
    }

    let file_id = format!("file-{}", Uuid::new_v4());
    let paper_dir = root.join("files").join("papers").join(&request.paper_id);
    fs::create_dir_all(&paper_dir).map_err(|error| error.to_string())?;
    let language = normalized_file_token(request.language.as_deref().unwrap_or("manual"));
    let target_path = paper_dir.join(format!("translated.{language}.{file_id}.pdf"));
    fs::copy(&source_path, &target_path).map_err(|error| error.to_string())?;
    let translated_pdf = path_to_string(&target_path);
    insert_paper_file(&database_path, &file_id, &request.paper_id, "translated_pdf", &translated_pdf, &language, None)?;
    Ok(ImportTranslationResult {
        paper_id: request.paper_id,
        file_id,
        translated_pdf,
        copied: true,
    })
}

fn paper_exists(database_path: &Path, paper_id: &str) -> Result<bool, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM papers WHERE id = ?1", params![paper_id], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

fn normalized_file_token(value: &str) -> String {
    let token = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-' || *character == '_')
        .collect::<String>();
    if token.trim().is_empty() {
        "manual".to_string()
    } else {
        token
    }
}

fn load_paper_file_bytes_from_database(database_path: &Path, request: &LoadPaperFileRequest) -> Result<Vec<u8>, String> {
    let path = paper_file_path_from_database(database_path, &request.paper_id, &request.kind, request.file_id.as_deref())?;
    fs::read(&path).map_err(|error| format!("Failed to read PDF file: {error}"))
}

fn paper_file_path_from_database(database_path: &Path, paper_id: &str, kind: &str, file_id: Option<&str>) -> Result<PathBuf, String> {
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

fn insert_paper_file(database_path: &Path, file_id: &str, paper_id: &str, file_type: &str, path: &str, language: &str, content_hash: Option<&str>) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO paper_files (id, paper_id, type, path, language, content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![file_id, paper_id, file_type, path, language, content_hash, current_timestamp_ms()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn find_duplicate_paper(database_path: &Path, content_hash: &str, doi: &str) -> Result<Option<String>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    if !content_hash.trim().is_empty() {
        let found = connection.query_row(
            "SELECT paper_id FROM paper_files WHERE content_hash = ?1 AND type = \"source_pdf\" LIMIT 1",
            params![content_hash],
            |row| row.get::<_, String>(0),
        );
        if let Ok(paper_id) = found {
            return Ok(Some(paper_id));
        }
    }
    if !doi.trim().is_empty() {
        let found = connection.query_row(
            "SELECT id FROM papers WHERE lower(doi) = lower(?1) LIMIT 1",
            params![doi.trim()],
            |row| row.get::<_, String>(0),
        );
        if let Ok(paper_id) = found {
            return Ok(Some(paper_id));
        }
    }
    Ok(None)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
}

fn insert_imported_document(database_path: &Path, paper_id: &str, file_id: &str, source_pdf: &str, content_hash: Option<&str>, request: &ImportPdfRequest) -> Result<(), String> {
    initialize_database(database_path)?;
    let now = current_timestamp_ms();
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let title = if request.title.trim().is_empty() {
        "Untitled document"
    } else {
        request.title.trim()
    };

    transaction
        .execute(
            "INSERT OR REPLACE INTO papers (id, title, authors, year, venue, doi, status, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![paper_id, title, request.authors.trim(), request.year, request.venue.trim(), request.doi.trim(), "unread", "library", now, now],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO paper_files (id, paper_id, type, path, language, content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![file_id, paper_id, "source_pdf", source_pdf, "", content_hash, now],
        )
        .map_err(|error| error.to_string())?;

    for tag in normalized_tags(&request.tags) {
        let tag_id = stable_tag_id(&tag);
        transaction
            .execute("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)", params![tag_id, tag, now])
            .map_err(|error| error.to_string())?;
        transaction
            .execute("INSERT OR IGNORE INTO paper_tags (paper_id, tag_id) VALUES (?1, ?2)", params![paper_id, tag_id])
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn update_paper_metadata_in_database(database_path: &Path, request: &UpdatePaperMetadataRequest) -> Result<(), String> {
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
            params![title, request.authors.trim(), request.year, request.venue.trim(), request.doi.trim(), current_timestamp_ms(), request.paper_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Document does not exist; cannot save".to_string());
    }
    Ok(())
}

fn update_paper_tags_in_database(database_path: &Path, paper_id: &str, tags: &[String]) -> Result<(), String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let exists: i64 = connection
        .query_row("SELECT COUNT(*) FROM papers WHERE id = ?1", params![paper_id], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if exists == 0 {
        return Err("Document does not exist; cannot save tags".to_string());
    }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM paper_tags WHERE paper_id = ?1", params![paper_id])
        .map_err(|error| error.to_string())?;
    for tag in normalized_tags(tags) {
        let tag_id = stable_tag_id(&tag);
        transaction
            .execute("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)", params![tag_id, tag, now])
            .map_err(|error| error.to_string())?;
        transaction
            .execute("INSERT OR IGNORE INTO paper_tags (paper_id, tag_id) VALUES (?1, ?2)", params![paper_id, tag_id])
            .map_err(|error| error.to_string())?;
    }
    transaction
        .execute("UPDATE papers SET updated_at = ?1 WHERE id = ?2", params![now, paper_id])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn delete_paper_in_root(root: &Path, paper_id: &str) -> Result<(), String> {
    let database_path = root.join("aster.db");
    initialize_database(&database_path)?;
    let mut connection = Connection::open(&database_path).map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_messages WHERE thread_id IN (SELECT id FROM ai_threads WHERE paper_id = ?1)", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_threads WHERE paper_id = ?1", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM annotations WHERE paper_id = ?1", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM notes WHERE paper_id = ?1", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM paper_files WHERE paper_id = ?1", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM paper_tags WHERE paper_id = ?1", params![paper_id])
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

fn list_papers_in_database(database_path: &Path) -> Result<Vec<PaperSummary>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT p.id, p.title, COALESCE(p.authors, ''), p.year, COALESCE(p.venue, ''), COALESCE(p.doi, ''),
                    (SELECT pf.id FROM paper_files pf WHERE pf.paper_id = p.id AND pf.type = 'source_pdf' ORDER BY pf.created_at DESC LIMIT 1),
                    (SELECT pf.path FROM paper_files pf WHERE pf.paper_id = p.id AND pf.type = 'source_pdf' ORDER BY pf.created_at DESC LIMIT 1)
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
                source_file_id: row.get(6)?,
                source_pdf: row.get(7)?,
                translated_file_ids: Vec::new(),
                translated_pdfs: Vec::new(),
                tags: Vec::new(),
                notes: Vec::new(),
                annotations: Vec::new(),
                ai_threads: Vec::new(),
            })
        })
        .map_err(|error| error.to_string())?;

    let mut papers = Vec::new();
    for row in rows {
        let mut paper = row.map_err(|error| error.to_string())?;
        paper.tags = list_tags_for_paper(&connection, &paper.paper_id)?;
        paper.translated_file_ids = list_translated_file_ids_for_paper(&connection, &paper.paper_id)?;
        paper.translated_pdfs = list_translated_pdfs_for_paper(&connection, &paper.paper_id)?;
        paper.notes = list_notes_for_paper(&connection, &paper.paper_id)?;
        paper.annotations = list_annotations_for_paper(&connection, &paper.paper_id)?;
        paper.ai_threads = list_ai_threads_for_paper(&connection, &paper.paper_id)?;
        papers.push(paper);
    }
    Ok(papers)
}

fn normalized_tags(tags: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut cleaned = Vec::new();
    for tag in tags.iter().map(|tag| tag.trim()).filter(|tag| !tag.is_empty()) {
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

fn extract_metadata_from_pdf_path(original_path: &str) -> MetadataDraft {
    let mut draft = metadata_from_filename(original_path);
    let path = PathBuf::from(original_path);
    if !path.exists() {
        draft.warnings.push("PDF file not found; used filename only".to_string());
        return draft;
    }

    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            draft.warnings.push(format!("Failed to read PDF content: {error}. Used filename only as draft."));
            return draft;
        }
    };

    let text = extract_pdf_text(&path, &bytes);
    if text.trim().is_empty() {
        draft.warnings.push("Could not extract readable text from PDF content; used filename only.".to_string());
        return draft;
    }

    let candidates = top_candidate_lines(&text, 36);
    if let Some(title) = choose_title(&candidates) {
        draft.title = title.line.clone();
        draft.source = "pdf_text".to_string();
        if let Some(authors) = choose_authors(&candidates, title.index) {
            draft.authors = authors.line;
        }
    }

    if let Some(doi) = find_doi(&text) {
        draft.doi = doi;
        draft.source = "pdf_text".to_string();
    }

    if draft.year.is_none() {
        if let Some(year) = find_year_near_top(&text) {
            draft.year = Some(year);
            draft.source = "pdf_text".to_string();
        }
    }

    if draft.source == "filename" {
        draft.warnings.push("PDF text extraction is limited; used filename as fallback.".to_string());
    }
    draft
}

fn metadata_from_filename(original_path: &str) -> MetadataDraft {
    let file_name = Path::new(original_path).file_stem().and_then(|name| name.to_str()).unwrap_or("Untitled");
    let cleaned = file_name.replace(['_', '-'], " ").split_whitespace().collect::<Vec<_>>().join(" ");
    MetadataDraft {
        title: if cleaned.trim().is_empty() {
            "Untitled".to_string()
        } else {
            cleaned.trim().to_string()
        },
        authors: String::new(),
        year: find_year_anywhere(file_name),
        venue: String::new(),
        doi: String::new(),
        tags: vec![FALLBACK_TAG.to_string()],
        source: "filename".to_string(),
        warnings: Vec::new(),
    }
}

fn extract_pdf_text(path: &Path, bytes: &[u8]) -> String {
    if let Ok(text) = pdf_extract::extract_text(path) {
        let cleaned = clean_pdf_text(&text);
        if !cleaned.trim().is_empty() {
            return cleaned;
        }
    }
    clean_pdf_text(&extract_ascii_pdf_text(bytes))
}

fn extract_ascii_pdf_text(bytes: &[u8]) -> String {
    let limited = &bytes[..bytes.len().min(512_000)];
    let mut output = String::new();
    let mut current = String::new();
    for byte in limited {
        let ch = *byte as char;
        if ch.is_ascii_graphic() || ch == ' ' {
            current.push(ch);
        } else {
            if current.len() >= 4 {
                output.push_str(&current);
                output.push('\n');
            }
            current.clear();
        }
    }
    if current.len() >= 4 {
        output.push_str(&current);
    }
    output
}

fn clean_pdf_text(text: &str) -> String {
    text.lines()
        .map(normalize_spaces)
        .filter(|line| !line.is_empty())
        .filter(|line| !is_pdf_noise_line(line))
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_spaces(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_pdf_noise_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    if lower.is_empty() {
        return true;
    }
    let exact_noise = [
        "obj",
        "endobj",
        "stream",
        "endstream",
        "xref",
        "trailer",
        "startxref",
        "catalog",
    ];
    if exact_noise.contains(&lower.as_str()) {
        return true;
    }
    let contains_noise = [
        "/type",
        "/xobject",
        "flatedecode",
        "bbo",
        "bbox",
        "/resources",
        "/mediabox",
        "/contents",
        "/length",
        "/filter",
        "/font",
        "/procset",
        "endobj",
        "xref",
        "obj",
    ];
    if contains_noise.iter().any(|token| lower.contains(token)) {
        return true;
    }
    if lower.starts_with('%') || lower.starts_with("<<") || lower.starts_with(">>") {
        return true;
    }
    false
}

fn top_candidate_lines(text: &str, limit: usize) -> Vec<String> {
    text.lines()
        .map(normalize_spaces)
        .filter(|line| !line.is_empty())
        .take(limit)
        .collect()
}

fn choose_title(lines: &[String]) -> Option<ScoredLine> {
    lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            let score = score_title_line(line, index);
            (score > 0).then(|| ScoredLine {
                index,
                line: line.clone(),
                score,
            })
        })
        .max_by(|a, b| compare_scored_lines(a, b))
}

fn choose_authors(lines: &[String], title_index: usize) -> Option<ScoredLine> {
    lines
        .iter()
        .enumerate()
        .filter(|(index, _)| *index > title_index && *index <= title_index + 4)
        .filter_map(|(index, line)| {
            let score = score_author_line(line, index.saturating_sub(title_index));
            (score > 0).then(|| ScoredLine {
                index,
                line: line.clone(),
                score,
            })
        })
        .max_by(|a, b| compare_scored_lines(a, b))
}

fn score_title_line(line: &str, index: usize) -> i32 {
    let len = line.chars().count();
    if !(12..=220).contains(&len) || !has_letter(line) {
        return -100;
    }
    if looks_like_author_list(line) {
        return -100;
    }
    let lower = line.to_lowercase();
    if lower.contains("doi")
        || lower.contains("abstract")
        || lower.contains("introduction")
        || lower.contains("references")
        || lower.contains("copyright")
        || lower.contains("arxiv:")
        || lower.contains('@')
    {
        return -100;
    }

    let mut score = 0;
    score += (40_i32 - (index as i32 * 4)).max(0);
    if (18..=140).contains(&len) {
        score += 24;
    }
    let words = line.split_whitespace().count();
    if (3..=18).contains(&words) {
        score += 18;
    }
    let alpha_ratio = line.chars().filter(|ch| ch.is_alphabetic()).count() as f32 / len as f32;
    if alpha_ratio > 0.55 {
        score += 18;
    }
    if line.chars().all(|ch| !ch.is_lowercase() || !ch.is_alphabetic()) {
        score -= 8;
    }
    if line.chars().any(|ch| ch.is_ascii_digit()) {
        score -= 6;
    }
    if line.contains(',') {
        score -= 10;
    }
    score
}

fn score_author_line(line: &str, distance_from_title: usize) -> i32 {
    let len = line.chars().count();
    if !(3..=180).contains(&len) || !has_letter(line) {
        return -100;
    }
    let lower = line.to_lowercase();
    if lower.contains("abstract")
        || lower.contains("introduction")
        || lower.contains("doi")
        || lower.contains("copyright")
        || lower.contains("university")
        || lower.contains("department")
        || lower.contains("school")
        || lower.contains("institute")
        || lower.contains("keywords")
    {
        return -100;
    }
    if !looks_like_author_list(line) {
        return -100;
    }

    let mut score = 0;
    score += (28_i32 - distance_from_title as i32 * 6).max(0);
    if line.contains(',') || line.contains(" and ") {
        score += 14;
    }
    if lower.contains("et al") {
        score += 10;
    }
    if line.contains('@') {
        score -= 10;
    }
    let words = line.split_whitespace().count();
    if (2..=16).contains(&words) {
        score += 12;
    }
    score
}

fn compare_scored_lines(a: &ScoredLine, b: &ScoredLine) -> Ordering {
    a.score
        .cmp(&b.score)
        .then_with(|| b.index.cmp(&a.index))
}

fn has_letter(line: &str) -> bool {
    line.chars().any(|ch| ch.is_alphabetic())
}

fn looks_like_author_list(line: &str) -> bool {
    let lower = line.to_lowercase();
    if lower.contains("et al") || lower.contains(" and ") {
        return true;
    }
    if !line.contains(',') {
        return false;
    }
    let parts: Vec<&str> = line.split(',').map(|part| part.trim()).filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return false;
    }
    parts.iter().all(|part| {
        let words: Vec<&str> = part.split_whitespace().collect();
        (1..=4).contains(&words.len())
            && words
                .iter()
                .all(|word| word.chars().next().map(|ch| ch.is_uppercase()).unwrap_or(false))
    })
}

fn find_doi(text: &str) -> Option<String> {
    let lowered = text.to_lowercase();
    let start = lowered.find("10.")?;
    let tail = &text[start..text.len().min(start + 220)];
    let candidate = tail
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';' | '.'));
    if candidate.starts_with("10.") && candidate.contains('/') && candidate.len() >= 7 {
        Some(candidate.to_string())
    } else {
        None
    }
}

fn find_year_near_top(text: &str) -> Option<i64> {
    let window = text.lines().take(40).collect::<Vec<_>>().join(" ");
    find_year_anywhere(&window)
}

fn find_year_anywhere(text: &str) -> Option<i64> {
    for token in text.split(|ch: char| !ch.is_ascii_alphanumeric()) {
        if token.len() == 4 {
            if let Ok(year) = token.parse::<i64>() {
                if (1900..=2100).contains(&year) {
                    return Some(year);
                }
            }
        }
    }
    None
}

fn insert_annotation(database_path: &Path, request: &CreateAnnotationRequest) -> Result<String, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let id = format!("anno-{}", Uuid::new_v4());
    connection
        .execute(
            "INSERT INTO annotations (id, paper_id, file_id, page, type, quote, comment, color, position_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![id, request.paper_id, request.file_id, request.page, request.annotation_type, request.quote, request.comment, request.color, request.position_json, now, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(id)
}

fn restore_annotation_in_database(database_path: &Path, request: &RestoreAnnotationRequest) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    connection
        .execute(
            "INSERT OR REPLACE INTO annotations (id, paper_id, file_id, page, type, quote, comment, color, position_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                request.annotation_id,
                request.paper_id,
                request.file_id,
                request.page,
                request.annotation_type,
                request.quote,
                request.comment,
                request.color,
                request.position_json,
                request.created_at,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn update_annotation_comment_in_database(database_path: &Path, request: &UpdateAnnotationCommentRequest) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let updated = connection
        .execute(
            "UPDATE annotations SET comment = ?1, updated_at = ?2 WHERE id = ?3",
            params![request.comment, current_timestamp_ms(), request.annotation_id],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err("Annotation not found".to_string());
    }
    Ok(())
}

fn update_annotation_color_in_database(database_path: &Path, request: &UpdateAnnotationColorRequest) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let changed = connection
        .execute(
            "UPDATE annotations
             SET color = ?1, updated_at = ?2
             WHERE id = ?3",
            params![request.color.trim(), current_timestamp_ms(), request.annotation_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Annotation not found".to_string());
    }
    Ok(())
}

fn update_annotation_position_in_database(database_path: &Path, request: &UpdateAnnotationPositionRequest) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let changed = connection
        .execute(
            "UPDATE annotations
             SET position_json = ?1, updated_at = ?2
             WHERE id = ?3",
            params![request.position_json.trim(), current_timestamp_ms(), request.annotation_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Annotation not found".to_string());
    }
    Ok(())
}

fn delete_annotation_in_database(database_path: &Path, request: &DeleteAnnotationRequest) -> Result<(), String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM annotations WHERE id = ?1", params![request.annotation_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn upsert_note_in_database(database_path: &Path, request: UpsertNoteRequest) -> Result<String, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let id = request.note_id.unwrap_or_else(|| format!("note-{}", Uuid::new_v4()));
    connection
        .execute(
            "INSERT INTO notes (id, paper_id, title, content, format, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, format = excluded.format, updated_at = excluded.updated_at",
            params![id, request.paper_id, request.title, request.content, "markdown", now, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(id)
}

fn list_tags_for_paper(connection: &Connection, paper_id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT t.name FROM tags t INNER JOIN paper_tags pt ON pt.tag_id = t.id WHERE pt.paper_id = ?1 ORDER BY t.name")
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![paper_id], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?;
    collect_string_rows(rows)
}

fn list_translated_pdfs_for_paper(connection: &Connection, paper_id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT path FROM paper_files WHERE paper_id = ?1 AND type = 'translated_pdf' ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![paper_id], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?;
    collect_string_rows(rows)
}

fn list_translated_file_ids_for_paper(connection: &Connection, paper_id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT id FROM paper_files WHERE paper_id = ?1 AND type = 'translated_pdf' ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![paper_id], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?;
    collect_string_rows(rows)
}

fn list_notes_for_paper(connection: &Connection, paper_id: &str) -> Result<Vec<NoteSummary>, String> {
    let mut statement = connection
        .prepare("SELECT id, COALESCE(title, '阅读笔记'), content, updated_at FROM notes WHERE paper_id = ?1 ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| {
            Ok(NoteSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut notes = Vec::new();
    for row in rows {
        notes.push(row.map_err(|error| error.to_string())?);
    }
    Ok(notes)
}

fn list_annotations_for_paper(connection: &Connection, paper_id: &str) -> Result<Vec<AnnotationSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, file_id, page, type, COALESCE(quote, ''), COALESCE(comment, ''), COALESCE(color, 'yellow'), position_json, created_at
             FROM annotations WHERE paper_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| {
            Ok(AnnotationSummary {
                id: row.get(0)?,
                file_id: row.get(1)?,
                page: row.get(2)?,
                annotation_type: row.get(3)?,
                quote: row.get(4)?,
                comment: row.get(5)?,
                color: row.get(6)?,
                position_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut annotations = Vec::new();
    for row in rows {
        annotations.push(row.map_err(|error| error.to_string())?);
    }
    Ok(annotations)
}

fn list_ai_threads_for_paper(connection: &Connection, paper_id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT id FROM ai_threads WHERE paper_id = ?1 ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![paper_id], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?;
    collect_string_rows(rows)
}

fn list_ai_threads_with_messages(database_path: &Path, paper_id: &str) -> Result<Vec<AiThreadSummary>, String> {
    initialize_database(database_path)?;
    let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, COALESCE(paper_id, ''), title, COALESCE(provider, ''), COALESCE(model, ''), created_at, updated_at
             FROM ai_threads
             WHERE paper_id = ?1
             ORDER BY updated_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![paper_id], |row| {
            Ok(AiThreadSummary {
                id: row.get(0)?,
                paper_id: row.get(1)?,
                title: row.get(2)?,
                provider: row.get(3)?,
                model: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                messages: Vec::new(),
            })
        })
        .map_err(|error| error.to_string())?;

    let mut threads = Vec::new();
    for row in rows {
        let mut thread = row.map_err(|error| error.to_string())?;
        thread.messages = list_ai_messages_for_thread(&connection, &thread.id)?;
        threads.push(thread);
    }
    Ok(threads)
}

fn list_ai_messages_for_thread(connection: &Connection, thread_id: &str) -> Result<Vec<AiMessageSummary>, String> {
    let mut statement = connection
        .prepare("SELECT id, role, content, created_at FROM ai_messages WHERE thread_id = ?1 ORDER BY created_at ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![thread_id], |row| {
            Ok(AiMessageSummary {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|error| error.to_string())?);
    }
    Ok(messages)
}

fn append_ai_message_in_database(database_path: &Path, request: &AppendAiMessageRequest) -> Result<AppendAiMessageResult, String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let now = current_timestamp_ms();
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let thread_id = match request.thread_id.as_deref().filter(|id| !id.trim().is_empty()) {
        Some(existing) => existing.to_string(),
        None => {
            let id = format!("thread-{}", Uuid::new_v4());
            transaction
                .execute(
                    "INSERT INTO ai_threads (id, paper_id, title, provider, model, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![id, request.paper_id, "文献对话", "local", "context-draft", now, now],
                )
                .map_err(|error| error.to_string())?;
            id
        }
    };
    let message_id = format!("msg-{}", Uuid::new_v4());
    transaction
        .execute(
            "INSERT INTO ai_messages (id, thread_id, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![message_id, thread_id, request.role.trim(), request.content.trim(), now],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute("UPDATE ai_threads SET updated_at = ?1 WHERE id = ?2", params![now, thread_id])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(AppendAiMessageResult { thread_id, message_id })
}

fn clear_ai_threads_in_database(database_path: &Path, paper_id: &str) -> Result<(), String> {
    initialize_database(database_path)?;
    let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_messages WHERE thread_id IN (SELECT id FROM ai_threads WHERE paper_id = ?1)", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_threads WHERE paper_id = ?1", params![paper_id])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn collect_string_rows(rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<String>>) -> Result<Vec<String>, String> {
    let mut values = Vec::new();
    for row in rows {
        values.push(row.map_err(|error| error.to_string())?);
    }
    Ok(values)
}

fn stable_tag_id(tag: &str) -> String {
    let encoded = tag.as_bytes().iter().map(|byte| format!("{:02x}", byte)).collect::<String>();
    format!("tag-{encoded}")
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_pdf_tags_translation_and_ai_thread_roundtrip() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("aster.db");
        let source_pdf = root.join("source-input.pdf");
        let translated_pdf = root.join("translated-input.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF").unwrap();
        fs::write(&translated_pdf, b"%PDF-1.4\ntranslated\n%%EOF").unwrap();

        let import_result = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-test".to_string()),
                title: "  Test Paper  ".to_string(),
                authors: "  Ada Lovelace  ".to_string(),
                year: Some(2026),
                venue: "  Aster Conf  ".to_string(),
                doi: "10.1000/aster.test".to_string(),
                tags: vec![],
            },
        )
        .unwrap();

        assert!(import_result.copied);
        assert_eq!(import_result.paper_id, "paper-test");
        assert!(PathBuf::from(&import_result.source_pdf).exists());

        let papers = list_papers_in_database(&database).unwrap();
        assert_eq!(papers.len(), 1);
        assert_eq!(papers[0].title, "Test Paper");
        assert_eq!(papers[0].authors, "Ada Lovelace");
        assert_eq!(papers[0].tags, vec![FALLBACK_TAG.to_string()]);
        assert_eq!(papers[0].source_file_id.as_deref(), Some(import_result.file_id.as_str()));

        update_paper_tags_in_database(
            &database,
            "paper-test",
            &["  AI  ".to_string(), "".to_string(), "阅读".to_string(), "ai".to_string(), FALLBACK_TAG.to_string(), "AI".to_string()],
        )
        .unwrap();
        let papers = list_papers_in_database(&database).unwrap();
        assert_eq!(papers[0].tags.len(), 2);
        assert!(papers[0].tags.contains(&"AI".to_string()));
        assert!(papers[0].tags.contains(&"阅读".to_string()));

        let translation = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "paper-test".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        )
        .unwrap();
        assert!(translation.copied);
        assert!(PathBuf::from(&translation.translated_pdf).exists());
        assert!(translation.translated_pdf.contains(&translation.file_id));

        append_ai_message_in_database(
            &database,
            &AppendAiMessageRequest {
                paper_id: "paper-test".to_string(),
                thread_id: None,
                role: "user".to_string(),
                content: "Summarize this paper".to_string(),
            },
        )
        .unwrap();

        let papers = list_papers_in_database(&database).unwrap();
        assert_eq!(papers[0].translated_file_ids, vec![translation.file_id]);
        assert_eq!(papers[0].translated_pdfs, vec![translation.translated_pdf]);
        assert_eq!(papers[0].ai_threads.len(), 1);
        assert!(papers[0].ai_threads[0].starts_with("thread-"));

        let translated_bytes = load_paper_file_bytes_from_database(
            &database,
            &LoadPaperFileRequest {
                paper_id: "paper-test".to_string(),
                kind: "translated".to_string(),
                file_id: None,
            },
        )
        .unwrap();
        assert!(translated_bytes.starts_with(b"%PDF"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn translated_pdf_import_requires_existing_paper_and_keeps_multiple_files() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let source_pdf = root.join("translation-source.pdf");
        let translated_pdf = root.join("translation-target.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\nsource\n%%EOF").unwrap();
        fs::write(&translated_pdf, b"%PDF-1.4\ntranslated-v1\n%%EOF").unwrap();

        let missing = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "missing-paper".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        );
        assert!(missing.is_err());
        assert!(!root.join("files").join("papers").join("missing-paper").exists());

        let import_result = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-translation".to_string()),
                title: "Translation Paper".to_string(),
                authors: String::new(),
                year: None,
                venue: String::new(),
                doi: String::new(),
                tags: vec![],
            },
        )
        .unwrap();
        assert_eq!(import_result.paper_id, "paper-translation");

        let first = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "paper-translation".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        )
        .unwrap();
        fs::write(&translated_pdf, b"%PDF-1.4\ntranslated-v2\n%%EOF").unwrap();
        let second = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "paper-translation".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        )
        .unwrap();

        assert_ne!(first.file_id, second.file_id);
        assert_ne!(first.translated_pdf, second.translated_pdf);
        assert!(PathBuf::from(&first.translated_pdf).exists());
        assert!(PathBuf::from(&second.translated_pdf).exists());
        let papers = list_papers_in_database(&root.join("aster.db")).unwrap();
        assert_eq!(papers[0].translated_file_ids.len(), 2);
        assert_eq!(papers[0].translated_pdfs.len(), 2);
        assert_eq!(papers[0].translated_file_ids[0], second.file_id);
        assert_eq!(papers[0].translated_file_ids[1], first.file_id);
        let latest_bytes = load_paper_file_bytes_from_database(
            &root.join("aster.db"),
            &LoadPaperFileRequest {
                paper_id: "paper-translation".to_string(),
                kind: "translated".to_string(),
                file_id: None,
            },
        )
        .unwrap();
        assert!(String::from_utf8_lossy(&latest_bytes).contains("translated-v2"));
        let first_bytes = load_paper_file_bytes_from_database(
            &root.join("aster.db"),
            &LoadPaperFileRequest {
                paper_id: "paper-translation".to_string(),
                kind: "translated".to_string(),
                file_id: Some(first.file_id),
            },
        )
        .unwrap();
        assert!(String::from_utf8_lossy(&first_bytes).contains("translated-v1"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_import_uses_existing_paper_by_hash() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let source_pdf = root.join("duplicate.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\nduplicate-content\n%%EOF").unwrap();
        let request = ImportPdfRequest {
            original_path: path_to_string(&source_pdf),
            paper_id: Some("paper-duplicate".to_string()),
            title: "Duplicate Paper".to_string(),
            authors: String::new(),
            year: None,
            venue: String::new(),
            doi: String::new(),
            tags: vec!["重复".to_string()],
        };

        let first = import_pdf_into_root(&root, request).unwrap();
        assert!(first.copied);
        let second = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-duplicate-second".to_string()),
                title: "Duplicate Paper Again".to_string(),
                authors: String::new(),
                year: None,
                venue: String::new(),
                doi: String::new(),
                tags: vec![],
            },
        )
        .unwrap();

        assert!(second.duplicate);
        assert_eq!(second.existing_paper_id.as_deref(), Some("paper-duplicate"));
        let papers = list_papers_in_database(&root.join("aster.db")).unwrap();
        assert_eq!(papers.len(), 1);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn annotation_delete_is_idempotent_and_restorable() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("aster.db");
        let source_pdf = root.join("annotation-source.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\nannotation-source\n%%EOF").unwrap();
        let import_result = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-annotation".to_string()),
                title: "Annotation Paper".to_string(),
                authors: String::new(),
                year: None,
                venue: String::new(),
                doi: String::new(),
                tags: vec![],
            },
        )
        .unwrap();

        let annotation_id = insert_annotation(
            &database,
            &CreateAnnotationRequest {
                paper_id: "paper-annotation".to_string(),
                file_id: import_result.file_id.clone(),
                page: 3,
                annotation_type: "highlight".to_string(),
                quote: "Important sentence".to_string(),
                comment: String::new(),
                color: "yellow".to_string(),
                position_json: "{\"x\":10,\"y\":20,\"width\":30,\"height\":4}".to_string(),
            },
        )
        .unwrap();

        let delete_request = DeleteAnnotationRequest {
            annotation_id: annotation_id.clone(),
        };
        delete_annotation_in_database(&database, &delete_request).unwrap();
        delete_annotation_in_database(&database, &delete_request).unwrap();
        assert!(list_annotations_for_paper(&Connection::open(&database).unwrap(), "paper-annotation").unwrap().is_empty());

        restore_annotation_in_database(
            &database,
            &RestoreAnnotationRequest {
                annotation_id: annotation_id.clone(),
                paper_id: "paper-annotation".to_string(),
                file_id: import_result.file_id,
                page: 3,
                annotation_type: "highlight".to_string(),
                quote: "Important sentence".to_string(),
                comment: "Restored".to_string(),
                color: "green".to_string(),
                position_json: "{\"x\":10,\"y\":20,\"width\":30,\"height\":4}".to_string(),
                created_at: current_timestamp_ms(),
            },
        )
        .unwrap();

        let restored = list_annotations_for_paper(&Connection::open(&database).unwrap(), "paper-annotation").unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, annotation_id);
        assert_eq!(restored[0].comment, "Restored");
        assert_eq!(restored[0].color, "green");

        delete_annotation_in_database(&database, &delete_request).unwrap();
        assert!(list_annotations_for_paper(&Connection::open(&database).unwrap(), "paper-annotation").unwrap().is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn source_and_translated_annotations_are_isolated_by_file_id() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("aster.db");
        let source_pdf = root.join("source-independent.pdf");
        let translated_pdf = root.join("translated-independent.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\nsource-independent\n%%EOF").unwrap();
        fs::write(&translated_pdf, b"%PDF-1.4\ntranslated-independent\n%%EOF").unwrap();

        let import_result = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-independent-annotations".to_string()),
                title: "Independent Annotations".to_string(),
                authors: String::new(),
                year: None,
                venue: String::new(),
                doi: String::new(),
                tags: vec![],
            },
        )
        .unwrap();
        let translation = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "paper-independent-annotations".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        )
        .unwrap();

        let source_annotation_id = insert_annotation(
            &database,
            &CreateAnnotationRequest {
                paper_id: "paper-independent-annotations".to_string(),
                file_id: import_result.file_id.clone(),
                page: 1,
                annotation_type: "highlight".to_string(),
                quote: "Source quote".to_string(),
                comment: "Source note".to_string(),
                color: "yellow".to_string(),
                position_json: "{\"x\":10,\"y\":12,\"width\":30,\"height\":4}".to_string(),
            },
        )
        .unwrap();
        let translated_annotation_id = insert_annotation(
            &database,
            &CreateAnnotationRequest {
                paper_id: "paper-independent-annotations".to_string(),
                file_id: translation.file_id.clone(),
                page: 1,
                annotation_type: "underline".to_string(),
                quote: "Translated quote".to_string(),
                comment: "Translated note".to_string(),
                color: "blue".to_string(),
                position_json: "{\"x\":12,\"y\":22,\"width\":28,\"height\":3}".to_string(),
            },
        )
        .unwrap();

        let papers = list_papers_in_database(&database).unwrap();
        let annotations = &papers[0].annotations;
        assert_eq!(annotations.len(), 2);
        assert!(annotations.iter().any(|annotation| annotation.id == source_annotation_id && annotation.file_id == import_result.file_id));
        assert!(annotations.iter().any(|annotation| annotation.id == translated_annotation_id && annotation.file_id == translation.file_id));

        delete_annotation_in_database(
            &database,
            &DeleteAnnotationRequest {
                annotation_id: source_annotation_id,
            },
        )
        .unwrap();
        let remaining = list_annotations_for_paper(&Connection::open(&database).unwrap(), "paper-independent-annotations").unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, translated_annotation_id);
        assert_eq!(remaining[0].file_id, translation.file_id);
        assert_eq!(remaining[0].comment, "Translated note");

        fs::remove_dir_all(root).unwrap();
    }

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!("aster-test-{}", Uuid::new_v4()))
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_aster_paths,
            initialize_library,
            get_app_diagnostics,
            reveal_aster_path,
            create_library_backup,
            restore_library_backup,
            extract_pdf_metadata,
            import_pdf_to_library,
            import_translated_pdf_to_library,
            load_paper_file_bytes,
            reveal_paper_file,
            open_paper_file,
            list_papers,
            create_annotation,
            restore_annotation,
            update_annotation_comment,
            update_annotation_color,
            update_annotation_position,
            delete_annotation,
            upsert_note,
            update_paper_metadata,
            update_paper_tags,
            delete_paper,
            list_ai_threads,
            append_ai_message,
            clear_ai_threads
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aster");
}

