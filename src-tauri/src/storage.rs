//! Library file storage root (task 6557dc15).
//!
//! Large library files — source, translated and captured PDFs, attachments and the
//! per-paper summaries — live under `<files root>/papers`. The default files root is
//! `<AsterData>/files`, which on Windows sits in the roaming AppData folder on the
//! system drive; users watched that drive fill up. `storage.json` next to `aster.db`
//! can point the tree anywhere else. `files_root` / `papers_root` are the single
//! resolution entry used by import, capture, summaries, backup, diagnostics and the
//! settings page; nothing else joins `"files"` onto the data root any more.
//!
//! Moving the tree is copy → verify → rewrite `paper_files.path` → delete. Every
//! step keeps the database consistent with files that exist: a failed or cancelled
//! copy removes what it created and leaves the old location untouched, and the
//! configuration only switches after the database points at the new copies.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

use crate::app_paths::{app_data_root, path_to_string};
use crate::backup::{hash_file, suffix_under};
use crate::database::initialize_database;

pub(crate) const CONFIG_FILE: &str = "storage.json";
const DEFAULT_FILES_DIR: &str = "files";
const PAPERS_DIR: &str = "papers";
const CAPTURE_DIR: &str = "capture";
const ISOLATED_RECOMMENDED_DIR: &str = "A4NoteFiles";
/// Keep this much headroom on the destination volume beyond the bytes being moved.
const FREE_SPACE_MARGIN: u64 = 64 * 1024 * 1024;
/// A drive is only recommended when it still has this much room.
const RECOMMENDED_MIN_FREE: u64 = 2 * 1024 * 1024 * 1024;
pub(crate) const PROGRESS_EVENT: &str = "library://storage-migration";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StorageConfig {
    version: u32,
    files_root: Option<String>,
    prompt_dismissed_at: Option<u64>,
}

fn config_path(root: &Path) -> PathBuf {
    root.join(CONFIG_FILE)
}

fn read_config(root: &Path) -> StorageConfig {
    fs::read(config_path(root))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_config(root: &Path, config: &StorageConfig) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let target = config_path(root);
    let temporary = root.join(format!(".{CONFIG_FILE}.tmp"));
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| format!("无法写入存储设置：{error}"))?;
    if let Err(error) = fs::rename(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法保存存储设置：{error}"));
    }
    Ok(())
}

/* --- resolution ----------------------------------------------------------- */

/// The configured files root, if any; relative or empty values are ignored.
pub(crate) fn configured_files_root(root: &Path) -> Option<PathBuf> {
    read_config(root)
        .files_root
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

pub(crate) fn default_files_root(root: &Path) -> PathBuf {
    root.join(DEFAULT_FILES_DIR)
}

/// Where the `files/` tree lives: the configured directory or `<AsterData>/files`.
pub(crate) fn files_root(root: &Path) -> PathBuf {
    configured_files_root(root).unwrap_or_else(|| default_files_root(root))
}

/// `<files root>/papers`, the directory every per-paper folder hangs off.
pub(crate) fn papers_root(root: &Path) -> PathBuf {
    files_root(root).join(PAPERS_DIR)
}

pub(crate) fn is_custom(root: &Path) -> bool {
    configured_files_root(root).is_some()
}

/// Browser-capture download cache: next to the other large files when a custom
/// root is configured, otherwise the historical `A4CaptureData` directory.
pub(crate) fn capture_cache_root(root: &Path, default: PathBuf) -> PathBuf {
    configured_files_root(root)
        .map(|files| files.join(CAPTURE_DIR))
        .unwrap_or(default)
}

/// Both the current and the default papers directory: files bound before a switch
/// without migration still live under the old root.
pub(crate) fn known_papers_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![papers_root(root)];
    let default = default_files_root(root).join(PAPERS_DIR);
    if !same_location(&roots[0], &default) {
        roots.push(default);
    }
    roots
}

/* --- comparison helpers --------------------------------------------------- */

fn normalized(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\");
    let trimmed = text.trim_end_matches('\\');
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn same_location(a: &Path, b: &Path) -> bool {
    normalized(a) == normalized(b)
}

/// `path` is `base` or lies inside it (textual, case-insensitive on Windows).
pub(crate) fn under(path: &Path, base: &Path) -> bool {
    let path = normalized(path);
    let base = normalized(base);
    path == base || path.starts_with(&format!("{base}\\"))
}

/* --- disk facts ----------------------------------------------------------- */

fn nearest_existing(path: &Path) -> Option<PathBuf> {
    path.ancestors().find(|ancestor| ancestor.exists()).map(Path::to_path_buf)
}

/// `(free, total)` bytes of the volume holding `path` (or its nearest existing ancestor).
#[cfg(windows)]
pub(crate) fn disk_space(path: &Path) -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let probe = nearest_existing(path)?;
    let wide: Vec<u16> = probe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free = 0u64;
    let mut total = 0u64;
    let mut total_free = 0u64;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut total_free) };
    (ok != 0).then_some((free, total))
}

#[cfg(not(windows))]
pub(crate) fn disk_space(_path: &Path) -> Option<(u64, u64)> {
    None
}

#[cfg(windows)]
fn drive_letter(path: &Path) -> Option<char> {
    use std::path::Prefix;
    match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => Some((letter as char).to_ascii_uppercase()),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(windows)]
fn system_drive_letter() -> char {
    std::env::var("SystemDrive")
        .ok()
        .and_then(|value| value.chars().next())
        .unwrap_or('C')
        .to_ascii_uppercase()
}

/// `Some(true)` when `path` is on the Windows system drive; `None` off Windows or for UNC paths.
#[cfg(windows)]
pub(crate) fn on_system_drive(path: &Path) -> Option<bool> {
    drive_letter(path).map(|letter| letter == system_drive_letter())
}

#[cfg(not(windows))]
pub(crate) fn on_system_drive(_path: &Path) -> Option<bool> {
    None
}

/// Where a fresh install should keep its files: inside the isolated instance for
/// dev:live, otherwise the roomiest fixed non-system drive (Windows only).
pub(crate) fn recommended_root(root: &Path, isolated: bool) -> Option<PathBuf> {
    if isolated {
        return root.parent().map(|identity| identity.join(ISOLATED_RECOMMENDED_DIR));
    }
    recommended_production_root()
}

#[cfg(windows)]
fn recommended_production_root() -> Option<PathBuf> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    /// `GetDriveTypeW` result for fixed (non-removable, non-network) disks.
    const DRIVE_FIXED: u32 = 3;
    let mask = unsafe { GetLogicalDrives() };
    let system = system_drive_letter();
    let mut best: Option<(u64, char)> = None;
    for index in 0..26u32 {
        if mask & (1 << index) == 0 {
            continue;
        }
        let letter = (b'A' + index as u8) as char;
        if letter == system {
            continue;
        }
        let drive = format!("{letter}:\\");
        let wide: Vec<u16> = drive.encode_utf16().chain(std::iter::once(0)).collect();
        if unsafe { GetDriveTypeW(wide.as_ptr()) } != DRIVE_FIXED {
            continue;
        }
        let free = disk_space(Path::new(&drive)).map(|(free, _)| free).unwrap_or(0);
        if free < RECOMMENDED_MIN_FREE {
            continue;
        }
        if best.map_or(true, |(best_free, _)| free > best_free) {
            best = Some((free, letter));
        }
    }
    best.map(|(_, letter)| PathBuf::from(format!("{letter}:\\A4Note\\files")))
}

#[cfg(not(windows))]
fn recommended_production_root() -> Option<PathBuf> {
    None
}

/// Bytes under `path`, following no symlinks; missing paths count as 0.
pub(crate) fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else { return 0 };
    let mut total = 0;
    for entry in entries.flatten() {
        let Ok(meta) = fs::symlink_metadata(entry.path()) else { continue };
        if meta.file_type().is_symlink() {
            continue;
        }
        total += if meta.is_dir() { dir_size(&entry.path()) } else { meta.len() };
    }
    total
}

/* --- validation ----------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageCandidate {
    pub(crate) path: String,
    pub(crate) on_system_drive: Option<bool>,
    pub(crate) free_bytes: Option<u64>,
    pub(crate) total_bytes: Option<u64>,
}

/// Accept `candidate` as a files root: absolute, no reparse points on the way, not
/// overlapping the data directory, inside the instance for isolated builds and
/// outside AppData for production, creatable and writable.
pub(crate) fn validate_candidate(root: &Path, candidate: &Path, isolated: bool) -> Result<StorageCandidate, String> {
    if !candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("请选择一个绝对路径（不能包含 `.` 或 `..`）。".into());
    }
    if candidate.parent().is_none() {
        return Err("不能直接使用磁盘根目录，请选择或新建一个文件夹，例如 D:\\A4Note\\files。".into());
    }
    crate::dev_environment::safe_path(candidate)
        .map_err(|_| "所选目录经过符号链接或联接点，请选择一个真实目录。".to_string())?;
    if under(candidate, root) || under(root, candidate) {
        return Err("文件存储位置不能位于资料库数据目录内部，也不能包含数据目录。".into());
    }
    if let Some(identity) = root.parent() {
        if isolated && !under(candidate, identity) {
            return Err("隔离实例的文件存储位置必须留在实例目录内（AsterData 的同级目录），不能指向正式资料库或其它位置。".into());
        }
        if !isolated && under(candidate, identity) {
            return Err("请选择应用数据目录（AppData）之外的位置，例如其它磁盘上的文件夹。".into());
        }
    }
    fs::create_dir_all(candidate).map_err(|error| format!("无法创建目录：{error}"))?;
    let probe = candidate.join(format!(".a4note-write-test-{}", uuid::Uuid::new_v4()));
    fs::write(&probe, b"ok").map_err(|error| format!("目录不可写：{error}"))?;
    let _ = fs::remove_file(&probe);
    let (free_bytes, total_bytes) = match disk_space(candidate) {
        Some((free, total)) => (Some(free), Some(total)),
        None => (None, None),
    };
    Ok(StorageCandidate {
        path: path_to_string(candidate),
        on_system_drive: on_system_drive(candidate),
        free_bytes,
        total_bytes,
    })
}

/* --- migration ------------------------------------------------------------ */

static MIGRATING: AtomicBool = AtomicBool::new(false);
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

pub(crate) fn migration_active() -> bool {
    MIGRATING.load(Ordering::Acquire)
}

/// Import and capture entry points refuse new work while files are moving.
pub(crate) fn ensure_not_migrating() -> Result<(), String> {
    if migration_active() {
        Err("文件存储位置正在迁移，请等待迁移完成后再试。".into())
    } else {
        Ok(())
    }
}

pub(crate) fn request_cancel() {
    if migration_active() {
        CANCEL_REQUESTED.store(true, Ordering::Release);
    }
}

struct MigrationGuard;

impl Drop for MigrationGuard {
    fn drop(&mut self) {
        MIGRATING.store(false, Ordering::Release);
        CANCEL_REQUESTED.store(false, Ordering::Release);
    }
}

fn begin_migration() -> Result<MigrationGuard, String> {
    MIGRATING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "已有一次迁移正在进行，请等待其完成。".to_string())?;
    CANCEL_REQUESTED.store(false, Ordering::Release);
    Ok(MigrationGuard)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationProgress {
    pub(crate) phase: String,
    pub(crate) copied_files: u64,
    pub(crate) total_files: u64,
    pub(crate) copied_bytes: u64,
    pub(crate) total_bytes: u64,
    pub(crate) current: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationReport {
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) files_moved: u64,
    pub(crate) bytes_moved: u64,
    pub(crate) database_rows_updated: u64,
    pub(crate) warnings: Vec<String>,
    pub(crate) files_root: String,
    pub(crate) is_custom: bool,
}

struct Entry {
    source: PathBuf,
    relative: PathBuf,
    size: u64,
}

fn collect_files(base: &Path, dir: &Path, entries: &mut Vec<Entry>, total: &mut u64) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| format!("无法读取 {}：{error}", dir.display()))? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let meta = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if meta.file_type().is_symlink() {
            return Err(format!("文件目录中含有符号链接，已停止迁移：{}", path.display()));
        }
        if meta.is_dir() {
            collect_files(base, &path, entries, total)?;
        } else {
            let relative = path
                .strip_prefix(base)
                .map_err(|_| "文件不在迁移目录内".to_string())?
                .to_path_buf();
            *total += meta.len();
            entries.push(Entry { source: path, relative, size: meta.len() });
        }
    }
    Ok(())
}

fn same_content(a: &Path, b: &Path) -> Result<bool, String> {
    let (ma, mb) = (
        fs::metadata(a).map_err(|error| error.to_string())?,
        fs::metadata(b).map_err(|error| error.to_string())?,
    );
    if ma.len() != mb.len() {
        return Ok(false);
    }
    Ok(hash_file(a)? == hash_file(b)?)
}

fn remove_created(created: &[PathBuf], new_papers: &Path) {
    for path in created {
        let _ = fs::remove_file(path);
    }
    remove_empty_dirs(new_papers);
}

/// Remove empty directories bottom-up; `dir` itself goes too when it ends up empty.
fn remove_empty_dirs(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                remove_empty_dirs(&entry.path());
            }
        }
    }
    let _ = fs::remove_dir(dir);
}

fn rebased(suffix: &str, new_papers: &Path) -> PathBuf {
    let mut path = new_papers.to_path_buf();
    for part in suffix.split('/').filter(|part| !part.is_empty()) {
        path.push(part);
    }
    path
}

/// Rewrite every `paper_files.path` under `from` to the same suffix under `to`.
fn rewrite_database_paths(database: &Path, from: &Path, to: &Path) -> Result<u64, String> {
    initialize_database(database)?;
    let mut connection = Connection::open(database).map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let rows: Vec<(String, String)> = {
        let mut statement = transaction
            .prepare("SELECT id, path FROM paper_files")
            .map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?;
        mapped.collect::<Result<_, _>>().map_err(|error| error.to_string())?
    };
    let from_text = path_to_string(from);
    let mut updated = 0;
    for (id, path) in rows {
        if let Some(suffix) = suffix_under(&path, &from_text) {
            let next = path_to_string(&rebased(&suffix, to));
            transaction
                .execute("UPDATE paper_files SET path = ?1 WHERE id = ?2", params![next, id])
                .map_err(|error| error.to_string())?;
            updated += 1;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(updated)
}

fn megabytes(bytes: u64) -> u64 {
    bytes.div_ceil(1024 * 1024)
}

/// Move the `papers` tree from the current files root to `requested` (`None` =
/// back to the default) and switch the configuration. See the module docs for
/// the ordering guarantees.
pub(crate) fn migrate_files_root(
    root: &Path,
    requested: Option<&Path>,
    progress: &dyn Fn(&MigrationProgress),
) -> Result<MigrationReport, String> {
    let _guard = begin_migration()?;
    let _import_guard = crate::library_import::IMPORT_LOCK
        .lock()
        .map_err(|_| "Import lock unavailable".to_string())?;
    let old_files = files_root(root);
    let new_files = requested.map(Path::to_path_buf).unwrap_or_else(|| default_files_root(root));
    let old_papers = old_files.join(PAPERS_DIR);
    let new_papers = new_files.join(PAPERS_DIR);
    let is_custom = requested.is_some();
    let mut report = MigrationReport {
        from: path_to_string(&old_papers),
        to: path_to_string(&new_papers),
        files_moved: 0,
        bytes_moved: 0,
        database_rows_updated: 0,
        warnings: Vec::new(),
        files_root: path_to_string(&new_files),
        is_custom,
    };
    if same_location(&old_files, &new_files) {
        let mut config = read_config(root);
        config.version = 1;
        config.files_root = requested.map(path_to_string);
        write_config(root, &config)?;
        return Ok(report);
    }
    if under(&new_papers, &old_papers) || under(&old_papers, &new_papers) {
        return Err("新旧文件目录互相包含，无法迁移。".into());
    }

    let mut entries = Vec::new();
    let mut total_bytes = 0;
    if old_papers.exists() {
        collect_files(&old_papers, &old_papers, &mut entries, &mut total_bytes)?;
    }
    let total_files = entries.len() as u64;
    fs::create_dir_all(&new_papers).map_err(|error| format!("无法创建目标目录：{error}"))?;
    if let Some((free, _)) = disk_space(&new_papers) {
        if free < total_bytes.saturating_add(FREE_SPACE_MARGIN) {
            return Err(format!(
                "目标磁盘剩余空间不足：需要约 {} MB（含 64 MB 余量），当前可用 {} MB。",
                megabytes(total_bytes.saturating_add(FREE_SPACE_MARGIN)),
                megabytes(free)
            ));
        }
    }
    let emit = |phase: &str, copied_files: u64, copied_bytes: u64, current: Option<&Path>| {
        progress(&MigrationProgress {
            phase: phase.to_string(),
            copied_files,
            total_files,
            copied_bytes,
            total_bytes,
            current: current.map(path_to_string),
        });
    };
    emit("copying", 0, 0, None);

    let mut created: Vec<PathBuf> = Vec::new();
    let mut copied_files = 0;
    let mut copied_bytes = 0;
    let copy_result: Result<(), String> = (|| {
        for entry in &entries {
            if CANCEL_REQUESTED.load(Ordering::Acquire) {
                return Err("迁移已取消，资料库与文件均未改动。".into());
            }
            let destination = new_papers.join(&entry.relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("无法创建目录 {}：{error}", parent.display()))?;
            }
            if destination.exists() {
                if !same_content(&entry.source, &destination)? {
                    return Err(format!("目标位置已存在内容不同的文件，已停止迁移：{}", destination.display()));
                }
            } else {
                fs::copy(&entry.source, &destination)
                    .map_err(|error| format!("复制 {} 失败：{error}", entry.relative.display()))?;
                created.push(destination.clone());
                if !same_content(&entry.source, &destination)? {
                    return Err(format!("复制后校验失败：{}", entry.relative.display()));
                }
            }
            copied_files += 1;
            copied_bytes += entry.size;
            emit("copying", copied_files, copied_bytes, Some(&entry.relative));
        }
        Ok(())
    })();
    if let Err(error) = copy_result {
        remove_created(&created, &new_papers);
        return Err(error);
    }

    emit("database", copied_files, copied_bytes, None);
    let database = root.join("aster.db");
    let updated = match rewrite_database_paths(&database, &old_papers, &new_papers) {
        Ok(count) => count,
        Err(error) => {
            remove_created(&created, &new_papers);
            return Err(format!("更新数据库中的文件路径失败，文件未迁移：{error}"));
        }
    };
    let mut config = read_config(root);
    config.version = 1;
    config.files_root = requested.map(path_to_string);
    if let Err(error) = write_config(root, &config) {
        let _ = rewrite_database_paths(&database, &new_papers, &old_papers);
        remove_created(&created, &new_papers);
        return Err(error);
    }

    emit("cleanup", copied_files, copied_bytes, None);
    for entry in &entries {
        if let Err(error) = fs::remove_file(&entry.source) {
            report.warnings.push(format!("无法删除旧文件 {}：{error}", entry.source.display()));
        }
    }
    if old_papers.exists() {
        remove_empty_dirs(&old_papers);
        if old_papers.exists() {
            report.warnings.push(format!("旧目录 {} 仍有残留内容，未自动删除。", old_papers.display()));
        }
    }
    if !same_location(&old_files, &default_files_root(root)) {
        // A previous custom root is only removed when nothing else lives there.
        let _ = fs::remove_dir(&old_files);
    }
    report.files_moved = copied_files;
    report.bytes_moved = copied_bytes;
    report.database_rows_updated = updated;
    emit("done", copied_files, copied_bytes, None);
    Ok(report)
}

/* --- commands ------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryStorageInfo {
    pub(crate) root: String,
    pub(crate) files_root: String,
    pub(crate) papers_root: String,
    pub(crate) default_files_root: String,
    pub(crate) is_custom: bool,
    pub(crate) free_bytes: Option<u64>,
    pub(crate) total_bytes: Option<u64>,
    pub(crate) files_size_bytes: u64,
    pub(crate) on_system_drive: Option<bool>,
    pub(crate) recommended_root: Option<String>,
    pub(crate) prompt_dismissed: bool,
    pub(crate) isolated: bool,
    pub(crate) migration_active: bool,
    pub(crate) capture_cache_root: String,
}

pub(crate) fn storage_info(root: &Path, isolated: bool) -> LibraryStorageInfo {
    let files = files_root(root);
    let papers = files.join(PAPERS_DIR);
    let config = read_config(root);
    let (free_bytes, total_bytes) = match disk_space(&files) {
        Some((free, total)) => (Some(free), Some(total)),
        None => (None, None),
    };
    let custom = config.files_root.as_deref().map(PathBuf::from).filter(|path| path.is_absolute()).is_some();
    let default_capture = root
        .parent()
        .map(|identity| identity.join("A4CaptureData"))
        .unwrap_or_else(|| root.join("A4CaptureData"));
    LibraryStorageInfo {
        root: path_to_string(root),
        files_root: path_to_string(&files),
        papers_root: path_to_string(&papers),
        default_files_root: path_to_string(&default_files_root(root)),
        is_custom: custom,
        free_bytes,
        total_bytes,
        files_size_bytes: dir_size(&papers),
        on_system_drive: on_system_drive(&files),
        recommended_root: if custom { None } else { recommended_root(root, isolated).map(|path| path_to_string(&path)) },
        prompt_dismissed: config.prompt_dismissed_at.is_some(),
        isolated,
        migration_active: migration_active(),
        capture_cache_root: path_to_string(&capture_cache_root(root, default_capture)),
    }
}

fn isolated(app: &AppHandle) -> bool {
    crate::dev_environment::initialize(app).isolated
}

#[tauri::command]
pub fn get_library_storage(app: AppHandle) -> Result<LibraryStorageInfo, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    Ok(storage_info(&root, isolated(&app)))
}

#[tauri::command]
pub fn validate_library_files_root(app: AppHandle, path: String) -> Result<StorageCandidate, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    validate_candidate(&root, Path::new(path.trim()), isolated(&app))
}

/// Switch the files root; `None` restores the default. With `migrate` the existing
/// tree is moved first, otherwise only new files use the location (existing
/// bindings keep their absolute paths).
#[tauri::command(async)]
pub fn set_library_files_root(app: AppHandle, path: Option<String>, migrate: bool) -> Result<MigrationReport, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let isolated = isolated(&app);
    let requested = match path.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Some(PathBuf::from(validate_candidate(&root, Path::new(value), isolated)?.path)),
        None => None,
    };
    if migrate {
        let handle = app.clone();
        let report_progress = move |progress: &MigrationProgress| {
            let _ = handle.emit(PROGRESS_EVENT, progress);
        };
        return migrate_files_root(&root, requested.as_deref(), &report_progress);
    }
    ensure_not_migrating()?;
    let mut config = read_config(&root);
    config.version = 1;
    config.files_root = requested.as_deref().map(path_to_string);
    write_config(&root, &config)?;
    let files = files_root(&root);
    Ok(MigrationReport {
        from: String::new(),
        to: path_to_string(&files.join(PAPERS_DIR)),
        files_moved: 0,
        bytes_moved: 0,
        database_rows_updated: 0,
        warnings: Vec::new(),
        files_root: path_to_string(&files),
        is_custom: requested.is_some(),
    })
}

#[tauri::command]
pub fn cancel_library_files_root_migration() -> Result<(), String> {
    request_cancel();
    Ok(())
}

#[tauri::command]
pub fn dismiss_library_storage_prompt(app: AppHandle) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let mut config = read_config(&root);
    config.version = 1;
    config.prompt_dismissed_at = Some(crate::database::current_timestamp_ms() as u64);
    write_config(&root, &config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use std::sync::Mutex;

    // Migrations share process-wide state; keep the tests that run one sequential.
    static SERIAL: Mutex<()> = Mutex::new(());

    struct Fixture {
        base: PathBuf,
        root: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!("a4-storage-{tag}-{}", uuid::Uuid::new_v4()));
            let root = base.join("app.aster.research").join("AsterData");
            fs::create_dir_all(&root).unwrap();
            Self { base, root }
        }

        fn seed_paper(&self, paper: &str, files: &[(&str, &[u8])]) -> Vec<String> {
            let database = self.root.join("aster.db");
            initialize_database(&database).unwrap();
            let connection = Connection::open(&database).unwrap();
            connection
                .execute(
                    "INSERT INTO papers (id,title,authors,year,venue,doi,status,folder_id,created_at,updated_at) VALUES (?1,?1,'',2026,'','','unread','library',1,1)",
                    params![paper],
                )
                .unwrap();
            let paper_dir = papers_root(&self.root).join(paper);
            fs::create_dir_all(&paper_dir).unwrap();
            let mut paths = Vec::new();
            for (index, (name, bytes)) in files.iter().enumerate() {
                let mut path = paper_dir.clone();
                for component in Path::new(name).components() {
                    path.push(component);
                }
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).unwrap();
                }
                fs::write(&path, bytes).unwrap();
                let text = path_to_string(&path);
                connection
                    .execute(
                        "INSERT INTO paper_files (id,paper_id,type,path,language,created_at) VALUES (?1,?2,'source_pdf',?3,'',?4)",
                        params![format!("file-{paper}-{index}"), paper, text, 1],
                    )
                    .unwrap();
                paths.push(text);
            }
            paths
        }

        fn database_paths(&self) -> Vec<String> {
            let connection = Connection::open(self.root.join("aster.db")).unwrap();
            let mut statement = connection.prepare("SELECT path FROM paper_files ORDER BY id").unwrap();
            let rows = statement.query_map([], |row| row.get::<_, String>(0)).unwrap();
            rows.map(Result::unwrap).collect()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    #[test]
    fn default_root_is_files_under_aster_data_and_config_roundtrips() {
        let fixture = Fixture::new("default");
        assert_eq!(files_root(&fixture.root), fixture.root.join("files"));
        assert_eq!(papers_root(&fixture.root), fixture.root.join("files").join("papers"));
        assert!(!is_custom(&fixture.root));
        let external = fixture.base.join("external");
        write_config(&fixture.root, &StorageConfig { version: 1, files_root: Some(path_to_string(&external)), prompt_dismissed_at: None }).unwrap();
        assert_eq!(files_root(&fixture.root), external);
        assert!(is_custom(&fixture.root));
        assert_eq!(capture_cache_root(&fixture.root, PathBuf::from("default")), external.join("capture"));
        // Relative values are ignored rather than trusted.
        write_config(&fixture.root, &StorageConfig { version: 1, files_root: Some("relative/dir".into()), prompt_dismissed_at: None }).unwrap();
        assert_eq!(files_root(&fixture.root), fixture.root.join("files"));
        assert_eq!(known_papers_roots(&fixture.root).len(), 1);
    }

    #[test]
    fn validation_rejects_relative_root_overlap_and_appdata_but_accepts_external() {
        let fixture = Fixture::new("validate");
        assert!(validate_candidate(&fixture.root, Path::new("relative"), false).is_err());
        assert!(validate_candidate(&fixture.root, &fixture.root.join("inside"), false).unwrap_err().contains("数据目录"));
        assert!(validate_candidate(&fixture.root, &fixture.base, false).unwrap_err().contains("数据目录"));
        // Inside the identity dir is AppData for production, but exactly where an isolated instance must stay.
        let sibling = fixture.root.parent().unwrap().join("A4NoteFiles");
        assert!(validate_candidate(&fixture.root, &sibling, false).unwrap_err().contains("AppData"));
        assert_eq!(validate_candidate(&fixture.root, &sibling, true).unwrap().path, path_to_string(&sibling));
        assert!(sibling.is_dir(), "validation creates the directory and probes it");
        let external = fixture.base.join("elsewhere").join("files");
        let accepted = validate_candidate(&fixture.root, &external, false).unwrap();
        assert_eq!(accepted.path, path_to_string(&external));
        assert!(validate_candidate(&fixture.root, &external, true).unwrap_err().contains("隔离实例"));
        assert_eq!(recommended_root(&fixture.root, true), Some(sibling));
    }

    #[test]
    fn migration_moves_files_rewrites_paths_and_can_return_to_default() {
        let _serial = SERIAL.lock().unwrap();
        let fixture = Fixture::new("migrate");
        let original = fixture.seed_paper("paper-a", &[("source.pdf", b"%PDF-a"), ("captures/c1/x.pdf", b"%PDF-c"), ("总结.md", "# 摘要".as_bytes())]);
        fixture.seed_paper("paper-b", &[("translated.zh.file-1.pdf", b"%PDF-t")]);
        let external = fixture.base.join("D-drive").join("A4Note").join("files");
        let phases = std::cell::RefCell::new(Vec::new());
        let report = migrate_files_root(&fixture.root, Some(&external), &|progress| phases.borrow_mut().push(progress.phase.clone())).unwrap();
        let phases = phases.into_inner();
        assert_eq!(report.files_moved, 4);
        assert_eq!(report.database_rows_updated, 4);
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
        assert!(phases.contains(&"copying".to_string()) && phases.last() == Some(&"done".to_string()));
        assert_eq!(files_root(&fixture.root), external);
        assert!(external.join("papers").join("paper-a").join("captures").join("c1").join("x.pdf").is_file());
        assert!(!fixture.root.join("files").join("papers").exists(), "old tree removed");
        for path in fixture.database_paths() {
            assert!(under(Path::new(&path), &external.join("papers")), "{path}");
            assert!(Path::new(&path).is_file(), "{path}");
        }
        assert!(!fixture.database_paths().iter().any(|path| original.contains(path)));
        // And back to the default location.
        let report = migrate_files_root(&fixture.root, None, &|_| {}).unwrap();
        assert_eq!(report.files_moved, 4);
        assert!(!is_custom(&fixture.root));
        assert!(fixture.root.join("files").join("papers").join("paper-b").join("translated.zh.file-1.pdf").is_file());
        assert!(!external.exists(), "empty custom root is removed");
        assert_eq!(fixture.database_paths(), original.iter().cloned().chain(std::iter::once(path_to_string(&fixture.root.join("files").join("papers").join("paper-b").join("translated.zh.file-1.pdf")))).collect::<Vec<_>>());
    }

    #[test]
    fn migration_refuses_conflicts_and_cancellation_without_touching_the_database() {
        let _serial = SERIAL.lock().unwrap();
        let fixture = Fixture::new("conflict");
        let original = fixture.seed_paper("paper-a", &[("source.pdf", b"%PDF-a"), ("notes.pdf", b"%PDF-n")]);
        let external = fixture.base.join("external");
        let clash = external.join("papers").join("paper-a").join("source.pdf");
        fs::create_dir_all(clash.parent().unwrap()).unwrap();
        fs::write(&clash, b"%PDF-different").unwrap();
        let error = migrate_files_root(&fixture.root, Some(&external), &|_| {}).unwrap_err();
        assert!(error.contains("内容不同"), "{error}");
        assert_eq!(fixture.database_paths(), original);
        assert!(!is_custom(&fixture.root));
        assert!(fixture.root.join("files").join("papers").join("paper-a").join("notes.pdf").is_file());
        assert_eq!(fs::read(&clash).unwrap(), b"%PDF-different");
        fs::remove_dir_all(&external).unwrap();
        // Cancelling mid-copy removes the partial copy and keeps everything else.
        let error = migrate_files_root(&fixture.root, Some(&external), &|progress| {
            if progress.copied_files == 1 {
                CANCEL_REQUESTED.store(true, Ordering::Release);
            }
        })
        .unwrap_err();
        assert!(error.contains("取消"), "{error}");
        assert_eq!(fixture.database_paths(), original);
        assert!(!external.join("papers").join("paper-a").exists());
        assert!(!migration_active());
        assert!(original.iter().all(|path| Path::new(path).is_file()));
    }

    #[test]
    fn switching_without_migration_keeps_old_bindings_and_reports_both_roots() {
        let _serial = SERIAL.lock().unwrap();
        let fixture = Fixture::new("switch");
        let original = fixture.seed_paper("paper-a", &[("source.pdf", b"%PDF-a")]);
        let external = fixture.base.join("external");
        write_config(&fixture.root, &StorageConfig { version: 1, files_root: Some(path_to_string(&external)), prompt_dismissed_at: None }).unwrap();
        assert_eq!(fixture.database_paths(), original);
        assert!(Path::new(&original[0]).is_file());
        let roots = known_papers_roots(&fixture.root);
        assert_eq!(roots, vec![external.join("papers"), fixture.root.join("files").join("papers")]);
        let info = storage_info(&fixture.root, false);
        assert!(info.is_custom);
        assert_eq!(info.files_root, path_to_string(&external));
        assert!(info.recommended_root.is_none(), "no recommendation once a root is chosen");
    }
}
