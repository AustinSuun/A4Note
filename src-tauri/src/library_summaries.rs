//! Paper-bound Markdown summaries. No note-table mutation; files/papers is covered by backups.
use std::{fs, path::{Path, PathBuf}, io::Write};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use tauri::AppHandle;
use crate::{app_paths::app_data_root, workspace_fs::text_file_io};
static SUMMARY_MUTATIONS: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub(crate) fn mutation() -> Result<std::sync::MutexGuard<'static, ()>, String> { SUMMARY_MUTATIONS.lock().map_err(|_| "总结文件操作锁不可用".into()) }
const MAX_SUMMARY: u64 = 2 * 1024 * 1024;
const MAX_IMAGE: usize = 3 * 1024 * 1024;
#[derive(Debug, Serialize)]
pub(crate) struct SummaryFile { pub path: String, pub content: String, pub exists: bool }
fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') { return Err("无效的文献标识".into()); }
    Ok(())
}
fn safe_child(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let path = parent.join(name);
    match fs::symlink_metadata(&path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() { return Err("总结目录不允许符号链接".into()); }
            // Also rejects Windows junction/reparse destinations outside the managed parent.
            let canonical = path.canonicalize().map_err(|e| e.to_string())?;
            let base = parent.canonicalize().map_err(|e| e.to_string())?;
            if !canonical.starts_with(base) { return Err("总结路径越过托管目录".into()); }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
        Err(e) => return Err(e.to_string()),
    }
    Ok(path)
}
fn managed_root(root: &Path) -> Result<PathBuf, String> {
    let files = safe_child(root, "files")?;
    safe_child(&files, "papers")
}
fn paper_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    valid_id(id)?;
    let connection = Connection::open_with_flags(root.join("aster.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let exists = connection.query_row("SELECT id FROM papers WHERE id=?1", [id], |row| row.get::<_, String>(0)).optional().map_err(|e| e.to_string())?;
    if exists.is_none() { return Err("文献不存在或已删除，未读写总结".into()); }
    safe_child(&managed_root(root)?, id)
}
fn summary_path(root: &Path, id: &str) -> Result<PathBuf, String> { safe_child(&paper_dir(root, id)?, "总结.md") }
fn read(path: &Path) -> Result<SummaryFile, String> {
    let content = match fs::metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.len() > MAX_SUMMARY { return Err("总结必须是小于2MB的UTF-8文件".into()); }
            let value = fs::read_to_string(path).map_err(|e| format!("无法完整读取总结：{e}"))?;
            if value.contains('\0') { return Err("总结不是文本文件".into()); }
            Some(value)
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    Ok(SummaryFile { path: path.to_string_lossy().into(), exists: content.is_some(), content: content.unwrap_or_default() })
}
fn ensure(root: &Path, id: &str) -> Result<SummaryFile, String> {
    let _mutation = mutation()?;
    let path = summary_path(root, id)?;
    if !path.exists() {
        fs::create_dir_all(path.parent().ok_or("缺少总结目录")?).map_err(|e| e.to_string())?;
        // Explicit editing action only. A failed race re-reads, never overwrites the winner.
        if let Err(error) = text_file_io::create_text(&path, "# 总结\n\n") { if !path.is_file() { return Err(error); } }
    }
    read(&path)
}
fn save(root: &Path, id: &str, content: &str, expected: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_SUMMARY || content.contains('\0') { return Err("总结超过2MB或不是文本".into()); }
    let _mutation = mutation()?;
    let path = summary_path(root, id)?;
    // Missing/deleted files must never be silently recreated by a stale editor.
    text_file_io::atomic_write(&path, content, Some(expected))
}
#[tauri::command]
pub async fn read_paper_summary(app: AppHandle, paper_id: String) -> Result<SummaryFile, String> {
    let _access = crate::library_access::operation()?;
    read(&summary_path(&app_data_root(&app)?, &paper_id)?)
}
#[tauri::command]
pub async fn ensure_paper_summary(app: AppHandle, paper_id: String) -> Result<SummaryFile, String> {
    let _access = crate::library_access::operation()?;
    ensure(&app_data_root(&app)?, &paper_id)
}
#[tauri::command]
pub async fn save_paper_summary(app: AppHandle, paper_id: String, content: String, expected_content: String) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    save(&app_data_root(&app)?, &paper_id, &content, &expected_content)
}
#[tauri::command]
pub async fn read_summary_layout(app: AppHandle) -> Result<SummaryFile, String> {
    let _access = crate::library_access::operation()?;
    read(&safe_child(&managed_root(&app_data_root(&app)?)?, ".summary-view.json")?)
}
#[tauri::command]
pub async fn save_summary_layout(app: AppHandle, content: String, expected_content: String) -> Result<(), String> {
    let _access = crate::library_access::operation()?;
    if content.len() > 128 * 1024 { return Err("列设置过大".into()); }
    let root = managed_root(&app_data_root(&app)?)?;
    let path = safe_child(&root, ".summary-view.json")?;
    if !path.exists() && expected_content.is_empty() {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        text_file_io::create_text(&path, &content)
    } else { text_file_io::atomic_write(&path, &content, Some(&expected_content)) }
}
fn image_extension(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.len() > MAX_IMAGE { return Err("图片不得超过3MB".into()); }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { Ok("png") }
    else if bytes.starts_with(&[0xff, 0xd8, 0xff]) { Ok("jpg") }
    else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { Ok("webp") }
    else { Err("仅支持PNG、JPEG、WebP图片".into()) }
}
fn image_path(root: &Path, id: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.len() > 80 || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.') || name.starts_with('.') { return Err("无效的图片引用".into()); }
    safe_child(&safe_child(&paper_dir(root, id)?, "summary-assets")?, name)
}
#[tauri::command]
pub async fn import_summary_image(app: AppHandle, paper_id: String, bytes: Vec<u8>) -> Result<String, String> {
    let _access = crate::library_access::operation()?;
    let _mutation = mutation()?;
    let ext = image_extension(&bytes)?;
    let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let path = image_path(&app_data_root(&app)?, &paper_id, &name)?;
    fs::create_dir_all(path.parent().ok_or("缺少图片目录")?).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&path).map_err(|e| e.to_string())?;
    let result = file.write_all(&bytes).and_then(|_| file.sync_all());
    if let Err(e) = result { drop(file); let _ = fs::remove_file(&path); return Err(e.to_string()); }
    Ok(format!("summary-assets/{name}"))
}
#[tauri::command]
pub async fn read_summary_image(app: AppHandle, paper_id: String, name: String) -> Result<Vec<u8>, String> {
    let _access = crate::library_access::operation()?;
    let path = image_path(&app_data_root(&app)?, &paper_id, &name)?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_IMAGE as u64 { return Err("图片过大".into()); }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    image_extension(&bytes)?;
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("a4-summary-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            crate::database::initialize_database(&root.join("aster.db")).unwrap();
            let c = Connection::open(root.join("aster.db")).unwrap();
            c.execute("INSERT INTO papers(id,title,created_at,updated_at) VALUES ('p1','paper',1,1)", []).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test] fn summary_read_does_not_create_and_roundtrip_preserves_unknown_markdown() {
        let f=Fixture::new(); let p=summary_path(&f.0,"p1").unwrap();
        assert!(!read(&p).unwrap().exists); assert!(!p.exists());
        let initial=ensure(&f.0,"p1").unwrap();
        let text="\u{feff}---\r\nunknown: keep\r\n---\r\n# 总结\r\n😀 ![](summary-assets/a.png)\r\n";
        save(&f.0,"p1",text,&initial.content).unwrap(); assert_eq!(read(&p).unwrap().content,text);
        assert_eq!(ensure(&f.0,"p1").unwrap().content,text);
    }
    #[test] fn summary_stale_and_deleted_writes_are_rejected() {
        let f=Fixture::new();let initial=ensure(&f.0,"p1").unwrap();
        save(&f.0,"p1","external",&initial.content).unwrap();assert!(save(&f.0,"p1","draft",&initial.content).is_err());
        assert_eq!(read(Path::new(&initial.path)).unwrap().content,"external");
        fs::remove_file(&initial.path).unwrap();assert!(save(&f.0,"p1","draft","external").is_err());assert!(!Path::new(&initial.path).exists());
    }
    #[test] fn summary_rejects_traversal_missing_and_deleted_papers() {
        let f=Fixture::new();for id in ["../p1","p1/../../escape","C:\\p1","missing","."] { assert!(ensure(&f.0,id).is_err()); }
        let c=Connection::open(f.0.join("aster.db")).unwrap();c.execute("DELETE FROM papers WHERE id='p1'",[]).unwrap();assert!(ensure(&f.0,"p1").is_err());
    }
    #[test] fn summary_rejects_binary_oversize_and_non_utf8() {
        let f=Fixture::new();let a=ensure(&f.0,"p1").unwrap();assert!(save(&f.0,"p1","a\0b",&a.content).is_err());assert!(save(&f.0,"p1",&"x".repeat(MAX_SUMMARY as usize+1),&a.content).is_err());
        fs::write(&a.path,[0xff,0xfe]).unwrap();assert!(read(Path::new(&a.path)).is_err());
    }
    #[test] fn summary_assets_are_bounded_and_scoped() {
        let f=Fixture::new();for n in ["../x.png","a/b.png","..",".hidden"] { assert!(image_path(&f.0,"p1",n).is_err()); }
        assert!(image_extension(b"<svg><script/></svg>").is_err());assert!(image_extension(&vec![0;MAX_IMAGE+1]).is_err());assert_eq!(image_extension(b"\x89PNG\r\n\x1a\n").unwrap(),"png");
    }
    #[test] fn summary_exclusive_create_never_clobbers_another_writer() {
        let f=Fixture::new();let a=ensure(&f.0,"p1").unwrap();assert!(text_file_io::create_text(Path::new(&a.path),"overwrite").is_err());assert_eq!(read(Path::new(&a.path)).unwrap().content,a.content);
    }
}
