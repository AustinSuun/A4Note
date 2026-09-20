//! Explicit user-triggered task service launch; never runs during app setup.
use std::{path::PathBuf, process::{Command, Stdio}, time::{Duration, Instant}};
use tauri::Manager;
#[path = "project_tasks_path.rs"]
mod node_path;

#[tauri::command]
pub async fn start_project_tasks(
    app: tauri::AppHandle,
    project_root: Option<String>,
    port: Option<u16>,
) -> Result<serde_json::Value, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent()
            .ok_or("无法确定开发项目目录")?.to_path_buf();
        let root = match project_root {
            Some(value) if !value.trim().is_empty() => PathBuf::from(value),
            _ if cfg!(debug_assertions) => dev_root.clone(),
            _ => return Err("PROJECT_REQUIRED".to_string()),
        };
        let root = node_path::for_node(&root);
        if !root.is_absolute() || !root.is_dir() {
            return Err("请选择有效的项目文件夹".to_string());
        }
        // The selected project supplies data scope, never executable code.
        let bootstrap = if cfg!(debug_assertions) {
            dev_root.join("apps/project-tasks/bootstrap.mjs")
        } else {
            resource_dir.join("project-tasks/bootstrap.mjs")
        };
        if !bootstrap.is_file() {
            return Err("当前 A4 Note 缺少任务服务资源，请更新包含一键启动功能的版本".into());
        }
        let port = port.unwrap_or(4319);
        if port < 1024 { return Err("请选择1024以上的端口".into()); }
        let mut command = Command::new("node");
        command.arg(node_path::for_node(&bootstrap)).arg(&root).arg(port.to_string()).arg("--register-project")
            .current_dir(&root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "没有找到 Node.js。请安装22.13以上版本后重启 A4 Note".to_string()
            } else { format!("无法启动任务服务：{e}") }
        })?;
        let deadline = Instant::now() + Duration::from_secs(25);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
                Ok(None) => { let _ = child.kill(); let _ = child.wait(); return Err("本机启动请求超时，请重试或检查服务日志".into()); }
                Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(format!("无法读取启动状态：{error}")); }
            }
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().chars().take(1500).collect());
        }
        let result: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "启动服务返回了无效数据")?;
        let parsed = result["url"].as_str().and_then(|s| tauri::Url::parse(s).ok());
        let valid = parsed.as_ref().map(|u| {
            let expected_path = result["projectId"].as_str().map(|id| format!("/projects/{id}"));
            u.scheme() == "http" && u.host_str() == Some("127.0.0.1")
                && u.port().is_some_and(|p| p >= 1024) && u.username().is_empty()
                && u.password().is_none() && u.query().is_none() && u.fragment().is_none()
                && expected_path.as_deref() == Some(u.path())
        }).unwrap_or(false);
        if !valid || !result["operatorToken"].is_string() {
            return Err("本机连接信息无效".into());
        }
        // No logging: this result contains a local owner credential.
        Ok(result)
    }).await.map_err(|e| format!("启动任务未完成：{e}"))?
}
