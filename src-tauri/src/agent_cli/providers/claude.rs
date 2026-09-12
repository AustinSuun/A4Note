//! Claude Code: `claude -p --input-format stream-json` behind the
//! [`ProviderSession`] seam.
//!
//! The dialect is *not* JSON-RPC, checked against Claude Code 2.1.220. Frames are
//! bare newline-delimited objects tagged with `type` and carrying no `id` or
//! `method`, so they reach the adapter as [`PeerNotice::Payload`]. Five properties of
//! it shape this file:
//!
//! * nothing is written until the first user message, so there is no handshake to
//!   answer. `handshake` instead watches the fresh process for long enough to catch
//!   one that died on a rejected flag or a missing login.
//! * a turn is one `{"type":"user",...}` frame in and, on the way back,
//!   `system`/`stream_event`/`assistant`/`result`. The CLI never names the turn, so
//!   the adapter mints its own marker.
//! * `--include-partial-messages` streams Anthropic's own message events, so the
//!   text really is incremental (`text_delta`). The `assistant` frame that follows
//!   repeats the whole message, and is suppressed per message id.
//! * `system`/`init` repeats on *every* turn and carries the `session_id` a later
//!   `--resume` needs.
//! * stopping is the control protocol: `{"subtype":"interrupt"}` in, one
//!   `control_response` back. That answer is what ends the turn here, so a stop does
//!   not depend on whether the aborted turn still reports a `result`.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

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

/// Resolved on `PATH`, so a user who installed Claude Code through npm or the native
/// installer needs no setting.
pub const CLAUDE_PROGRAM: &str = "claude";

/// The conservative floor. A4Note cannot render a permission prompt, so `manual`
/// means anything that would ask is refused: the turn can read and search, and it
/// cannot write. Also the fallback, so an unknown mode never widens a session.
pub const MANUAL_MODE: &str = "manual";

/// How long a fresh process is watched before the session counts as started. A CLI
/// that rejects a flag or has no credentials exits well inside this; one that is
/// healthy simply stays silent, because it has nothing to say yet.
const SETTLE_WINDOW: Duration = Duration::from_millis(500);

/// How much of a tool detail line is kept. Long enough to recognise a command, short
/// enough that one call cannot flood the transcript.
const DETAIL_LIMIT: usize = 200;

/// What a refused permission request is told. It reaches the model, so it says what
/// to do instead of only saying no.
const DENY_MESSAGE: &str = "A4 Note 没有开启这个权限。请改用只读方式完成，或让用户把会话权限调高。";

pub struct ClaudeSession {
    program: String,
    model: Option<String>,
    /// Set to continue an existing claude session instead of starting a new one.
    resume: Option<String>,
    handle: ProviderHandle,
    /// Our own marker for the turn in flight; `None` between turns. claude names no
    /// turn, and this is also the latch that keeps one turn to one terminal.
    turn: Option<String>,
    /// Turns sent on this session, used to make the marker and the interrupt ids
    /// unique for as long as the process lives.
    turns: usize,
    /// Assistant messages whose text already arrived as deltas. Their `assistant`
    /// frame repeats the whole thing, which would double it in the transcript.
    streamed: HashSet<String>,
    /// The assistant message the `stream_event` frames currently belong to: a
    /// `content_block_delta` says which block it is, never which message.
    message: Option<String>,
    /// Whether this turn has produced any text yet, so `result` can stand in when
    /// nothing streamed at all.
    spoke: bool,
    /// `tool_use_id` → tool name, so a failed `tool_result` can name what failed.
    tools: HashMap<String, String>,
    /// `request_id`s of interrupts we sent and have not heard back on.
    interrupts: HashSet<String>,
    /// Injected by tests. `None` spawns the real CLI.
    transport: Option<Box<dyn AgentTransport + Send>>,
}

impl Default for ClaudeSession {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeSession {
    pub fn new() -> Self {
        Self {
            program: CLAUDE_PROGRAM.to_string(),
            model: None,
            resume: None,
            handle: ProviderHandle::default(),
            turn: None,
            turns: 0,
            streamed: HashSet::new(),
            message: None,
            spoke: false,
            tools: HashMap::new(),
            interrupts: HashSet::new(),
            transport: None,
        }
    }

    /// An explicit executable, for a claude that is not on `PATH`.
    pub fn with_program(mut self, program: impl Into<String>) -> Self {
        let program = program.into();
        if !program.trim().is_empty() {
            self.program = program;
        }
        self
    }

    /// `None` leaves the model to the user's own Claude Code configuration.
    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model = model.filter(|model| !model.trim().is_empty());
        self
    }

    /// Continues an existing claude session. An id claude no longer has fails the
    /// spawn, which is how a stale saved session reports itself instead of silently
    /// starting a new conversation under the old name.
    pub fn resuming(mut self, session_id: Option<String>) -> Self {
        self.resume = session_id.filter(|id| !id.trim().is_empty());
        self
    }

    /// Reads the session id after the adapter has been handed to the supervisor.
    pub fn handle(&self) -> ProviderHandle {
        self.handle.clone()
    }

    /// The seam the in-memory fixture uses; the real session never sets it.
    pub fn with_transport(mut self, transport: impl AgentTransport + Send + 'static) -> Self {
        self.transport = Some(Box::new(transport));
        self
    }
}

impl ProviderSession for ClaudeSession {
    /// `-p` with stream-json on both ends is what makes this a protocol rather than a
    /// screen scrape, and `--verbose` is what the CLI requires alongside it. There is
    /// no `--cwd`: the working directory comes from the spawn itself.
    fn launch(&self, spec: &SessionSpec) -> Result<LaunchConfig, AgentError> {
        let mut config = LaunchConfig::new(&self.program, &spec.working_directory).args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
            "--permission-mode",
            permission_for(&spec.permission_mode),
        ]);
        if let Some(model) = &self.model {
            config = config.args(["--model", model]);
        }
        if let Some(session_id) = &self.resume {
            config = config.args(["--resume", session_id]);
        }
        Ok(config)
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

    /// There is nothing to exchange: claude stays silent until the first user
    /// message, so a session that opens costs no model call. What is left to check is
    /// that the process it opened is still there — a rejected flag or a missing login
    /// exits in milliseconds, and without this the session would look started and
    /// only fail on the user's first message.
    fn handshake(&mut self, _spec: &SessionSpec, io: &mut SessionIo<'_>) -> Result<(), AgentError> {
        io.settle(SETTLE_WINDOW).map_err(|error| AgentError {
            kind: AgentErrorKind::HandshakeFailed,
            message: format!("claude 启动后立刻退出：{}", error.message),
            detail: error.detail,
            exit_code: error.exit_code,
            signal: error.signal,
        })
    }

    /// One frame, and the turn is open. claude answers nothing to it, so the marker
    /// is minted here rather than read out of a response.
    fn begin_turn(
        &mut self,
        message: &str,
        io: &mut SessionIo<'_>,
    ) -> Result<TurnStart, AgentError> {
        self.reset_turn();
        let sent = io.send_payload(&json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{ "type": "text", "text": message }],
            },
        }));
        if !sent {
            return Err(AgentError::new(
                AgentErrorKind::Transport,
                "claude 的输入流已关闭，消息没有发出去",
            ));
        }
        self.turns += 1;
        let marker = format!("claude-turn-{}", self.turns);
        self.turn = Some(marker.clone());
        Ok(TurnStart::Known(marker))
    }

    /// Never called: [`TurnStart::Known`] means the handle was known up front.
    fn run_id(&mut self, _response: &Value) -> Result<String, AgentError> {
        Err(AgentError::new(
            AgentErrorKind::Internal,
            "claude 的回合不通过响应命名",
        ))
    }

    /// Asks over the control protocol and reports that the CLI will end the turn
    /// itself — which it does by answering this very request, see `control_response`.
    fn cancel_turn(&mut self, _run_id: &str, io: &mut SessionIo<'_>) -> bool {
        let request_id = format!("a4note-interrupt-{}-{}", self.turns, self.interrupts.len());
        let sent = io.send_payload(&json!({
            "type": "control_request",
            "request_id": request_id,
            "request": { "subtype": "interrupt" },
        }));
        if sent {
            self.interrupts.insert(request_id);
        }
        sent
    }

    /// Everything claude says is a `type`-tagged object, which arrives as
    /// [`PeerNotice::Payload`] and is read by `on_payload`. A JSON-RPC notification, a
    /// banner and an orphan response all carry nothing for the transcript.
    fn translate(&mut self, _notice: &PeerNotice) -> Vec<TurnFrame> {
        Vec::new()
    }

    fn on_payload(&mut self, payload: &Value, io: &mut SessionIo<'_>) -> Vec<TurnFrame> {
        match payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "system" => self.system(payload),
            "stream_event" => self.stream_event(payload),
            "assistant" => self.assistant(payload),
            "user" => self.tool_results(payload),
            "result" => self.result(payload),
            "control_request" => self.control_request(payload, io),
            "control_response" => self.control_response(payload),
            _ => Vec::new(),
        }
    }
}

impl ClaudeSession {
    /// `system` carries no text. `init` repeats on every turn and is where the
    /// `session_id` a later `--resume` needs lives; `status` and the rest are noise.
    fn system(&mut self, payload: &Value) -> Vec<TurnFrame> {
        if payload.get("subtype").and_then(Value::as_str) == Some("init") {
            if let Some(session_id) = payload.get("session_id").and_then(Value::as_str) {
                self.handle.publish(session_id);
            }
        }
        Vec::new()
    }

    /// Anthropic's own message events, forwarded verbatim by `--include-partial-messages`.
    /// Only text deltas are shown: thinking is not the answer, and `input_json` deltas
    /// are partial JSON that is reported once, whole, as a tool notice instead.
    fn stream_event(&mut self, payload: &Value) -> Vec<TurnFrame> {
        let Some(event) = payload.get("event") else {
            return Vec::new();
        };
        match event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            // The only frame that names the message the following deltas belong to.
            "message_start" => {
                self.message = event
                    .get("message")
                    .and_then(|message| message.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                Vec::new()
            }
            "content_block_delta" => self.text_delta(event),
            _ => Vec::new(),
        }
    }

    /// Marks the message as streamed on the way through, which is what suppresses the
    /// `assistant` frame that repeats all of it.
    fn text_delta(&mut self, event: &Value) -> Vec<TurnFrame> {
        let delta = event.get("delta");
        if delta
            .and_then(|delta| delta.get("type"))
            .and_then(Value::as_str)
            != Some("text_delta")
        {
            return Vec::new();
        }
        let text = delta
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if text.is_empty() {
            return Vec::new();
        }
        if let Some(message) = self.message.clone() {
            self.streamed.insert(message);
        }
        self.spoke = true;
        vec![self.frame(TurnUpdate::Delta(text.to_string()))]
    }

    /// The whole message, again. Its text is only delivered when nothing streamed it,
    /// and `tool_use` blocks are only ever reported from here — this is the first
    /// frame in which a call's arguments are complete.
    fn assistant(&mut self, payload: &Value) -> Vec<TurnFrame> {
        let message = payload.get("message");
        let streamed = message
            .and_then(|message| message.get("id"))
            .and_then(Value::as_str)
            .is_some_and(|id| self.streamed.contains(id));
        let mut frames = Vec::new();
        for block in blocks(message) {
            match block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "text" if !streamed => {
                    let text = block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !text.is_empty() {
                        self.spoke = true;
                        frames.push(self.frame(TurnUpdate::Delta(text.to_string())));
                    }
                }
                "tool_use" => frames.push(self.tool_use(block)),
                // Thinking blocks and anything a newer CLI adds stay out of the
                // transcript rather than being shown as if the model had said them.
                _ => {}
            }
        }
        frames
    }

    /// Remembers `tool_use_id → name`, because a failing `tool_result` names only the
    /// id and a notice that cannot say which tool failed is not worth showing.
    fn tool_use(&mut self, block: &Value) -> TurnFrame {
        let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
        if let Some(id) = block.get("id").and_then(Value::as_str) {
            self.tools.insert(id.to_string(), name.to_string());
        }
        self.frame(TurnUpdate::Tool(json!({
            "kind": tool_kind_for(name),
            "detail": tool_detail(name, block.get("input")),
            "status": "inProgress",
        })))
    }

    /// The CLI echoes every tool result back as a `user` frame. A success is already
    /// implied by the call notice, so only a failure is reported — with the same kind
    /// and a `failed` status, which is the vocabulary the UI already renders.
    fn tool_results(&mut self, payload: &Value) -> Vec<TurnFrame> {
        let mut frames = Vec::new();
        for block in blocks(payload.get("message")) {
            if block.get("type").and_then(Value::as_str) != Some("tool_result")
                || block.get("is_error").and_then(Value::as_bool) != Some(true)
            {
                continue;
            }
            let name = block
                .get("tool_use_id")
                .and_then(Value::as_str)
                .and_then(|id| self.tools.get(id))
                .cloned()
                .unwrap_or_else(|| "tool".to_string());
            let mut notice = json!({ "kind": tool_kind_for(&name), "status": "failed" });
            notice["detail"] = Value::from(match flatten(block.get("content")) {
                Some(text) => clip(&format!("{name}: {text}")),
                None => clip(&name),
            });
            frames.push(self.frame(TurnUpdate::Tool(notice)));
        }
        frames
    }

    /// The end of the turn, and the only frame that reports whether it worked. The
    /// `turn` latch is what keeps a second `result` — or one that arrives after a stop
    /// was already answered — from ending the run a second time.
    fn result(&mut self, payload: &Value) -> Vec<TurnFrame> {
        if self.turn.is_none() {
            return Vec::new();
        }
        let subtype = payload
            .get("subtype")
            .and_then(Value::as_str)
            .unwrap_or("success");
        if payload.get("is_error").and_then(Value::as_bool) == Some(true) || subtype != "success" {
            let error = AgentError::new(AgentErrorKind::Protocol, result_error(payload, subtype));
            return vec![self.finish(TurnUpdate::Failed(error))];
        }
        let mut frames = Vec::new();
        // A CLI built without partial messages, or a turn whose answer arrived in one
        // piece: `result` repeats the whole thing and is then the only copy there is.
        if !self.spoke {
            if let Some(text) = result_message(payload) {
                frames.push(self.frame(TurnUpdate::Delta(text)));
            }
        }
        frames.push(self.finish(TurnUpdate::Completed));
        frames
    }

    /// claude asks before a tool that needs permission. A4Note has no prompt to show,
    /// so the answer is a refusal that tells the model what to do instead, and the
    /// transcript records it: a step that quietly never ran is worse than one that
    /// visibly could not. Every subtype is answered, because a control request nobody
    /// answers stalls the turn waiting on it.
    fn control_request(&mut self, payload: &Value, io: &mut SessionIo<'_>) -> Vec<TurnFrame> {
        let request_id = payload
            .get("request_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let request = payload.get("request");
        let subtype = request
            .and_then(|request| request.get("subtype"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if subtype != "can_use_tool" {
            io.send_payload(&json!({
                "type": "control_response",
                "response": {
                    "subtype": "error",
                    "request_id": request_id,
                    "error": format!("A4 Note 暂不支持这个控制请求：{subtype}"),
                },
            }));
            return Vec::new();
        }
        io.send_payload(&json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": request_id,
                "response": { "behavior": "deny", "message": DENY_MESSAGE },
            },
        }));
        if self.turn.is_none() {
            return Vec::new();
        }
        let name = request
            .and_then(|request| request.get("tool_name"))
            .and_then(Value::as_str)
            .unwrap_or("tool");
        vec![self.frame(TurnUpdate::Tool(json!({
            "kind": "approvalDenied",
            "detail": clip(name),
        })))]
    }

    /// The answer to an interrupt *we* sent, and what ends a stopped turn. Waiting for
    /// a `result` instead would leave the run open if claude does not emit one after an
    /// interrupt; an id we never sent belongs to somebody else and is ignored.
    fn control_response(&mut self, payload: &Value) -> Vec<TurnFrame> {
        let request_id = payload
            .get("response")
            .and_then(|response| response.get("request_id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !self.interrupts.remove(request_id) || self.turn.is_none() {
            return Vec::new();
        }
        vec![self.finish(TurnUpdate::Stopped)]
    }

    /// Builds a frame and closes the turn, so one turn ends exactly once: an answered
    /// interrupt and the `result` that may still follow it are the same end, and
    /// ending twice would terminate whichever run started next.
    fn finish(&mut self, update: TurnUpdate) -> TurnFrame {
        let frame = self.frame(update);
        self.reset_turn();
        frame
    }

    fn frame(&self, update: TurnUpdate) -> TurnFrame {
        match self.turn.as_deref() {
            Some(marker) => TurnFrame::of(marker, update),
            None => TurnFrame::any(update),
        }
    }

    /// Everything that is per-turn. `tools` outlives the turn on purpose: a
    /// `tool_result` can still be decoded after the turn it belonged to has ended.
    fn reset_turn(&mut self) {
        self.turn = None;
        self.message = None;
        self.spoke = false;
        self.streamed.clear();
    }
}

/// claude's permission mode for each A4Note mode. An unknown mode — including one a
/// newer frontend invents — gets [`MANUAL_MODE`], which cannot write, never the mode
/// that skips every prompt.
pub fn permission_for(mode: &str) -> &'static str {
    match mode {
        "autoReview" => "acceptEdits",
        "fullAccess" => "bypassPermissions",
        _ => MANUAL_MODE,
    }
}

/// The transcript vocabulary the UI already has (`agentToolKinds` in `src/ui/zh.ts`).
/// claude's built-in tools map onto it; an MCP tool is named `mcp__server__tool`, and
/// everything else keeps the generic label rather than inventing a kind per tool.
fn tool_kind_for(name: &str) -> &'static str {
    match name {
        "Bash" | "BashOutput" | "KillShell" => "commandExecution",
        "Edit" | "Write" | "NotebookEdit" => "fileChange",
        "WebSearch" | "WebFetch" => "webSearch",
        "TodoWrite" => "todoList",
        other if other.starts_with("mcp__") => "mcpToolCall",
        _ => "toolUse",
    }
}

/// The content blocks of a message, in order. A frame without them is not an error:
/// `system` and `result` carry no content at all.
fn blocks(message: Option<&Value>) -> &[Value] {
    message
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

/// One line naming the call: the tool, plus whatever field says what it acted on. The
/// key order is the fallback order, so a tool this file has never heard of still shows
/// its name rather than an empty row.
fn tool_detail(name: &str, input: Option<&Value>) -> String {
    const SUBJECTS: [&str; 7] = [
        "command",
        "file_path",
        "path",
        "pattern",
        "query",
        "url",
        "prompt",
    ];
    let subject = input.and_then(|input| {
        SUBJECTS.iter().find_map(|key| {
            input
                .get(key)
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
        })
    });
    match subject {
        Some(subject) => clip(&format!("{name}: {subject}")),
        None => clip(name),
    }
}

/// A `tool_result`'s content is a plain string for some tools and a block list for
/// others. Both become one line.
fn flatten(content: Option<&Value>) -> Option<String> {
    let content = content?;
    if let Some(text) = content.as_str() {
        return (!text.trim().is_empty()).then(|| text.to_string());
    }
    let joined = content
        .as_array()?
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    (!joined.trim().is_empty()).then_some(joined)
}

/// The whole answer, as `result` repeats it. Only read when nothing streamed.
fn result_message(payload: &Value) -> Option<String> {
    let text = payload.get("result").and_then(Value::as_str)?;
    (!text.trim().is_empty()).then(|| text.to_string())
}

/// What a failed turn says. claude puts a sentence in `result` when it has one, and
/// otherwise only names the subtype — still better than a blank error.
fn result_error(payload: &Value, subtype: &str) -> String {
    match result_message(payload) {
        Some(text) => clip(&text),
        None => format!("claude 未能完成本回合（{subtype}）"),
    }
}

/// Char-boundary safe on purpose: these details are as often Chinese as ASCII.
fn clip(text: &str) -> String {
    let mut clipped: String = text.chars().take(DETAIL_LIMIT).collect();
    if clipped.chars().count() < text.chars().count() {
        clipped.push('…');
    }
    clipped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_cli::peer::AgentPeer;
    use crate::agent_cli::protocol::AgentEvent;
    use crate::agent_cli::supervisor::{AgentSupervisor, SessionSink};
    use crate::agent_cli::transport::{FakePeer, InMemoryTransport, ProcessExit};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    fn spec(session_id: &str) -> SessionSpec {
        SessionSpec::new(session_id, std::env::temp_dir())
    }

    /// A session whose first turn is already open, exactly as `begin_turn` leaves it.
    fn seeded() -> ClaudeSession {
        let mut session = ClaudeSession::new();
        session.turns = 1;
        session.turn = Some("claude-turn-1".to_string());
        session
    }

    /// The `stream_event` envelope claude wraps Anthropic's own message events in.
    fn streamed(event: Value) -> Value {
        json!({ "type": "stream_event", "event": event })
    }

    /// Drives `on_payload` over a live pipe, so a frame that needs an answer can send
    /// one. The returned peer is what the answer was written to.
    fn feed(session: &mut ClaudeSession, payloads: &[Value]) -> (Vec<TurnFrame>, FakePeer) {
        let (mut transport, cli) = InMemoryTransport::new();
        let mut peer = AgentPeer::new();
        let mut frames = Vec::new();
        for payload in payloads {
            frames.extend(
                session.on_payload(payload, &mut SessionIo::new(&mut transport, &mut peer)),
            );
        }
        (frames, cli)
    }

    fn parsed(line: &str) -> Value {
        serde_json::from_str(line).expect("有效 JSON 帧")
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

    /// stream-json on both ends is what makes this a protocol rather than a screen
    /// scrape, and `--verbose` is what the CLI demands alongside `-p`.
    #[test]
    fn the_launch_config_speaks_stream_json_on_both_ends() {
        let config = ClaudeSession::new()
            .with_model(Some("opus".to_string()))
            .launch(&spec("s1"))
            .expect("启动配置必须可用");
        assert_eq!(config.program, "claude");
        assert_eq!(
            config.args.join(" "),
            "-p --input-format stream-json --output-format stream-json \
             --include-partial-messages --verbose --permission-mode manual --model opus"
        );
        // The working directory is the spawn's own: claude has no `--cwd`.
        assert_eq!(config.working_directory, std::env::temp_dir());
        assert!(!config.args.iter().any(|arg| arg == "--cwd"));
    }

    #[test]
    fn permission_modes_map_to_claude_modes() {
        assert_eq!(permission_for("default"), MANUAL_MODE);
        assert_eq!(permission_for("autoReview"), "acceptEdits");
        assert_eq!(permission_for("fullAccess"), "bypassPermissions");
        // A mode a newer frontend invents must not silently unlock the machine.
        assert_eq!(permission_for("everything"), MANUAL_MODE);
    }

    /// An id claude no longer has fails the spawn, which is how a stale saved session
    /// reports itself instead of quietly starting a new conversation under the old name.
    #[test]
    fn resuming_continues_the_saved_session() {
        let config = ClaudeSession::new()
            .resuming(Some("sess-9".to_string()))
            .launch(&spec("s1"))
            .expect("启动配置必须可用");
        assert!(
            config
                .args
                .windows(2)
                .any(|pair| pair == ["--resume".to_string(), "sess-9".to_string()]),
            "恢复会话必须带 --resume：{:?}",
            config.args
        );
        // A blank id is not an id: it would resume nothing and reject the spawn.
        let fresh = ClaudeSession::new()
            .resuming(Some("   ".to_string()))
            .launch(&spec("s1"))
            .expect("启动配置必须可用");
        assert!(!fresh.args.iter().any(|arg| arg == "--resume"));
    }

    /// Silence is the healthy case: claude writes nothing until the first user message,
    /// so the only thing a handshake can check is that the process is still there.
    #[test]
    fn a_silent_process_starts_and_one_that_already_exited_does_not() {
        let (mut transport, _cli) = InMemoryTransport::new();
        let mut peer = AgentPeer::new();
        ClaudeSession::new()
            .handshake(&spec("s1"), &mut SessionIo::new(&mut transport, &mut peer))
            .expect("沉默不是失败：第一条消息之前 claude 什么都不说");

        let (mut transport, cli) = InMemoryTransport::new();
        cli.exit(ProcessExit::code(1));
        let mut peer = AgentPeer::new();
        let error = ClaudeSession::new()
            .handshake(&spec("s1"), &mut SessionIo::new(&mut transport, &mut peer))
            .expect_err("被拒绝的参数或缺少登录会立刻退出，必须报错");
        assert_eq!(error.kind, AgentErrorKind::HandshakeFailed);
        assert_eq!(error.exit_code, Some(1));
        assert!(error.message.contains("claude 启动后立刻退出"));
    }

    /// One frame in, and the turn is open under a marker we minted: claude never names
    /// a turn, so there is no response to read one out of.
    #[test]
    fn a_turn_is_one_user_frame_under_our_own_marker() {
        let (mut transport, cli) = InMemoryTransport::new();
        let mut peer = AgentPeer::new();
        let mut session = ClaudeSession::new();
        let start = session
            .begin_turn("你好", &mut SessionIo::new(&mut transport, &mut peer))
            .expect("第一条消息必须发得出去");
        assert_eq!(start, TurnStart::Known("claude-turn-1".to_string()));

        let frame = parsed(&cli.written()[0]);
        assert_eq!(frame["type"], "user");
        assert_eq!(frame["message"]["role"], "user");
        assert_eq!(frame["message"]["content"][0]["type"], "text");
        assert_eq!(frame["message"]["content"][0]["text"], "你好");
        assert!(frame.get("jsonrpc").is_none(), "claude 不认 jsonrpc 包装");
        assert!(frame.get("method").is_none());

        // The second turn is a second marker, so a stale frame cannot land in it.
        let next = session
            .begin_turn("再来一次", &mut SessionIo::new(&mut transport, &mut peer))
            .expect("第二条消息必须发得出去");
        assert_eq!(next, TurnStart::Known("claude-turn-2".to_string()));
        // `TurnStart::Known` means the supervisor never asks for a run id.
        assert_eq!(
            session
                .run_id(&json!({}))
                .expect_err("claude 的回合不通过响应命名")
                .kind,
            AgentErrorKind::Internal
        );
    }

    /// `system/init` repeats on every turn and carries the id a later `--resume` needs.
    /// Nothing in a `system` frame belongs in the transcript.
    #[test]
    fn system_init_publishes_the_session_id_and_shows_nothing() {
        let mut session = seeded();
        let handle = session.handle();
        let (frames, _cli) = feed(
            &mut session,
            &[
                json!({ "type": "system", "subtype": "init", "session_id": "sess-1" }),
                json!({ "type": "system", "subtype": "status", "session_id": "sess-1" }),
            ],
        );
        assert!(frames.is_empty(), "system 帧不进转录");
        assert_eq!(handle.conversation_id().as_deref(), Some("sess-1"));
    }

    /// `--include-partial-messages` streams the text for real, and the `assistant`
    /// frame that follows repeats the whole message. Rendering both doubles it.
    #[test]
    fn streamed_text_is_not_repeated_by_the_assistant_snapshot() {
        let mut session = seeded();
        let (frames, _cli) = feed(
            &mut session,
            &[
                streamed(json!({
                    "type": "message_start",
                    "message": { "id": "msg_1", "role": "assistant" },
                })),
                streamed(json!({
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": { "type": "text_delta", "text": "你" },
                })),
                streamed(json!({
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": { "type": "text_delta", "text": "好" },
                })),
                json!({
                    "type": "assistant",
                    "message": { "id": "msg_1", "content": [{ "type": "text", "text": "你好" }] },
                }),
            ],
        );
        assert_eq!(deltas(&frames), vec!["你", "好"]);
        assert_eq!(frames.len(), 2, "快照不能把同一段话再说一遍");
        assert_eq!(frames[0].run_id.as_deref(), Some("claude-turn-1"));
    }

    /// The other direction: a message that never streamed arrives whole, and then the
    /// snapshot is the only copy of the answer there is.
    #[test]
    fn an_answer_that_never_streamed_arrives_with_its_snapshot() {
        let mut session = seeded();
        let (frames, _cli) = feed(
            &mut session,
            &[json!({
                "type": "assistant",
                "message": { "id": "msg_2", "content": [{ "type": "text", "text": "一次性回答" }] },
            })],
        );
        assert_eq!(deltas(&frames), vec!["一次性回答"]);
    }

    /// Reasoning is not the answer, and a tool call's arguments arrive as partial JSON
    /// that is only worth showing once it is complete.
    #[test]
    fn thinking_and_partial_tool_input_stay_hidden() {
        let mut session = seeded();
        let (frames, _cli) = feed(
            &mut session,
            &[
                streamed(json!({
                    "type": "content_block_delta",
                    "delta": { "type": "thinking_delta", "thinking": "想一想" },
                })),
                streamed(json!({
                    "type": "content_block_delta",
                    "delta": { "type": "input_json_delta", "partial_json": "{\"command\":" },
                })),
                streamed(json!({ "type": "message_stop" })),
                json!({
                    "type": "assistant",
                    "message": {
                        "id": "msg_3",
                        "content": [{ "type": "thinking", "thinking": "想一想" }],
                    },
                }),
            ],
        );
        assert!(frames.is_empty(), "思考过程不能当成模型的回答");
    }

    #[test]
    fn tool_names_map_onto_the_labels_the_ui_already_has() {
        assert_eq!(tool_kind_for("Bash"), "commandExecution");
        assert_eq!(tool_kind_for("Write"), "fileChange");
        assert_eq!(tool_kind_for("NotebookEdit"), "fileChange");
        assert_eq!(tool_kind_for("WebFetch"), "webSearch");
        assert_eq!(tool_kind_for("TodoWrite"), "todoList");
        assert_eq!(tool_kind_for("mcp__aster__note"), "mcpToolCall");
        // Everything else keeps one generic label rather than inventing a kind per tool.
        assert_eq!(tool_kind_for("Read"), "toolUse");
    }

    /// A call is one notice; its result is only worth a second one when it failed, and
    /// then it has to be able to say which tool failed.
    #[test]
    fn a_tool_call_is_one_notice_and_a_failure_names_the_tool() {
        let mut session = seeded();
        let (frames, _cli) = feed(
            &mut session,
            &[
                json!({
                    "type": "assistant",
                    "message": {
                        "id": "msg_4",
                        "content": [{
                            "type": "tool_use",
                            "id": "toolu_1",
                            "name": "Bash",
                            "input": { "command": "npm run verify" },
                        }],
                    },
                }),
                json!({
                    "type": "user",
                    "message": {
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": "toolu_1",
                            "is_error": true,
                            "content": [{ "type": "text", "text": "exit 1" }],
                        }],
                    },
                }),
            ],
        );
        assert_eq!(frames.len(), 2);
        assert_eq!(tool(&frames[0])["kind"], "commandExecution");
        assert_eq!(tool(&frames[0])["detail"], "Bash: npm run verify");
        assert_eq!(tool(&frames[0])["status"], "inProgress");
        assert_eq!(tool(&frames[1])["kind"], "commandExecution");
        assert_eq!(tool(&frames[1])["detail"], "Bash: exit 1");
        assert_eq!(tool(&frames[1])["status"], "failed");

        let (quiet, _cli) = feed(
            &mut session,
            &[json!({
                "type": "user",
                "message": {
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": "toolu_1",
                        "content": "ok",
                    }],
                },
            })],
        );
        assert!(quiet.is_empty(), "成功的结果已经由调用通知说明过了");
    }

    /// A turn that only ran tools, or a CLI built without partial messages, says
    /// nothing until `result` — which repeats the whole answer.
    #[test]
    fn a_result_stands_in_for_an_answer_that_never_streamed() {
        let mut session = seeded();
        let (frames, _cli) = feed(
            &mut session,
            &[json!({
                "type": "result",
                "subtype": "success",
                "is_error": false,
                "result": "只有 result 里有这段话",
            })],
        );
        assert_eq!(deltas(&frames), vec!["只有 result 里有这段话"]);
        assert!(matches!(frames[1].update, TurnUpdate::Completed));
        assert_eq!(frames[1].run_id.as_deref(), Some("claude-turn-1"));
    }

    /// One turn, one terminal: an error subtype ends it, and anything that arrives
    /// afterwards would otherwise end whichever run started next.
    #[test]
    fn a_failed_result_ends_the_turn_exactly_once() {
        let mut session = seeded();
        let (frames, _cli) = feed(
            &mut session,
            &[
                json!({ "type": "result", "subtype": "error_during_execution", "is_error": true }),
                json!({
                    "type": "result",
                    "subtype": "success",
                    "is_error": false,
                    "result": "迟到的第二个 result",
                }),
            ],
        );
        assert_eq!(frames.len(), 1, "同一个回合只能结束一次");
        match &frames[0].update {
            TurnUpdate::Failed(error) => {
                assert_eq!(error.kind, AgentErrorKind::Protocol);
                assert!(
                    error.message.contains("error_during_execution"),
                    "错误里要留下 subtype：{}",
                    error.message
                );
            }
            other => panic!("expected a failure, got {other:?}"),
        }
    }

    /// A4Note cannot render a permission prompt, so the answer is a refusal that tells
    /// the model what to do instead — and the transcript says so, because a step that
    /// quietly never ran is worse than one that visibly could not.
    #[test]
    fn a_permission_request_is_refused_and_shown_in_the_transcript() {
        let mut session = seeded();
        let (frames, cli) = feed(
            &mut session,
            &[json!({
                "type": "control_request",
                "request_id": "req_1",
                "request": {
                    "subtype": "can_use_tool",
                    "tool_name": "Write",
                    "input": { "file_path": "a.ts" },
                },
            })],
        );
        let reply = parsed(&cli.written()[0]);
        assert_eq!(reply["type"], "control_response");
        assert_eq!(reply["response"]["subtype"], "success");
        assert_eq!(reply["response"]["request_id"], "req_1");
        assert_eq!(reply["response"]["response"]["behavior"], "deny");
        assert_eq!(reply["response"]["response"]["message"], DENY_MESSAGE);
        assert_eq!(tool(&frames[0])["kind"], "approvalDenied");
        assert_eq!(tool(&frames[0])["detail"], "Write");

        // An unanswered control request stalls the turn behind it, so an unknown
        // subtype is answered too — as an error rather than as a decision.
        let (quiet, cli) = feed(
            &mut session,
            &[json!({
                "type": "control_request",
                "request_id": "req_2",
                "request": { "subtype": "mcp_message" },
            })],
        );
        assert!(quiet.is_empty());
        let refusal = parsed(&cli.written()[0]);
        assert_eq!(refusal["response"]["subtype"], "error");
        assert_eq!(refusal["response"]["request_id"], "req_2");
    }

    #[test]
    fn a_turn_streams_through_the_supervisor_and_completes() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = recorder();
        let supervisor = AgentSupervisor::new(sink);
        supervisor
            .start(
                spec("s1"),
                Box::new(ClaudeSession::new().with_transport(transport)),
            )
            .expect("沉默的进程就是启动成功");
        supervisor.send("s1", "你好").expect("会话必须能接收消息");
        assert_eq!(
            parsed(&written(&cli, 1)[0])["message"]["content"][0]["text"],
            "你好"
        );

        // `system/init` repeats on every turn; the id it carries is what --resume needs.
        cli.send_line(
            &json!({ "type": "system", "subtype": "init", "session_id": "sess-1" }).to_string(),
        );
        cli.send_line(
            &streamed(json!({
                "type": "message_start",
                "message": { "id": "msg_1", "role": "assistant" },
            }))
            .to_string(),
        );
        for delta in ["你", "好"] {
            cli.send_line(
                &streamed(json!({
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": { "type": "text_delta", "text": delta },
                }))
                .to_string(),
            );
        }
        cli.send_line(
            &json!({
                "type": "assistant",
                "message": { "id": "msg_1", "content": [{ "type": "text", "text": "你好" }] },
            })
            .to_string(),
        );
        cli.send_line(
            &json!({ "type": "result", "subtype": "success", "is_error": false, "result": "你好" })
                .to_string(),
        );

        let seen = wait_for_terminal(&events);
        assert_eq!(kinds(&seen), vec!["started", "delta", "delta", "completed"]);
        assert_eq!(text(&seen), "你好");
        assert!(supervisor.close("s1"));
    }

    /// Stopping is the control protocol, and the answer to our own interrupt is what
    /// ends the turn — so a stop is correct whether or not claude still reports a
    /// `result` for the turn it abandoned.
    #[test]
    fn stopping_a_turn_interrupts_it_and_the_answer_ends_it() {
        let (transport, cli) = InMemoryTransport::new();
        let (sink, events) = recorder();
        let supervisor = AgentSupervisor::new(sink);
        supervisor
            .start(
                spec("s1"),
                Box::new(ClaudeSession::new().with_transport(transport)),
            )
            .expect("沉默的进程就是启动成功");
        supervisor
            .send("s1", "跑很久的任务")
            .expect("会话必须能接收消息");
        written(&cli, 1);

        supervisor.stop("s1").expect("会话必须能收到停止");
        let interrupt = parsed(&written(&cli, 2)[1]);
        assert_eq!(interrupt["type"], "control_request");
        assert_eq!(interrupt["request"]["subtype"], "interrupt");
        let request_id = interrupt["request_id"]
            .as_str()
            .expect("中断必须带 request_id")
            .to_string();

        cli.send_line(
            &json!({
                "type": "control_response",
                "response": {
                    "subtype": "success",
                    "request_id": request_id,
                    "response": { "still_queued": [] },
                },
            })
            .to_string(),
        );
        let seen = wait_for_terminal(&events);
        assert_eq!(kinds(&seen), vec!["started", "stopped"]);
        assert!(supervisor.close("s1"));
    }
}
