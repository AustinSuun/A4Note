//! Project workspace filesystem access (RES-0 / RES-1 / RES-3) and agent CLI detection.
//!
//! Every command takes an absolute path chosen by the user through the folder
//! picker. Nothing here writes to the user's files: listing, revealing and
//! opening only. Reads are shallow so a large tree can be expanded lazily.
#[path = "text_file_io.rs"]
pub(crate) mod text_file_io;

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// `cmd.exe` is needed for npm-installed CLI shims on Windows, but it must not
/// create a visible console while A4Note is checking whether a provider exists.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Directories that would flood the tree with generated content.
const IGNORED_DIRECTORY_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    ".venv",
    "__pycache__",
];

const MAX_DIRECTORY_ENTRIES: usize = 2000;

/// A file tab only needs enough text to look at, never the whole file.
const MAX_TEXT_PREVIEW_BYTES: usize = 256 * 1024;

/// A whole-file read crosses the IPC boundary as one buffer, so a mistakenly
/// picked disk image has to be refused instead of being copied into the webview.
/// PDF-0's real documents are far below this.
const MAX_FILE_BYTES: u64 = 96 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct PathRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct WriteTextFileRequest {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub expected_content: Option<String>,
}

pub type CreateTextFileRequest = WriteTextFileRequest;

#[derive(Debug, Deserialize)]
pub struct CreateDirectoryRequest {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameTextFileRequest {
    pub path: String,
    pub new_name: String,
}

#[derive(Debug, Deserialize)]
pub struct MovePathRequest {
    pub source_path: String,
    pub destination_directory: String,
}

#[derive(Debug, Serialize)]
pub struct RenamedTextFile {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct MovedPath {
    pub source_path: String,
    pub path: String,
    pub name: String,
    pub is_directory: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListDirectoryRequest {
    pub path: String,
    #[serde(default)]
    pub include_hidden: bool,
}

#[derive(Debug, Serialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub extension: String,
    /// Milliseconds since the Unix epoch. Optional because some filesystems do
    /// not expose one of these timestamps.
    pub modified_at: Option<u64>,
    pub created_at: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<DirectoryEntry>,
    /// True when the directory held more than `MAX_DIRECTORY_ENTRIES` children.
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct ProjectFolderInfo {
    pub path: String,
    pub name: String,
    pub exists: bool,
    pub is_directory: bool,
}

#[derive(Debug, Serialize)]
pub struct TextFilePreview {
    pub path: String,
    pub content: String,
    pub byte_length: u64,
    /// True when the file is longer than `MAX_TEXT_PREVIEW_BYTES`.
    pub truncated: bool,
    /// True when a NUL byte turned up, in which case `content` stays empty.
    pub binary: bool,
}

#[derive(Debug, Serialize)]
pub struct TextFileContent {
    pub path: String,
    pub content: String,
    pub byte_length: u64,
    pub binary: bool,
}

#[derive(Debug, Deserialize)]
pub struct DetectAgentCliRequest {
    pub command: String,
}

#[derive(Debug, Deserialize)]
pub struct RunProjectCommandRequest {
    pub cwd: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AgentCliStatus {
    pub command: String,
    pub available: bool,
    pub executable_path: String,
    pub version: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
pub struct CommandResult {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

pub fn run_project_command(request: &RunProjectCommandRequest) -> Result<CommandResult, String> {
    let cwd = resolve_existing_path(&request.cwd)?;
    if !cwd.is_dir() {
        return Err("终端工作目录必须是文件夹".to_string());
    }
    let command = request.command.trim();
    if command.is_empty() || command.contains([';', '&', '|', '`', '\n', '\r']) {
        return Err("命令必须是单独的可执行文件名，不能包含 shell 运算符".to_string());
    }
    let output = Command::new(command)
        .args(&request.args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("无法启动命令：{error}"))?;
    Ok(CommandResult {
        status: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout)
            .chars()
            .take(262_144)
            .collect(),
        stderr: String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(262_144)
            .collect(),
    })
}

pub fn resolve_existing_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("路径为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("必须使用绝对路径".to_string());
    }
    if !path.exists() {
        return Err(format!("路径不存在：{trimmed}"));
    }
    Ok(path)
}

pub fn describe_project_folder(raw: &str) -> ProjectFolderInfo {
    let path = PathBuf::from(raw.trim());
    let exists = path.exists();
    ProjectFolderInfo {
        name: folder_display_name(&path),
        path: path.to_string_lossy().to_string(),
        is_directory: exists && path.is_dir(),
        exists,
    }
}

fn folder_display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

pub fn is_ignored_directory(name: &str) -> bool {
    IGNORED_DIRECTORY_NAMES.contains(&name)
}

pub fn read_directory(path: &Path, include_hidden: bool) -> Result<DirectoryListing, String> {
    if !path.is_dir() {
        return Err(format!("不是文件夹：{}", path.to_string_lossy()));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in fs::read_dir(path).map_err(|error| format!("无法读取文件夹：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取目录项：{error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !include_hidden && name.starts_with('.') {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let is_directory = file_type.is_dir();
        if is_directory && is_ignored_directory(&name) {
            continue;
        }
        if entries.len() >= MAX_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }
        let entry_path = entry.path();
        let metadata = entry.metadata().ok();
        entries.push(DirectoryEntry {
            extension: entry_extension(&entry_path, is_directory),
            size: if is_directory {
                0
            } else {
                metadata.as_ref().map(|meta| meta.len()).unwrap_or(0)
            },
            modified_at: metadata.as_ref().and_then(|meta| system_time_millis(meta.modified().ok()?)),
            created_at: metadata.as_ref().and_then(|meta| system_time_millis(meta.created().ok()?)),
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory,
        });
    }
    entries.sort_by(compare_entries);
    Ok(DirectoryListing {
        path: path.to_string_lossy().to_string(),
        entries,
        truncated,
    })
}

fn system_time_millis(value: SystemTime) -> Option<u64> {
    value.duration_since(UNIX_EPOCH).ok().map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
}

fn entry_extension(path: &Path, is_directory: bool) -> String {
    if is_directory {
        return String::new();
    }
    path.extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Folders first, then case-insensitive name order, so the tree reads like an explorer.
fn compare_entries(left: &DirectoryEntry, right: &DirectoryEntry) -> Ordering {
    match right.is_directory.cmp(&left.is_directory) {
        Ordering::Equal => left
            .name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name)),
        other => other,
    }
}

/// Reads the head of a file so a file tab can show something without loading
/// the whole thing. Binary files report `binary` instead of garbled text.
pub fn read_text_preview(path: &Path) -> Result<TextFilePreview, String> {
    if !path.is_file() {
        return Err(format!("不是文件：{}", path.to_string_lossy()));
    }
    let byte_length = fs::metadata(path)
        .map(|meta| meta.len())
        .map_err(|error| format!("无法读取文件信息：{error}"))?;
    let file = fs::File::open(path).map_err(|error| format!("无法打开文件：{error}"))?;
    let mut bytes = Vec::new();
    file.take(MAX_TEXT_PREVIEW_BYTES as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取文件：{error}"))?;
    let binary = bytes.contains(&0);
    let truncated = !binary && (bytes.len() as u64) < byte_length;
    Ok(TextFilePreview {
        path: path.to_string_lossy().to_string(),
        content: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&bytes).to_string()
        },
        byte_length,
        truncated,
        binary,
    })
}

/// Reads a complete Markdown document for source editing. The size limit keeps
/// an accidental binary or generated file from blocking the webview.
pub fn read_text_file(path: &Path) -> Result<TextFileContent, String> {
    if !path.is_file() {
        return Err(format!("不是文件：{}", path.to_string_lossy()));
    }
    let byte_length = fs::metadata(path)
        .map(|meta| meta.len())
        .map_err(|error| format!("无法读取文件信息：{error}"))?;
    const MAX_EDITABLE_TEXT_BYTES: u64 = 16 * 1024 * 1024;
    if byte_length > MAX_EDITABLE_TEXT_BYTES {
        return Err(format!("文件过大，无法作为 Markdown 编辑：{} MB", byte_length / (1024 * 1024)));
    }
    let bytes = fs::read(path).map_err(|error| format!("无法读取文件：{error}"))?;
    let binary = bytes.contains(&0);
    Ok(TextFileContent {
        path: path.to_string_lossy().to_string(),
        content: if binary { String::new() } else { String::from_utf8(bytes).map_err(|_| "不是有效的 UTF-8 文本，已拒绝有损读取".to_string())? },
        byte_length,
        binary,
    })
}

/// Reads a whole file for a viewer that needs the bytes themselves (PDF-0's
/// resource-backed PDF tab). Unlike `read_text_preview` this must not truncate —
/// half a PDF is not a PDF — so an oversized file is refused with its size
/// instead of being silently cut.
pub fn read_file_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if !path.is_file() {
        return Err(format!("不是文件：{}", path.to_string_lossy()));
    }
    let byte_length = fs::metadata(path)
        .map(|meta| meta.len())
        .map_err(|error| format!("无法读取文件信息：{error}"))?;
    if byte_length > MAX_FILE_BYTES {
        return Err(format!(
            "文件过大，无法打开：{} MB（上限 {} MB）",
            byte_length / (1024 * 1024),
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    fs::read(path).map_err(|error| format!("无法读取文件：{error}"))
}

pub fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    write_text_file_checked(path, content, None)
}

pub fn write_text_file_checked(path: &Path, content: &str, expected: Option<&str>) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("不是文件：{}", path.to_string_lossy()));
    }
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("文本文件过大，无法保存".to_string());
    }
    text_file_io::atomic_write(path, content, expected)
}

/// Renames a user-selected Markdown file without allowing a title to escape its
/// current folder or replace an existing file.
pub fn rename_text_file(path: &Path, new_name: &str) -> Result<RenamedTextFile, String> {
    let _guard = text_file_io::lock()?;
    if !path.is_file() {
        return Err(format!("不是文件：{}", path.to_string_lossy()));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| matches!(value.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdx"))
        .ok_or_else(|| "只能重命名 Markdown 文件".to_string())?;
    let stem = new_name.trim().trim_matches('.');
    if stem.is_empty() || stem.len() > 120 || stem == "." || stem == ".." {
        return Err("文件标题无效".to_string());
    }
    if stem.chars().any(|value| matches!(value, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\u{1f}')) {
        return Err("文件标题包含系统不支持的字符".to_string());
    }
    let parent = path.parent().ok_or_else(|| "无法确定文件所在目录".to_string())?;
    let target = parent.join(format!("{stem}.{extension}"));
    if target == path {
        return Ok(RenamedTextFile {
            path: path.to_string_lossy().to_string(),
            name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
        });
    }
    if target.exists() {
        return Err("同名文件已存在，未覆盖原文件".to_string());
    }
    fs::rename(path, &target).map_err(|error| format!("无法重命名文件：{error}"))?;
    Ok(RenamedTextFile {
        path: target.to_string_lossy().to_string(),
        name: target.file_name().unwrap_or_default().to_string_lossy().to_string(),
    })
}

/// Moves a file or directory into an existing destination directory without
/// replacing an existing entry. Directory moves reject descendants to prevent
/// accidentally moving a folder into itself.
pub fn move_path(raw_source: &str, raw_destination_directory: &str) -> Result<MovedPath, String> {
    let _guard = text_file_io::lock()?;
    let source = resolve_existing_path(raw_source)?;
    let destination_directory = resolve_existing_path(raw_destination_directory)?;
    if !destination_directory.is_dir() {
        return Err("目标位置必须是文件夹".to_string());
    }

    let source_canonical = fs::canonicalize(&source).map_err(|error| format!("无法确定源路径：{error}"))?;
    let destination_canonical = fs::canonicalize(&destination_directory).map_err(|error| format!("无法确定目标文件夹：{error}"))?;
    if source_canonical == destination_canonical {
        return Err("不能将项目移动到自身".to_string());
    }
    if source.is_dir() && destination_canonical.starts_with(&source_canonical) {
        return Err("不能将文件夹移动到自身或子文件夹中".to_string());
    }

    let name = source
        .file_name()
        .ok_or_else(|| "无法确定要移动的项目名称".to_string())?
        .to_string_lossy()
        .to_string();
    let is_directory = source.is_dir();
    let target = destination_directory.join(&name);
    if target.exists() {
        return Err("目标文件夹中已存在同名项目，未覆盖原文件".to_string());
    }
    fs::rename(&source, &target).map_err(|error| format!("无法移动项目：{error}"))?;
    Ok(MovedPath {
        source_path: source.to_string_lossy().to_string(),
        path: target.to_string_lossy().to_string(),
        name,
        is_directory,
    })
}

pub fn create_text_file(raw_path: &str, content: &str) -> Result<(), String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("必须使用绝对路径".to_string());
    }
    let parent = path.parent().ok_or_else(|| "文件目录无效".to_string())?;
    if !parent.is_dir() {
        return Err(format!("目录不存在：{}", parent.to_string_lossy()));
    }
    if path.exists() {
        return Err(format!("文件已存在：{}", path.to_string_lossy()));
    }
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("文本文件过大，无法创建".to_string());
    }
    fs::write(&path, content.as_bytes()).map_err(|error| format!("无法创建文件：{error}"))
}

pub fn create_directory(raw_parent: &str, raw_name: &str) -> Result<(), String> {
    let parent = resolve_existing_path(raw_parent)?;
    if !parent.is_dir() {
        return Err("父路径不是文件夹".to_string());
    }
    let name = raw_name.trim().trim_matches('.');
    if name.is_empty() || name.len() > 120 || name == "." || name == ".." {
        return Err("文件夹名称无效".to_string());
    }
    if name.chars().any(|value| matches!(value, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\u{1f}')) {
        return Err("文件夹名称包含系统不支持的字符".to_string());
    }
    let target = parent.join(name);
    if target.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    fs::create_dir(&target).map_err(|error| format!("无法创建文件夹：{error}"))
}

pub fn delete_text_file(raw_path: &str) -> Result<(), String> {
    let _guard = text_file_io::lock()?;
    let path = resolve_existing_path(raw_path)?;
    if !path.is_file() {
        return Err("只能删除文件，不能删除文件夹".to_string());
    }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown" | "mdx") {
        return Err("Markdown 场景只能删除 Markdown 文件".to_string());
    }
    fs::remove_file(&path).map_err(|error| format!("无法删除文件：{error}"))
}

/// VS Code ships as a shell script on Unix and a `.cmd` shim on Windows, so the
/// launcher has to go through the shell rather than exec the name directly.
pub fn launch_vscode(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "code", &path.to_string_lossy()])
            .spawn()
            .map_err(|error| format!("无法启动 VS Code：{error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("code")
            .arg(path)
            .spawn()
            .map_err(|error| format!("无法启动 VS Code：{error}"))?;
        return Ok(());
    }
}

pub fn detect_cli(command: &str) -> AgentCliStatus {
    let name = command.trim().to_string();
    if name.is_empty() || !name.chars().all(is_safe_command_char) {
        return AgentCliStatus {
            command: name,
            available: false,
            executable_path: String::new(),
            version: String::new(),
            error: "命令名不合法".to_string(),
        };
    }
    let located = locate_executable(&name);
    let Some(executable_path) = located else {
        return AgentCliStatus {
            command: name,
            available: false,
            executable_path: String::new(),
            version: String::new(),
            error: "未在 PATH 中找到该命令".to_string(),
        };
    };
    let (version, error) = probe_version(&name);
    AgentCliStatus {
        command: name,
        available: true,
        executable_path,
        version,
        error,
    }
}

/// The command name is used to build a process invocation, so keep it to a
/// literal executable name and reject anything a shell could reinterpret.
fn is_safe_command_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '-' || value == '_' || value == '.'
}

fn locate_executable(name: &str) -> Option<String> {
    let path_variable = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_variable) {
        for candidate in executable_candidates(name) {
            let full = directory.join(&candidate);
            if full.is_file() {
                return Some(full.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn executable_candidates(name: &str) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let extensions =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        let mut candidates = vec![name.to_string()];
        for extension in extensions.split(';') {
            let extension = extension.trim();
            if extension.is_empty() {
                continue;
            }
            candidates.push(format!("{name}{}", extension.to_lowercase()));
        }
        candidates
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec![name.to_string()]
    }
}

fn probe_version(name: &str) -> (String, String) {
    let mut command = version_command(name);
    match command.output() {
        Ok(output) => {
            let text = if output.stdout.is_empty() {
                String::from_utf8_lossy(&output.stderr).to_string()
            } else {
                String::from_utf8_lossy(&output.stdout).to_string()
            };
            (first_line(&text), String::new())
        }
        Err(error) => (String::new(), format!("无法读取版本：{error}")),
    }
}

fn version_command(name: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        command.args(["/C", name, "--version"]);
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut command = Command::new(name);
        command.arg("--version");
        command
    }
}

fn first_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_and_missing_paths() {
        assert!(resolve_existing_path("  ").is_err());
        assert!(resolve_existing_path("relative/dir").is_err());
        assert!(resolve_existing_path("/definitely/not/here/aster-test").is_err());
    }

    #[test]
    fn lists_directories_before_files_and_skips_noise() {
        let root = std::env::temp_dir().join(format!("aster-fs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("zeta")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join("alpha.md"), b"# alpha").unwrap();
        fs::write(root.join("Beta.PDF"), b"%PDF").unwrap();

        let listing = read_directory(&root, false).unwrap();
        let names: Vec<String> = listing
            .entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect();
        assert_eq!(names, vec!["zeta", "alpha.md", "Beta.PDF"]);
        assert!(!listing.truncated);
        assert!(listing.entries[0].is_directory);
        assert_eq!(listing.entries[2].extension, "pdf");

        let with_hidden = read_directory(&root, true).unwrap();
        let hidden_names: Vec<String> = with_hidden
            .entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect();
        assert!(hidden_names.contains(&".hidden".to_string()));
        assert!(!hidden_names.contains(&"node_modules".to_string()));

        let file_listing = read_directory(&root.join("alpha.md"), false);
        assert!(file_listing.is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn describes_folders_without_touching_disk() {
        let info = describe_project_folder("/tmp/aster-does-not-exist");
        assert_eq!(info.name, "aster-does-not-exist");
        assert!(!info.exists);
        assert!(!info.is_directory);
    }

    #[test]
    fn previews_text_and_flags_binary_files() {
        let root = std::env::temp_dir().join(format!("aster-preview-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let text_path = root.join("note.md");
        fs::write(&text_path, "# 标题\n正文".as_bytes()).unwrap();
        let preview = read_text_preview(&text_path).unwrap();
        assert_eq!(preview.content, "# 标题\n正文");
        assert!(!preview.binary);
        assert!(!preview.truncated);
        assert_eq!(preview.byte_length, "# 标题\n正文".len() as u64);

        let binary_path = root.join("blob.bin");
        fs::write(&binary_path, [0x50, 0x00, 0x4b]).unwrap();
        let binary_preview = read_text_preview(&binary_path).unwrap();
        assert!(binary_preview.binary);
        assert!(binary_preview.content.is_empty());

        assert!(read_text_preview(&root).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_whole_files_and_refuses_directories() {
        let root = std::env::temp_dir().join(format!("aster-bytes-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let pdf_path = root.join("doc.pdf");
        let payload: Vec<u8> = (0u8..=255).collect();
        fs::write(&pdf_path, &payload).unwrap();

        // Whole file, byte for byte: a truncated PDF would not open at all.
        assert_eq!(read_file_bytes(&pdf_path).unwrap(), payload);
        assert!(read_file_bytes(&root).is_err());
        assert!(read_file_bytes(&root.join("missing.pdf")).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn deletes_only_markdown_files() {
        let root = std::env::temp_dir().join(format!("aster-delete-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let note = root.join("note.md");
        fs::write(&note, b"# note").unwrap();
        assert!(delete_text_file(note.to_str().unwrap()).is_ok());
        assert!(!note.exists());

        let other = root.join("document.txt");
        fs::write(&other, b"keep").unwrap();
        assert!(delete_text_file(other.to_str().unwrap()).is_err());
        assert!(other.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn creates_directories_within_existing_parent() {
        let root = std::env::temp_dir().join(format!("aster-create-dir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        assert!(create_directory(root.to_str().unwrap(), "章节").is_ok());
        assert!(root.join("章节").is_dir());
        assert!(create_directory(root.to_str().unwrap(), "章节").is_err());
        assert!(create_directory(root.to_str().unwrap(), "../越界").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn moves_files_and_directories_without_overwriting_or_descendant_moves() {
        let root = std::env::temp_dir().join(format!("aster-move-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let source_dir = root.join("source");
        let destination_dir = root.join("destination");
        let nested_dir = source_dir.join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::create_dir_all(&destination_dir).unwrap();
        let note = source_dir.join("note.md");
        fs::write(&note, b"# note").unwrap();

        let moved_note = move_path(note.to_str().unwrap(), destination_dir.to_str().unwrap()).unwrap();
        assert_eq!(moved_note.name, "note.md");
        assert!(!moved_note.is_directory);
        assert!(!note.exists());
        assert!(destination_dir.join("note.md").is_file());

        let rejected = move_path(source_dir.to_str().unwrap(), nested_dir.to_str().unwrap());
        assert!(rejected.is_err());
        assert!(source_dir.is_dir());

        fs::write(destination_dir.join("source"), b"collision").unwrap();
        let collision = move_path(source_dir.to_str().unwrap(), destination_dir.to_str().unwrap());
        assert!(collision.is_err());
        assert!(source_dir.is_dir());
        fs::remove_file(destination_dir.join("source")).unwrap();

        let moved_dir = move_path(source_dir.to_str().unwrap(), destination_dir.to_str().unwrap());
        assert!(moved_dir.is_ok());
        let moved_dir = moved_dir.unwrap();
        assert!(moved_dir.is_directory);
        assert!(destination_dir.join("source").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unsafe_cli_names() {
        let status = detect_cli("codex; rm -rf /");
        assert!(!status.available);
        assert_eq!(status.error, "命令名不合法");
        assert!(!detect_cli("").available);
    }

    #[test]
    fn reports_missing_cli_as_unavailable() {
        let status = detect_cli("aster-not-a-real-cli");
        assert!(!status.available);
        assert_eq!(status.error, "未在 PATH 中找到该命令");
    }

    #[test]
    fn project_command_rejects_shell_composition() {
        let root = std::env::temp_dir();
        let request = RunProjectCommandRequest {
            cwd: root.to_string_lossy().to_string(),
            command: "echo;whoami".to_string(),
            args: vec![],
        };
        assert!(run_project_command(&request).unwrap_err().contains("shell"));
    }

    #[test]
    fn keeps_first_non_empty_version_line() {
        assert_eq!(first_line("\n  codex 1.2.3 \nextra"), "codex 1.2.3");
        assert_eq!(first_line("   "), "");
    }
}


#[derive(Debug, Deserialize)]
pub struct DirectoryPathRequest { pub root_path: String, pub path: String }
#[derive(Debug, Deserialize)]
pub struct RenameDirectoryRequest { pub root_path: String, pub path: String, pub new_name: String }

/// Folder actions are restricted to real descendants of the chosen workspace.
/// Do not follow a selected link/junction as if it were an ordinary folder.
fn scoped_directory(root: &str, raw: &str) -> Result<PathBuf, String> {
    let root = resolve_existing_path(root)?;
    if !root.is_dir() { return Err("工作区根路径不是文件夹".into()); }
    let path = resolve_existing_path(raw)?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() { return Err("不允许操作符号链接文件夹".into()); }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return Err("不允许操作链接或联接文件夹".into()); }
    }
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let canonical_path = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || canonical_path == canonical_root || !canonical_path.starts_with(&canonical_root) {
        return Err("只能操作工作区内的子文件夹，不能操作根目录或外部目录".into());
    }
    Ok(path)
}

pub fn rename_directory(root: &str, raw: &str, new_name: &str) -> Result<RenamedTextFile, String> {
    let _guard = text_file_io::lock()?;
    let path = scoped_directory(root, raw)?;
    let name = new_name.trim();
    if name.is_empty() || name.len() > 120 || name == "." || name == ".." || name.ends_with('.') ||
       name.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\u{1f}')) {
        return Err("文件夹名称无效或包含系统不支持的字符".into());
    }
    let parent = path.parent().ok_or_else(|| "无法确定父目录".to_string())?;
    let target = parent.join(name);
    if target != path {
        if fs::symlink_metadata(&target).is_ok() { return Err("同名文件或文件夹已存在，未覆盖".into()); }
        fs::rename(&path, &target).map_err(|e| format!("无法重命名文件夹：{e}"))?;
    }
    Ok(RenamedTextFile { path: target.to_string_lossy().into_owned(), name: name.to_string() })
}

pub fn delete_empty_directory(root: &str, raw: &str) -> Result<(), String> {
    let _guard = text_file_io::lock()?;
    let path = scoped_directory(root, raw)?;
    // One non-recursive OS operation: even a concurrent file creation makes this
    // fail instead of deleting that new file. Never fall back to remove_dir_all.
    fs::remove_dir(&path).map_err(|e| format!("仅允许删除空文件夹；目录非空、被占用或权限不足，未删除：{e}"))
}

#[cfg(test)]
mod directory_action_tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture { fn new() -> Self {
        let name = format!("a4-folder-actions-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let root = std::env::temp_dir().join(name); fs::create_dir(&root).unwrap(); Self(root)
    } fn text(&self) -> String { self.0.to_string_lossy().into_owned() } }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test] fn directory_rename_preserves_contents_and_rejects_collision() {
        let root = Fixture::new(); let child = root.0.join("old.folder"); fs::create_dir(&child).unwrap();
        fs::write(child.join("keep.md"), b"unchanged").unwrap();
        let renamed = rename_directory(&root.text(), &child.to_string_lossy(), "new.folder").unwrap();
        assert_eq!(fs::read(Path::new(&renamed.path).join("keep.md")).unwrap(), b"unchanged");
        fs::create_dir(root.0.join("existing")).unwrap();
        assert!(rename_directory(&root.text(), &renamed.path, "existing").is_err());
        assert!(rename_directory(&root.text(), &renamed.path, "../outside").is_err());
        assert!(rename_directory(&root.text(), &renamed.path, "").is_err());
    }
    #[test] fn empty_delete_never_removes_notes_children_or_workspace_root() {
        let root = Fixture::new(); let child = root.0.join("child"); fs::create_dir(&child).unwrap();
        fs::write(child.join("keep.md"), b"keep").unwrap();
        assert!(delete_empty_directory(&root.text(), &child.to_string_lossy()).is_err());
        assert_eq!(fs::read(child.join("keep.md")).unwrap(), b"keep");
        assert!(delete_empty_directory(&root.text(), &root.text()).is_err());
        assert!(rename_directory(&root.text(), &root.text(), "other-root").is_err());
        fs::remove_file(child.join("keep.md")).unwrap();
        delete_empty_directory(&root.text(), &child.to_string_lossy()).unwrap(); assert!(!child.exists());
    }
    #[test] fn outside_workspace_directory_is_rejected() {
        let root = Fixture::new(); let outside = Fixture::new();
        assert!(delete_empty_directory(&root.text(), &outside.text()).is_err());
        assert!(rename_directory(&root.text(), &outside.text(), "other").is_err());
        assert!(outside.0.exists());
    }
}
