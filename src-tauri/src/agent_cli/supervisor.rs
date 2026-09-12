//! One thread per session: control messages in, `AgentEvent`s out.
//!
//! The division of labour is the whole point of this file. A provider adapter
//! knows one CLI's protocol and nothing else — it never owns the transport, the
//! pump loop or the run ids. Those live here, so run isolation, cancellation and
//! exit cleanup are written once instead of once per CLI.
//!
//! Run ids are minted here rather than taken from the provider, because a turn can
//! fail before the CLI answers, and a handle like codex's `conversationId` names a
//! *session* anyway. The provider's own turn handle is kept beside ours and used
//! only to recognise stale frames.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::launch::LaunchConfig;
use super::peer::{AgentPeer, PeerNotice, PumpOutcome, DEFAULT_REQUEST_TIMEOUT};
use super::process::ChildTransport;
use super::protocol::{AgentError, AgentErrorKind, AgentEvent};
use super::transport::AgentTransport;
use super::turn::RunGate;

/// How long one pump waits for output before the loop looks at its control queue.
/// Short enough that a stop feels immediate, long enough that an idle session is
/// not a spin loop.
const POLL: Duration = Duration::from_millis(50);

/// Read granularity while a caller waits for one response. The request's own
/// deadline is what fails it; this only decides how often the wait wakes up.
const AWAIT_TICK: Duration = Duration::from_millis(50);

/// What a session needs to know about itself. Deliberately not the UI's session
/// record: the runtime has no business knowing about titles or transcripts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSpec {
    /// The id every event is stamped with. Comes from the workspace store, so the
    /// UI can route events without a second mapping table.
    pub session_id: String,
    /// Where the CLI runs. The caller has already restricted this to the Project
    /// root or a folder the user picked.
    pub working_directory: PathBuf,
    /// Mirrors `AgentPermissionMode` in `src/core/workspace.ts`. A string rather
    /// than an enum because only the provider adapter knows how to spell it for
    /// its own CLI, and the conservative default must survive an unknown value.
    pub permission_mode: String,
}

impl SessionSpec {
    pub fn new(session_id: impl Into<String>, working_directory: impl Into<PathBuf>) -> Self {
        Self {
            session_id: session_id.into(),
            working_directory: working_directory.into(),
            permission_mode: "default".to_string(),
        }
    }

    pub fn with_permission_mode(mut self, mode: impl Into<String>) -> Self {
        self.permission_mode = mode.into();
        self
    }
}

/// One thing that happened inside a turn, in the runtime's vocabulary rather than
/// the CLI's. A provider adapter's whole output is a stream of these.
#[derive(Debug, Clone, PartialEq)]
pub enum TurnUpdate {
    Delta(String),
    Tool(Value),
    Completed,
    Stopped,
    Failed(AgentError),
}

/// A [`TurnUpdate`] plus whichever turn the *provider* said it belongs to. `None`
/// means the provider did not say, which is normal for CLIs that stream a single
/// turn at a time.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnFrame {
    pub run_id: Option<String>,
    pub update: TurnUpdate,
}

impl TurnFrame {
    /// A frame the provider did not attribute to a turn.
    pub fn any(update: TurnUpdate) -> Self {
        Self {
            run_id: None,
            update,
        }
    }

    pub fn of(run_id: impl Into<String>, update: TurnUpdate) -> Self {
        Self {
            run_id: Some(run_id.into()),
            update,
        }
    }
}

/// How a turn's identity becomes known. Some CLIs name the turn in the response to
/// the request that started it; others have a handle before the turn even begins.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnStart {
    /// The provider already knows the CLI's handle for this turn.
    Known(String),
    /// The handle arrives in the response to this request id.
    Response(i64),
}

/// Where events go. `Arc<dyn Fn>` rather than a channel so the Tauri layer can
/// emit straight to the window, and a test can push into a `Vec`.
pub type SessionSink = Arc<dyn Fn(AgentEvent) + Send + Sync>;

/// The only way a provider adapter touches the wire: the transport and the request
/// bookkeeping, lent out for the duration of one call. Handing over the pair rather
/// than the session keeps an adapter from reaching the run ids or the sink.
pub struct SessionIo<'a> {
    transport: &'a mut dyn AgentTransport,
    peer: &'a mut AgentPeer,
}

impl<'a> SessionIo<'a> {
    pub fn new(transport: &'a mut dyn AgentTransport, peer: &'a mut AgentPeer) -> Self {
        Self { transport, peer }
    }

    /// A short request, bounded by the default deadline. Handshake-shaped calls.
    pub fn request(&mut self, method: &str, params: Value) -> Result<i64, AgentError> {
        self.request_within(method, params, Some(DEFAULT_REQUEST_TIMEOUT))
    }

    /// A request whose deadline the caller chooses. `None` never expires, which is
    /// what the request standing for a whole turn needs.
    pub fn request_within(
        &mut self,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> Result<i64, AgentError> {
        self.peer
            .send_request(&mut *self.transport, method, params, timeout)
    }

    /// Fire-and-forget. False means stdin was already gone.
    pub fn notify(&mut self, method: &str, params: Value) -> bool {
        self.peer
            .send_notification(&mut *self.transport, method, params)
    }

    /// Writes one frame verbatim, for a CLI whose dialect is not JSON-RPC —
    /// `claude -p --input-format stream-json` reads `{"type":"user",...}` and would
    /// reject anything wrapped in `jsonrpc`/`method`. False means stdin was already
    /// gone.
    pub fn send_payload(&mut self, payload: &Value) -> bool {
        self.peer.send_payload(&mut *self.transport, payload)
    }

    /// Reads for up to `window`, failing only if the process is already gone.
    ///
    /// A CLI that says nothing until its first user message has no handshake to
    /// answer, so this is the one way such an adapter can still tell a live session
    /// from a start that died: a rejected flag or a missing login exits within
    /// milliseconds. Anything the CLI does send is left in the peer, so the session
    /// loop still delivers it.
    pub fn settle(&mut self, window: Duration) -> Result<(), AgentError> {
        let deadline = Instant::now() + window;
        loop {
            if let PumpOutcome::Closed(error) =
                self.peer.pump_once(&mut *self.transport, AWAIT_TICK)
            {
                return Err(error);
            }
            if Instant::now() >= deadline {
                return Ok(());
            }
        }
    }

    /// Pumps until `id` is answered, its deadline passes, or the process exits.
    /// Notifications that arrive meanwhile are not lost: the peer keeps them.
    pub fn await_response(&mut self, id: i64) -> Result<Value, AgentError> {
        self.peer
            .await_response(&mut *self.transport, id, AWAIT_TICK)
    }

    /// One request, answered before returning — the shape every handshake step has.
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, AgentError> {
        let id = self.request(method, params)?;
        self.await_response(id)
    }

    /// Refuses a request the provider made. False means stdin was already gone.
    pub fn respond_error(&mut self, id: i64, code: i64, message: &str) -> bool {
        self.peer
            .respond_error(&mut *self.transport, id, code, message)
    }

    /// Stops waiting for a request whose answer carries nothing worth having.
    pub fn forget(&mut self, id: i64) {
        self.peer.forget(id);
    }

    /// What the CLI has written to stderr so far, for an error message.
    pub fn stderr_tail(&self) -> &str {
        self.peer.stderr_tail()
    }
}

/// One CLI's protocol. Everything a `codex app-server` or `claude -p` adapter has
/// to say, and nothing about processes, threads or run isolation.
///
/// `Send` because the adapter moves onto the session thread after the handshake.
pub trait ProviderSession: Send {
    /// What to spawn for this session.
    fn launch(&self, spec: &SessionSpec) -> Result<LaunchConfig, AgentError>;

    /// Opens the connection. Defaulted to spawning the real CLI, so an adapter only
    /// overrides this to be driven by an in-memory pipe in tests.
    fn connect(
        &mut self,
        spec: &SessionSpec,
    ) -> Result<Box<dyn AgentTransport + Send>, AgentError> {
        Ok(Box::new(ChildTransport::spawn(&self.launch(spec)?)?))
    }

    /// Whatever must succeed before the session counts as ready. Runs on the
    /// caller's thread, so its failure is returned instead of emitted.
    fn handshake(&mut self, spec: &SessionSpec, io: &mut SessionIo<'_>) -> Result<(), AgentError>;

    /// Sends the user's message and says how this turn's handle will become known.
    fn begin_turn(
        &mut self,
        message: &str,
        io: &mut SessionIo<'_>,
    ) -> Result<TurnStart, AgentError>;

    /// Reads the CLI's turn handle out of the response promised by
    /// [`TurnStart::Response`]. Only called for that variant.
    fn run_id(&mut self, response: &Value) -> Result<String, AgentError>;

    /// Asks the CLI to abandon the turn. `true` means it was asked and will report
    /// the end itself; `false` sends the session down the stop ladder instead.
    fn cancel_turn(&mut self, run_id: &str, io: &mut SessionIo<'_>) -> bool;

    /// Turns one line the CLI sent into zero or more turn updates. Zero is the
    /// common case: most of what these CLIs stream is not user-visible.
    ///
    /// No `io` here on purpose: a notification nobody is waiting for must not be
    /// able to start writing back. The two frames that *can* need an answer get
    /// their own hooks below.
    fn translate(&mut self, notice: &PeerNotice) -> Vec<TurnFrame>;

    /// Reads one frame of a dialect that is not JSON-RPC. Defaulted to ignoring it,
    /// because a JSON-RPC adapter never sees one. `io` is here because such a frame
    /// can be a question — `claude` asks for tool permission with a
    /// `control_request` that carries no JSON-RPC id at all.
    fn on_payload(&mut self, _payload: &Value, _io: &mut SessionIo<'_>) -> Vec<TurnFrame> {
        Vec::new()
    }

    /// Answers a request the CLI made of us. Defaulted to a refusal, because a
    /// request left unanswered stalls the turn behind it and A4Note has no approval
    /// UI yet: refusing lets the CLI fail that one step and carry on. An adapter
    /// overrides this once there is a real answer to give.
    fn on_request(
        &mut self,
        id: i64,
        method: &str,
        _params: &Value,
        io: &mut SessionIo<'_>,
    ) -> Vec<TurnFrame> {
        io.respond_error(id, -32601, &format!("A4 Note 暂不支持该请求：{method}"));
        Vec::new()
    }
}

/// What the supervisor thread can be told. Kept tiny on purpose: everything else a
/// session does is a reaction to the CLI, not to us.
enum Control {
    Send(String),
    Stop,
    Close,
}

/// A running session as the supervisor sees it. `alive` exists because a session
/// can end on its own — the CLI crashed, the user quit it — and the map entry would
/// otherwise keep claiming it is running.
struct Handle {
    control: Sender<Control>,
    alive: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

/// Owns every live Agent CLI session. One instance per app, held in Tauri state.
pub struct AgentSupervisor {
    sink: SessionSink,
    sessions: Mutex<HashMap<String, Handle>>,
}

impl AgentSupervisor {
    pub fn new(sink: SessionSink) -> Self {
        Self {
            sink,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Connects, handshakes, and hands the session to its own thread.
    ///
    /// The handshake deliberately runs here rather than on that thread: "not
    /// installed" and "handshake failed" have to reach the caller as an `Err` so the
    /// UI can go starting -> failed, instead of arriving as an event for a session
    /// it still believes is starting.
    pub fn start(
        &self,
        spec: SessionSpec,
        mut provider: Box<dyn ProviderSession>,
    ) -> Result<(), AgentError> {
        if self.is_running(&spec.session_id) {
            return Err(AgentError::new(
                AgentErrorKind::Internal,
                format!("会话已在运行：{}", spec.session_id),
            ));
        }
        // A session that ended on its own leaves its thread behind; join it before
        // the name is taken again.
        self.close(&spec.session_id);
        let mut transport = provider.connect(&spec)?;
        let mut peer = AgentPeer::new();
        provider.handshake(&spec, &mut SessionIo::new(transport.as_mut(), &mut peer))?;
        let (control, inbox) = channel();
        let alive = Arc::new(AtomicBool::new(true));
        let session_id = spec.session_id.clone();
        let session = SessionLoop {
            spec,
            provider,
            transport,
            peer,
            inbox,
            sink: Arc::clone(&self.sink),
            gate: RunGate::new(),
            queued: VecDeque::new(),
            run: None,
            runs: 0,
            alive: Arc::clone(&alive),
        };
        let thread = thread::Builder::new()
            .name(format!("a4note-agent-{session_id}"))
            .spawn(move || session.run())
            .map_err(|error| {
                AgentError::new(AgentErrorKind::Internal, "无法启动会话线程")
                    .with_detail(error.to_string())
            })?;
        self.lock().insert(
            session_id,
            Handle {
                control,
                alive,
                thread: Some(thread),
            },
        );
        Ok(())
    }

    /// Queues a user message. A CLI takes one turn at a time, so a message sent
    /// while a run is open waits for it rather than being refused.
    pub fn send(&self, session_id: &str, message: impl Into<String>) -> Result<(), AgentError> {
        self.dispatch(session_id, Control::Send(message.into()))
    }

    /// Asks for the open turn to end. Does nothing when no turn is running.
    pub fn stop(&self, session_id: &str) -> Result<(), AgentError> {
        self.dispatch(session_id, Control::Stop)
    }

    /// Ends the session and waits for its thread, so the CLI is gone before this
    /// returns. Idempotent: closing what is already closed is not an error, which is
    /// what lets `start` reuse it to reap a dead session.
    pub fn close(&self, session_id: &str) -> bool {
        let Some(handle) = self.lock().remove(session_id) else {
            return false;
        };
        join(handle);
        true
    }

    /// Every session, ended. Called on app exit: a CLI must not outlive the window
    /// that started it.
    pub fn close_all(&self) {
        let handles: Vec<Handle> = self.lock().drain().map(|(_, handle)| handle).collect();
        for handle in handles {
            join(handle);
        }
    }

    pub fn is_running(&self, session_id: &str) -> bool {
        self.lock()
            .get(session_id)
            .is_some_and(|handle| handle.alive.load(Ordering::SeqCst))
    }

    /// How many sessions are still alive. For the exit path and the tests.
    pub fn running_count(&self) -> usize {
        self.lock()
            .values()
            .filter(|handle| handle.alive.load(Ordering::SeqCst))
            .count()
    }

    fn dispatch(&self, session_id: &str, message: Control) -> Result<(), AgentError> {
        let sessions = self.lock();
        let Some(handle) = sessions.get(session_id) else {
            return Err(AgentError::new(
                AgentErrorKind::Internal,
                format!("会话未运行：{session_id}"),
            ));
        };
        // A thread that has already ended still has a live channel for a moment, so
        // the liveness flag is what decides, not the send.
        if !handle.alive.load(Ordering::SeqCst) || handle.control.send(message).is_err() {
            return Err(AgentError::new(
                AgentErrorKind::Exited,
                format!("会话已结束：{session_id}"),
            ));
        }
        Ok(())
    }

    /// A poisoned map is still a usable map: the panic that poisoned it happened in
    /// a caller, not in the entries, and refusing to clean up sessions afterwards
    /// would leak CLI processes.
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Handle>> {
        self.sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

impl Drop for AgentSupervisor {
    fn drop(&mut self) {
        self.close_all();
    }
}

/// Tells a session thread to end and waits for it. The send failing means the
/// thread is already on its way out, which is what we wanted anyway.
fn join(mut handle: Handle) {
    let _ = handle.control.send(Control::Close);
    if let Some(thread) = handle.thread.take() {
        let _ = thread.join();
    }
}

/// Everything one session thread owns. Nothing here is shared, so the loop needs no
/// locks: the only things crossing the thread boundary are the control queue, the
/// sink and the liveness flag.
struct SessionLoop {
    spec: SessionSpec,
    provider: Box<dyn ProviderSession>,
    transport: Box<dyn AgentTransport + Send>,
    peer: AgentPeer,
    inbox: Receiver<Control>,
    sink: SessionSink,
    gate: RunGate,
    /// Messages sent while a run was open, started in order as runs finish.
    queued: VecDeque<String>,
    run: Option<Run>,
    /// Turns started so far, and the counter the run ids are minted from.
    runs: u64,
    alive: Arc<AtomicBool>,
}

/// The turn in flight. `run_id` exists from the first moment, so even a failure
/// before the CLI answered has something to attach to; `provider` is the CLI's own
/// handle for the same turn, once it is known.
struct Run {
    run_id: String,
    provider: Option<String>,
    /// The request whose response carries the provider's handle, while it is
    /// outstanding. `None` once the handle is known.
    awaiting: Option<i64>,
    /// Set once the CLI has been asked to cancel. A second stop does not ask twice;
    /// it ends the turn locally, so a provider that never answers cannot wedge the
    /// session.
    stopping: bool,
}

impl SessionLoop {
    /// Control first, then one bounded read, then whatever that read produced. The
    /// order matters: a stop that arrives during a long turn is acted on within one
    /// [`POLL`], not after the CLI next says something.
    fn run(mut self) {
        loop {
            match self.inbox.try_recv() {
                Ok(Control::Send(message)) => self.begin(message),
                Ok(Control::Stop) => self.stop(),
                Ok(Control::Close) => break,
                Err(TryRecvError::Empty) => {}
                // The supervisor is gone; nobody will read our events again.
                Err(TryRecvError::Disconnected) => break,
            }
            let outcome = self.peer.pump_once(self.transport.as_mut(), POLL);
            // Both run even on the pump that saw the exit: a CLI can send its last
            // frame and die in the same read, and that frame is the answer.
            self.resolve();
            self.deliver();
            if let PumpOutcome::Closed(error) = outcome {
                self.fail_open_run(error);
                break;
            }
        }
        self.shutdown();
    }

    /// Starts a turn, or queues the message when one is already running.
    fn begin(&mut self, message: String) {
        if self.run.is_some() {
            self.queued.push_back(message);
            return;
        }
        self.runs += 1;
        let run_id = format!("{}-{}", self.spec.session_id, self.runs);
        let start = self.provider.begin_turn(
            &message,
            &mut SessionIo::new(self.transport.as_mut(), &mut self.peer),
        );
        match start {
            Ok(TurnStart::Known(handle)) => {
                self.run = Some(Run::new(run_id.clone(), Some(handle)));
                self.open(run_id);
            }
            Ok(TurnStart::Response(id)) => {
                let mut run = Run::new(run_id, None);
                run.awaiting = Some(id);
                self.run = Some(run);
            }
            Err(error) => {
                // Nothing was buffered under this id, so this is the whole run: one
                // `Failed`, and the session is idle again.
                self.fail_run(run_id, error);
            }
        }
    }

    /// Opens the gate and flushes whatever streamed in before the id was known.
    fn open(&mut self, run_id: String) {
        self.emit(AgentEvent::Started {
            session_id: self.spec.session_id.clone(),
            run_id: run_id.clone(),
        });
        for event in self.gate.open(run_id) {
            self.push(event);
        }
    }

    /// The one funnel for run-scoped events: emit it if the run is live, hold it if
    /// the id is not known yet, drop it if the run it belongs to is over. Replaying a
    /// stale frame would corrupt the answer the user is reading now.
    fn push(&mut self, event: AgentEvent) {
        if self.gate.accept(&event) {
            let terminal = event.is_terminal();
            self.emit(event);
            if terminal {
                self.finish_run();
            }
            return;
        }
        if self.gate.current().is_none() {
            self.gate.buffer(event);
        }
    }

    /// One `Failed` for a run that never opened its gate.
    fn fail_run(&mut self, run_id: String, error: AgentError) {
        self.emit(AgentEvent::Failed {
            session_id: self.spec.session_id.clone(),
            run_id,
            error,
        });
        self.finish_run();
    }

    fn finish_run(&mut self) {
        self.gate.close();
        self.run = None;
        // Recursion depth is the queue length: `begin` only queues while a run is
        // open, and there is none now.
        if let Some(message) = self.queued.pop_front() {
            self.begin(message);
        }
    }

    /// Turns the response carrying the CLI's turn handle into an open run. Until it
    /// arrives the run exists but its gate does not, so frames are buffered.
    fn resolve(&mut self) {
        let Some((run_id, id)) = self
            .run
            .as_ref()
            .and_then(|run| run.awaiting.map(|id| (run.run_id.clone(), id)))
        else {
            return;
        };
        let Some(answer) = self.peer.take_response(id) else {
            return;
        };
        let resolved = match answer {
            Ok(value) => self.provider.run_id(&value),
            Err(error) => Err(error),
        };
        match resolved {
            Ok(handle) => {
                if let Some(run) = self.run.as_mut() {
                    run.provider = Some(handle);
                    run.awaiting = None;
                }
                self.open(run_id);
            }
            // The turn never started. Whatever was buffered belonged to it and dies
            // with it, which is what `finish_run` clearing the gate does.
            Err(error) => self.fail_run(run_id, error),
        }
    }

    /// Translates everything the peer collected since the last pass. The two frames
    /// that can carry a question — a JSON-RPC request, and a frame of a dialect that
    /// has no JSON-RPC ids — go to `on_request` / `on_payload` instead, because
    /// answering one needs the wire and `translate` deliberately cannot reach it.
    fn deliver(&mut self) {
        for notice in self.peer.take_notices() {
            let frames = match &notice {
                PeerNotice::Request { id, method, params } => self.provider.on_request(
                    *id,
                    method,
                    params,
                    &mut SessionIo::new(self.transport.as_mut(), &mut self.peer),
                ),
                PeerNotice::Payload(payload) => self.provider.on_payload(
                    payload,
                    &mut SessionIo::new(self.transport.as_mut(), &mut self.peer),
                ),
                other => self.provider.translate(other),
            };
            for frame in frames {
                if let Some(event) = self.stamp(frame) {
                    self.push(event);
                }
            }
        }
    }

    /// Stamps a provider frame with our ids, or drops it when it names a turn other
    /// than the one in flight. Before the CLI's handle is known nothing can be ruled
    /// out, so those frames are kept and the gate holds them.
    fn stamp(&self, frame: TurnFrame) -> Option<AgentEvent> {
        let run = self.run.as_ref()?;
        if let Some(named) = &frame.run_id {
            if run
                .provider
                .as_deref()
                .is_some_and(|open| open != named.as_str())
            {
                return None;
            }
        }
        let session_id = self.spec.session_id.clone();
        let run_id = run.run_id.clone();
        Some(match frame.update {
            TurnUpdate::Delta(content) => AgentEvent::Delta {
                session_id,
                run_id,
                content,
            },
            TurnUpdate::Tool(payload) => AgentEvent::Tool {
                session_id,
                run_id,
                payload,
            },
            TurnUpdate::Completed => AgentEvent::Completed { session_id, run_id },
            TurnUpdate::Stopped => AgentEvent::Stopped { session_id, run_id },
            TurnUpdate::Failed(error) => AgentEvent::Failed {
                session_id,
                run_id,
                error,
            },
        })
    }

    /// Ends the open turn. The CLI is asked first: a cancel it understands leaves the
    /// session usable, while the stop ladder would cost the whole process.
    fn stop(&mut self) {
        let Some((run_id, handle, stopping)) = self
            .run
            .as_ref()
            .map(|run| (run.run_id.clone(), run.provider.clone(), run.stopping))
        else {
            return;
        };
        if !stopping {
            let asked = match &handle {
                Some(handle) => self.provider.cancel_turn(
                    handle,
                    &mut SessionIo::new(self.transport.as_mut(), &mut self.peer),
                ),
                // No handle yet: there is nothing the CLI could be asked about.
                None => false,
            };
            if asked {
                // The end of the turn is whatever the CLI reports next, so the
                // transcript stays in the order the CLI produced it.
                if let Some(run) = self.run.as_mut() {
                    run.stopping = true;
                }
                return;
            }
        }
        self.emit(AgentEvent::Stopped {
            session_id: self.spec.session_id.clone(),
            run_id,
        });
        self.finish_run();
    }

    /// The process is gone: one error on the open run, and the loop ends. Silent when
    /// no run was open — an idle session that exits is not a turn failure.
    fn fail_open_run(&mut self, error: AgentError) {
        let Some(run_id) = self.run.take().map(|run| run.run_id) else {
            return;
        };
        self.emit(AgentEvent::Failed {
            session_id: self.spec.session_id.clone(),
            run_id,
            error,
        });
        self.gate.close();
    }

    /// Leaves nothing behind: an open turn gets its terminal event, stdin is closed,
    /// and the process is ended if EOF alone did not do it.
    fn shutdown(mut self) {
        // Cleared before the ladder rather than after, so `is_running` stops claiming
        // a session that is already on its way out.
        self.alive.store(false, Ordering::SeqCst);
        if let Some(run) = self.run.take() {
            self.emit(AgentEvent::Stopped {
                session_id: self.spec.session_id.clone(),
                run_id: run.run_id,
            });
        }
        self.gate.close();
        self.transport.close_stdin();
        self.transport.terminate();
    }

    fn emit(&self, event: AgentEvent) {
        (self.sink)(event);
    }
}

impl Run {
    fn new(run_id: String, provider: Option<String>) -> Self {
        Self {
            run_id,
            provider,
            awaiting: None,
            stopping: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_cli::transport::{FakePeer, InMemoryTransport, ProcessExit};
    use serde_json::json;

    /// A provider whose protocol is only as complicated as these tests need: `init`
    /// is the handshake, `start` answers with the CLI's turn handle, notifications
    /// carry that handle back, and `cancel` is honoured or refused depending on how
    /// the fake was built.
    struct Fake {
        transport: Option<InMemoryTransport>,
        handshake: Result<(), AgentError>,
        cancels: bool,
        canceled: Arc<Mutex<Vec<String>>>,
    }

    impl Fake {
        fn new(transport: InMemoryTransport) -> Self {
            Self {
                transport: Some(transport),
                handshake: Ok(()),
                cancels: false,
                canceled: Arc::new(Mutex::new(Vec::new())),
            }
        }

        /// A CLI that understands cancellation and reports the end of the turn itself.
        fn cancelable(mut self) -> Self {
            self.cancels = true;
            self
        }

        fn failing(mut self, error: AgentError) -> Self {
            self.handshake = Err(error);
            self
        }
    }

    impl ProviderSession for Fake {
        fn launch(&self, spec: &SessionSpec) -> Result<LaunchConfig, AgentError> {
            Ok(LaunchConfig::new(
                "a4note-fake-cli",
                &spec.working_directory,
            ))
        }

        /// The in-memory pipe instead of a real child: this is the seam the default
        /// `connect` exists for.
        fn connect(
            &mut self,
            _spec: &SessionSpec,
        ) -> Result<Box<dyn AgentTransport + Send>, AgentError> {
            Ok(Box::new(self.transport.take().expect("每个会话只连接一次")))
        }

        fn handshake(
            &mut self,
            spec: &SessionSpec,
            io: &mut SessionIo<'_>,
        ) -> Result<(), AgentError> {
            self.handshake.clone()?;
            io.call(
                "init",
                json!({
                    "cwd": spec.working_directory.display().to_string(),
                    "permissionMode": spec.permission_mode,
                }),
            )?;
            Ok(())
        }

        fn begin_turn(
            &mut self,
            message: &str,
            io: &mut SessionIo<'_>,
        ) -> Result<TurnStart, AgentError> {
            // No deadline: a turn legitimately runs for minutes.
            let id = io.request_within("start", json!({ "message": message }), None)?;
            Ok(TurnStart::Response(id))
        }

        fn run_id(&mut self, response: &Value) -> Result<String, AgentError> {
            response
                .get("runId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| AgentError::new(AgentErrorKind::Protocol, "响应缺少 runId"))
        }

        fn cancel_turn(&mut self, run_id: &str, io: &mut SessionIo<'_>) -> bool {
            if !self.cancels {
                return false;
            }
            self.canceled
                .lock()
                .expect("取消记录")
                .push(run_id.to_string());
            io.notify("cancel", json!({ "runId": run_id }))
        }

        fn translate(&mut self, notice: &PeerNotice) -> Vec<TurnFrame> {
            let PeerNotice::Notification { method, params } = notice else {
                return Vec::new();
            };
            let update = match method.as_str() {
                "delta" => TurnUpdate::Delta(
                    params
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                ),
                "done" => TurnUpdate::Completed,
                "canceled" => TurnUpdate::Stopped,
                _ => return Vec::new(),
            };
            match params.get("runId").and_then(Value::as_str) {
                Some(run_id) => vec![TurnFrame::of(run_id, update)],
                None => vec![TurnFrame::any(update)],
            }
        }
    }

    fn spec(session_id: &str) -> SessionSpec {
        SessionSpec::new(session_id, std::env::temp_dir())
    }

    fn sink() -> (SessionSink, Arc<Mutex<Vec<AgentEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&events);
        (
            Arc::new(move |event| seen.lock().expect("事件列表").push(event)),
            events,
        )
    }

    /// Starts a session whose handshake is already answered. The fixture queues its
    /// frames, so the reply is waiting before the request is even written; `1` is the
    /// first id a fresh peer hands out.
    fn start(
        supervisor: &AgentSupervisor,
        session_id: &str,
        provider: Fake,
        cli: &FakePeer,
    ) -> Result<(), AgentError> {
        cli.send_line(&json!({ "id": 1, "result": {} }).to_string());
        supervisor.start(spec(session_id), Box::new(provider))
    }

    /// Events are produced on the session thread, so assertions wait for them.
    fn wait_for(
        events: &Arc<Mutex<Vec<AgentEvent>>>,
        done: impl Fn(&[AgentEvent]) -> bool,
    ) -> Vec<AgentEvent> {
        for _ in 0..200 {
            let seen = events.lock().expect("事件列表").clone();
            if done(&seen) {
                return seen;
            }
            thread::sleep(Duration::from_millis(10));
        }
        events.lock().expect("事件列表").clone()
    }

    /// Waits until the CLI side has been written `count` lines, then returns them.
    fn written(cli: &FakePeer, count: usize) -> Vec<String> {
        for _ in 0..200 {
            let lines = cli.written();
            if lines.len() >= count {
                return lines;
            }
            thread::sleep(Duration::from_millis(10));
        }
        cli.written()
    }

    /// Waits for something the session thread will eventually do.
    fn eventually(ready: impl Fn() -> bool) -> bool {
        for _ in 0..200 {
            if ready() {
                return true;
            }
            thread::sleep(Duration::from_millis(10));
        }
        false
    }

    fn request_id(line: &str) -> i64 {
        serde_json::from_str::<Value>(line).expect("请求必须是 JSON")["id"]
            .as_i64()
            .expect("请求必须带 id")
    }

    /// The event stream reduced to variant names, which is what most of these
    /// assertions are actually about.
    fn kinds(events: &[AgentEvent]) -> Vec<&'static str> {
        events
            .iter()
            .map(|event| match event {
                AgentEvent::Started { .. } => "started",
                AgentEvent::Delta { .. } => "delta",
                AgentEvent::Tool { .. } => "tool",
                AgentEvent::Completed { .. } => "completed",
                AgentEvent::Stopped { .. } => "stopped",
                AgentEvent::Failed { .. } => "failed",
            })
            .collect()
    }

    fn text(events: &[AgentEvent]) -> String {
        events
            .iter()
            .filter_map(|event| match event {
                AgentEvent::Delta { content, .. } => Some(content.as_str()),
                _ => None,
            })
            .collect()
    }

    fn terminal(events: &[AgentEvent]) -> bool {
        events.iter().any(AgentEvent::is_terminal)
    }

    /// Answers the request that started a turn, naming the CLI's own handle for it.
    fn answer_start(cli: &FakePeer, index: usize, handle: &str) {
        let id = request_id(&written(cli, index + 1)[index]);
        cli.send_line(&json!({ "id": id, "result": { "runId": handle } }).to_string());
    }

    #[test]
    fn a_turn_streams_deltas_and_completes() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", Fake::new(transport), &cli).expect("握手必须成功");
        assert!(supervisor.is_running("s1"));
        supervisor.send("s1", "你好").expect("会话必须能接收消息");

        let lines = written(&cli, 2);
        assert!(lines[0].contains("\"method\":\"init\""), "握手必须先发生");
        assert!(lines[1].contains("你好"));
        answer_start(&cli, 1, "cli-1");
        for chunk in ["你", "好"] {
            cli.send_line(
                &json!({ "method": "delta", "params": { "runId": "cli-1", "text": chunk } })
                    .to_string(),
            );
        }
        cli.send_line(&json!({ "method": "done", "params": { "runId": "cli-1" } }).to_string());

        let seen = wait_for(&events, terminal);
        assert_eq!(kinds(&seen), vec!["started", "delta", "delta", "completed"]);
        assert_eq!(text(&seen), "你好");
        // The run id is ours, not the CLI's: a turn that fails before the CLI answers
        // still needs one.
        assert_eq!(seen[0].run_id(), "s1-1");
        assert!(supervisor.close("s1"));
    }

    /// A CLI that asks permission mid-turn gets an answer without an adapter writing
    /// one: the refusal is what keeps the turn from waiting on a dialog A4Note does
    /// not have yet, and the turn still finishes normally.
    #[test]
    fn a_request_from_the_cli_is_refused_and_the_turn_continues() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", Fake::new(transport), &cli).expect("握手必须成功");
        supervisor
            .send("s1", "跑一下测试")
            .expect("会话必须能接收消息");
        answer_start(&cli, 1, "cli-1");

        cli.send_line(
            &json!({ "id": 900, "method": "execCommandApproval", "params": { "command": "rm -rf /" } })
                .to_string(),
        );
        let reply: Value = serde_json::from_str(&written(&cli, 3)[2]).expect("有效 JSON-RPC");
        assert_eq!(reply["id"], 900);
        assert_eq!(reply["error"]["code"], -32601);
        assert!(reply["error"]["message"]
            .as_str()
            .is_some_and(|message| message.contains("execCommandApproval")));

        cli.send_line(&json!({ "method": "done", "params": { "runId": "cli-1" } }).to_string());
        let seen = wait_for(&events, terminal);
        assert_eq!(kinds(&seen), vec!["started", "completed"]);
        assert!(supervisor.close("s1"));
    }

    #[test]
    fn frames_that_arrive_before_the_run_id_are_replayed_once() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", Fake::new(transport), &cli).expect("握手必须成功");
        supervisor.send("s1", "第一问").expect("会话必须能接收消息");
        let start_id = request_id(&written(&cli, 2)[1]);

        // The CLI streams before it answers the request that started the turn.
        cli.send_line(&json!({ "method": "delta", "params": { "text": "早" } }).to_string());
        cli.send_line(&json!({ "id": start_id, "result": { "runId": "cli-1" } }).to_string());
        cli.send_line(&json!({ "method": "done", "params": { "runId": "cli-1" } }).to_string());
        let seen = wait_for(&events, terminal);
        assert_eq!(kinds(&seen), vec!["started", "delta", "completed"]);
        assert_eq!(text(&seen), "早");

        // A frame from the finished turn arrives late and must not be replayed into
        // the transcript the user is now reading.
        cli.send_line(
            &json!({ "method": "delta", "params": { "runId": "cli-1", "text": "迟" } }).to_string(),
        );
        thread::sleep(Duration::from_millis(150));
        assert_eq!(text(&events.lock().expect("事件列表")), "早");
        assert!(supervisor.close("s1"));
    }

    #[test]
    fn a_cli_that_dies_mid_turn_fails_the_open_run() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", Fake::new(transport), &cli).expect("握手必须成功");
        supervisor.send("s1", "你好").expect("会话必须能接收消息");
        answer_start(&cli, 1, "cli-1");
        wait_for(&events, |seen| !seen.is_empty());
        cli.send_stderr("boom: missing api key\n");
        cli.exit(ProcessExit::code(9));

        let seen = wait_for(&events, terminal);
        let Some(AgentEvent::Failed { error, run_id, .. }) = seen.last() else {
            panic!("进程退出必须让进行中的回合失败：{seen:?}");
        };
        assert_eq!(error.kind, AgentErrorKind::Exited);
        assert_eq!(error.exit_code, Some(9));
        assert!(
            error.detail.as_deref().unwrap_or_default().contains("boom"),
            "错误必须带上 stderr 尾部：{error:?}"
        );
        assert_eq!(run_id.as_str(), "s1-1");
        assert_eq!(kinds(&seen), vec!["started", "failed"]);
        // The thread ended with the process, so the session must stop claiming to run.
        assert!(
            eventually(|| !supervisor.is_running("s1")),
            "进程退出后会话不能仍报告运行中"
        );
    }

    #[test]
    fn a_stop_asks_the_cli_and_waits_for_its_answer() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let fake = Fake::new(transport).cancelable();
        let canceled = Arc::clone(&fake.canceled);
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", fake, &cli).expect("握手必须成功");
        supervisor.send("s1", "你好").expect("会话必须能接收消息");
        answer_start(&cli, 1, "cli-1");
        wait_for(&events, |seen| !seen.is_empty());

        supervisor.stop("s1").expect("停止必须送达");
        assert!(written(&cli, 3)[2].contains("\"method\":\"cancel\""));
        assert_eq!(canceled.lock().expect("取消记录").clone(), vec!["cli-1"]);
        // Nothing is emitted until the CLI reports the end itself, so the transcript
        // keeps the order the CLI produced.
        assert!(!terminal(&events.lock().expect("事件列表")));
        cli.send_line(&json!({ "method": "canceled", "params": { "runId": "cli-1" } }).to_string());
        assert_eq!(
            kinds(&wait_for(&events, terminal)),
            vec!["started", "stopped"]
        );
        assert!(supervisor.close("s1"));
    }

    #[test]
    fn a_provider_that_cannot_cancel_ends_the_turn_locally() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", Fake::new(transport), &cli).expect("握手必须成功");
        supervisor.send("s1", "你好").expect("会话必须能接收消息");
        answer_start(&cli, 1, "cli-1");
        wait_for(&events, |seen| !seen.is_empty());

        supervisor.stop("s1").expect("停止必须送达");
        assert_eq!(
            kinds(&wait_for(&events, terminal)),
            vec!["started", "stopped"]
        );
        // The session stays usable: the next message is a new run, not a resumption of
        // the stopped one.
        supervisor.send("s1", "再来").expect("停止后会话必须仍可用");
        answer_start(&cli, 2, "cli-2");
        cli.send_line(&json!({ "method": "done", "params": { "runId": "cli-2" } }).to_string());
        let seen = wait_for(&events, |seen| seen.len() >= 4);
        assert_eq!(
            kinds(&seen),
            vec!["started", "stopped", "started", "completed"]
        );
        assert_eq!(seen[2].run_id(), "s1-2");
        assert!(supervisor.close("s1"));
    }

    #[test]
    fn a_message_sent_during_a_turn_waits_for_it() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", Fake::new(transport), &cli).expect("握手必须成功");
        supervisor.send("s1", "第一问").expect("会话必须能接收消息");
        let first = request_id(&written(&cli, 2)[1]);
        supervisor
            .send("s1", "第二问")
            .expect("排队的消息也必须被接收");

        // A CLI takes one turn at a time, so the second request must not be written
        // until the first turn is over.
        thread::sleep(Duration::from_millis(150));
        assert_eq!(cli.written().len(), 2, "回合进行中不能再发第二个请求");
        cli.send_line(&json!({ "id": first, "result": { "runId": "cli-1" } }).to_string());
        cli.send_line(&json!({ "method": "done", "params": { "runId": "cli-1" } }).to_string());

        let lines = written(&cli, 3);
        assert!(lines[2].contains("第二问"));
        answer_start(&cli, 2, "cli-2");
        cli.send_line(&json!({ "method": "done", "params": { "runId": "cli-2" } }).to_string());
        let seen = wait_for(&events, |seen| seen.len() >= 4);
        assert_eq!(
            kinds(&seen),
            vec!["started", "completed", "started", "completed"]
        );
        assert_eq!(seen[2].run_id(), "s1-2");
        assert!(supervisor.close("s1"));
    }

    #[test]
    fn a_failed_handshake_is_returned_to_the_caller() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        let fake = Fake::new(transport).failing(AgentError::new(
            AgentErrorKind::HandshakeFailed,
            "版本不匹配",
        ));

        let error = supervisor
            .start(spec("s1"), Box::new(fake))
            .expect_err("握手失败必须作为错误返回");
        assert_eq!(error.kind, AgentErrorKind::HandshakeFailed);
        // A session the UI still believes is starting must not receive events, and no
        // thread may be left behind.
        assert!(events.lock().expect("事件列表").is_empty());
        assert!(cli.written().is_empty());
        assert!(!supervisor.is_running("s1"));
        assert_eq!(
            supervisor
                .send("s1", "你好")
                .expect_err("没有会话可以接收消息")
                .kind,
            AgentErrorKind::Internal
        );
    }

    #[test]
    fn closing_a_session_ends_its_thread_and_the_process() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", Fake::new(transport), &cli).expect("握手必须成功");
        supervisor.send("s1", "你好").expect("会话必须能接收消息");
        answer_start(&cli, 1, "cli-1");
        wait_for(&events, |seen| !seen.is_empty());

        assert!(supervisor.close("s1"), "关闭必须找到会话");
        // `close` joined the thread, so these hold without waiting.
        assert!(cli.stdin_closed(), "关闭必须先发 stdin EOF");
        assert_eq!(cli.terminated(), 1, "停止阶梯只能跑一次");
        assert!(!supervisor.is_running("s1"));
        assert_eq!(
            kinds(&events.lock().expect("事件列表")),
            vec!["started", "stopped"],
            "关闭必须给未完成的回合一个结局"
        );
        assert!(!supervisor.close("s1"), "重复关闭不是错误");
    }

    #[test]
    fn closing_the_supervisor_ends_every_session() {
        let (first, first_cli) = InMemoryTransport::new();
        let (second, second_cli) = InMemoryTransport::new();
        let (sink, _events) = sink();
        let supervisor = AgentSupervisor::new(sink);
        start(&supervisor, "s1", Fake::new(first), &first_cli).expect("握手必须成功");
        start(&supervisor, "s2", Fake::new(second), &second_cli).expect("握手必须成功");
        assert_eq!(supervisor.running_count(), 2);

        // The app exit path: no CLI may outlive the window that started it.
        supervisor.close_all();
        assert_eq!(supervisor.running_count(), 0);
        for cli in [&first_cli, &second_cli] {
            assert!(cli.stdin_closed());
            assert_eq!(cli.terminated(), 1);
        }
        assert!(!supervisor.close("s1"), "会话已经被清理");
    }
}
