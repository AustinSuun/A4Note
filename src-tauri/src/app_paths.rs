//! The app data root and the desktop actions on a path (P2-1).
//!
//! Every library command starts here: `AsterData/` is resolved from Tauri's app
//! data dir, and the older `aster.db` / `files/papers` names are kept so an
//! existing install keeps its library. Revealing and opening live here too,
//! because they are the only places that hand a path to the desktop shell.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::database::initialize_database;
use crate::guide::seed_default_guide;

#[derive(Debug, Serialize)]
pub(crate) struct AsterPaths {
    pub(crate) root: String,
    pub(crate) database: String,
    pub(crate) files_root: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RevealPathRequest {
    pub(crate) kind: String,
}

#[tauri::command]
pub fn get_aster_paths(app: AppHandle) -> Result<AsterPaths, String> {
    let _access = crate::library_access::operation()?;
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

/// First-run schema setup and guide seeding perform SQLite and file I/O.
/// Scheduling the command keeps the first window responsive while it runs.
#[tauri::command(async)]
pub fn initialize_library(app: AppHandle) -> Result<AsterPaths, String> {
    let _access = crate::library_access::operation()?;
    let paths = get_aster_paths(app)?;
    let database = Path::new(&paths.database);
    initialize_database(database)?;
    seed_default_guide(Path::new(&paths.root), database)?;
    Ok(paths)
}

#[tauri::command]
pub fn reveal_aster_path(app: AppHandle, request: RevealPathRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let paths = get_aster_paths(app)?;
    let target = match request.kind.as_str() {
        "root" => PathBuf::from(paths.root),
        "files" => PathBuf::from(paths.files_root),
        "backups" => PathBuf::from(paths.root).join("backups"),
        "database" => {
            let database = PathBuf::from(paths.database);
            database.parent().map(Path::to_path_buf).unwrap_or(database)
        }
        _ => return Err("未知的资料库路径类型".to_string()),
    };
    fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    open_path_in_file_manager(&target)
}

pub(crate) fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let root = base.join("AsterData");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

pub(crate) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub(crate) fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
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
            .map_err(|error| format!("Failed to open path: {error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open path: {error}"))?;
        return Ok(());
    }
}

pub(crate) fn open_file_with_default_app(path: &Path) -> Result<(), String> {
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

pub(crate) fn open_external_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://") || trimmed.starts_with("mailto:"))
        || trimmed.chars().any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("只允许打开 http、https 或 mailto 链接".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", trimmed])
            .spawn()
            .map_err(|error| format!("无法打开链接：{error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(trimmed).spawn().map_err(|error| format!("无法打开链接：{error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(trimmed).spawn().map_err(|error| format!("无法打开链接：{error}"))?;
        return Ok(());
    }
}
