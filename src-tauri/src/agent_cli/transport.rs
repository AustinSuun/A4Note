//! The stdio seam.
//!
//! Everything above this file works against [`AgentTransport`], never against a
//! `std::process::Child`, so the framing and request layers can be driven by an
//! in-memory pipe in tests. The real child process lives in `process.rs` and
//! implements this same trait.

use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::protocol::{AgentError, AgentErrorKind};

/// How a process ended. `signal` is a string because the useful value on Windows
/// is a description rather than a POSIX signal number.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessExit {
    pub code: Option<i32>,
    pub signal: Option<String>,
}

impl ProcessExit {
    pub fn code(code: i32) -> Self {
        Self {
            code: Some(code),
            signal: None,
        }
    }

    pub fn is_success(&self) -> bool {
        self.code == Some(0) && self.signal.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportRead {
    /// One raw stdout chunk. Not necessarily a whole line.
    Chunk(String),
    /// Nothing arrived before the deadline. Long turns are normal, so this is not
    /// an error on its own — only a pending request's own deadline can fail.
    Idle,
    /// stdout reached EOF and the process is gone.
    Closed(ProcessExit),
}

pub trait AgentTransport {
    /// Writes one request line. `\n` is appended here so callers cannot forget it.
    fn write_line(&mut self, line: &str) -> Result<(), AgentError>;
    fn read(&mut self, timeout: Duration) -> TransportRead;
    /// Sends EOF on stdin. First step of the stop ladder: a well-behaved CLI
    /// exits on its own and never has to be killed.
    fn close_stdin(&mut self);
    /// Drains whatever stderr has accumulated. Empty when there is nothing new.
    fn take_stderr(&mut self) -> String;
    /// Last step of the stop ladder: end the process and everything it started.
    /// Returns the exit if the transport observed one. The default does nothing,
    /// so a transport with no process behind it — the in-memory fixture, a future
    /// socket — does not have to pretend it can kill anything.
    fn terminate(&mut self) -> Option<ProcessExit> {
        None
    }
}

#[derive(Debug, Default)]
struct SharedPipe {
    written: Vec<String>,
    stdin_closed: bool,
    stderr: String,
    /// How many times the client escalated to `terminate()`. A count rather than a
    /// flag: the stop ladder must not fire twice for one stop.
    terminated: usize,
}

/// Test double for a live CLI process: a queue in each direction plus the log of
/// what the client wrote. Held by both ends, so a fixture can assert on the
/// request it received before answering it.
#[derive(Debug)]
pub struct InMemoryTransport {
    inbound: Receiver<TransportRead>,
    shared: Arc<Mutex<SharedPipe>>,
    closed: Option<ProcessExit>,
}

/// The provider side of an [`InMemoryTransport`]: what a fake `codex app-server`
/// or `claude -p` would do.
#[derive(Debug, Clone)]
pub struct FakePeer {
    outbound: Sender<TransportRead>,
    shared: Arc<Mutex<SharedPipe>>,
}

impl InMemoryTransport {
    pub fn new() -> (Self, FakePeer) {
        let (outbound, inbound) = channel();
        let shared = Arc::new(Mutex::new(SharedPipe::default()));
        let transport = Self {
            inbound,
            shared: Arc::clone(&shared),
            closed: None,
        };
        let peer = FakePeer { outbound, shared };
        (transport, peer)
    }
}

impl AgentTransport for InMemoryTransport {
    fn write_line(&mut self, line: &str) -> Result<(), AgentError> {
        let mut shared = self.shared.lock().expect("in-memory pipe poisoned");
        if shared.stdin_closed || self.closed.is_some() {
            return Err(AgentError::new(
                AgentErrorKind::Transport,
                "stdin 已关闭，请求被丢弃",
            ));
        }
        shared.written.push(line.to_string());
        Ok(())
    }

    fn read(&mut self, timeout: Duration) -> TransportRead {
        if let Some(exit) = &self.closed {
            return TransportRead::Closed(exit.clone());
        }
        // Drain anything already queued before paying the timeout, so a scripted
        // burst of frames is delivered without one sleep per frame.
        match self.inbound.try_recv() {
            Ok(read) => return self.remember(read),
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {
                return self.remember(TransportRead::Closed(ProcessExit::default()))
            }
        }
        match self.inbound.recv_timeout(timeout) {
            Ok(read) => self.remember(read),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => TransportRead::Idle,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                self.remember(TransportRead::Closed(ProcessExit::default()))
            }
        }
    }

    fn close_stdin(&mut self) {
        self.shared
            .lock()
            .expect("in-memory pipe poisoned")
            .stdin_closed = true;
    }

    fn take_stderr(&mut self) -> String {
        let mut shared = self.shared.lock().expect("in-memory pipe poisoned");
        std::mem::take(&mut shared.stderr)
    }

    fn terminate(&mut self) -> Option<ProcessExit> {
        self.shared
            .lock()
            .expect("in-memory pipe poisoned")
            .terminated += 1;
        let exit = ProcessExit {
            code: None,
            signal: Some("terminated".to_string()),
        };
        self.remember(TransportRead::Closed(exit.clone()));
        Some(exit)
    }
}

impl InMemoryTransport {
    /// A closed stream stays closed: once the process is gone, later reads must
    /// keep reporting the same exit instead of blocking again.
    fn remember(&mut self, read: TransportRead) -> TransportRead {
        if let TransportRead::Closed(exit) = &read {
            self.closed = Some(exit.clone());
        }
        read
    }
}

impl FakePeer {
    /// Sends one complete JSONL line.
    pub fn send_line(&self, line: &str) {
        let _ = self
            .outbound
            .send(TransportRead::Chunk(format!("{line}\n")));
    }

    /// Sends a raw chunk with no newline handling, for split-frame tests.
    pub fn send_chunk(&self, chunk: &str) {
        let _ = self.outbound.send(TransportRead::Chunk(chunk.to_string()));
    }

    pub fn send_stderr(&self, chunk: &str) {
        let mut shared = self.shared.lock().expect("in-memory pipe poisoned");
        shared.stderr.push_str(chunk);
    }

    pub fn exit(&self, exit: ProcessExit) {
        let _ = self.outbound.send(TransportRead::Closed(exit));
    }

    /// Every line the client has written so far.
    pub fn written(&self) -> Vec<String> {
        self.shared
            .lock()
            .expect("in-memory pipe poisoned")
            .written
            .clone()
    }

    pub fn stdin_closed(&self) -> bool {
        self.shared
            .lock()
            .expect("in-memory pipe poisoned")
            .stdin_closed
    }

    /// How many times the client escalated to `terminate()`.
    pub fn terminated(&self) -> usize {
        self.shared
            .lock()
            .expect("in-memory pipe poisoned")
            .terminated
    }
}
