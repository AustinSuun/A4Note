//! Explicit user-triggered task service launch and exit-time lifecycle; never runs during app setup.
use std::{path::{Path, PathBuf}, process::{Command, Stdio}, sync::{Mutex, MutexGuard}, time::{Duration, Instant}};
use tauri::{Emitter, Manager};
#[path = "project_tasks_path.rs"]
mod node_path;

/// Event asking the WebView to run the exit confirmation flow for the task service.
pub const EXIT_EVENT: &str = "a4note://task-service-exit";
/// If the WebView does not answer within this window, the next close proceeds (crash-safe valve).
const EXIT_PROMPT_GRACE: Duration = Duration::from_secs(10);

/// What this app process knows about the shared gateway it launched or reused.
struct Lifecycle {
    /// `start_project_tasks` succeeded in this process, so exit may stop the service.
    launched: bool,
    /// User preference: leave the service running in the background after exit.
    keep_running: bool,
    /// Stop already happened or was explicitly waived for this exit.
    exit_decided: bool,
    /// WebView confirmation in flight since this instant.
    exit_prompt: Option<Instant>,
    /// WebView confirmed exit; closes are no longer intercepted.
    exit_confirmed: bool,
}
static LIFECYCLE: Mutex<Lifecycle> = Mutex::new(Lifecycle {
    launched: false,
    keep_running: false,
    exit_decided: false,
    exit_prompt: None,
    exit_confirmed: false,
});
fn lifecycle() -> MutexGuard<'static, Lifecycle> {
    LIFECYCLE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn dev_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf).ok_or_else(|| "无法确定开发项目目录".to_string())
}

fn lifecycle_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let script = if cfg!(debug_assertions) {
        dev_root()?.join("apps/project-tasks/gateway-lifecycle.mjs")
    } else {
        app.path().resource_dir().map_err(|e| e.to_string())?.join("project-tasks/gateway-lifecycle.mjs")
    };
    if !script.is_file() {
        return Err("当前 A4 Note 缺少任务服务生命周期资源，请更新版本".into());
    }
    Ok(script)
}

/// Runs `gateway-lifecycle.mjs <action> [--k=v...]`; the script only ever acts on the gateway whose
/// private record, live identity and pid agree, so this wrapper never receives ports or pids to kill.
fn run_lifecycle(script: &Path, action: &str, extra: &[String], timeout: Duration) -> Result<serde_json::Value, String> {
    let mut command = Command::new("node");
    command.arg(node_path::for_node(script)).arg(action).args(extra)
        .current_dir(script.parent().ok_or("无效的脚本目录")?)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound { "没有找到 Node.js，无法检查或停止任务服务".to_string() } else { format!("无法运行任务服务生命周期脚本：{e}") }
    })?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => { let _ = child.kill(); let _ = child.wait(); return Err("任务服务生命周期脚本超时".into()); }
            Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(format!("无法读取脚本状态：{error}")); }
        }
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().chars().take(1500).collect());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "任务服务生命周期脚本返回了无效数据".to_string())
}

/// Read-only: identity and activity of the recorded gateway (pid, agents recently online, open streams).
#[tauri::command]
pub async fn inspect_project_tasks(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let script = lifecycle_script(&app)?;
    tauri::async_runtime::spawn_blocking(move || run_lifecycle(&script, "inspect", &[], Duration::from_secs(8)))
        .await.map_err(|e| format!("检查任务服务未完成：{e}"))?
}

/// Graceful stop (HTTP/SSE close, SQLite close) with bounded, identity-rechecked termination as fallback.
#[tauri::command]
pub async fn stop_project_tasks(app: tauri::AppHandle, reason: Option<String>) -> Result<serde_json::Value, String> {
    let script = lifecycle_script(&app)?;
    let reason = reason.unwrap_or_default().chars().filter(|c| !c.is_control()).take(120).collect::<String>();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_lifecycle(&script, "stop", &[format!("--reason={reason}")], Duration::from_secs(20))
    }).await.map_err(|e| format!("停止任务服务未完成：{e}"))??;
    if result["stopped"].as_bool() == Some(true) {
        lifecycle().exit_decided = true;
    }
    Ok(result)
}

#[tauri::command]
pub fn set_project_tasks_exit_policy(keep_running: bool) {
    lifecycle().keep_running = keep_running;
}

/// WebView answer to `EXIT_EVENT`: proceed (optionally leaving the stop to `shutdown_on_exit`) or cancel.
#[tauri::command]
pub fn resolve_app_exit(app: tauri::AppHandle, proceed: bool, stop_service: bool) {
    {
        let mut state = lifecycle();
        if proceed {
            state.exit_confirmed = true;
            if !stop_service { state.exit_decided = true; }
        } else {
            state.exit_prompt = None;
        }
    }
    if proceed { app.exit(0); }
}

/// Intercepts the close of a window only while a service this process launched would be stopped,
/// so the WebView can disclose the disconnection impact first. Never blocks close for longer than the grace window.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else { return };
    let mut state = lifecycle();
    if !state.launched || state.keep_running || state.exit_decided || state.exit_confirmed { return; }
    if let Some(started) = state.exit_prompt {
        if started.elapsed() <= EXIT_PROMPT_GRACE { api.prevent_close(); }
        return;
    }
    state.exit_prompt = Some(Instant::now());
    api.prevent_close();
    drop(state);
    let _ = window.emit(EXIT_EVENT, serde_json::json!({ "graceMs": EXIT_PROMPT_GRACE.as_millis() as u64 }));
}

/// Last-resort stop on `RunEvent::Exit` when the WebView flow did not already decide (hung UI, forced close).
pub fn shutdown_on_exit(app: &tauri::AppHandle) {
    let pending = { let state = lifecycle(); state.launched && !state.keep_running && !state.exit_decided };
    if !pending { return; }
    if let Ok(script) = lifecycle_script(app) {
        let _ = run_lifecycle(&script, "stop", &["--reason=app-exit".to_string()], Duration::from_secs(12));
    }
    lifecycle().exit_decided = true;
}

/// Minimum Node.js the task service is supported on.
const MIN_NODE: (u32, u32) = (22, 13);

/// Parse "v22.13.1" / "22.13.1" into (major, minor).
fn parse_node_version(raw: &str) -> Option<(u32, u32)> {
    let text = raw.trim();
    let text = text.strip_prefix('v').unwrap_or(text);
    let mut parts = text.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((major, minor))
}

/// Read-only environment probe for the one-click binding guide.
///
/// This never starts, stops or contacts a service: it only reports what the user
/// would run into, so the UI can explain the blocker before anything is launched.
/// A port that is already listening is reported, not seized; deciding whether it is
/// a reusable A4 service or a foreign process stays with the existing launch path.
#[tauri::command]
pub async fn preflight_project_tasks(
    app: tauri::AppHandle,
    project_root: Option<String>,
    port: Option<u16>,
) -> Result<serde_json::Value, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent()
            .ok_or("无法确定开发项目目录")?.to_path_buf();

        // --- Node.js presence and version ---
        let mut node = Command::new("node");
        node.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            node.creation_flags(0x08000000);
        }
        let (node_status, node_version, node_detail) = match node.output() {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (
                "missing", String::new(),
                format!("没有找到 Node.js。请安装 {}.{} 以上版本后重启 A4 Note。", MIN_NODE.0, MIN_NODE.1),
            ),
            Err(e) => ("unknown", String::new(), format!("无法检查 Node.js：{e}")),
            Ok(out) => {
                let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
                match parse_node_version(&raw) {
                    Some(v) if v >= MIN_NODE => ("ok", raw, String::new()),
                    Some(_) => {
                        let detail = format!(
                            "当前 Node.js {raw} 低于要求的 {}.{}。请升级后重启 A4 Note。",
                            MIN_NODE.0, MIN_NODE.1
                        );
                        ("outdated", raw, detail)
                    }
                    None => ("unknown", raw.clone(), format!("无法解析 Node.js 版本：{raw}")),
                }
            }
        };

        // --- Bundled service resources ---
        let bootstrap = if cfg!(debug_assertions) {
            dev_root.join("apps/project-tasks/bootstrap.mjs")
        } else {
            resource_dir.join("project-tasks/bootstrap.mjs")
        };
        let resources_ok = bootstrap.is_file();

        // --- Project folder ---
        let (project_status, project_path) = match project_root {
            Some(value) if !value.trim().is_empty() => {
                let root = node_path::for_node(&PathBuf::from(value));
                let ok = root.is_absolute() && root.is_dir();
                (if ok { "ok" } else { "invalid" }, root.to_string_lossy().to_string())
            }
            _ => ("unset", String::new()),
        };

        // --- Port availability (report only, never seize) ---
        let port = port.unwrap_or(4319);
        let (port_status, port_detail) = if port < 1024 {
            ("invalid", "请选择 1024 以上的端口。".to_string())
        } else {
            match std::net::TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => { drop(listener); ("free", String::new()) }
                Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => (
                    "in_use",
                    format!("端口 {port} 已被占用。可能是已在运行的任务服务（可直接连接），也可能是其他程序；A4 Note 不会结束占用进程。"),
                ),
                Err(e) => ("unknown", format!("无法检查端口 {port}：{e}")),
            }
        };

        let ready = node_status == "ok" && resources_ok && project_status == "ok"
            && (port_status == "free" || port_status == "in_use");

        Ok(serde_json::json!({
            "ready": ready,
            "node": { "status": node_status, "version": node_version, "detail": node_detail,
                      "required": format!("{}.{}", MIN_NODE.0, MIN_NODE.1) },
            "resources": { "status": if resources_ok { "ok" } else { "missing" },
                           "detail": if resources_ok { String::new() }
                                     else { "当前 A4 Note 缺少任务服务资源，请更新包含一键启动功能的版本。".to_string() } },
            "project": { "status": project_status, "path": project_path },
            "port": { "status": port_status, "value": port, "detail": port_detail },
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

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
        lifecycle().launched = true;
        Ok(result)
    }).await.map_err(|e| format!("启动任务未完成：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real Node run of the packaged lifecycle script against an empty private directory:
    // it must report "none" and must not create records or touch any process.
    #[cfg(windows)]
    #[test]
    fn lifecycle_script_reports_none_for_empty_state_dir() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let script = dev_root().unwrap().join("apps/project-tasks/gateway-lifecycle.mjs");
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let state_dir = std::env::temp_dir().join(format!("a4-lifecycle-rs-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&state_dir).unwrap();
        let arg = format!("--state-dir={}", state_dir.display());
        let inspected = run_lifecycle(&script, "inspect", &[arg.clone()], Duration::from_secs(20)).unwrap();
        assert_eq!(inspected["state"], "none");
        let stopped = run_lifecycle(&script, "stop", &[arg], Duration::from_secs(20)).unwrap();
        assert_eq!(stopped["stopped"], false);
        assert_eq!(stopped["skipped"], true);
        assert!(std::fs::read_dir(&state_dir).unwrap().next().is_none(), "no records may be created");
        std::fs::remove_dir_all(state_dir).unwrap();
    }

    #[test]
    fn exit_policy_and_decisions_gate_the_fallback_stop() {
        let mut state = lifecycle();
        *state = Lifecycle { launched: false, keep_running: false, exit_decided: false, exit_prompt: None, exit_confirmed: false };
        let pending = |s: &Lifecycle| s.launched && !s.keep_running && !s.exit_decided;
        assert!(!pending(&state), "nothing launched: never stop");
        state.launched = true;
        assert!(pending(&state));
        state.keep_running = true;
        assert!(!pending(&state), "user keeps the service");
        state.keep_running = false;
        state.exit_decided = true;
        assert!(!pending(&state), "already stopped or waived");
        *state = Lifecycle { launched: false, keep_running: false, exit_decided: false, exit_prompt: None, exit_confirmed: false };
    }
}
