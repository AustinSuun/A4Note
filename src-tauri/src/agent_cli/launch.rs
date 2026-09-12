//! What to spawn, where, and with which environment.
//!
//! Two rules live here because both are easy to get wrong once and never notice:
//! the parent Agent session's variables must not leak into the child (A4Note is
//! itself developed inside Claude Code, so they are always set), and on Windows
//! these CLIs are npm shims that only run through `cmd`, which makes every
//! program name and argument a potential shell injection.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::protocol::{AgentError, AgentErrorKind};

/// Variables the parent Agent session exports. Left in place, a child `claude`
/// believes it is a nested session and behaves differently — see
/// `CLI_REUSE_STRATEGY.md` §4.9.
pub const STRIPPED_ENV_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_AGENT_SDK_VERSION",
];

/// Characters `cmd.exe` reinterprets. A program name or argument containing one
/// of these is refused rather than escaped: nothing A4Note passes needs them, so
/// their presence means something built the config from untrusted input.
const SHELL_METACHARACTERS: &[char] = &['&', '|', '<', '>', '^', '"', '%', '\r', '\n'];

/// Windows creates a console window for `cmd.exe` unless told not to. The app has
/// no console of its own (`windows_subsystem = "windows"`), so without this every
/// session start flashes a black box.
#[cfg(target_os = "windows")]
pub(super) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchConfig {
    /// A bare command name resolved through `PATH`, or an absolute path.
    pub program: String,
    pub args: Vec<String>,
    /// The session's working directory. Must exist: the constraint that it is the
    /// Project root or a folder the user picked is enforced by the caller, but a
    /// path that is simply gone must fail before the process starts.
    pub working_directory: PathBuf,
    /// Extra variables to set, applied after the strip list.
    pub env: Vec<(String, String)>,
}

impl LaunchConfig {
    pub fn new(program: impl Into<String>, working_directory: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            working_directory: working_directory.into(),
            env: Vec::new(),
        }
    }

    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }

    /// True when the program has to go through `cmd`. npm installs `codex` and
    /// `claude` as `.cmd` / `.ps1` shims plus an extensionless file; only a real
    /// `.exe` can be executed directly.
    pub fn requires_shell(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            let extension = Path::new(&self.program)
                .extension()
                .map(|extension| extension.to_string_lossy().to_lowercase());
            !matches!(extension.as_deref(), Some("exe") | Some("com"))
        }

        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    }
}
impl LaunchConfig {
    /// Builds the process invocation. Every check that can fail without touching
    /// the process table happens here, so a bad config never becomes a half-open
    /// session.
    pub fn build_command(&self) -> Result<Command, AgentError> {
        let program = self.program.trim();
        if program.is_empty() {
            return Err(AgentError::new(AgentErrorKind::SpawnFailed, "命令名为空"));
        }
        validate_program(program)?;
        if self.requires_shell() {
            reject_metacharacters(program, "命令名")?;
            for arg in &self.args {
                reject_metacharacters(arg, "启动参数")?;
            }
        }
        if !self.working_directory.is_dir() {
            return Err(AgentError::new(
                AgentErrorKind::SpawnFailed,
                format!("工作目录不存在：{}", self.working_directory.display()),
            ));
        }

        let mut command = if self.requires_shell() {
            let mut command = Command::new("cmd");
            command.arg("/C").arg(program).args(&self.args);
            command
        } else {
            let mut command = Command::new(program);
            command.args(&self.args);
            command
        };
        command
            .current_dir(&self.working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for variable in STRIPPED_ENV_VARS {
            command.env_remove(variable);
        }
        for (key, value) in &self.env {
            command.env(key, value);
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        #[cfg(unix)]
        {
            // Own process group, so the stop ladder can signal the whole tree: an
            // npm shim's grandchildren are what survive a plain kill.
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        Ok(command)
    }
}

/// A bare name must look like an executable name. A path is allowed as-is: the
/// caller may hand over the executable that detection already resolved.
fn validate_program(program: &str) -> Result<(), AgentError> {
    if looks_like_path(program) {
        return Ok(());
    }
    if program.chars().all(is_safe_program_char) {
        return Ok(());
    }
    Err(AgentError::new(
        AgentErrorKind::SpawnFailed,
        format!("命令名不合法：{program}"),
    ))
}

/// Whether the program names a location instead of something `PATH` resolves.
/// `c:relative` counts too — a drive-relative path is still a path.
fn looks_like_path(program: &str) -> bool {
    program.contains('/')
        || program.contains('\\')
        || Path::new(program).is_absolute()
        || program.len() > 1 && program.as_bytes()[1] == b':'
}

/// Finds a bare command name on `PATH`, honouring `PATHEXT` on Windows.
///
/// Needed because `cmd /C codex` starts successfully even when `codex` does not
/// exist — the shim shell is what spawned, and the missing tool only surfaces as
/// exit code 1 much later. Looking first is what keeps `NotInstalled` reachable on
/// Windows. (`workspace_fs::locate_executable` is the detection-side copy of this
/// walk; the two should be folded together once detection moves behind a provider.)
pub fn resolve_program(name: &str) -> Option<PathBuf> {
    if looks_like_path(name) {
        let path = PathBuf::from(name);
        return path.is_file().then_some(path);
    }
    let variable = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&variable) {
        for candidate in program_candidates(name) {
            let full = directory.join(candidate);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn program_candidates(name: &str) -> Vec<String> {
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    let mut candidates = vec![name.to_string()];
    for extension in extensions.split(';') {
        let extension = extension.trim();
        if !extension.is_empty() {
            candidates.push(format!("{name}{extension}"));
        }
    }
    candidates
}

#[cfg(not(target_os = "windows"))]
fn program_candidates(name: &str) -> Vec<String> {
    vec![name.to_string()]
}

fn is_safe_program_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '-' || value == '_' || value == '.'
}

fn reject_metacharacters(value: &str, label: &str) -> Result<(), AgentError> {
    match value
        .chars()
        .find(|value| SHELL_METACHARACTERS.contains(value))
    {
        Some(found) => Err(AgentError::new(
            AgentErrorKind::SpawnFailed,
            format!("{label}包含 shell 元字符 {found:?}：{value}"),
        )),
        None => Ok(()),
    }
}

/// The variables a spawned child will actually see removed. Exposed so the
/// supervisor can log the policy without rebuilding a `Command`.
pub fn stripped_env_vars() -> Vec<OsString> {
    STRIPPED_ENV_VARS.iter().map(OsString::from).collect()
}
#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> LaunchConfig {
        LaunchConfig::new("codex", std::env::temp_dir()).arg("app-server")
    }

    fn envs(command: &Command) -> Vec<(String, Option<String>)> {
        command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.map(|value| value.to_string_lossy().to_string()),
                )
            })
            .collect()
    }

    #[test]
    fn removes_the_parent_session_variables_and_keeps_the_extras() {
        let command = config()
            .env("A4NOTE_SESSION", "s1")
            .build_command()
            .expect("a plain config should build");
        let envs = envs(&command);
        for variable in STRIPPED_ENV_VARS {
            assert!(
                envs.iter()
                    .any(|(key, value)| key == variable && value.is_none()),
                "{variable} 必须从子进程环境中删除",
            );
        }
        assert!(envs
            .iter()
            .any(|(key, value)| key == "A4NOTE_SESSION" && value.as_deref() == Some("s1")));
        assert_eq!(
            command.get_current_dir(),
            Some(std::env::temp_dir().as_path())
        );
    }

    #[test]
    fn a_missing_working_directory_fails_before_the_process_starts() {
        let config = LaunchConfig::new("codex", std::env::temp_dir().join("a4note-not-there-42"));
        let error = config.build_command().expect_err("路径不存在必须失败");
        assert_eq!(error.kind, AgentErrorKind::SpawnFailed);
        assert!(error.message.contains("工作目录不存在"));
    }

    #[test]
    fn rejects_a_program_name_a_shell_could_reinterpret() {
        let config = LaunchConfig::new("codex & calc", std::env::temp_dir());
        let error = config.build_command().expect_err("命令名必须被校验");
        assert_eq!(error.kind, AgentErrorKind::SpawnFailed);
        let empty = LaunchConfig::new("   ", std::env::temp_dir());
        assert_eq!(
            empty.build_command().expect_err("空命令名必须失败").message,
            "命令名为空"
        );
    }

    #[test]
    fn the_shim_shell_is_only_used_where_it_is_needed() {
        let command = config().build_command().expect("config should build");
        let program = command.get_program().to_string_lossy().to_string();
        let args: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();

        #[cfg(target_os = "windows")]
        {
            // A bare npm shim only runs through cmd; a real .exe does not.
            assert_eq!(program, "cmd");
            assert_eq!(args, vec!["/C", "codex", "app-server"]);
            assert!(config().requires_shell());
            assert!(!LaunchConfig::new("codex.exe", std::env::temp_dir()).requires_shell());

            let error = config()
                .arg("--flag=a|b")
                .build_command()
                .expect_err("经过 cmd 的参数必须校验元字符");
            assert!(error.message.contains("shell 元字符"));
        }

        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(program, "codex");
            assert_eq!(args, vec!["app-server"]);
            assert!(!config().requires_shell());
        }
    }

    #[test]
    fn resolves_a_bare_name_through_path_and_reports_a_missing_one() {
        // A program every supported OS ships, so this asserts the PATH walk and
        // not whatever the developer happens to have installed.
        let known = if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        };
        assert!(
            resolve_program(known).is_some(),
            "{known} 必须能在 PATH 中找到"
        );
        assert!(resolve_program("a4note-no-such-cli-42").is_none());
        // A path is checked as a path instead of being looked up on PATH.
        let absent = std::env::temp_dir().join("a4note-no-such-cli-42");
        assert!(resolve_program(&absent.to_string_lossy()).is_none());
    }
}
