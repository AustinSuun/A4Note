//! Codex: `codex app-server` behind the [`ProviderSession`] seam.
//!
//! The dialect is the v2 `thread/*` + `turn/*` JSON-RPC surface, checked against
//! `codex app-server` 0.146.0 and the schema it exports (Apache-2.0 upstream
//! `openai/codex`). Four properties of it shape this file:
//!
//! * `turn/start` answers immediately with the turn's id, before any update, so a
//!   turn is a [`TurnStart::Response`] and its deltas stream while that response is
//!   still in flight.
//! * server frames omit `jsonrpc` and add `emittedAtMs`; the decoder tolerates both.
//! * a failing turn is announced twice — an `error` with `willRetry:false` and then
//!   a `turn/completed` with `status:"failed"` — and a *retrying* error looks almost
//!   the same, so the adapter latches its turn and emits exactly one terminal.
//! * codex asks before running commands. A4Note has no approval UI yet, so every
//!   session runs with `approvalPolicy:"never"` and the sandbox does the limiting;
//!   an approval request that still arrives is refused and shown in the transcript.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::agent_cli::launch::LaunchConfig;
use crate::agent_cli::peer::PeerNotice;
use crate::agent_cli::process::ChildTransport;
use crate::agent_cli::protocol::{AgentError, AgentErrorKind};
use crate::agent_cli::providers::ProviderHandle;
use crate::agent_cli::supervisor::{
    ProviderSession, SessionIo, SessionSpec, TurnFrame, TurnStart, TurnUpdate,
};
use crate::agent_cli::transport::AgentTransport;

/// Resolved on `PATH`, so a user who installed codex through npm needs no setting.
pub const CODEX_PROGRAM: &str = "codex";

/// Only the sandbox limits what a turn may do: A4Note cannot render an approval
/// prompt yet, and a policy that asks would stall every turn on a dialog that never
/// opens. The three sandboxes below are the real permission control.
const APPROVAL_POLICY: &str = "never";

/// Item types that are the conversation itself, or our own echo, and so are never
/// reported as tool activity.
const QUIET_ITEMS: [&str; 3] = ["agentMessage", "userMessage", "reasoning"];

/// How much of a tool detail line is kept. Long enough to recognise a command,
/// short enough that one item cannot flood the transcript.
const DETAIL_LIMIT: usize = 200;

/// The thread id codex minted for a session, readable from off the session thread.
/// The adapter itself is moved into the supervisor by `start`, so this is how the
/// caller learns the id it has to hand back to resume the same thread later.
pub struct CodexSession {
    program: String,
    model: Option<String>,
    /// Set to continue an existing codex thread instead of starting a new one.
    resume: Option<String>,
    handle: ProviderHandle,
    thread_id: Option<String>,
    /// codex's id for the turn in flight. `None` between turns.
    turn: Option<String>,
    /// Between `turn/start` and the first frame that names a turn, any turn id the
    /// CLI mentions is ours — there can only be one turn at a time.
    awaiting_turn: bool,
    /// Message items that already streamed deltas. Their final `item/completed`
    /// repeats the whole text, which would double it in the transcript.
    streamed: HashSet<String>,
    /// Injected by tests. `None` spawns the real CLI.
    transport: Option<Box<dyn AgentTransport + Send>>,
}

impl Default for CodexSession {
    fn default() -> Self {
        Self::new()
    }
}

impl CodexSession {
    pub fn new() -> Self {
        Self {
            program: CODEX_PROGRAM.to_string(),
            model: None,
            resume: None,
            handle: ProviderHandle::default(),
            thread_id: None,
            turn: None,
            awaiting_turn: false,
            streamed: HashSet::new(),
            transport: None,
        }
    }

    /// An explicit executable, for a codex that is not on `PATH`.
    pub fn with_program(mut self, program: impl Into<String>) -> Self {
        let program = program.into();
        if !program.trim().is_empty() {
            self.program = program;
        }
        self
    }

    /// `None` leaves the model to the user's own codex configuration.
    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model = model.filter(|model| !model.trim().is_empty());
        self
    }

    /// Continues an existing codex thread. Unknown ids fail the handshake, which is
    /// how a stale saved session reports itself instead of silently starting over.
    pub fn resuming(mut self, thread_id: Option<String>) -> Self {
        self.resume = thread_id.filter(|id| !id.trim().is_empty());
        self
    }

    /// Reads the thread id after the session has been handed to the supervisor.
    pub fn handle(&self) -> ProviderHandle {
        self.handle.clone()
    }

    /// The seam the in-memory fixture uses; the real session never sets it.
    pub fn with_transport(mut self, transport: impl AgentTransport + Send + 'static) -> Self {
        self.transport = Some(Box::new(transport));
        self
    }
}

impl ProviderSession for CodexSession {
    fn launch(&self, spec: &SessionSpec) -> Result<LaunchConfig, AgentError> {
        Ok(LaunchConfig::new(&self.program, &spec.working_directory).arg("app-server"))
    }

    fn connect(
        &mut self,
        spec: &SessionSpec,
    ) -> Result<Box<dyn AgentTransport + Send>, AgentError> {
        match self.transport.take() {
            Some(transport) => Ok(transport),
            None => Ok(Box::new(ChildTransport::spawn(&self.launch(spec)?)?)),
        }
    }

    /// `initialize` → `initialized` → `thread/start`. Nothing here starts a turn, so
    /// a session that opens costs no model call.
    fn handshake(&mut self, spec: &SessionSpec, io: &mut SessionIo<'_>) -> Result<(), AgentError> {
        io.call(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "A4 Note",
                    "title": "A4 Note",
                    "version": env!("CARGO_PKG_VERSION"),
                },
            }),
        )
        .map_err(|error| promote_handshake(error, "initialize"))?;
        io.notify("initialized", json!({}));

        let (method, params) = self.thread_request(spec);
        let response = io
            .call(method, params)
            .map_err(|error| promote_handshake(error, method))?;
        let thread_id = response
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AgentError::new(
                    AgentErrorKind::HandshakeFailed,
                    format!("codex 未返回会话线程 id（{method}）"),
                )
                .with_detail(io.stderr_tail().to_string())
            })?;
        self.handle.publish(thread_id);
        self.thread_id = Some(thread_id.to_string());
        Ok(())
    }

    /// No deadline on `turn/start`: it answers in about a millisecond, but the turn
    /// it opens legitimately runs for minutes and shares the same request.
    fn begin_turn(
        &mut self,
        message: &str,
        io: &mut SessionIo<'_>,
    ) -> Result<TurnStart, AgentError> {
        let thread_id = self
            .thread_id
            .clone()
            .ok_or_else(|| AgentError::new(AgentErrorKind::Internal, "codex 会话尚未完成握手"))?;
        self.turn = None;
        self.awaiting_turn = true;
        self.streamed.clear();
        let id = io.request_within(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{ "type": "text", "text": message }],
            }),
            None,
        )?;
        Ok(TurnStart::Response(id))
    }

    fn run_id(&mut self, response: &Value) -> Result<String, AgentError> {
        let turn_id = response
            .get("turn")
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AgentError::new(AgentErrorKind::Protocol, "codex 未返回 turn.id")
                    .with_detail(clip(&response.to_string()))
            })?;
        self.turn = Some(turn_id.to_string());
        self.awaiting_turn = false;
        Ok(turn_id.to_string())
    }

    /// codex reports the end of an interrupted turn itself, as `turn/completed` with
    /// an interrupted status, so this returns `true` and the stop ladder is not used.
    /// The interrupt's own response carries nothing, and is forgotten rather than
    /// left pending — see [`SessionIo::forget`].
    fn cancel_turn(&mut self, run_id: &str, io: &mut SessionIo<'_>) -> bool {
        let Some(thread_id) = self.thread_id.clone() else {
            return false;
        };
        match io.request_within(
            "turn/interrupt",
            json!({ "threadId": thread_id, "turnId": run_id }),
            None,
        ) {
            Ok(id) => {
                io.forget(id);
                true
            }
            Err(_) => false,
        }
    }

    fn translate(&mut self, notice: &PeerNotice) -> Vec<TurnFrame> {
        match notice {
            PeerNotice::Notification { method, params } => self.notification(method, params),
            // A request is answered in `on_request`; an unparsed banner, a non-RPC
            // frame codex never sends, and an orphan response are diagnostics rather
            // than turn updates.
            PeerNotice::Request { .. }
            | PeerNotice::Unparsed(_)
            | PeerNotice::Payload(_)
            | PeerNotice::Orphan(_) => Vec::new(),
        }
    }

    /// Refuses, then says so in the transcript: with `approvalPolicy:"never"` this
    /// should not happen, and if it does the user needs to see why a step stopped
    /// rather than watch the turn go quiet.
    fn on_request(
        &mut self,
        id: i64,
        method: &str,
        params: &Value,
        io: &mut SessionIo<'_>,
    ) -> Vec<TurnFrame> {
        io.respond_error(id, -32601, &format!("A4 Note 暂不支持该请求：{method}"));
        if !self.same_thread(params) || !self.live(turn_of(params)) {
            return Vec::new();
        }
        vec![TurnFrame::any(TurnUpdate::Tool(json!({
            "kind": "approvalDenied",
            "detail": method,
        })))]
    }
}

impl CodexSession {
    /// `thread/resume` takes the same parameters as `thread/start` plus the id, so
    /// resuming is one branch rather than a second code path.
    fn thread_request(&self, spec: &SessionSpec) -> (&'static str, Value) {
        let mut params = json!({
            "cwd": spec.working_directory.display().to_string(),
            "approvalPolicy": APPROVAL_POLICY,
            "sandbox": sandbox_for(&spec.permission_mode),
        });
        if let Some(model) = &self.model {
            params["model"] = Value::from(model.clone());
        }
        match &self.resume {
            Some(thread_id) => {
                params["threadId"] = Value::from(thread_id.clone());
                ("thread/resume", params)
            }
            None => ("thread/start", params),
        }
    }

    fn notification(&mut self, method: &str, params: &Value) -> Vec<TurnFrame> {
        if !self.same_thread(params) {
            return Vec::new();
        }
        match method {
            // Nothing to show, but it is usually the first frame to name the turn.
            "turn/started" => {
                self.live(turn_of(params));
                Vec::new()
            }
            "item/agentMessage/delta" => self.message_delta(params),
            "item/completed" => self.item_completed(params),
            "turn/completed" => self.turn_completed(params),
            "error" => self.error_notice(params),
            // Reasoning deltas, plan updates, diffs, MCP startup and hook progress:
            // all real frames, none of them part of what CLI-2 shows.
            _ => Vec::new(),
        }
    }

    fn message_delta(&mut self, params: &Value) -> Vec<TurnFrame> {
        if !self.live(turn_of(params)) {
            return Vec::new();
        }
        let text = params
            .get("delta")
            .or_else(|| params.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if text.is_empty() {
            return Vec::new();
        }
        if let Some(item_id) = params.get("itemId").and_then(Value::as_str) {
            self.streamed.insert(item_id.to_string());
        }
        vec![self.frame(TurnUpdate::Delta(text.to_string()))]
    }

    /// A finished item is either the assistant's message or a record of something the
    /// agent did. The message is only delivered here when it never streamed: codex
    /// repeats the full text in the completed item, and rendering both doubles it.
    fn item_completed(&mut self, params: &Value) -> Vec<TurnFrame> {
        if !self.live(turn_of(params)) {
            return Vec::new();
        }
        let Some(item) = params.get("item") else {
            return Vec::new();
        };
        if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
            let item_id = item.get("id").and_then(Value::as_str).unwrap_or_default();
            let text = item.get("text").and_then(Value::as_str).unwrap_or_default();
            if text.is_empty() || self.streamed.contains(item_id) {
                return Vec::new();
            }
            return vec![self.frame(TurnUpdate::Delta(text.to_string()))];
        }
        match tool_payload(item) {
            Some(payload) => vec![self.frame(TurnUpdate::Tool(payload))],
            None => Vec::new(),
        }
    }

    fn turn_completed(&mut self, params: &Value) -> Vec<TurnFrame> {
        if !self.live(turn_of(params)) {
            return Vec::new();
        }
        let turn = params.get("turn");
        let status = turn
            .and_then(|turn| turn.get("status"))
            .and_then(Value::as_str)
            .unwrap_or("completed");
        let update = match status {
            "failed" => TurnUpdate::Failed(turn_error(turn)),
            other if is_interrupted(other) => TurnUpdate::Stopped,
            // An unknown status still ends the turn: an open run would leave the
            // composer waiting on a turn nobody is going to finish.
            _ => TurnUpdate::Completed,
        };
        vec![self.finish(update)]
    }

    /// codex reports a lost connection as an `error` notification and retries up to
    /// five times before giving up, so only `willRetry:false` ends the turn.
    fn error_notice(&mut self, params: &Value) -> Vec<TurnFrame> {
        if !self.live(turn_of(params)) {
            return Vec::new();
        }
        let message = params
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("codex 报告了一个错误");
        if params
            .get("willRetry")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return vec![self.frame(TurnUpdate::Tool(json!({
                "kind": "retry",
                "detail": clip(message),
            })))];
        }
        vec![self.finish(TurnUpdate::Failed(AgentError::new(
            AgentErrorKind::Transport,
            message,
        )))]
    }

    /// Builds a frame and closes the turn. Both halves matter: codex announces one
    /// failure twice (an `error` and then a failed `turn/completed`), and dropping the
    /// second is what keeps the run from ending twice — or, when a queued message has
    /// already started the next run, from ending the wrong one.
    fn finish(&mut self, update: TurnUpdate) -> TurnFrame {
        let frame = self.frame(update);
        self.turn = None;
        self.awaiting_turn = false;
        self.streamed.clear();
        frame
    }

    /// Whether a frame belongs to the turn in flight, adopting codex's turn id the
    /// first time one is seen. `false` drops the frame.
    fn live(&mut self, turn_id: Option<&str>) -> bool {
        match (self.turn.as_deref(), turn_id) {
            (Some(current), Some(named)) => current == named,
            // Thread-level frames such as `error` carry no turn; during a turn they
            // are about that turn.
            (Some(_), None) => true,
            (None, Some(named)) if self.awaiting_turn => {
                self.turn = Some(named.to_string());
                self.awaiting_turn = false;
                true
            }
            (None, _) => false,
        }
    }

    fn same_thread(&self, params: &Value) -> bool {
        match (
            self.thread_id.as_deref(),
            params.get("threadId").and_then(Value::as_str),
        ) {
            (Some(current), Some(named)) => current == named,
            _ => true,
        }
    }

    fn frame(&self, update: TurnUpdate) -> TurnFrame {
        match self.turn.as_deref() {
            Some(turn_id) => TurnFrame::of(turn_id, update),
            None => TurnFrame::any(update),
        }
    }
}

/// codex's sandbox for each A4Note permission mode. An unknown mode — including one
/// a newer frontend invents — gets the least privileged sandbox, never the most.
pub fn sandbox_for(mode: &str) -> &'static str {
    match mode {
        "autoReview" => "workspace-write",
        "fullAccess" => "danger-full-access",
        _ => "read-only",
    }
}

/// The turn a frame is about. Update notifications carry `turnId`; the two turn
/// lifecycle notifications carry the whole turn instead.
fn turn_of(params: &Value) -> Option<&str> {
    params.get("turnId").and_then(Value::as_str).or_else(|| {
        params
            .get("turn")
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
    })
}

/// Interrupting is a normal end, not a failure, and the status naming it has changed
/// spelling upstream before.
fn is_interrupted(status: &str) -> bool {
    let status = status.to_ascii_lowercase();
    status.contains("interrupt") || status.contains("cancel") || status.contains("abort")
}

fn turn_error(turn: Option<&Value>) -> AgentError {
    let message = turn
        .and_then(|turn| turn.get("error"))
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("codex 未能完成本回合");
    AgentError::new(AgentErrorKind::Protocol, message)
}

/// A compact notice for one non-message item: what the agent did, not the whole
/// item. Items carry diffs and command output, and the transcript is not the place
/// to re-render either.
fn tool_payload(item: &Value) -> Option<Value> {
    let kind = item.get("type").and_then(Value::as_str)?;
    if QUIET_ITEMS.contains(&kind) {
        return None;
    }
    let mut payload = json!({ "kind": kind });
    if let Some(detail) = tool_detail(item, kind) {
        payload["detail"] = Value::from(detail);
    }
    if let Some(status) = item.get("status").and_then(Value::as_str) {
        payload["status"] = Value::from(status);
    }
    if let Some(code) = item.get("exitCode").and_then(Value::as_i64) {
        payload["exitCode"] = Value::from(code);
    }
    Some(payload)
}

/// One line describing an item, chosen by what the item actually has. The fallback
/// order is deliberate: a new item type upstream still shows something useful rather
/// than an empty row.
fn tool_detail(item: &Value, kind: &str) -> Option<String> {
    if kind == "fileChange" {
        return file_change_detail(item);
    }
    if kind == "mcpToolCall" {
        let server = item.get("server").and_then(Value::as_str);
        let tool = item.get("tool").and_then(Value::as_str);
        if let (Some(server), Some(tool)) = (server, tool) {
            return Some(clip(&format!("{server} / {tool}")));
        }
    }
    for key in ["command", "query", "tool", "path", "title", "text"] {
        if let Some(value) = item.get(key).and_then(Value::as_str) {
            if !value.trim().is_empty() {
                return Some(clip(value));
            }
        }
    }
    // `command` is a string for a shell call and an argv list for a direct exec.
    let argv = item.get("command").and_then(Value::as_array)?;
    let joined = argv
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join(" ");
    (!joined.trim().is_empty()).then(|| clip(&joined))
}

fn file_change_detail(item: &Value) -> Option<String> {
    let changes = item.get("changes").and_then(Value::as_array)?;
    let paths: Vec<&str> = changes
        .iter()
        .filter_map(|change| change.get("path").and_then(Value::as_str))
        .take(3)
        .collect();
    if paths.is_empty() {
        return None;
    }
    let listed = paths.join("、");
    let summary = if changes.len() > paths.len() {
        format!("{listed} 等 {} 处", changes.len())
    } else {
        listed
    };
    Some(clip(&summary))
}

/// Char-boundary safe on purpose: these details are as often Chinese as ASCII.
fn clip(text: &str) -> String {
    let mut clipped: String = text.chars().take(DETAIL_LIMIT).collect();
    if clipped.chars().count() < text.chars().count() {
        clipped.push('…');
    }
    clipped
}

/// Reports a failure during the handshake as one, keeping the cause in the message.
/// A CLI that is missing or would not start already says so more precisely.
fn promote_handshake(error: AgentError, method: &str) -> AgentError {
    if matches!(
        error.kind,
        AgentErrorKind::NotInstalled | AgentErrorKind::SpawnFailed
    ) {
        return error;
    }
    AgentError {
        kind: AgentErrorKind::HandshakeFailed,
        message: format!("codex 握手失败（{method}）：{}", error.message),
        detail: error.detail,
        exit_code: error.exit_code,
        signal: error.signal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_cli::peer::AgentPeer;
    use crate::agent_cli::protocol::AgentEvent;
    use crate::agent_cli::supervisor::{AgentSupervisor, SessionSink};
    use crate::agent_cli::transport::{FakePeer, InMemoryTransport};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    fn spec(session_id: &str) -> SessionSpec {
        SessionSpec::new(session_id, std::env::temp_dir())
    }

    fn thread_result(thread_id: &str) -> Value {
        json!({ "thread": { "id": thread_id, "cwd": ".", "turns": [] } })
    }

    /// Answers each request only after it has been written, the way a real CLI does.
    /// Queueing the answers up front would not work: a response to an id that is not
    /// pending yet is discarded as an orphan.
    fn serve(cli: FakePeer, answers: Vec<Value>) -> thread::JoinHandle<()> {
        thread::spawn(move || {
            let mut answered = 0;
            let mut cursor = 0;
            for _ in 0..400 {
                let lines = cli.written();
                while cursor < lines.len() && answered < answers.len() {
                    let message: Value =
                        serde_json::from_str(&lines[cursor]).expect("有效 JSON-RPC");
                    cursor += 1;
                    if message.get("id").is_none() || message.get("method").is_none() {
                        continue;
                    }
                    cli.send_line(
                        &json!({ "id": message["id"], "result": answers[answered] }).to_string(),
                    );
                    answered += 1;
                }
                if answered >= answers.len() {
                    return;
                }
                thread::sleep(Duration::from_millis(5));
            }
        })
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

    fn parsed(line: &str) -> Value {
        serde_json::from_str(line).expect("有效 JSON-RPC")
    }

    /// A session already past its handshake, with `turn-1` in flight.
    fn seeded() -> CodexSession {
        let mut session = CodexSession::new();
        session.thread_id = Some("thread-1".to_string());
        session.turn = Some("turn-1".to_string());
        session
    }

    fn notice(method: &str, params: Value) -> PeerNotice {
        PeerNotice::Notification {
            method: method.to_string(),
            params,
        }
    }

    fn deltas(frames: &[TurnFrame]) -> Vec<String> {
        frames
            .iter()
            .filter_map(|frame| match &frame.update {
                TurnUpdate::Delta(text) => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    fn tool(frame: &TurnFrame) -> &Value {
        match &frame.update {
            TurnUpdate::Tool(payload) => payload,
            other => panic!("expected a tool notice, got {other:?}"),
        }
    }

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
                AgentEvent::Delta { content, .. } => Some(content.clone()),
                _ => None,
            })
            .collect()
    }

    /// Events are produced on the session thread, so assertions wait for them.
    fn wait_for_terminal(events: &Arc<Mutex<Vec<AgentEvent>>>) -> Vec<AgentEvent> {
        for _ in 0..200 {
            let seen = events.lock().expect("事件列表").clone();
            if seen.iter().any(AgentEvent::is_terminal) {
                return seen;
            }
            thread::sleep(Duration::from_millis(10));
        }
        events.lock().expect("事件列表").clone()
    }

    fn recorder() -> (SessionSink, Arc<Mutex<Vec<AgentEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&events);
        (
            Arc::new(move |event| seen.lock().expect("事件列表").push(event)),
            events,
        )
    }

    #[test]
    fn the_launch_config_starts_the_app_server() {
        let config = CodexSession::new()
            .launch(&spec("s1"))
            .expect("启动配置必须可用");
        assert_eq!(config.program, "codex");
        assert_eq!(config.args, vec!["app-server".to_string()]);
    }

    #[test]
    fn permission_modes_map_to_sandboxes() {
        assert_eq!(sandbox_for("default"), "read-only");
        assert_eq!(sandbox_for("autoReview"), "workspace-write");
        assert_eq!(sandbox_for("fullAccess"), "danger-full-access");
        // A mode a newer frontend invents must not silently unlock the machine.
        assert_eq!(sandbox_for("everything"), "read-only");
    }

    #[test]
    fn handshake_starts_a_thread_and_publishes_its_id() {
        let (mut transport, cli) = InMemoryTransport::new();
        let responder = serve(
            cli.clone(),
            vec![json!({ "userAgent": "codex" }), thread_result("thread-1")],
        );
        let mut session = CodexSession::new();
        let handle = session.handle();
        let mut peer = AgentPeer::new();
        session
            .handshake(
                &spec("s1").with_permission_mode("autoReview"),
                &mut SessionIo::new(&mut transport, &mut peer),
            )
            .expect("握手必须成功");
        responder.join().expect("应答线程");

        let lines = cli.written();
        assert_eq!(lines.len(), 3);
        assert_eq!(parsed(&lines[0])["method"], "initialize");
        assert_eq!(parsed(&lines[0])["params"]["clientInfo"]["name"], "A4 Note");
        assert_eq!(parsed(&lines[1])["method"], "initialized");
        assert!(parsed(&lines[1]).get("id").is_none(), "initialized 是通知");
        let start = parsed(&lines[2]);
        assert_eq!(start["method"], "thread/start");
        assert_eq!(start["params"]["approvalPolicy"], "never");
        assert_eq!(start["params"]["sandbox"], "workspace-write");
        assert_eq!(handle.conversation_id().as_deref(), Some("thread-1"));
    }

    #[test]
    fn resuming_continues_the_saved_thread() {
        let (mut transport, cli) = InMemoryTransport::new();
        let responder = serve(cli.clone(), vec![json!({}), thread_result("thread-9")]);
        let mut session = CodexSession::new().resuming(Some("thread-9".to_string()));
        let mut peer = AgentPeer::new();
        session
            .handshake(&spec("s1"), &mut SessionIo::new(&mut transport, &mut peer))
            .expect("握手必须成功");
        responder.join().expect("应答线程");

        let resume = parsed(&cli.written()[2]);
        assert_eq!(resume["method"], "thread/resume");
        assert_eq!(resume["params"]["threadId"], "thread-9");
        assert_eq!(resume["params"]["sandbox"], "read-only");
    }

    /// A thread id that never arrives has to fail the handshake: a session that
    /// silently has no thread would accept messages and answer none of them.
    #[test]
    fn a_handshake_without_a_thread_id_fails() {
        let (mut transport, cli) = InMemoryTransport::new();
        let responder = serve(cli.clone(), vec![json!({}), json!({ "thread": {} })]);
        let mut session = CodexSession::new();
        let mut peer = AgentPeer::new();
        let error = session
            .handshake(&spec("s1"), &mut SessionIo::new(&mut transport, &mut peer))
            .expect_err("缺少 thread.id 必须失败");
        responder.join().expect("应答线程");
        assert_eq!(error.kind, AgentErrorKind::HandshakeFailed);
        assert!(session.handle().conversation_id().is_none());
    }

    #[test]
    fn a_streamed_message_is_not_repeated_by_its_completed_item() {
        let mut session = seeded();
        let mut frames = Vec::new();
        for delta in ["你", "好"] {
            frames.extend(session.translate(&notice(
                "item/agentMessage/delta",
                json!({
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "itemId": "item-1",
                    "delta": delta,
                }),
            )));
        }
        assert_eq!(deltas(&frames), vec!["你", "好"]);
        assert_eq!(frames[0].run_id.as_deref(), Some("turn-1"));

        let repeated = session.translate(&notice(
            "item/completed",
            json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": { "id": "item-1", "type": "agentMessage", "text": "你好" },
            }),
        ));
        assert!(repeated.is_empty(), "流式输出过的消息不能再重复一次");
    }

    /// codex can answer in one item with no deltas at all, and then the completed
    /// item is the only copy of the text there is.
    #[test]
    fn a_message_that_never_streamed_arrives_with_its_completed_item() {
        let mut session = seeded();
        let frames = session.translate(&notice(
            "item/completed",
            json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": { "id": "item-7", "type": "agentMessage", "text": "一次性回答" },
            }),
        ));
        assert_eq!(deltas(&frames), vec!["一次性回答"]);
    }

    /// Our own message comes back as an item, and reasoning streams constantly.
    /// Neither is agent output.
    #[test]
    fn the_echo_of_our_message_and_the_reasoning_stream_stay_hidden() {
        let mut session = seeded();
        let echo = session.translate(&notice(
            "item/completed",
            json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": { "id": "item-0", "type": "userMessage", "text": "你好" },
            }),
        ));
        assert!(echo.is_empty(), "用户自己的消息不能当成模型输出");

        let reasoning = session.translate(&notice(
            "item/reasoning/textDelta",
            json!({ "threadId": "thread-1", "turnId": "turn-1", "delta": "思考" }),
        ));
        assert!(reasoning.is_empty());
    }

    #[test]
    fn a_command_item_becomes_one_tool_notice() {
        let mut session = seeded();
        let frames = session.translate(&notice(
            "item/completed",
            json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": {
                    "id": "item-2",
                    "type": "commandExecution",
                    "command": "npm run verify",
                    "status": "completed",
                    "exitCode": 0,
                },
            }),
        ));
        assert_eq!(frames.len(), 1);
        let payload = tool(&frames[0]);
        assert_eq!(payload["kind"], "commandExecution");
        assert_eq!(payload["detail"], "npm run verify");
        assert_eq!(payload["status"], "completed");
        assert_eq!(payload["exitCode"], 0);
    }

    #[test]
    fn a_file_change_item_names_the_files_it_touched() {
        let mut session = seeded();
        let frames = session.translate(&notice(
            "item/completed",
            json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": {
                    "id": "item-3",
                    "type": "fileChange",
                    "status": "completed",
                    "changes": [
                        { "path": "src/a.ts" },
                        { "path": "src/b.ts" },
                        { "path": "src/c.ts" },
                        { "path": "src/d.ts" },
                    ],
                },
            }),
        ));
        let payload = tool(&frames[0]);
        assert_eq!(payload["kind"], "fileChange");
        assert_eq!(payload["detail"], "src/a.ts、src/b.ts、src/c.ts 等 4 处");
    }

    /// The failure path codex actually produces: up to five retries, then one final
    /// error, then a failed `turn/completed` for the same failure. One turn, one end.
    #[test]
    fn a_retrying_error_is_a_notice_and_the_final_one_ends_the_turn_once() {
        let mut session = seeded();
        let retry = session.translate(&notice(
            "error",
            json!({
                "threadId": "thread-1",
                "message": "Reconnecting... 1/5",
                "willRetry": true,
            }),
        ));
        assert_eq!(tool(&retry[0])["kind"], "retry");

        let failed = session.translate(&notice(
            "error",
            json!({ "threadId": "thread-1", "message": "stream error: 503", "willRetry": false }),
        ));
        match &failed[0].update {
            TurnUpdate::Failed(error) => {
                assert_eq!(error.kind, AgentErrorKind::Transport);
                assert_eq!(error.message, "stream error: 503");
            }
            other => panic!("expected a failure, got {other:?}"),
        }

        let duplicate = session.translate(&notice(
            "turn/completed",
            json!({
                "threadId": "thread-1",
                "turn": { "id": "turn-1", "status": "failed", "error": { "message": "stream error: 503" } },
            }),
        ));
        assert!(duplicate.is_empty(), "同一个回合只能结束一次");
    }

    #[test]
    fn an_interrupted_turn_stops_and_an_unknown_status_still_ends_it() {
        let mut session = seeded();
        let stopped = session.translate(&notice(
            "turn/completed",
            json!({ "threadId": "thread-1", "turn": { "id": "turn-1", "status": "interrupted" } }),
        ));
        assert!(matches!(stopped[0].update, TurnUpdate::Stopped));

        let mut session = seeded();
        let ended = session.translate(&notice(
            "turn/completed",
            json!({ "threadId": "thread-1", "turn": { "id": "turn-1", "status": "somethingNew" } }),
        ));
        assert!(
            matches!(ended[0].update, TurnUpdate::Completed),
            "未知状态也要结束回合，否则输入框永远等下去"
        );
    }

    #[test]
    fn frames_from_another_turn_or_thread_are_dropped() {
        let mut session = seeded();
        let other_turn = session.translate(&notice(
            "item/agentMessage/delta",
            json!({ "threadId": "thread-1", "turnId": "turn-2", "delta": "别的回合" }),
        ));
        assert!(other_turn.is_empty());
        let other_thread = session.translate(&notice(
            "item/agentMessage/delta",
            json!({ "threadId": "thread-9", "turnId": "turn-1", "delta": "别的线程" }),
        ));
        assert!(other_thread.is_empty());
    }

    /// Before `turn/start` answers, codex can already be streaming: the first turn id
    /// it names is adopted, because there is only ever one turn in flight.
    #[test]
    fn the_first_turn_id_seen_is_adopted_when_the_response_is_still_in_flight() {
        let mut session = CodexSession::new();
        session.thread_id = Some("thread-1".to_string());
        session.awaiting_turn = true;
        let early = session.translate(&notice(
            "item/agentMessage/delta",
            json!({ "threadId": "thread-1", "turnId": "turn-1", "delta": "早" }),
        ));
        assert_eq!(deltas(&early), vec!["早"]);
        assert_eq!(session.turn.as_deref(), Some("turn-1"));
    }

    /// With `approvalPolicy:"never"` this should not happen at all; if it does, the
    /// answer is a refusal and the transcript says so, because a step that quietly
    /// never ran is worse than one that visibly could not.
    #[test]
    fn an_approval_request_is_refused_and_shown_in_the_transcript() {
        let (mut transport, cli) = InMemoryTransport::new();
        let mut peer = AgentPeer::new();
        let mut session = seeded();
        let frames = session.on_request(
            7,
            "execCommandApproval",
            &json!({ "threadId": "thread-1", "turnId": "turn-1" }),
            &mut SessionIo::new(&mut transport, &mut peer),
        );

        let reply = parsed(&cli.written()[0]);
        assert_eq!(reply["id"], 7);
        assert_eq!(reply["error"]["code"], -32601);
        assert_eq!(tool(&frames[0])["kind"], "approvalDenied");
        assert_eq!(tool(&frames[0])["detail"], "execCommandApproval");
    }

    #[test]
    fn a_turn_streams_through_the_supervisor_and_completes() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = recorder();
        let supervisor = AgentSupervisor::new(sink);
        let responder = serve(
            cli.clone(),
            vec![
                json!({}),
                thread_result("thread-1"),
                json!({ "turn": { "id": "turn-1", "status": "inProgress" } }),
            ],
        );
        supervisor
            .start(
                spec("s1"),
                Box::new(CodexSession::new().with_transport(transport)),
            )
            .expect("握手必须成功");
        supervisor.send("s1", "你好").expect("会话必须能接收消息");
        responder.join().expect("应答线程");

        let start = parsed(&written(&cli, 4)[3]);
        assert_eq!(start["method"], "turn/start");
        assert_eq!(start["params"]["threadId"], "thread-1");
        assert_eq!(start["params"]["input"][0]["text"], "你好");
        for delta in ["你", "好"] {
            cli.send_line(
                &json!({
                    "method": "item/agentMessage/delta",
                    "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "i1", "delta": delta },
                    "emittedAtMs": 1,
                })
                .to_string(),
            );
        }
        cli.send_line(
            &json!({
                "method": "turn/completed",
                "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "completed" } },
            })
            .to_string(),
        );

        let seen = wait_for_terminal(&events);
        assert_eq!(kinds(&seen), vec!["started", "delta", "delta", "completed"]);
        assert_eq!(text(&seen), "你好");
        assert!(supervisor.close("s1"));
    }

    /// Stopping asks codex to interrupt and then waits for its answer, so the end of
    /// the turn is still the CLI's own report rather than ours.
    #[test]
    fn stopping_a_turn_interrupts_it_in_codex() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = recorder();
        let supervisor = AgentSupervisor::new(sink);
        let responder = serve(
            cli.clone(),
            vec![
                json!({}),
                thread_result("thread-1"),
                json!({ "turn": { "id": "turn-1", "status": "inProgress" } }),
            ],
        );
        supervisor
            .start(
                spec("s1"),
                Box::new(CodexSession::new().with_transport(transport)),
            )
            .expect("握手必须成功");
        supervisor
            .send("s1", "跑很久的任务")
            .expect("会话必须能接收消息");
        responder.join().expect("应答线程");
        written(&cli, 4);

        supervisor.stop("s1").expect("会话必须能收到停止");
        let interrupt = parsed(&written(&cli, 5)[4]);
        assert_eq!(interrupt["method"], "turn/interrupt");
        assert_eq!(interrupt["params"]["threadId"], "thread-1");
        assert_eq!(interrupt["params"]["turnId"], "turn-1");

        cli.send_line(
            &json!({
                "method": "turn/completed",
                "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "interrupted" } },
            })
            .to_string(),
        );
        let seen = wait_for_terminal(&events);
        assert_eq!(kinds(&seen), vec!["started", "stopped"]);
        assert!(supervisor.close("s1"));
    }
}
