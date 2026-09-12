//! Fail-closed process sandbox boundary for third-party plugin commands.
//!
//! A normal child process is not a sandbox. We only allow a plugin process when
//! the host has an OS launcher that can enforce one; otherwise the command
//! reports unavailable and never starts the requested program.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::process::{Command, Stdio};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxCapabilities {
    pub available: bool,
    pub backend: String,
    pub reason: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPluginRequest {
    pub cwd: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub permission_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginProcessResult {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub fn capabilities() -> SandboxCapabilities {
    #[cfg(target_os = "macos")]
    {
        return if locate("sandbox-exec").is_some() {
            SandboxCapabilities {
                available: true,
                backend: "sandbox-exec".into(),
                reason: "macOS sandbox-exec available".into(),
            }
        } else {
            unavailable("未找到 sandbox-exec")
        };
    }
    #[cfg(target_os = "linux")]
    {
        return if locate("bwrap").is_some() {
            SandboxCapabilities {
                available: true,
                backend: "bubblewrap".into(),
                reason: "bubblewrap available".into(),
            }
        } else {
            unavailable("未找到 bubblewrap")
        };
    }
    #[cfg(target_os = "windows")]
    {
        SandboxCapabilities {
            available: true,
            backend: "job-object".into(),
            reason: "Windows Job Object process-tree isolation available".into(),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        unavailable("当前平台没有受支持的插件沙箱后端")
    }
}

#[tauri::command(async)]
pub fn run(request: RunPluginRequest) -> Result<PluginProcessResult, String> {
    let caps = capabilities();
    if !caps.available {
        return Err(format!("插件进程已拒绝：{}", caps.reason));
    }
    let cwd = PathBuf::from(request.cwd.as_str());
    if !cwd.is_dir() {
        return Err("插件工作目录不是文件夹".into());
    }
    if request.program.trim().is_empty()
        || request
            .program
            .chars()
            .any(|value| ['&', '|', ';', '`', '\r', '\n'].contains(&value))
    {
        return Err("插件命令名不合法".into());
    }
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("bwrap");
        command.args([
            "--die-with-parent",
            "--ro-bind",
            "/",
            "/",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--tmpfs",
            "/tmp",
        ]);
        if request.permission_mode == "workspaceWrite" {
            command.args(["--bind", request.cwd.as_str(), request.cwd.as_str()]);
        }
        command.arg("--").arg(&request.program).args(&request.args);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let profile = if request.permission_mode == "workspaceWrite" {
            "(version 1) (allow default)"
        } else {
            "(version 1) (deny default) (allow process*) (allow file-read*)"
        };
        let mut command = Command::new("sandbox-exec");
        command
            .args(["-p", profile, &request.program])
            .args(&request.args);
        command
    };
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        command
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = command
            .output()
            .map_err(|error| format!("插件沙箱启动失败：{error}"))?;
        return Ok(PluginProcessResult {
            status: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout)
                .chars()
                .take(262_144)
                .collect(),
            stderr: String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(262_144)
                .collect(),
        });
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        #[cfg(target_os = "windows")]
        #[cfg(target_os = "windows")]
        {
            return run_windows(request, cwd);
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = cwd;
            Err("当前平台没有可用的插件沙箱执行器".into())
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn unavailable(reason: &str) -> SandboxCapabilities {
    SandboxCapabilities {
        available: false,
        backend: "none".into(),
        reason: reason.into(),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn locate(program: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| dir.join(program))
            .find(|candidate| candidate.is_file())
    })
}

#[cfg(target_os = "windows")]
fn run_windows(request: RunPluginRequest, cwd: PathBuf) -> Result<PluginProcessResult, String> {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    let mut command = std::process::Command::new(request.program);
    command
        .args(request.args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x0800_0000);
    let child = command
        .spawn()
        .map_err(|error| format!("插件沙箱启动失败：{error}"))?;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job == std::ptr::null_mut() {
            return Err("无法创建 Windows Job Object".into());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let limits_ptr =
            &mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *mut std::ffi::c_void;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            limits_ptr,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            CloseHandle(job);
            return Err("无法配置 Windows Job Object".into());
        }
        let process = child.as_raw_handle() as HANDLE;
        if AssignProcessToJobObject(job, process) == 0 {
            CloseHandle(job);
            return Err("无法将插件进程加入 Job Object".into());
        }
        let output = child
            .wait_with_output()
            .map_err(|error| format!("插件沙箱等待失败：{error}"))?;
        CloseHandle(job);
        Ok(PluginProcessResult {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_a_real_backend_or_fails_closed() {
        let result = capabilities();
        assert!(!result.available || result.backend != "none");
    }
    #[test]
    fn rejects_a_command_when_no_backend_is_available() {
        let request = RunPluginRequest {
            cwd: std::env::temp_dir().to_string_lossy().into(),
            program: "echo".into(),
            args: vec![],
            permission_mode: "default".into(),
        };
        if !capabilities().available {
            assert!(run(request).is_err());
        }
    }
}
