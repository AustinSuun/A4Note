//! Standalone Markdown assets are confined to persisted, user-opened folder workspaces.
use std::{fs, path::{Path, PathBuf}};
use tauri::AppHandle;
use crate::managed_image_io::{self, DirectoryGuard};

struct DocumentGuard { directory: PathBuf, relative_directory: String, _parent: DirectoryGuard, _document: fs::File }
fn authorized_document(path: &Path, roots: &[PathBuf]) -> Result<DocumentGuard, String> {
    if !path.is_absolute() { return Err("请先把Markdown文档保存到已打开的文件夹工作区。".into()); }
    let extension = path.extension().and_then(|p| p.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown" | "mdx") { return Err("图片只能写入已保存Markdown文档的资源目录。".into()); }
    let canonical = path.canonicalize().map_err(|_| "文档不存在或尚未保存；未创建图片。")?;
    let allowed = roots.iter().any(|root| root.canonicalize().is_ok_and(|root| canonical.starts_with(&root) && canonical != root));
    if !allowed { return Err("文档不在已授权的文件夹工作区内。请先在笔记工作区打开所属文件夹，稍后重试。".into()); }
    let parent = path.parent().ok_or("文档缺少父目录")?;
    // Check the original spelling, not just canonical(), so internal junctions also fail closed.
    let guard = DirectoryGuard::open(parent, false)?;
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    managed_image_io::reject_link(&metadata)?;
    if !metadata.is_file() || metadata.permissions().readonly() { return Err("文档只读或不是普通文件，未创建图片。".into()); }
    let mut options = fs::OpenOptions::new();
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_FLAG_OPEN_REPARSE_POINT};
        options.access_mode(FILE_READ_ATTRIBUTES | FILE_READ_DATA).share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(not(windows))] { options.read(true); }
    let document = options.open(path).map_err(|e| e.to_string())?;
    managed_image_io::reject_link(&document.metadata().map_err(|e| e.to_string())?)?;
    let stem = path.file_stem().and_then(|s| s.to_str()).filter(|s| !s.is_empty()).ok_or("文档名称无法表示为相对路径")?;
    let relative_directory = format!("{stem}.assets");
    let directory = guard.path.join(&relative_directory);
    Ok(DocumentGuard { directory, relative_directory, _parent: guard, _document: document })
}

fn import(path: &Path, roots: &[PathBuf], bytes: &[u8], mime: &str) -> Result<String, String> {
    // Decode before acquiring the document lock, minimizing interference with atomic saves.
    managed_image_io::validate(bytes, Some(mime))?;
    let document = authorized_document(path, roots)?;
    let name = managed_image_io::create(&document.directory, bytes, Some(mime))?;
    Ok(format!("{}/{name}", document.relative_directory))
}

#[tauri::command]
pub async fn import_markdown_image(app: AppHandle, document_path: String, bytes: Vec<u8>, mime: String) -> Result<String, String> {
    let _access = crate::library_access::operation()?;
    let database = crate::state_commands::workbench_database(&app)?;
    let roots = crate::state_commands::markdown_image_workspace_roots(&database)?;
    import(Path::new(&document_path), &roots, &bytes, &mime)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture { fn new() -> Self { let p = std::env::temp_dir().join(format!("a4-md-image-{}", uuid::Uuid::new_v4())); fs::create_dir(&p).unwrap(); Self(p) } }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn png() -> Vec<u8> { let mut out = std::io::Cursor::new(Vec::new()); image::DynamicImage::new_rgb8(2, 2).write_to(&mut out, image::ImageFormat::Png).unwrap(); out.into_inner() }
    #[test] fn markdown_image_requires_existing_authorized_document() {
        let f = Fixture::new(); let doc = f.0.join("note.md"); let roots = [f.0.clone()];
        assert!(import(&doc, &roots, &png(), "image/png").is_err());
        fs::write(&doc, "keep draft").unwrap(); assert!(import(&doc, &[], &png(), "image/png").is_err());
        assert!(import(Path::new("note.md"), &roots, &png(), "image/png").is_err());
        let sibling = Fixture::new(); assert!(import(&doc, &[sibling.0.clone()], &png(), "image/png").is_err());
        assert!(!f.0.join("note.assets").exists()); assert_eq!(fs::read_to_string(&doc).unwrap(), "keep draft");
    }
    #[test] fn markdown_image_relative_assets_survive_folder_move() {
        let f = Fixture::new(); let original = f.0.join("original"); fs::create_dir(&original).unwrap();
        let doc = original.join("论文.md"); fs::write(&doc, "# 内容").unwrap();
        let reference = import(&doc, &[original.clone()], &png(), "image/png").unwrap();
        assert!(reference.starts_with("论文.assets/")); assert_eq!(fs::read(original.join(&reference)).unwrap(), png());
        fs::write(&doc, format!("![图](<{reference}>)")).unwrap();
        let moved = f.0.join("moved"); fs::rename(&original, &moved).unwrap();
        assert_eq!(fs::read(moved.join(reference)).unwrap(), png());
        let renamed = moved.join("重命名.md"); fs::rename(moved.join("论文.md"), &renamed).unwrap();
        fs::remove_file(renamed).unwrap(); assert!(moved.join("论文.assets").is_dir());
    }
    #[test] fn markdown_image_readonly_and_directory_conflicts_preserve_draft() {
        let f = Fixture::new(); let doc = f.0.join("note.md"); fs::write(&doc, "keep").unwrap();
        let mut permissions = fs::metadata(&doc).unwrap().permissions(); permissions.set_readonly(true); fs::set_permissions(&doc, permissions).unwrap();
        assert!(import(&doc, &[f.0.clone()], &png(), "image/png").is_err()); assert!(!f.0.join("note.assets").exists());
        let mut permissions = fs::metadata(&doc).unwrap().permissions(); permissions.set_readonly(false); fs::set_permissions(&doc, permissions).unwrap();
        fs::write(f.0.join("note.assets"), "sentinel").unwrap(); assert!(import(&doc, &[f.0.clone()], &png(), "image/png").is_err());
        assert_eq!(fs::read_to_string(&doc).unwrap(), "keep"); assert_eq!(fs::read_to_string(f.0.join("note.assets")).unwrap(), "sentinel");
    }
}
