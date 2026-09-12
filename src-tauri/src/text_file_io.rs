//! Atomic text saves with optimistic conflict detection. All in-app mutations
//! share this lock; external editors are checked again immediately before replace.
use std::{fs, io::Write, path::Path, sync::{Mutex, MutexGuard}};
static MUTATION_LOCK: Mutex<()> = Mutex::new(());
pub fn lock() -> Result<MutexGuard<'static, ()>, String> {
    MUTATION_LOCK.lock().map_err(|_| "文件操作锁不可用，请重新启动应用".to_string())
}

pub fn atomic_write(path: &Path, content: &str, expected: Option<&str>) -> Result<(), String> {
    let _guard = lock()?;
    let check = || -> Result<(), String> {
        let actual = fs::read(path).map_err(|error| format!("无法读取保存基线：{error}"))?;
        if expected.is_some_and(|text| text.as_bytes() != actual) {
            return Err("文件已被外部程序修改，已停止覆盖。请先导出本地草稿，再重新加载磁盘版本进行合并。".to_string());
        }
        Ok(())
    };
    check()?;
    let parent = path.parent().ok_or_else(|| "无法确定文件目录".to_string())?;
    let temporary = parent.join(format!(".a4note-save-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let permissions = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
        if permissions.readonly() { return Err("文件为只读，未覆盖原文件".to_string()); }
        let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        file.set_permissions(permissions).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        check()?;
        replace(&temporary, path)
    })();
    if temporary.exists() { let _ = fs::remove_file(&temporary); }
    result
}

#[cfg(not(target_os = "windows"))]
fn replace(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination).map_err(|e| format!("无法原子保存文件：{e}"))?;
    if let Some(parent) = destination.parent() { if let Ok(directory) = fs::File::open(parent) { let _ = directory.sync_all(); } }
    Ok(())
}
#[cfg(target_os = "windows")]
fn replace(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    // Never delete the original as a fallback: failure leaves it untouched.
    let ok = unsafe { ReplaceFileW(target.as_ptr(), source.as_ptr(), std::ptr::null(), 0, std::ptr::null(), std::ptr::null()) };
    if ok == 0 { Err(format!("无法原子保存文件：{}", std::io::Error::last_os_error())) } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("a4note-save-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap(); let file = root.join("note.md"); fs::write(&file, "old").unwrap(); (root, file)
    }
    #[test]
    fn atomic_save_preserves_utf8_bom_crlf_and_cleans_temporary() {
        let (root, file) = fixture(); let text = "\u{feff}# 笔记\r\n\r\n正文\r\n";
        atomic_write(&file, text, Some("old")).unwrap();
        assert_eq!(fs::read(&file).unwrap(), text.as_bytes()); assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stale_save_does_not_overwrite_external_edit() {
        let (root, file) = fixture(); fs::write(&file, "external").unwrap();
        assert!(atomic_write(&file, "draft", Some("old")).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "external"); assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_file_is_not_recreated() {
        let (root, file) = fixture(); fs::remove_file(&file).unwrap();
        assert!(atomic_write(&file, "draft", Some("old")).is_err()); assert!(!file.exists()); fs::remove_dir_all(root).unwrap();
    }
}

/// Publish a new complete file without replacing a concurrently created destination.
/// Same-directory hard-link publication is atomic and fails closed on unsupported filesystems.
pub(crate) fn create_text(path: &Path, content: &str) -> Result<(), String> {
    let _guard = lock()?;
    let parent = path.parent().ok_or("文件目录不可用")?;
    let temporary = parent.join(format!(".a4note-save-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::hard_link(&temporary, path).map_err(|e| format!("无法创建文件（可能已被其他窗口创建）：{e}"))?;
        #[cfg(not(target_os = "windows"))]
        if let Ok(directory) = fs::File::open(parent) { let _ = directory.sync_all(); }
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    result
}
