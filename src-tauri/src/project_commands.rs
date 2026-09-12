//! Tauri's side of the project workspace commands (RES-0 / RES-1 / RES-3).
//!
//! Wrappers only. Each one resolves the user's path through `workspace_fs`
//! first, so a request can never name a path that does not exist, and the logic
//! and its tests stay in that module where no Tauri handle is needed.

use std::path::Path;

use crate::app_paths::{open_file_with_default_app, open_path_in_file_manager};
use crate::workspace_fs;

#[tauri::command]
pub fn describe_project_folder(
    request: workspace_fs::PathRequest,
) -> workspace_fs::ProjectFolderInfo {
    workspace_fs::describe_project_folder(&request.path)
}

#[tauri::command]
pub fn list_directory_entries(
    request: workspace_fs::ListDirectoryRequest,
) -> Result<workspace_fs::DirectoryListing, String> {
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    workspace_fs::read_directory(&path, request.include_hidden)
}

#[tauri::command]
pub fn reveal_path(request: workspace_fs::PathRequest) -> Result<(), String> {
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    let target = if path.is_dir() {
        path
    } else {
        path.parent().map(Path::to_path_buf).unwrap_or(path)
    };
    open_path_in_file_manager(&target)
}

#[tauri::command]
pub fn open_path_external(request: workspace_fs::PathRequest) -> Result<(), String> {
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    open_file_with_default_app(&path)
}

#[tauri::command]
pub fn open_path_in_vscode(request: workspace_fs::PathRequest) -> Result<(), String> {
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    workspace_fs::launch_vscode(&path)
}

#[tauri::command]
pub fn open_external_url(request: workspace_fs::PathRequest) -> Result<(), String> {
    crate::app_paths::open_external_url(&request.path)
}

#[tauri::command]
pub fn read_text_file_preview(
    request: workspace_fs::PathRequest,
) -> Result<workspace_fs::TextFilePreview, String> {
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    workspace_fs::read_text_preview(&path)
}

#[tauri::command]
pub fn read_text_file(
    request: workspace_fs::PathRequest,
) -> Result<workspace_fs::TextFileContent, String> {
    let _access = crate::library_access::operation()?;
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    workspace_fs::read_text_file(&path)
}

#[tauri::command]
pub fn write_text_file(request: workspace_fs::WriteTextFileRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    match request.expected_content.as_deref() {
        Some(expected) => workspace_fs::write_text_file_checked(&path, &request.content, Some(expected)),
        None => workspace_fs::write_text_file(&path, &request.content),
    }
}

#[tauri::command]
pub fn rename_text_file(
    request: workspace_fs::RenameTextFileRequest,
) -> Result<workspace_fs::RenamedTextFile, String> {
    let _access = crate::library_access::operation()?;
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    workspace_fs::rename_text_file(&path, &request.new_name)
}

#[tauri::command]
pub fn move_path(
    request: workspace_fs::MovePathRequest,
) -> Result<workspace_fs::MovedPath, String> {
    let _access = crate::library_access::operation()?;
    workspace_fs::move_path(&request.source_path, &request.destination_directory)
}

#[tauri::command]
pub fn create_text_file(request: workspace_fs::CreateTextFileRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    workspace_fs::create_text_file(&request.path, &request.content)
}

#[tauri::command]
pub fn create_directory(request: workspace_fs::CreateDirectoryRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    workspace_fs::create_directory(&request.path, &request.name)
}

#[tauri::command]
pub fn delete_text_file(request: workspace_fs::PathRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    workspace_fs::delete_text_file(&request.path)
}

/// Whole-file bytes for a viewer that parses them itself — PDF-0's resource PDF
/// tab. Async because a large file would otherwise block the main thread while
/// it is read.
#[tauri::command(async)]
pub fn read_file_bytes(request: workspace_fs::PathRequest) -> Result<Vec<u8>, String> {
    let _access = crate::library_access::operation()?;
    let path = workspace_fs::resolve_existing_path(&request.path)?;
    workspace_fs::read_file_bytes(&path)
}

/// CLI version probes may start npm shims and wait on disk/process I/O. Keep
/// that work away from Tauri's UI thread so the first window remains responsive.
#[tauri::command(async)]
pub fn detect_agent_cli(
    request: workspace_fs::DetectAgentCliRequest,
) -> workspace_fs::AgentCliStatus {
    workspace_fs::detect_cli(&request.command)
}

#[tauri::command(async)]
pub fn run_project_command(
    request: workspace_fs::RunProjectCommandRequest,
) -> Result<workspace_fs::CommandResult, String> {
    workspace_fs::run_project_command(&request)
}

#[tauri::command]
pub fn rename_directory(request: workspace_fs::RenameDirectoryRequest) -> Result<workspace_fs::RenamedTextFile, String> {
    let _access = crate::library_access::operation()?;
    workspace_fs::rename_directory(&request.root_path, &request.path, &request.new_name)
}
#[tauri::command]
pub fn delete_empty_directory(request: workspace_fs::DirectoryPathRequest) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    workspace_fs::delete_empty_directory(&request.root_path, &request.path)
}
