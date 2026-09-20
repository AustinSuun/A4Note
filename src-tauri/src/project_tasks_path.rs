//! Node's entry-module resolver rejects verbatim Windows paths (e.g. \\?\D:\...).
//! Keep OS-native strings intact, but remove the namespace prefix at the Node boundary.
use std::path::{Path, PathBuf};

pub(super) fn for_node(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        use std::{ffi::OsString, os::windows::ffi::{OsStrExt, OsStringExt}};
        use std::path::{Component, Prefix};
        let units: Vec<u16> = path.as_os_str().encode_wide().collect();
        match path.components().next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::VerbatimDisk(_) => return OsString::from_wide(&units[4..]).into(),
                Prefix::VerbatimUNC(_, _) => {
                    let mut normal = vec![b'\\' as u16, b'\\' as u16];
                    normal.extend_from_slice(&units[8..]);
                    return OsString::from_wide(&normal).into();
                }
                _ => {}
            },
            _ => {}
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_paths_are_unchanged() {
        for value in ["relative/bootstrap.mjs", "/tmp/任务 space/bootstrap.mjs", "D:\\任务 space\\bootstrap.mjs"] {
            assert_eq!(for_node(Path::new(value)), PathBuf::from(value));
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_namespace_paths_keep_drive_share_and_unicode() {
        for (input, expected) in [
            (r"\\?\D:\任务 space # %\bootstrap.mjs", r"D:\任务 space # %\bootstrap.mjs"),
            (r"\\?\D:\", r"D:\"),
            (r"\\?\UNC\server\share\任务 space\bootstrap.mjs", r"\\server\share\任务 space\bootstrap.mjs"),
            (r"\\server\share\project", r"\\server\share\project"),
        ] {
            assert_eq!(for_node(Path::new(input)), PathBuf::from(expected));
        }
    }

    // Real Windows process launch, not a browser IPC mock. Exercises Node's main
    // module resolver and argument quoting using a canonicalized resource path.
    #[cfg(windows)]
    #[test]
    fn node_loads_canonical_resource_path_with_spaces_and_unicode() {
        use std::{fs, process::{Command, Stdio}, time::{SystemTime, UNIX_EPOCH}};
        use std::os::windows::process::CommandExt;
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("a4-node-path-{}-{nonce}", std::process::id()))
            .join("任务 space # %");
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join("bootstrap.mjs");
        fs::write(&script, "process.stdout.write(JSON.stringify({root:process.argv[2],port:process.argv[3]}));").unwrap();
        let canonical_script = fs::canonicalize(&script).unwrap();
        let canonical_root = fs::canonicalize(&dir).unwrap();
        assert!(canonical_script.to_string_lossy().starts_with(r"\\?\"));
        let root = for_node(&canonical_root);
        let output = Command::new("node")
            .arg(for_node(&canonical_script)).arg(&root).arg("4319")
            .current_dir(&root).stdin(Stdio::null()).creation_flags(0x08000000)
            .output().expect("Node must be available for the Windows launcher regression");
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let actual: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(actual["root"], root.to_string_lossy().as_ref());
        assert_eq!(actual["port"], "4319");
        fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }
}
