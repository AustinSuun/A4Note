//! SQLite snapshots + immutable backup directories + recoverable staged restore.
//! Production entry points hold the maintenance gate across DB AND attachment I/O.
use crate::app_paths::{app_data_root, path_to_string};
use crate::database::{current_timestamp_ms, initialize_database};
use rusqlite::{
    backup::{Backup, StepResult},
    params, Connection, OpenFlags,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub(crate) struct BackupResult {
    pub(crate) backup_path: String,
}
#[derive(Debug, Serialize)]
pub(crate) struct RestoreBackupResult {
    pub(crate) restored_from: String,
    pub(crate) safety_backup_path: String,
    pub(crate) restart_required: bool,
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    files_root: String,
    database_sha256: String,
    files: Vec<FileDigest>,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
struct FileDigest {
    path: String,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
struct RestoreJournal {
    token: String,
    had_files: bool,
}
const JOURNAL: &str = ".aster-restore-journal.json";

#[tauri::command(async)]
pub fn create_library_backup(app: AppHandle) -> Result<BackupResult, String> {
    let _access = crate::library_access::maintenance()?;
    let root = app_data_root(&app)?;
    let backup = create_backup_for_root(&root, "aster-backup")?;
    Ok(BackupResult {
        backup_path: path_to_string(&backup),
    })
}
#[tauri::command(async)]
pub fn restore_library_backup(
    app: AppHandle,
    backup_path: String,
) -> Result<RestoreBackupResult, String> {
    let _access = crate::library_access::maintenance()?;
    let root = app_data_root(&app)?;
    let result = restore_backup_into_root(&root, Path::new(&backup_path));
    // Restored DB must not receive delayed autosaves from the previous UI session.
    if result.is_ok() || root.join(JOURNAL).exists() {
        crate::library_access::require_restart();
    }
    result
}
#[tauri::command]
pub fn restart_after_library_restore(app: AppHandle) -> Result<(), String> {
    if !crate::library_access::restart_required() {
        return Err("当前没有需要重启的恢复操作".into());
    }
    app.restart();
}

fn io(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn read_only(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(io)
}
fn snapshot_database(source: &Path, target: &Path) -> Result<(), String> {
    let source = read_only(source)?;
    let mut target = Connection::open(target).map_err(io)?;
    let backup = Backup::new(&source, &mut target).map_err(io)?;
    match backup.step(-1).map_err(io)? {
        StepResult::Done => Ok(()),
        _ => Err("数据库繁忙，未生成完整快照，请稍后重试".into()),
    }
}
fn validate_database(path: &Path) -> Result<(), String> {
    let db = read_only(path)?;
    let check: String = db
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(io)?;
    if check != "ok" {
        return Err(format!("备份数据库损坏：{check}"));
    }
    for table in ["papers", "paper_files", "notes"] {
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                params![table],
                |r| r.get(0),
            )
            .map_err(io)?;
        if !exists {
            return Err(format!("不是有效的文献库备份：缺少 {table}"));
        }
    }
    Ok(())
}
fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(io)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(io)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
pub(crate) fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    if fs::symlink_metadata(source)
        .map_err(io)?
        .file_type()
        .is_symlink()
    {
        return Err("备份不跟随符号链接".into());
    }
    fs::create_dir_all(target).map_err(io)?;
    for entry in fs::read_dir(source).map_err(io)? {
        let entry = entry.map_err(io)?;
        let kind = entry.file_type().map_err(io)?;
        let destination = target.join(entry.file_name());
        if kind.is_symlink() {
            return Err(format!("备份不跟随符号链接：{}", entry.path().display()));
        }
        if kind.is_dir() {
            copy_dir_recursive(&entry.path(), &destination)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), destination).map_err(io)?;
        } else {
            return Err("备份目录含不支持的文件类型".into());
        }
    }
    Ok(())
}
fn digests(root: &Path) -> Result<Vec<FileDigest>, String> {
    fn collect(root: &Path, dir: &Path, files: &mut Vec<FileDigest>) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(io)? {
            let entry = entry.map_err(io)?;
            let kind = entry.file_type().map_err(io)?;
            if kind.is_dir() {
                collect(root, &entry.path(), files)?;
            } else if kind.is_file() {
                files.push(FileDigest {
                    path: entry
                        .path()
                        .strip_prefix(root)
                        .map_err(io)?
                        .to_string_lossy()
                        .replace('\\', "/"),
                    sha256: hash_file(&entry.path())?,
                });
            } else {
                return Err("备份含符号链接或非普通文件".into());
            }
        }
        Ok(())
    }
    let mut files = vec![];
    collect(root, root, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}
fn durable_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(io)?;
        file.write_all(&serde_json::to_vec_pretty(value).map_err(io)?)
            .map_err(io)?;
        file.sync_all().map_err(io)?;
        drop(file);
        if path.exists() {
            return Err("恢复标记或备份清单已存在，拒绝覆盖".into());
        }
        fs::rename(&temporary, path).map_err(io)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
fn normalized_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}
fn suffix_under(path: &str, root: &str) -> Option<String> {
    let path = normalized_path(path);
    let root = normalized_path(root);
    let prefix = format!("{root}/");
    let windows = root.as_bytes().get(1) == Some(&b':') || root.starts_with("//");
    if (windows && path.to_lowercase().starts_with(&prefix.to_lowercase()))
        || (!windows && path.starts_with(&prefix))
    {
        Some(path[prefix.len()..].into())
    } else {
        None
    }
}
// Check managed bindings and rebase only library-owned files, not external workspaces.
fn validate_and_rebase_files(
    db: &Path,
    staged_files: &Path,
    old_root: Option<&str>,
    destination: &Path,
) -> Result<(), String> {
    let connection = Connection::open(db).map_err(io)?;
    let rows: Vec<(String, String)> = {
        let mut statement = connection
            .prepare("SELECT id,path FROM paper_files")
            .map_err(io)?;
        let mapped = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(io)?;
        mapped.collect::<Result<_, _>>().map_err(io)?
    };
    for (id, path) in rows {
        let suffix = if let Some(old) = old_root {
            suffix_under(&path, old)
        } else {
            // Compatibility with old backups that predate the manifest.
            let normalized = normalized_path(&path);
            normalized
                .rfind("/files/papers/")
                .map(|i| normalized[i + 14..].to_string())
        };
        if let Some(suffix) = suffix {
            if suffix.is_empty()
                || suffix.split('/').any(|part| {
                    part.is_empty() || part == "." || part == ".." || part.contains(':')
                })
            {
                return Err("备份附件路径越界".into());
            }
            if !staged_files.join(&suffix).is_file() {
                return Err(format!("备份缺少附件：{suffix}"));
            }
            let rebased = path_to_string(&destination.join(&suffix));
            if normalized_path(&rebased) != normalized_path(&path) {
                connection
                    .execute(
                        "UPDATE paper_files SET path=?1 WHERE id=?2",
                        params![rebased, id],
                    )
                    .map_err(io)?;
            }
        }
    }
    Ok(())
}

/// Caller excludes concurrent managed-file mutations; SQLite API includes WAL data.
pub(crate) fn create_backup_for_root(root: &Path, prefix: &str) -> Result<PathBuf, String> {
    let db = root.join("aster.db");
    initialize_database(&db)?;
    let backups = root.join("backups");
    fs::create_dir_all(&backups).map_err(io)?;
    let name = format!("{prefix}-{}-{}", current_timestamp_ms(), Uuid::new_v4());
    let staging = backups.join(format!(".{name}.partial"));
    let final_path = backups.join(name);
    fs::create_dir(&staging).map_err(io)?;
    let result = (|| {
        snapshot_database(&db, &staging.join("aster.db"))?;
        validate_database(&staging.join("aster.db"))?;
        let source_files = root.join("files/papers");
        let target_files = staging.join("files/papers");
        if source_files.exists() {
            copy_dir_recursive(&source_files, &target_files)?;
        } else {
            fs::create_dir_all(&target_files).map_err(io)?;
        }
        validate_and_rebase_files(
            &staging.join("aster.db"),
            &target_files,
            Some(&path_to_string(&source_files)),
            &source_files,
        )?;
        let manifest = Manifest {
            version: 1,
            files_root: path_to_string(&source_files),
            database_sha256: hash_file(&staging.join("aster.db"))?,
            files: digests(&target_files)?,
        };
        durable_json(&staging.join("backup-manifest.json"), &manifest)?;
        fs::rename(&staging, &final_path).map_err(io)?;
        Ok(final_path)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Roll back any interrupted promotion before the window can issue DB commands.
pub(crate) fn recover_interrupted_restore(root: &Path) -> Result<(), String> {
    let marker = root.join(JOURNAL);
    if !marker.exists() {
        return Ok(());
    }
    let journal: RestoreJournal =
        serde_json::from_slice(&fs::read(&marker).map_err(io)?).map_err(io)?;
    Uuid::parse_str(&journal.token)
        .map_err(|_| "恢复日志无效，请保留目录并手动检查安全备份".to_string())?;
    let old_db = root.join(format!(".restore-old-{}.db", journal.token));
    let old_files = root.join(format!(".restore-old-files-{}", journal.token));
    let staging = root.join(format!(".restore-stage-{}", journal.token));
    let db = root.join("aster.db");
    let files = root.join("files/papers");
    if old_db.exists() {
        if db.exists() {
            fs::remove_file(&db).map_err(io)?;
        }
        fs::rename(&old_db, &db).map_err(io)?;
    }
    if old_files.exists() {
        if files.exists() {
            fs::remove_dir_all(&files).map_err(io)?;
        }
        fs::rename(&old_files, &files).map_err(io)?;
    } else if !journal.had_files && !staging.join("files/papers").exists() && files.exists() {
        fs::remove_dir_all(&files).map_err(io)?;
    }
    fs::remove_file(marker).map_err(io)?;
    let _ = fs::remove_dir_all(staging);
    Ok(())
}

pub(crate) fn restore_backup_into_root(
    root: &Path,
    backup_path: &Path,
) -> Result<RestoreBackupResult, String> {
    restore_with_checkpoint(root, backup_path, |_| Ok(()))
}
fn restore_with_checkpoint(
    root: &Path,
    backup_path: &Path,
    checkpoint: impl Fn(u8) -> Result<(), String>,
) -> Result<RestoreBackupResult, String> {
    if root.join(JOURNAL).exists() {
        return Err("上次恢复未完成，请重启应用执行回退".into());
    }
    let source_db = backup_path.join("aster.db");
    validate_database(&source_db)?;
    fs::create_dir_all(root).map_err(io)?;
    let token = Uuid::new_v4().to_string();
    let staging = root.join(format!(".restore-stage-{token}"));
    fs::create_dir(&staging).map_err(io)?;
    let result = (|| {
        let staged_db = staging.join("aster.db");
        let staged_files = staging.join("files/papers");
        // Copy the DB read-only into staging; migrations never alter the input backup.
        snapshot_database(&source_db, &staged_db)?;
        let source_files = backup_path.join("files/papers");
        if source_files.exists() {
            copy_dir_recursive(&source_files, &staged_files)?;
        } else {
            fs::create_dir_all(&staged_files).map_err(io)?;
        }
        let manifest_path = backup_path.join("backup-manifest.json");
        let manifest: Option<Manifest> = if manifest_path.exists() {
            Some(serde_json::from_slice(&fs::read(&manifest_path).map_err(io)?).map_err(io)?)
        } else {
            None
        };
        if let Some(manifest) = &manifest {
            for suffix in ["-wal", "-shm", "-journal"] {
                if backup_path.join(format!("aster.db{suffix}")).exists() {
                    return Err("备份数据库存在额外日志，拒绝恢复被继续写入的快照".into());
                }
            }
            if manifest.version != 1 {
                return Err("不支持此备份格式版本".into());
            }
            if hash_file(&source_db)? != manifest.database_sha256
                || digests(&staged_files)? != manifest.files
            {
                return Err("备份校验失败：数据库或附件已损坏/被修改".into());
            }
        }
        initialize_database(&staged_db)?;
        validate_and_rebase_files(
            &staged_db,
            &staged_files,
            manifest.as_ref().map(|m| m.files_root.as_str()),
            &root.join("files/papers"),
        )?;
        validate_database(&staged_db)?;
        checkpoint(0)?;
        let safety = create_backup_for_root(root, "aster-pre-restore")?;
        let db = root.join("aster.db");
        let files = root.join("files/papers");
        fs::create_dir_all(root.join("files")).map_err(io)?;
        // No live SQLite handles may exist here (maintenance command gate).
        // Refuse an unmanaged WAL rather than orphan a second process's transaction.
        for suffix in ["-wal", "-shm", "-journal"] {
            if root.join(format!("aster.db{suffix}")).exists() {
                return Err("检测到数据库日志或其他进程占用，请关闭其他实例后重试恢复".into());
            }
        }
        durable_json(
            &root.join(JOURNAL),
            &RestoreJournal {
                token: token.clone(),
                had_files: files.exists(),
            },
        )?;
        let old_db = root.join(format!(".restore-old-{token}.db"));
        let old_files = root.join(format!(".restore-old-files-{token}"));
        let promoted: Result<(), String> = (|| {
            fs::rename(&db, &old_db).map_err(io)?;
            checkpoint(1)?;
            if files.exists() {
                fs::rename(&files, &old_files).map_err(io)?;
            }
            checkpoint(2)?;
            fs::rename(&staged_db, &db).map_err(io)?;
            checkpoint(3)?;
            fs::rename(&staged_files, &files).map_err(io)?;
            checkpoint(4)?;
            fs::remove_file(root.join(JOURNAL)).map_err(io)?;
            Ok(())
        })();
        if let Err(error) = promoted {
            return match recover_interrupted_restore(root) {
                Ok(()) => Err(format!("恢复失败，原资料已回退：{error}")),
                Err(rollback) => Err(format!(
                    "恢复失败且回退未完成，请重启应用；安全备份 {}；{error}；{rollback}",
                    safety.display()
                )),
            };
        }
        let _ = fs::remove_file(old_db);
        let _ = fs::remove_dir_all(old_files);
        Ok(RestoreBackupResult {
            restored_from: path_to_string(backup_path),
            safety_backup_path: path_to_string(&safety),
            restart_required: true,
        })
    })();
    // Keep staging while a recovery journal exists; startup rollback still needs it.
    if !root.join(JOURNAL).exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("a4note-backup-{}", Uuid::new_v4()));
            fs::create_dir_all(root.join("files/papers/p")).unwrap();
            initialize_database(&root.join("aster.db")).unwrap();
            fs::write(root.join("files/papers/p/source.pdf"), b"%PDF original").unwrap();
            let c = Connection::open(root.join("aster.db")).unwrap();
            c.execute_batch(
                "INSERT INTO papers(id,title,created_at,updated_at) VALUES ('p','Original',1,1)",
            )
            .unwrap();
            c.execute("INSERT INTO paper_files(id,paper_id,type,path,created_at) VALUES ('f','p','source_pdf',?1,1)",params![path_to_string(&root.join("files/papers/p/source.pdf"))]).unwrap();
            Self { root }
        }
        fn change(&self) {
            Connection::open(self.root.join("aster.db"))
                .unwrap()
                .execute("UPDATE papers SET title='Latest'", [])
                .unwrap();
            fs::write(self.root.join("files/papers/p/source.pdf"), b"%PDF latest").unwrap();
        }
        fn title(&self) -> String {
            Connection::open(self.root.join("aster.db"))
                .unwrap()
                .query_row("SELECT title FROM papers WHERE id='p'", [], |r| r.get(0))
                .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn integrity_backup_snapshot_includes_uncheckpointed_wal_and_unique_names() {
        let f = Fixture::new();
        let c = Connection::open(f.root.join("aster.db")).unwrap();
        c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE papers SET title='WAL committed'").unwrap();
        let first = create_backup_for_root(&f.root, "test").unwrap();
        let second = create_backup_for_root(&f.root, "test").unwrap();
        assert_ne!(first, second);
        assert_eq!(
            read_only(&first.join("aster.db"))
                .unwrap()
                .query_row("SELECT title FROM papers WHERE id='p'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "WAL committed"
        );
    }
    #[test]
    fn integrity_restore_roundtrip_rebases_paths_and_keeps_safety_and_input() {
        let source = Fixture::new();
        let backup = create_backup_for_root(&source.root, "test").unwrap();
        let original = fs::read(backup.join("aster.db")).unwrap();
        let destination = Fixture::new();
        destination.change();
        let result = restore_backup_into_root(&destination.root, &backup).unwrap();
        assert_eq!(destination.title(), "Original");
        assert_eq!(fs::read(backup.join("aster.db")).unwrap(), original);
        let c = read_only(&destination.root.join("aster.db")).unwrap();
        let path: String = c
            .query_row("SELECT path FROM paper_files WHERE id='f'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            PathBuf::from(path),
            destination.root.join("files/papers/p/source.pdf")
        );
        assert_eq!(
            read_only(&Path::new(&result.safety_backup_path).join("aster.db"))
                .unwrap()
                .query_row("SELECT title FROM papers WHERE id='p'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "Latest"
        );
        assert!(result.restart_required);
    }
    #[test]
    fn integrity_restore_rejects_corruption_or_missing_attachment_without_live_changes() {
        for damage in [0, 1, 2] {
            let f = Fixture::new();
            let backup = create_backup_for_root(&f.root, "test").unwrap();
            f.change();
            match damage {
                0 => fs::write(backup.join("aster.db"), b"not sqlite").unwrap(),
                1 => fs::remove_file(backup.join("files/papers/p/source.pdf")).unwrap(),
                _ => fs::write(backup.join("files/papers/p/source.pdf"), b"tampered").unwrap(),
            };
            assert!(restore_backup_into_root(&f.root, &backup).is_err());
            assert_eq!(f.title(), "Latest");
            assert_eq!(
                fs::read(f.root.join("files/papers/p/source.pdf")).unwrap(),
                b"%PDF latest"
            );
            assert!(!f.root.join(JOURNAL).exists());
        }
    }
    #[test]
    fn integrity_restore_rolls_back_each_failed_promotion_boundary() {
        for stop in 0..=4 {
            let f = Fixture::new();
            let backup = create_backup_for_root(&f.root, "test").unwrap();
            f.change();
            assert!(
                restore_with_checkpoint(&f.root, &backup, |step| if step == stop {
                    Err("injected failure".into())
                } else {
                    Ok(())
                })
                .is_err()
            );
            assert_eq!(f.title(), "Latest");
            assert_eq!(
                fs::read(f.root.join("files/papers/p/source.pdf")).unwrap(),
                b"%PDF latest"
            );
            assert!(!f.root.join(JOURNAL).exists());
        }
    }
    #[test]
    fn integrity_startup_recovers_interrupted_restore_idempotently() {
        let f = Fixture::new();
        let token = Uuid::new_v4().to_string();
        durable_json(
            &f.root.join(JOURNAL),
            &RestoreJournal {
                token: token.clone(),
                had_files: true,
            },
        )
        .unwrap();
        fs::rename(
            f.root.join("aster.db"),
            f.root.join(format!(".restore-old-{token}.db")),
        )
        .unwrap();
        fs::rename(
            f.root.join("files/papers"),
            f.root.join(format!(".restore-old-files-{token}")),
        )
        .unwrap();
        fs::write(f.root.join("aster.db"), b"incomplete replacement").unwrap();
        fs::create_dir_all(f.root.join("files/papers")).unwrap();
        recover_interrupted_restore(&f.root).unwrap();
        recover_interrupted_restore(&f.root).unwrap();
        assert_eq!(f.title(), "Original");
        assert_eq!(
            fs::read(f.root.join("files/papers/p/source.pdf")).unwrap(),
            b"%PDF original"
        );
    }
    #[test]
    fn integrity_legacy_backup_is_not_migrated_in_place() {
        let f = Fixture::new();
        let backup = create_backup_for_root(&f.root, "test").unwrap();
        fs::remove_file(backup.join("backup-manifest.json")).unwrap();
        let c = Connection::open(backup.join("aster.db")).unwrap();
        c.execute_batch("DROP TABLE aster_schema_migrations")
            .unwrap();
        drop(c);
        let original = fs::read(backup.join("aster.db")).unwrap();
        f.change();
        restore_backup_into_root(&f.root, &backup).unwrap();
        assert_eq!(fs::read(backup.join("aster.db")).unwrap(), original);
        assert_eq!(f.title(), "Original");
    }
    #[test]
    fn summary_backup_restores_markdown_relative_assets_and_view_layout() {
        let source = Fixture::new();
        fs::create_dir_all(source.root.join("files/papers/p/summary-assets")).unwrap();
        let files = [("p/总结.md", "# 总结\n![结构](summary-assets/x.png)\n"), ("p/summary-assets/x.png", "image fixture"), (".summary-view.json", "{\"version\":1,\"columns\":[]}")];
        for (name, body) in files { fs::write(source.root.join("files/papers").join(name), body).unwrap(); }
        let backup = create_backup_for_root(&source.root, "summary-test").unwrap();
        let destination = Fixture::new();
        restore_backup_into_root(&destination.root, &backup).unwrap();
        for (name, body) in files { assert_eq!(fs::read_to_string(destination.root.join("files/papers").join(name)).unwrap(), body); }
    }

}
