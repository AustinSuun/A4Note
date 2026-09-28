//! Doc2X CLI execution bridge (doc2x-translate-0).
//!
//! The Doc2X CLI (`doc2x`, an npm package) is a plain executable: no protocol,
//! just a process. Two shapes are needed and neither fits the synchronous
//! `run_project_command` (no timeout, blocks the UI thread):
//!
//! * `run_doc2x_command` — a bounded run for translate/parse/account/models.
//! * `start_doc2x_login` + `cancel_doc2x_job` — a long run that waits for the
//!   user to finish the browser OAuth callback, streamed as events.
//!
//! Credentials never cross this boundary. The CLI owns its own token file and
//! only prints human-readable progress, so nothing here reads, copies or
//! forwards a token; the frontend is expected to keep it that way.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// Single event channel. Every payload names its `jobId`, so one listener can
/// route to the right UI surface.
pub const DOC2X_EVENT: &str = "doc2x://event";

/// The executable name. Callers pass arguments only, never a command string,
/// so a shell is never involved.
pub const DOC2X_COMMAND: &str = "doc2x";

/// Default ceiling for one run. Doc2X publishes no queryable task limit, and a
/// hung run must not keep the UI waiting forever.
pub const DEFAULT_TIMEOUT_MS: u64 = 15 * 60 * 1000;
pub const MAX_TIMEOUT_MS: u64 = 60 * 60 * 1000;
const MIN_TIMEOUT_MS: u64 = 1_000;
const OUTPUT_TAIL_CHARS: usize = 8_192;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Doc2xCommandRequest {
    pub cwd: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// Mirrors `Doc2xCommandResult` in `src/platform/doc2x/doc2xCli.ts`.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Doc2xCommandResult {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
    /// True when the run was killed at the timeout; never report success then.
    pub timed_out: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Doc2xJobEvent {
    pub job_id: String,
    /// `stdout`, `stderr` or `status`.
    pub stream: String,
    pub line: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Doc2xJobExit {
    pub job_id: String,
    /// `None` when the process was killed by a signal or never produced a code.
    pub status: Option<i32>,
    pub timed_out: bool,
}

/// Live login processes, so the UI can cancel one the user abandoned. A process
/// registry rather than managed Tauri state keeps `lib.rs` a module list plus
/// `run()`: wiring a command costs nothing here.
static JOBS: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();

fn jobs() -> &'static Mutex<HashMap<String, Child>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn insert_job(job_id: String, child: Child) {
    if let Ok(mut guard) = jobs().lock() {
        guard.insert(job_id, child);
    }
}

fn remove_job(job_id: &str) -> Option<Child> {
    jobs().lock().ok().and_then(|mut guard| guard.remove(job_id))
}

/// Rejects argument shapes that would change whose account is used or break the
/// spawn: newlines (log/terminal injection) and `--auth-mode client`, which
/// would silently translate with the Doc2X desktop account instead of the
/// account the user logged into from our UI.
pub fn validate_doc2x_args(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Doc2X 命令缺少参数".to_string());
    }
    for arg in args {
        if arg.contains('\n') || arg.contains('\r') || arg.contains('\0') {
            return Err("Doc2X 参数不能包含换行".to_string());
        }
        if arg.is_empty() {
            return Err("Doc2X 参数不能为空".to_string());
        }
    }
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--auth-mode" {
            let value = args.get(index + 1).map(String::as_str).unwrap_or_default();
            if value != "oauth" {
                return Err("Doc2X 只能使用本机 CLI 登录的账号（--auth-mode oauth）".to_string());
            }
            index += 2;
            continue;
        }
        index += 1;
    }
    Ok(())
}

pub fn clamp_timeout_ms(requested: Option<u64>) -> u64 {
    match requested {
        Some(value) if value < MIN_TIMEOUT_MS => MIN_TIMEOUT_MS,
        Some(value) if value > MAX_TIMEOUT_MS => MAX_TIMEOUT_MS,
        Some(value) => value,
        None => DEFAULT_TIMEOUT_MS,
    }
}

/// Keeps the tail of a stream: the exit reason and the last error line live at
/// the end, and a 300 MB PDF parse can print a lot before that.
pub fn tail_chars(text: &str, limit: usize) -> String {
    let count = text.chars().count();
    if count <= limit {
        return text.to_string();
    }
    text.chars().skip(count - limit).collect()
}

fn resolve_cwd(raw: &str) -> Result<std::path::PathBuf, String> {
    crate::workspace_fs::resolve_existing_path(raw)
}

fn build_command(request: &Doc2xCommandRequest) -> Result<Command, String> {
    validate_doc2x_args(&request.args)?;
    let cwd = resolve_cwd(&request.cwd)?;
    if !cwd.is_dir() {
        return Err("Doc2X 工作目录必须是文件夹".to_string());
    }
    let mut command = Command::new(DOC2X_COMMAND);
    command.args(&request.args).current_dir(cwd);
    Ok(command)
}

/// A bounded CLI run. Runs on a blocking thread so the UI stays responsive, and
/// kills the process at the timeout instead of leaving a zombie translate job.
#[tauri::command(async)]
pub async fn run_doc2x_command(request: Doc2xCommandRequest) -> Result<Doc2xCommandResult, String> {
    let timeout = clamp_timeout_ms(request.timeout_ms);
    let mut command = build_command(&request)?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 doc2x 命令：{error}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_handle = std::thread::spawn(move || {
        stdout
            .map(|pipe| BufReader::new(pipe).lines().map_while(Result::ok).collect::<Vec<_>>().join("\n"))
            .unwrap_or_default()
    });
    let stderr_handle = std::thread::spawn(move || {
        stderr
            .map(|pipe| BufReader::new(pipe).lines().map_while(Result::ok).collect::<Vec<_>>().join("\n"))
            .unwrap_or_default()
    });

    let started = std::time::Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started.elapsed() >= Duration::from_millis(timeout) {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(error) => return Err(format!("等待 doc2x 命令结束失败：{error}")),
        }
    };

    let stdout_text = stdout_handle.join().unwrap_or_default();
    let stderr_text = stderr_handle.join().unwrap_or_default();
    Ok(Doc2xCommandResult {
        status: status.and_then(|status| status.code()).unwrap_or(-1),
        stdout: tail_chars(&stdout_text, OUTPUT_TAIL_CHARS),
        stderr: tail_chars(&stderr_text, OUTPUT_TAIL_CHARS),
        timed_out,
    })
}

fn next_job_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    format!("doc2x-{millis}-{sequence}")
}

fn emit(app: &AppHandle, event: Doc2xJobEvent) {
    let _ = app.emit(DOC2X_EVENT, event);
}

/// `doc2x login` opens the browser on this machine and waits for the OAuth
/// callback on a loopback port, so it has to stream rather than block. The
/// caller may cancel it; the CLI keeps or clears its own token file.
  #[tauri::command(async)]
  pub async fn start_doc2x_login(app: AppHandle, request: Doc2xCommandRequest) -> Result<String, String> {
      let command = build_command(&request)?;
      spawn_streamed(&app, command)
  }

/// Cancels a login the user abandoned. Returns false when the job already
/// finished, which is not an error worth surfacing.
#[tauri::command(async)]
pub async fn cancel_doc2x_job(job_id: String) -> Result<bool, String> {
    match remove_job(&job_id) {
        Some(mut child) => {
            let _ = child.kill();
            let _ = child.wait();
            Ok(true)
        }
        None => Ok(false),
    }
}

  /// npm package that ships the `doc2x` executable.
  pub const DOC2X_CLI_PACKAGE: &str = "@noedgeai-org/doc2x-cli";

  #[derive(Debug, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct Doc2xInstallRequest {
      pub cwd: String,
      /// Optional npm mirror, for networks where the default registry is slow.
      #[serde(default)]
      pub registry: Option<String>,
  }

  /// Shared streaming runner: line events on `doc2x://event`, a final exit
  /// event, and the child kept in the registry so the UI can cancel it.
  fn spawn_streamed(app: &AppHandle, mut command: Command) -> Result<String, String> {
      command.stdout(Stdio::piped()).stderr(Stdio::piped());
      let mut child = command
          .spawn()
          .map_err(|error| format!("无法启动 doc2x 命令：{error}"))?;

      let job_id = next_job_id();
      let stdout = child.stdout.take();
      let stderr = child.stderr.take();
      insert_job(job_id.clone(), child);

      let out_app = app.clone();
      let out_job = job_id.clone();
      std::thread::spawn(move || {
          if let Some(pipe) = stdout {
              for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                  emit(
                      &out_app,
                      Doc2xJobEvent {
                          job_id: out_job.clone(),
                          stream: "stdout".to_string(),
                          line,
                      },
                  );
              }
          }
      });
      let err_app = app.clone();
      let err_job = job_id.clone();
      std::thread::spawn(move || {
          if let Some(pipe) = stderr {
              for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                  emit(
                      &err_app,
                      Doc2xJobEvent {
                          job_id: err_job.clone(),
                          stream: "stderr".to_string(),
                          line,
                      },
                  );
              }
          }
      });

      let wait_app = app.clone();
      let wait_job = job_id.clone();
      std::thread::spawn(move || {
          let outcome = remove_job(&wait_job).and_then(|mut child| child.wait().ok());
          let status = outcome.as_ref().and_then(|status| status.code());
          let _ = wait_app.emit(
              DOC2X_EVENT,
              Doc2xJobExit {
                  job_id: wait_job,
                  status,
                  timed_out: false,
              },
          );
      });

      Ok(job_id)
  }

  /// Windows cannot spawn `npm.cmd` through CreateProcess, so the installer
  /// runs `node <npm-cli.js> install -g <package>` with the node on PATH.
  fn node_executable() -> Option<PathBuf> {
      let paths = std::env::var_os("PATH")?;
      let names: &[&str] = if cfg!(windows) { &["node.exe"] } else { &["node"] };
      for dir in std::env::split_paths(&paths) {
          for name in names {
              let candidate = dir.join(name);
              if candidate.is_file() {
                  return Some(candidate);
              }
          }
      }
      None
  }

  pub fn npm_cli_js_for(node: &std::path::Path) -> PathBuf {
      let root = node.parent().unwrap_or_else(|| std::path::Path::new("."));
      root.join("node_modules").join("npm").join("bin").join("npm-cli.js")
  }

  /// A mirror is user supplied, so it has to be a plain https URL: anything
  /// else could break the spawn or silently redirect the install.
  pub fn validate_doc2x_registry(registry: Option<&str>) -> Result<Option<String>, String> {
      match registry {
          None => Ok(None),
          Some(value) => {
              let trimmed = value.trim();
              if trimmed.is_empty() {
                  return Ok(None);
              }
              if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.contains('\0') {
                  return Err("npm 镜像地址不能包含换行".to_string());
              }
              if trimmed.split_whitespace().count() != 1 {
                  return Err("npm 镜像地址不能包含空格".to_string());
              }
              if !trimmed.starts_with("https://") {
                  return Err("npm 镜像地址必须以 https:// 开头".to_string());
              }
              Ok(Some(trimmed.to_string()))
          }
      }
  }

  pub fn build_doc2x_install_command(
      cwd: &std::path::Path,
      registry: Option<&str>,
  ) -> Result<Command, String> {
      let node = node_executable().ok_or_else(|| {
          "未找到 Node.js：请先安装 Node.js 22 或更高版本（https://nodejs.org）".to_string()
      })?;
      let npm_cli = npm_cli_js_for(&node);
      if !npm_cli.is_file() {
          return Err(
              "未找到 npm：请确认 Node.js 安装完整，或在终端手动执行 npm i -g @noedgeai-org/doc2x-cli"
                  .to_string(),
          );
      }
      let mut command = Command::new(node);
      command
          .arg(npm_cli)
          .arg("install")
          .arg("-g")
          .arg(DOC2X_CLI_PACKAGE);
      if let Some(value) = validate_doc2x_registry(registry)? {
          command.arg("--registry").arg(value);
      }
      command.current_dir(cwd);
      Ok(command)
  }

  /// Installs the CLI the user explicitly asked for. Streamed like login
  /// because a global install takes minutes; never runs on its own.
  #[tauri::command(async)]
  pub async fn install_doc2x_cli(app: AppHandle, request: Doc2xInstallRequest) -> Result<String, String> {
      let cwd = resolve_cwd(&request.cwd)?;
      if !cwd.is_dir() {
          return Err("Doc2X 工作目录必须是文件夹".to_string());
      }
      let command = build_doc2x_install_command(&cwd, request.registry.as_deref())?;
      spawn_streamed(&app, command)
  }

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn accepts_oauth_pinned_task_args() {
        assert!(validate_doc2x_args(&args(&[
            "translate",
            "D:/paper.pdf",
            "--auth-mode",
            "oauth",
            "--json",
        ]))
        .is_ok());
    }

    #[test]
    fn rejects_desktop_account_auth_mode() {
        let error = validate_doc2x_args(&args(&["account", "status", "--auth-mode", "client"])).unwrap_err();
        assert!(error.contains("oauth"));
    }

    #[test]
    fn rejects_missing_auth_mode_value() {
        assert!(validate_doc2x_args(&args(&["models", "list", "--auth-mode"])).is_err());
    }

    #[test]
    fn rejects_newlines_and_empty_args() {
        assert!(validate_doc2x_args(&args(&["translate", "a\nb"])).is_err());
        assert!(validate_doc2x_args(&args(&[""])).is_err());
        assert!(validate_doc2x_args(&[]).is_err());
    }

    #[test]
    fn clamps_timeouts() {
        assert_eq!(clamp_timeout_ms(None), DEFAULT_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(10)), MIN_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(u64::MAX)), MAX_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(30_000)), 30_000);
    }

    #[test]
    fn keeps_only_the_output_tail() {
        assert_eq!(tail_chars("short", 32), "short");
        let long: String = "x".repeat(40);
        assert_eq!(tail_chars(&long, 10).chars().count(), 10);
        assert_eq!(tail_chars("中文输出保留尾部", 4), "保留尾部");
    }
      #[test]
      fn install_command_targets_the_published_package() {
          if let Some(node) = node_executable() {
              if npm_cli_js_for(&node).is_file() {
                  let command = build_doc2x_install_command(std::path::Path::new("."), None).expect("command");
                  let debug = format!("{command:?}");
                  assert!(debug.contains("install"));
                  assert!(debug.contains(DOC2X_CLI_PACKAGE));
              }
          }
      }

      #[test]
      fn install_command_pins_a_mirror_only_when_asked() {
          if let Some(node) = node_executable() {
              if npm_cli_js_for(&node).is_file() {
                  let plain = format!("{:?}", build_doc2x_install_command(std::path::Path::new("."), None).unwrap());
                  assert!(!plain.contains("--registry"));
                  let mirrored = format!("{:?}", build_doc2x_install_command(std::path::Path::new("."), Some("https://registry.npmmirror.com")).unwrap());
                  assert!(mirrored.contains("--registry"));
                  assert!(mirrored.contains("https://registry.npmmirror.com"));
              }
          }
      }

      #[test]
      fn rejects_registries_that_are_not_plain_https_urls() {
          assert!(validate_doc2x_registry(Some("http://mirror.example.com")).is_err());
          assert!(validate_doc2x_registry(Some("https://a\nb")).is_err());
          assert!(validate_doc2x_registry(Some("https://a b")).is_err());
          assert_eq!(validate_doc2x_registry(Some("  ")).unwrap(), None);
          assert_eq!(
              validate_doc2x_registry(Some("https://registry.npmmirror.com")).unwrap(),
              Some("https://registry.npmmirror.com".to_string())
          );
      }

}
