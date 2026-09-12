//! The real CLI process behind [`AgentTransport`].
//!
//! Two things here are not obvious. Reading happens on its own threads because
//! `AgentTransport::read` must be able to time out and a blocking pipe read cannot;
//! the blocking is moved off the session thread and arrives as channel items.
//! And stopping is a ladder rather than one `kill` because these CLIs are npm
//! shims: `cmd /C claude` is the *grandparent* of the process doing the work, so
//! killing what we spawned would leave the real one running.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::launch::{resolve_program, LaunchConfig};
use super::protocol::{AgentError, AgentErrorKind, StderrTail};
use super::transport::{AgentTransport, ProcessExit, TransportRead};

/// How long each rung of the stop ladder waits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StopLadder {
    /// After stdin EOF. A well-behaved CLI exits here and is never killed.
    pub graceful: Duration,
    /// After a soft tree-kill, before the forced one.
    pub forceful: Duration,
    /// How often the child is reaped while waiting.
    pub poll: Duration,
}

impl Default for StopLadder {
    fn default() -> Self {
        Self {
            graceful: Duration::from_secs(2),
            forceful: Duration::from_secs(1),
            poll: Duration::from_millis(50),
        }
    }
}

impl StopLadder {
    /// The same rungs in milliseconds, so a test can exercise the escalation
    /// without adding seconds to the suite.
    pub fn fast() -> Self {
        Self {
            graceful: Duration::from_millis(200),
            forceful: Duration::from_millis(300),
            poll: Duration::from_millis(10),
        }
    }
}

/// A live CLI process presented as a transport: owns the child, its stdin, and the
/// two reader threads.
#[derive(Debug)]
pub struct ChildTransport {
    child: Child,
    /// Kept beside the child because `Child::id` is meaningless once the process
    /// has been reaped, and the tree-kill needs the pid.
    pid: u32,
    /// `None` once stdin has been closed. Dropping the handle is what sends EOF.
    stdin: Option<ChildStdin>,
    stdout: Receiver<String>,
    stderr: Arc<Mutex<StderrTail>>,
    /// Latched on the first observed exit, so later reads keep reporting it
    /// instead of blocking on a stream nobody will write to again.
    exit: Option<ProcessExit>,
    ladder: StopLadder,
}

impl ChildTransport {
    pub fn spawn(config: &LaunchConfig) -> Result<Self, AgentError> {
        Self::spawn_with(config, StopLadder::default())
    }

    pub fn spawn_with(config: &LaunchConfig, ladder: StopLadder) -> Result<Self, AgentError> {
        let mut command = config.build_command()?;
        // Checked before spawning, not after: through the Windows shim it is `cmd`
        // that starts, so a missing CLI would otherwise look like a protocol
        // failure rather than a tool the user has not installed.
        if resolve_program(config.program.trim()).is_none() {
            return Err(AgentError::new(
                AgentErrorKind::NotInstalled,
                format!("找不到命令：{}", config.program.trim()),
            ));
        }
        let mut child = command
            .spawn()
            .map_err(|error| spawn_error(config, error))?;
        let pid = child.id();
        let stdin = child.stdin.take();
        let (stdout, stderr) = match (child.stdout.take(), child.stderr.take()) {
            (Some(stdout), Some(stderr)) => (stdout, stderr),
            _ => {
                abandon(child, pid, ladder);
                return Err(AgentError::new(
                    AgentErrorKind::SpawnFailed,
                    "无法接管子进程的标准输入输出",
                ));
            }
        };
        let (sender, inbound) = channel();
        let tail = Arc::new(Mutex::new(StderrTail::new()));
        let sink = Arc::clone(&tail);
        let readers = thread::Builder::new()
            .name("a4note-agent-stdout".to_string())
            .spawn(move || pump_stdout(stdout, sender))
            .and(
                thread::Builder::new()
                    .name("a4note-agent-stderr".to_string())
                    .spawn(move || pump_stderr(stderr, sink)),
            );
        if let Err(error) = readers {
            // Without a reader thread the process would run unobserved forever.
            abandon(child, pid, ladder);
            return Err(
                AgentError::new(AgentErrorKind::SpawnFailed, "无法启动读取线程")
                    .with_detail(error.to_string()),
            );
        }
        Ok(Self {
            child,
            pid,
            stdin,
            stdout: inbound,
            stderr: tail,
            exit: None,
            ladder,
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// The exit, once one has been observed.
    pub fn exit(&self) -> Option<&ProcessExit> {
        self.exit.as_ref()
    }
}

impl AgentTransport for ChildTransport {
    fn write_line(&mut self, line: &str) -> Result<(), AgentError> {
        let stdin = self.stdin.as_mut().ok_or_else(|| {
            AgentError::new(AgentErrorKind::Transport, "stdin 已关闭，请求被丢弃")
        })?;
        write_line(stdin, line).map_err(|error| {
            AgentError::new(AgentErrorKind::Transport, "写入子进程 stdin 失败")
                .with_detail(error.to_string())
        })
    }

    fn read(&mut self, timeout: Duration) -> TransportRead {
        if let Some(exit) = &self.exit {
            return TransportRead::Closed(exit.clone());
        }
        // Drain what already arrived before paying the timeout, so a burst of
        // frames is delivered without one wait per frame.
        match self.stdout.try_recv() {
            Ok(line) => return TransportRead::Chunk(line),
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => return TransportRead::Closed(self.finish()),
        }
        match self.stdout.recv_timeout(timeout) {
            Ok(line) => TransportRead::Chunk(line),
            Err(RecvTimeoutError::Timeout) => TransportRead::Idle,
            Err(RecvTimeoutError::Disconnected) => TransportRead::Closed(self.finish()),
        }
    }

    fn close_stdin(&mut self) {
        // Dropping the handle is what sends the EOF.
        self.stdin = None;
    }

    fn take_stderr(&mut self) -> String {
        self.stderr
            .lock()
            .map(|mut tail| tail.take())
            .unwrap_or_default()
    }

    fn terminate(&mut self) -> Option<ProcessExit> {
        if let Some(exit) = &self.exit {
            return Some(exit.clone());
        }
        self.close_stdin();
        Some(self.finish())
    }
}

impl ChildTransport {
    /// Turns "the stream ended" into an exit. Reaps the child for its code, and
    /// takes the tree down if it closed stdout but kept running.
    fn finish(&mut self) -> ProcessExit {
        if let Some(exit) = &self.exit {
            return exit.clone();
        }
        let exit = match wait_for_status(&mut self.child, self.ladder.graceful, self.ladder.poll) {
            Some(exit) => exit,
            None => self.terminate_tree(),
        };
        self.exit = Some(exit.clone());
        exit
    }

    /// Soft tree-kill, then forced. Both target the whole tree: the npm shim's
    /// grandchildren are what survive a plain kill.
    fn terminate_tree(&mut self) -> ProcessExit {
        for force in [false, true] {
            tree_kill(self.pid, force);
            let reaped = wait_for_status(&mut self.child, self.ladder.forceful, self.ladder.poll);
            if let Some(exit) = reaped {
                return exit;
            }
        }
        // Last resort: end at least what we spawned, so the handle is not leaked.
        let _ = self.child.kill();
        wait_for_status(&mut self.child, self.ladder.forceful, self.ladder.poll).unwrap_or(
            ProcessExit {
                code: None,
                signal: Some("terminated".to_string()),
            },
        )
    }
}

impl Drop for ChildTransport {
    fn drop(&mut self) {
        // A dropped transport must not leave a CLI running: nobody will ever read
        // its output again.
        if self.exit.is_none() {
            self.terminate();
        }
    }
}

fn write_line(stdin: &mut ChildStdin, line: &str) -> std::io::Result<()> {
    stdin.write_all(line.as_bytes())?;
    // The newline belongs to the framing, not to the caller's payload.
    stdin.write_all(b"\n")?;
    stdin.flush()
}

/// Polls for the exit up to `patience`. `None` means still running; an error from
/// `try_wait` means the child is already gone, which is as good as reaped.
fn wait_for_status(child: &mut Child, patience: Duration, poll: Duration) -> Option<ProcessExit> {
    let deadline = Instant::now() + patience;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(exit_from(status)),
            Ok(None) => {}
            Err(_) => return Some(ProcessExit::default()),
        }
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(poll);
    }
}

/// A child that could not be wired up: no transport will ever own it, so end the
/// whole tree here instead of leaking an unobserved CLI.
fn abandon(mut child: Child, pid: u32, ladder: StopLadder) {
    tree_kill(pid, false);
    if wait_for_status(&mut child, ladder.forceful, ladder.poll).is_none() {
        tree_kill(pid, true);
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn exit_from(status: ExitStatus) -> ProcessExit {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return ProcessExit {
                code: None,
                signal: Some(format!("signal {signal}")),
            };
        }
    }
    ProcessExit {
        code: status.code(),
        signal: None,
    }
}

/// Ends the process and its descendants. `Child::kill` alone would only end the
/// `cmd` shim on Windows, leaving the node process that actually speaks the
/// protocol behind.
fn tree_kill(pid: u32, force: bool) {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T"]);
        if force {
            command.arg("/F");
        }
        silence(&mut command);
        let _ = command.status();
    }

    #[cfg(unix)]
    {
        // A negative pid targets the process group `process_group(0)` created, so
        // the shell wrapper's children go with it.
        let signal = if force { "-KILL" } else { "-TERM" };
        let _ = Command::new("kill")
            .arg(signal)
            .arg(format!("-{pid}"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(not(any(target_os = "windows", unix)))]
    {
        let _ = (pid, force);
    }
}

#[cfg(target_os = "windows")]
fn silence(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    use super::launch::CREATE_NO_WINDOW;

    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
}

/// A missing CLI is the one spawn failure the UI has to phrase differently: it is
/// not a bug, the tool simply is not installed.
fn spawn_error(config: &LaunchConfig, error: std::io::Error) -> AgentError {
    let kind = if error.kind() == std::io::ErrorKind::NotFound {
        AgentErrorKind::NotInstalled
    } else {
        AgentErrorKind::SpawnFailed
    };
    AgentError::new(kind, format!("无法启动 {}", config.program)).with_detail(error.to_string())
}

/// stdout is read line by line rather than in fixed-size chunks: a lossy UTF-8
/// conversion of half a multi-byte character would corrupt Chinese output, and a
/// line boundary is where the framing layer splits anyway.
fn pump_stdout(stdout: ChildStdout, sender: Sender<String>) {
    let mut reader = BufReader::new(stdout);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => return,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buffer).into_owned();
                if sender.send(line).is_err() {
                    // The transport is gone; nothing will read this stream again.
                    return;
                }
            }
            Err(_) => return,
        }
    }
}

fn pump_stderr(stderr: ChildStderr, sink: Arc<Mutex<StderrTail>>) {
    let mut reader = BufReader::new(stderr);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => return,
            Ok(_) => {
                let chunk = String::from_utf8_lossy(&buffer).into_owned();
                match sink.lock() {
                    Ok(mut tail) => tail.push(&chunk),
                    Err(_) => return,
                }
            }
            Err(_) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// Writes a throwaway script and returns the config that runs it. On Windows
    /// this also exercises the shim path: a `.cmd` is exactly what npm installs.
    fn script(name: &str, body: &str) -> (LaunchConfig, PathBuf) {
        let directory = std::env::temp_dir();
        let file = if cfg!(target_os = "windows") {
            directory.join(format!("a4note-{name}.cmd"))
        } else {
            directory.join(format!("a4note-{name}.sh"))
        };
        // Batch needs CRLF; `sh` does not care either way.
        let body = if cfg!(target_os = "windows") {
            body.replace('\n', "\r\n")
        } else {
            body.to_string()
        };
        fs::write(&file, body).expect("临时脚本必须可写");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).expect("chmod");
        }
        let config = LaunchConfig::new(file.to_string_lossy().to_string(), &directory);
        (config, file)
    }

    /// Reads until the process ends or the round budget runs out.
    fn drain(transport: &mut ChildTransport, rounds: usize) -> (Vec<String>, Option<ProcessExit>) {
        let mut lines = Vec::new();
        for _ in 0..rounds {
            match transport.read(Duration::from_millis(200)) {
                TransportRead::Chunk(chunk) => lines.push(chunk.trim().to_string()),
                TransportRead::Idle => {}
                TransportRead::Closed(exit) => return (lines, Some(exit)),
            }
        }
        (lines, None)
    }

    /// stderr arrives on its own thread, so it may lag the exit by a moment.
    fn stderr_within(transport: &mut ChildTransport, needle: &str) -> String {
        let mut seen = String::new();
        for _ in 0..50 {
            seen.push_str(&transport.take_stderr());
            if seen.contains(needle) {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        seen
    }

    #[test]
    fn reads_lines_stderr_and_the_exit_code() {
        let (config, file) = script(
            "stream",
            if cfg!(target_os = "windows") {
                "@echo off\necho {\"id\":1}\necho {\"id\":2}\necho boom 1>&2\nexit /b 3\n"
            } else {
                "#!/bin/sh\necho '{\"id\":1}'\necho '{\"id\":2}'\necho boom >&2\nexit 3\n"
            },
        );
        let mut transport =
            ChildTransport::spawn_with(&config, StopLadder::fast()).expect("脚本必须能启动");
        let (lines, exit) = drain(&mut transport, 40);
        assert_eq!(lines, vec!["{\"id\":1}", "{\"id\":2}"]);
        assert_eq!(exit, Some(ProcessExit::code(3)));
        let stderr = stderr_within(&mut transport, "boom");
        assert!(
            stderr.contains("boom"),
            "stderr 尾部必须带上子进程输出：{stderr}"
        );
        // A closed stream keeps reporting the same exit instead of blocking again.
        assert_eq!(
            transport.read(Duration::from_millis(10)),
            TransportRead::Closed(ProcessExit::code(3))
        );
        let _ = fs::remove_file(file);
    }

    #[test]
    fn writes_a_line_and_the_child_exits_on_eof() {
        let (config, file) = script(
            "echo",
            if cfg!(target_os = "windows") {
                // `set /p` leaves the variable undefined at EOF, which ends the loop.
                "@echo off\n:loop\nset \"line=\"\nset /p line=\nif not defined line goto done\necho got %line%\ngoto loop\n:done\necho bye\n"
            } else {
                "#!/bin/sh\nwhile IFS= read -r line; do echo \"got $line\"; done\necho bye\n"
            },
        );
        let mut transport =
            ChildTransport::spawn_with(&config, StopLadder::fast()).expect("脚本必须能启动");
        transport.write_line("first").expect("stdin 必须可写");
        transport.close_stdin();
        let (lines, exit) = drain(&mut transport, 40);
        assert_eq!(lines, vec!["got first", "bye"]);
        assert_eq!(exit, Some(ProcessExit::code(0)));
        // A closed stdin refuses further writes instead of failing silently.
        let error = transport
            .write_line("second")
            .expect_err("stdin 关闭后必须报错");
        assert_eq!(error.kind, AgentErrorKind::Transport);
        let _ = fs::remove_file(file);
    }

    #[test]
    fn the_ladder_ends_a_child_that_ignores_eof() {
        let (config, file) = script(
            "spin",
            if cfg!(target_os = "windows") {
                // Never reads stdin, so EOF alone will not end it. `ping` rather
                // than `timeout`, which refuses to run with stdin redirected.
                "@echo off\n:loop\nping -n 2 127.0.0.1 >nul\ngoto loop\n"
            } else {
                "#!/bin/sh\nwhile true; do sleep 1; done\n"
            },
        );
        let mut transport =
            ChildTransport::spawn_with(&config, StopLadder::fast()).expect("脚本必须能启动");
        assert_eq!(
            transport.read(Duration::from_millis(50)),
            TransportRead::Idle,
            "不输出的进程只能是 Idle，不能被当成结束"
        );
        let started = Instant::now();
        let exit = transport.terminate().expect("终止必须报告退出信息");
        assert!(!exit.is_success(), "被强制结束的进程不应报告成功：{exit:?}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "阶梯必须在秒级内结束进程"
        );
        // Terminating again must not run the ladder a second time.
        assert_eq!(transport.terminate(), Some(exit));
        let _ = fs::remove_file(file);
    }

    #[test]
    fn a_missing_program_is_reported_as_not_installed() {
        // Not a spawn failure: on Windows `cmd /C` would start happily and only
        // fail later, so the missing tool has to be caught before that.
        let config = LaunchConfig::new("a4note-no-such-cli-42", std::env::temp_dir());
        let error = ChildTransport::spawn(&config).expect_err("缺失的命令必须失败");
        assert_eq!(error.kind, AgentErrorKind::NotInstalled);
    }
}
