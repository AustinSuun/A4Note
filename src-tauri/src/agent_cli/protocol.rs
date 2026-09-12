//! Frame shapes, error shapes and the two buffers every provider needs.
//!
//! The JSON names match `src/core/agentProtocol.ts` (camelCase) so an event can
//! cross the Tauri boundary without a second translation step.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// stderr exists to explain an error, not to be a second event stream, so only
/// the tail is kept. 8 KiB is enough for a stack trace or a usage message.
pub const STDERR_TAIL_LIMIT: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentErrorKind {
    NotInstalled,
    SpawnFailed,
    HandshakeFailed,
    Protocol,
    Transport,
    Timeout,
    Exited,
    Canceled,
    PermissionDenied,
    Internal,
}

/// One error carries everything the UI and the log need: exit code, signal and
/// the stderr tail are folded in rather than reported as separate events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentError {
    pub kind: AgentErrorKind,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

impl AgentError {
    pub fn new(kind: AgentErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
            exit_code: None,
            signal: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        self.detail = if detail.is_empty() {
            None
        } else {
            Some(detail)
        };
        self
    }

    pub fn with_exit(mut self, code: Option<i32>, signal: Option<String>) -> Self {
        self.exit_code = code;
        self.signal = signal;
        self
    }
}

/// Mirrors the `AgentEvent` union in `src/core/agentProtocol.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentEvent {
    #[serde(rename_all = "camelCase")]
    Started { session_id: String, run_id: String },
    #[serde(rename_all = "camelCase")]
    Delta {
        session_id: String,
        run_id: String,
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    Tool {
        session_id: String,
        run_id: String,
        payload: Value,
    },
    #[serde(rename_all = "camelCase")]
    Completed { session_id: String, run_id: String },
    #[serde(rename_all = "camelCase")]
    Stopped { session_id: String, run_id: String },
    #[serde(rename_all = "camelCase")]
    Failed {
        session_id: String,
        run_id: String,
        error: AgentError,
    },
}

impl AgentEvent {
    pub fn run_id(&self) -> &str {
        match self {
            AgentEvent::Started { run_id, .. }
            | AgentEvent::Delta { run_id, .. }
            | AgentEvent::Tool { run_id, .. }
            | AgentEvent::Completed { run_id, .. }
            | AgentEvent::Stopped { run_id, .. }
            | AgentEvent::Failed { run_id, .. } => run_id,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            AgentEvent::Completed { .. } | AgentEvent::Stopped { .. } | AgentEvent::Failed { .. }
        )
    }
}

/// A decoded stdout line. `Unparsed` is not an error: these CLIs mix banners and
/// warnings into stdout, and killing a live session over one stray line would be
/// worse than ignoring it.
///
/// `Payload` is the other half of that tolerance. Not every agent CLI speaks
/// JSON-RPC: `claude -p --output-format stream-json` emits bare objects tagged
/// with `type` and no `method`/`id` at all. Those are real protocol frames, so
/// they are handed to the adapter parsed rather than degraded to text.
#[derive(Debug, Clone, PartialEq)]
pub enum RpcFrame {
    Response {
        id: i64,
        result: Value,
    },
    Error {
        id: i64,
        error: AgentError,
    },
    /// A request *from* the provider: it carries both an id and a method and is
    /// waiting for our answer. Codex asks for command/patch approvals and MCP
    /// elicitations this way, and a request nobody answers stalls the turn behind
    /// it — so the id is kept instead of being folded into a notification.
    Request {
        id: i64,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
    /// A well-formed JSON object that is not JSON-RPC. The adapter for that
    /// dialect reads it; adapters that only speak JSON-RPC ignore it.
    Payload(Value),
    Unparsed(String),
}

/// Splits a byte stream into JSONL frames. Chunk boundaries are arbitrary, so
/// the tail of an incomplete line is held until its `\n` arrives.
#[derive(Debug, Default)]
pub struct JsonlDecoder {
    buffer: String,
}

impl JsonlDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds one chunk and returns every frame that is now complete.
    pub fn push(&mut self, chunk: &str) -> Vec<RpcFrame> {
        self.buffer.push_str(chunk);
        let mut frames = Vec::new();
        while let Some(index) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..=index).collect();
            if let Some(frame) = decode_line(&line) {
                frames.push(frame);
            }
        }
        frames
    }

    /// Decodes whatever is left when the stream ends without a final newline.
    pub fn flush(&mut self) -> Option<RpcFrame> {
        let line = std::mem::take(&mut self.buffer);
        decode_line(&line)
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

/// Windows CLIs end lines with `\r\n`; a trailing `\r` would make every payload
/// fail to parse, so it is stripped before the JSON parse.
fn decode_line(raw: &str) -> Option<RpcFrame> {
    let line = raw.trim_end_matches('\n').trim_end_matches('\r').trim();
    if line.is_empty() {
        return None;
    }
    let Ok(Value::Object(message)) = serde_json::from_str::<Value>(line) else {
        return Some(RpcFrame::Unparsed(line.to_string()));
    };
    Some(frame_from_object(message))
}

fn frame_from_object(message: Map<String, Value>) -> RpcFrame {
    let id = message.get("id").and_then(Value::as_i64);
    if let Some(id) = id {
        if let Some(error) = message.get("error") {
            return RpcFrame::Error {
                id,
                error: rpc_error(error),
            };
        }
        if let Some(result) = message.get("result") {
            return RpcFrame::Response {
                id,
                result: result.clone(),
            };
        }
    }
    // Owned before the match so the `None` arm can hand the whole object over.
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_string);
    match method {
        // An id here means the provider is asking us something, not telling us.
        Some(method) => {
            let params = message.get("params").cloned().unwrap_or(Value::Null);
            match id {
                Some(id) => RpcFrame::Request { id, method, params },
                None => RpcFrame::Notification { method, params },
            }
        }
        // Well-formed JSON that is neither a response nor a notification. A
        // non-JSON-RPC dialect lives here, so the parsed object is passed on; only
        // lines that are not JSON at all stay text.
        None => RpcFrame::Payload(Value::Object(message)),
    }
}

fn rpc_error(raw: &Value) -> AgentError {
    let message = raw
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("provider returned an error")
        .to_string();
    let mut error = AgentError::new(AgentErrorKind::Protocol, message);
    if let Some(code) = raw.get("code").and_then(Value::as_i64) {
        error = error.with_detail(format!("code {code}"));
    }
    error
}

/// Ring buffer over the last [`STDERR_TAIL_LIMIT`] bytes of stderr.
#[derive(Debug, Default)]
pub struct StderrTail {
    buffer: String,
}

impl StderrTail {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &str) {
        self.buffer.push_str(chunk);
        if self.buffer.len() <= STDERR_TAIL_LIMIT {
            return;
        }
        // Trim on a char boundary: byte slicing a UTF-8 string can panic.
        let overflow = self.buffer.len() - STDERR_TAIL_LIMIT;
        let start = self
            .buffer
            .char_indices()
            .map(|(index, _)| index)
            .find(|index| *index >= overflow)
            .unwrap_or(self.buffer.len());
        self.buffer = self.buffer[start..].to_string();
    }

    pub fn tail(&self) -> &str {
        &self.buffer
    }

    /// Hands the buffered tail over and starts empty. A transport whose reader
    /// thread accumulates stderr uses this to drain it without a second cap.
    pub fn take(&mut self) -> String {
        std::mem::take(&mut self.buffer)
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_a_frame_split_across_chunks() {
        let mut decoder = JsonlDecoder::new();
        assert!(decoder.push(r#"{"method":"agent/delta","par"#).is_empty());
        let frames = decoder.push("ams\":{\"text\":\"hi\"}}\r\n");
        assert_eq!(
            frames,
            vec![RpcFrame::Notification {
                method: "agent/delta".to_string(),
                params: serde_json::json!({ "text": "hi" }),
            }]
        );
        assert!(decoder.is_empty());
    }

    #[test]
    fn keeps_the_stream_alive_across_blank_and_non_json_lines() {
        let mut decoder = JsonlDecoder::new();
        let frames =
            decoder.push("\n  \nwarning: nightly build\n{\"id\":7,\"result\":{\"ok\":true}}\n");
        assert_eq!(frames.len(), 2);
        assert_eq!(
            frames[0],
            RpcFrame::Unparsed("warning: nightly build".to_string())
        );
        assert_eq!(
            frames[1],
            RpcFrame::Response {
                id: 7,
                result: serde_json::json!({ "ok": true }),
            }
        );
    }

    /// A message with both an id and a method is a request, not a notification.
    /// Codex sends approvals and MCP elicitations this way; keeping the id is what
    /// lets the session answer instead of leaving the turn waiting.
    #[test]
    fn keeps_the_id_of_a_provider_request() {
        let mut decoder = JsonlDecoder::new();
        let frames = decoder.push(
            "{\"id\":12,\"method\":\"item/commandExecution/requestApproval\",\"params\":{\"command\":\"ls\"}}\n",
        );
        assert_eq!(
            frames,
            vec![RpcFrame::Request {
                id: 12,
                method: "item/commandExecution/requestApproval".to_string(),
                params: serde_json::json!({ "command": "ls" }),
            }]
        );
    }

    #[test]
    fn error_frames_keep_the_provider_code() {
        let mut decoder = JsonlDecoder::new();
        let frames =
            decoder.push("{\"id\":3,\"error\":{\"code\":-32601,\"message\":\"unknown method\"}}\n");
        match &frames[0] {
            RpcFrame::Error { id, error } => {
                assert_eq!(*id, 3);
                assert_eq!(error.kind, AgentErrorKind::Protocol);
                assert_eq!(error.message, "unknown method");
                assert_eq!(error.detail.as_deref(), Some("code -32601"));
            }
            other => panic!("expected an error frame, got {other:?}"),
        }
    }

    #[test]
    fn flushes_a_final_line_that_has_no_newline() {
        let mut decoder = JsonlDecoder::new();
        assert!(decoder.push(r#"{"method":"agent/done"}"#).is_empty());
        assert_eq!(
            decoder.flush(),
            Some(RpcFrame::Notification {
                method: "agent/done".to_string(),
                params: Value::Null,
            })
        );
        assert_eq!(decoder.flush(), None);
    }

    #[test]
    fn json_that_is_neither_response_nor_notification_becomes_a_payload() {
        let mut decoder = JsonlDecoder::new();
        // `claude -p --output-format stream-json` frames look like this: a `type`
        // tag and nothing JSON-RPC. Its adapter needs them parsed.
        let frames = decoder.push("{\"type\":\"result\",\"is_error\":false}\n");
        assert_eq!(
            frames,
            vec![RpcFrame::Payload(json!({
                "type": "result",
                "is_error": false,
            }))]
        );
    }

    #[test]
    fn a_line_that_is_not_json_at_all_stays_text() {
        let mut decoder = JsonlDecoder::new();
        assert_eq!(
            decoder.push("codex: reading config\n"),
            vec![RpcFrame::Unparsed("codex: reading config".to_string())]
        );
        // A JSON scalar is not a frame either: only objects can carry a dialect.
        assert_eq!(
            decoder.push("42\n"),
            vec![RpcFrame::Unparsed("42".to_string())]
        );
    }

    #[test]
    fn stderr_tail_is_capped_without_splitting_a_character() {
        let mut tail = StderrTail::new();
        assert!(tail.is_empty());
        // 4000 three-byte characters: well past the limit, and a byte-sliced trim
        // would land mid-character and panic.
        tail.push(&"啊".repeat(4000));
        assert!(tail.tail().len() <= STDERR_TAIL_LIMIT);
        assert!(tail.tail().chars().all(|character| character == '啊'));
    }

    #[test]
    fn events_use_the_names_the_ui_expects() {
        let event = AgentEvent::Delta {
            session_id: "s1".to_string(),
            run_id: "r1".to_string(),
            content: "hi".to_string(),
        };
        let json = serde_json::to_value(&event).expect("event should serialize");
        assert_eq!(json["type"], "delta");
        assert_eq!(json["sessionId"], "s1");
        assert_eq!(json["runId"], "r1");
        assert_eq!(json["content"], "hi");
        assert_eq!(event.run_id(), "r1");
        assert!(!event.is_terminal());
        let restored: AgentEvent = serde_json::from_value(json).expect("event should round-trip");
        assert_eq!(restored, event);
    }

    #[test]
    fn failure_events_are_terminal_and_carry_the_exit() {
        let error = AgentError::new(AgentErrorKind::Exited, "退出").with_exit(Some(2), None);
        let event = AgentEvent::Failed {
            session_id: "s1".to_string(),
            run_id: "r1".to_string(),
            error,
        };
        let json = serde_json::to_value(&event).expect("event should serialize");
        assert_eq!(json["type"], "failed");
        assert_eq!(json["error"]["kind"], "exited");
        assert_eq!(json["error"]["exitCode"], 2);
        assert!(json["error"].get("signal").is_none());
        assert!(event.is_terminal());
    }
}
