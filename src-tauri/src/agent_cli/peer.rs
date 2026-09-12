//! Request correlation, deadlines, and the one error a termination produces.
//!
//! [`AgentPeer`] is synchronous and owns no thread: the caller drives it one read
//! at a time, so a test can step a fake provider frame by frame. Everything it
//! knows about the process arrives through [`AgentTransport`].

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use super::protocol::{AgentError, AgentErrorKind, JsonlDecoder, RpcFrame, StderrTail};
use super::transport::{AgentTransport, ProcessExit, TransportRead};

/// Bounds short requests such as the handshake. A request that stands for a whole
/// turn passes `None` instead: turns legitimately run for minutes.
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
struct Pending {
    method: String,
    /// `None` never expires.
    deadline: Option<Instant>,
}

/// Anything on stdout that is not an answer to one of our requests.
#[derive(Debug, Clone, PartialEq)]
pub enum PeerNotice {
    Notification {
        method: String,
        params: Value,
    },
    /// The provider is asking *us* something and will wait for the answer. Every
    /// one of these has to be replied to, even if the reply is a refusal.
    Request {
        id: i64,
        method: String,
        params: Value,
    },
    /// A line that is not a frame at all. These CLIs print banners and warnings
    /// to stdout, so it is kept for diagnostics and never fails the session.
    Unparsed(String),
    /// A frame from a dialect that is not JSON-RPC, already parsed. Only the
    /// adapter for that dialect understands it, and it may need an answer
    /// (`claude` asks for tool permission this way), so it is routed with write
    /// access rather than through `translate`.
    Payload(Value),
    /// A response whose id nobody is waiting for. Providers do answer twice.
    Orphan(i64),
}

#[derive(Debug, Clone, PartialEq)]
pub enum PumpOutcome {
    /// stdout produced a chunk. Zero frames is normal: a chunk can be half a line.
    Read,
    /// Nothing arrived before the read deadline. Not an error on its own.
    Idle,
    /// The process is gone. Every pending request has already failed with this
    /// same error.
    Closed(AgentError),
}

#[derive(Debug, Default)]
pub struct AgentPeer {
    next_id: i64,
    pending: HashMap<i64, Pending>,
    ready: HashMap<i64, Result<Value, AgentError>>,
    notices: Vec<PeerNotice>,
    decoder: JsonlDecoder,
    stderr: StderrTail,
    dropped_writes: usize,
    exit: Option<ProcessExit>,
}

impl AgentPeer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Allocates an id, writes the request, and starts its deadline. Nothing is
    /// recorded as pending when the write itself fails, so the caller's `Err` is
    /// the only report of that failure.
    pub fn send_request(
        &mut self,
        transport: &mut dyn AgentTransport,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> Result<i64, AgentError> {
        self.next_id += 1;
        let id = self.next_id;
        transport.write_line(&encode(method, params, Some(id)))?;
        self.pending.insert(
            id,
            Pending {
                method: method.to_string(),
                deadline: timeout.map(|timeout| Instant::now() + timeout),
            },
        );
        Ok(id)
    }

    /// Fire-and-forget. Nobody is waiting on a notification, so a closed stdin has
    /// no caller to fail; the drop is counted for the diagnostics instead. Returns
    /// whether the line made it out.
    pub fn send_notification(
        &mut self,
        transport: &mut dyn AgentTransport,
        method: &str,
        params: Value,
    ) -> bool {
        match transport.write_line(&encode(method, params, None)) {
            Ok(()) => true,
            Err(_) => {
                self.dropped_writes += 1;
                false
            }
        }
    }

    /// Writes one frame verbatim, for a provider whose dialect is not JSON-RPC.
    /// [`send_notification`](Self::send_notification) would stamp `jsonrpc` and
    /// `method` onto it, and `claude` accepts neither. The peer still owns the
    /// stream, so a dropped write is counted the same way. Returns whether the line
    /// made it out.
    pub fn send_payload(&mut self, transport: &mut dyn AgentTransport, payload: &Value) -> bool {
        match transport.write_line(&payload.to_string()) {
            Ok(()) => true,
            Err(_) => {
                self.dropped_writes += 1;
                false
            }
        }
    }

    /// Refuses a request the provider made. A4Note has no approval UI yet, so the
    /// honest answer to "may I run this?" is an error rather than silence: the
    /// provider then fails that step instead of waiting for us forever. Returns
    /// whether the line made it out.
    pub fn respond_error(
        &mut self,
        transport: &mut dyn AgentTransport,
        id: i64,
        code: i64,
        message: &str,
    ) -> bool {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        });
        match transport.write_line(&payload.to_string()) {
            Ok(()) => true,
            Err(_) => {
                self.dropped_writes += 1;
                false
            }
        }
    }

    /// Stops waiting for `id` without failing anybody. The late response arrives as
    /// [`PeerNotice::Orphan`] and is discarded there, which is what keeps a
    /// fire-and-forget request (`turn/interrupt`) from leaking a pending entry or
    /// tripping its own deadline.
    pub fn forget(&mut self, id: i64) {
        self.pending.remove(&id);
        self.ready.remove(&id);
    }

    /// One read, then one dispatch pass. `wait` bounds the read, not the request:
    /// a request only fails on its own deadline or on termination.
    pub fn pump_once(&mut self, transport: &mut dyn AgentTransport, wait: Duration) -> PumpOutcome {
        if let Some(exit) = self.exit.clone() {
            return PumpOutcome::Closed(self.termination_error(&exit));
        }
        let read = transport.read(wait);
        // Drain stderr on every pump so the tail is already there if this pump
        // turns out to be the one that has to explain a termination.
        let stderr = transport.take_stderr();
        if !stderr.is_empty() {
            self.stderr.push(&stderr);
        }
        let outcome = match read {
            TransportRead::Chunk(chunk) => {
                for frame in self.decoder.push(&chunk) {
                    self.dispatch(frame);
                }
                PumpOutcome::Read
            }
            TransportRead::Idle => PumpOutcome::Idle,
            TransportRead::Closed(exit) => {
                // A provider can exit right after its last frame without a final
                // newline; decode that remainder before reporting the exit.
                if let Some(frame) = self.decoder.flush() {
                    self.dispatch(frame);
                }
                self.exit = Some(exit.clone());
                let error = self.termination_error(&exit);
                self.fail_all(error.clone());
                PumpOutcome::Closed(error)
            }
        };
        self.expire(Instant::now());
        outcome
    }

    /// Pumps until `id` is answered, its deadline passes, or the process exits.
    pub fn await_response(
        &mut self,
        transport: &mut dyn AgentTransport,
        id: i64,
        wait: Duration,
    ) -> Result<Value, AgentError> {
        loop {
            if let Some(result) = self.ready.remove(&id) {
                return result;
            }
            if !self.pending.contains_key(&id) {
                return Err(AgentError::new(
                    AgentErrorKind::Internal,
                    format!("请求 {id} 不在等待队列中"),
                ));
            }
            if let PumpOutcome::Closed(error) = self.pump_once(transport, wait) {
                // `fail_all` has already queued this error for us; the fallback
                // only matters if the id was never pending.
                return self.ready.remove(&id).unwrap_or(Err(error));
            }
        }
    }

    /// One error for the whole termination, carrying how the process ended and the
    /// stderr tail that explains why. §4.4: one cause, not one error per waiter.
    pub fn termination_error(&self, exit: &ProcessExit) -> AgentError {
        let message = match (exit.code, exit.signal.as_deref()) {
            (_, Some(signal)) => format!("Agent CLI 被终止（{signal}）"),
            (Some(0), None) => "Agent CLI 已退出".to_string(),
            (Some(code), None) => format!("Agent CLI 退出，退出码 {code}"),
            (None, None) => "Agent CLI 连接已中断".to_string(),
        };
        AgentError::new(AgentErrorKind::Exited, message)
            .with_detail(self.stderr.tail().to_string())
            .with_exit(exit.code, exit.signal.clone())
    }

    /// Hands the same error to every waiter. Called on termination, and by CLI-1
    /// when the stop ladder gives up.
    pub fn fail_all(&mut self, error: AgentError) {
        for (id, _) in self.pending.drain() {
            self.ready.insert(id, Err(error.clone()));
        }
    }

    pub fn record_stderr(&mut self, chunk: &str) {
        self.stderr.push(chunk);
    }

    pub fn stderr_tail(&self) -> &str {
        self.stderr.tail()
    }

    /// Notifications and undecodable lines seen so far, cleared by the call.
    pub fn take_notices(&mut self) -> Vec<PeerNotice> {
        std::mem::take(&mut self.notices)
    }

    pub fn take_response(&mut self, id: i64) -> Option<Result<Value, AgentError>> {
        self.ready.remove(&id)
    }

    pub fn is_pending(&self, id: i64) -> bool {
        self.pending.contains_key(&id)
    }

    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    /// Notifications lost to a closed stdin. Non-zero means the session was told
    /// something it could not deliver.
    pub fn dropped_writes(&self) -> usize {
        self.dropped_writes
    }

    pub fn exit(&self) -> Option<&ProcessExit> {
        self.exit.as_ref()
    }

    fn dispatch(&mut self, frame: RpcFrame) {
        match frame {
            RpcFrame::Response { id, result } => self.resolve(id, Ok(result)),
            RpcFrame::Error { id, error } => self.resolve(id, Err(error)),
            RpcFrame::Request { id, method, params } => {
                self.notices
                    .push(PeerNotice::Request { id, method, params })
            }
            RpcFrame::Notification { method, params } => self
                .notices
                .push(PeerNotice::Notification { method, params }),
            RpcFrame::Payload(payload) => self.notices.push(PeerNotice::Payload(payload)),
            RpcFrame::Unparsed(line) => self.notices.push(PeerNotice::Unparsed(line)),
        }
    }

    fn resolve(&mut self, id: i64, result: Result<Value, AgentError>) {
        if self.pending.remove(&id).is_none() {
            self.notices.push(PeerNotice::Orphan(id));
            return;
        }
        self.ready.insert(id, result);
    }

    /// Turns every overdue request into a timeout. A request with no deadline is
    /// never overdue, which is what keeps a long turn from being killed.
    fn expire(&mut self, now: Instant) {
        let overdue: Vec<i64> = self
            .pending
            .iter()
            .filter(|(_, pending)| pending.deadline.is_some_and(|deadline| deadline <= now))
            .map(|(id, _)| *id)
            .collect();
        for id in overdue {
            let method = self
                .pending
                .remove(&id)
                .map(|pending| pending.method)
                .unwrap_or_default();
            let error = AgentError::new(
                AgentErrorKind::Timeout,
                format!("Agent CLI 请求超时：{method}"),
            )
            .with_detail(self.stderr.tail().to_string());
            self.ready.insert(id, Err(error));
        }
    }
}

/// JSON-RPC 2.0 on one line. `params` is omitted when null so a provider that
/// validates its schema strictly never sees `"params": null`.
fn encode(method: &str, params: Value, id: Option<i64>) -> String {
    let mut message = Map::new();
    message.insert("jsonrpc".to_string(), Value::from("2.0"));
    if let Some(id) = id {
        message.insert("id".to_string(), Value::from(id));
    }
    message.insert("method".to_string(), Value::from(method));
    if !params.is_null() {
        message.insert("params".to_string(), params);
    }
    Value::Object(message).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_cli::transport::{FakePeer, InMemoryTransport};
    use serde_json::json;

    /// Each read blocks for this long at most. The fixture queues its frames up
    /// front, so a pump normally returns without waiting at all.
    const TICK: Duration = Duration::from_millis(50);

    fn fixture() -> (AgentPeer, InMemoryTransport, FakePeer) {
        let (transport, remote) = InMemoryTransport::new();
        (AgentPeer::new(), transport, remote)
    }

    #[test]
    fn correlates_a_response_with_its_request() {
        let (mut peer, mut transport, remote) = fixture();
        let id = peer
            .send_request(&mut transport, "session/new", json!({ "cwd": "." }), None)
            .expect("stdin is open");

        let written: Value = serde_json::from_str(&remote.written()[0]).expect("valid JSON-RPC");
        assert_eq!(written["jsonrpc"], "2.0");
        assert_eq!(written["id"], id);
        assert_eq!(written["method"], "session/new");
        assert_eq!(written["params"]["cwd"], ".");

        remote.send_line(&json!({ "id": id, "result": { "sessionId": "abc" } }).to_string());
        let result = peer
            .await_response(&mut transport, id, TICK)
            .expect("the peer answered");
        assert_eq!(result["sessionId"], "abc");
        assert_eq!(peer.pending_count(), 0);
    }

    #[test]
    fn delivers_streamed_notifications_in_order() {
        let (mut peer, mut transport, remote) = fixture();
        let id = peer
            .send_request(&mut transport, "session/prompt", Value::Null, None)
            .expect("stdin is open");
        for text in ["你", "好", "。"] {
            remote.send_line(
                &json!({ "method": "agent/delta", "params": { "text": text } }).to_string(),
            );
        }
        remote.send_line(&json!({ "id": id, "result": {} }).to_string());

        peer.await_response(&mut transport, id, TICK)
            .expect("the turn finished");
        let texts: Vec<String> = peer
            .take_notices()
            .into_iter()
            .map(|notice| match notice {
                PeerNotice::Notification { method, params } => {
                    assert_eq!(method, "agent/delta");
                    params["text"].as_str().unwrap_or_default().to_string()
                }
                other => panic!("expected a delta, got {other:?}"),
            })
            .collect();
        assert_eq!(texts, vec!["你", "好", "。"]);
        assert!(peer.take_notices().is_empty());
    }

    /// A provider request surfaces with its id, and the refusal it gets back is a
    /// well-formed JSON-RPC error response for that same id.
    #[test]
    fn answers_a_provider_request_with_an_error() {
        let (mut peer, mut transport, remote) = fixture();
        remote.send_line(
            &json!({ "id": 41, "method": "execCommandApproval", "params": { "command": "rm -rf /" } })
                .to_string(),
        );
        peer.pump_once(&mut transport, TICK);

        let notices = peer.take_notices();
        let PeerNotice::Request { id, method, params } = &notices[0] else {
            panic!("expected a provider request, got {notices:?}");
        };
        assert_eq!(*id, 41);
        assert_eq!(method, "execCommandApproval");
        assert_eq!(params["command"], "rm -rf /");

        assert!(peer.respond_error(&mut transport, *id, -32601, "A4 Note 暂不支持审批"));
        let written: Value = serde_json::from_str(&remote.written()[0]).expect("valid JSON-RPC");
        assert_eq!(written["jsonrpc"], "2.0");
        assert_eq!(written["id"], 41);
        assert_eq!(written["error"]["code"], -32601);
        assert_eq!(written["error"]["message"], "A4 Note 暂不支持审批");
        assert!(written.get("result").is_none());
    }

    /// A dialect that is not JSON-RPC round-trips: the frame goes out exactly as
    /// written, and what comes back arrives parsed instead of as text.
    #[test]
    fn a_non_rpc_dialect_writes_and_reads_whole_frames() {
        let (mut peer, mut transport, remote) = fixture();
        let outgoing = json!({
            "type": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": "你好" }] },
        });
        assert!(peer.send_payload(&mut transport, &outgoing));
        let written: Value = serde_json::from_str(&remote.written()[0]).expect("valid JSON");
        assert_eq!(
            written, outgoing,
            "帧必须原样写出，不能被套上 jsonrpc/method"
        );

        remote.send_line(&json!({ "type": "result", "is_error": false }).to_string());
        peer.pump_once(&mut transport, TICK);
        let notices = peer.take_notices();
        let PeerNotice::Payload(payload) = &notices[0] else {
            panic!("expected a parsed payload, got {notices:?}");
        };
        assert_eq!(payload["type"], "result");
        assert_eq!(payload["is_error"], false);
    }

    /// A forgotten request neither times out nor leaks: its answer comes back as an
    /// orphan, which is the notice the session already discards.
    #[test]
    fn a_forgotten_request_answers_as_an_orphan() {
        let (mut peer, mut transport, remote) = fixture();
        let id = peer
            .send_request(
                &mut transport,
                "turn/interrupt",
                json!({ "turnId": "t1" }),
                Some(Duration::from_millis(1)),
            )
            .expect("stdin is open");
        peer.forget(id);
        assert_eq!(peer.pending_count(), 0);

        remote.send_line(&json!({ "id": id, "result": {} }).to_string());
        peer.pump_once(&mut transport, TICK);
        assert_eq!(peer.take_notices(), vec![PeerNotice::Orphan(id)]);
        assert!(peer.take_response(id).is_none());
    }

    #[test]
    fn only_a_request_with_a_deadline_can_time_out() {
        let (mut peer, mut transport, _remote) = fixture();
        let bounded = peer
            .send_request(
                &mut transport,
                "session/new",
                Value::Null,
                Some(Duration::ZERO),
            )
            .expect("stdin is open");
        let turn = peer
            .send_request(&mut transport, "session/prompt", Value::Null, None)
            .expect("stdin is open");

        assert_eq!(
            peer.pump_once(&mut transport, Duration::ZERO),
            PumpOutcome::Idle
        );
        let error = peer
            .take_response(bounded)
            .expect("the deadline passed")
            .expect_err("a timeout is an error");
        assert_eq!(error.kind, AgentErrorKind::Timeout);
        assert!(error.message.contains("session/new"));
        // A long turn must survive any number of idle reads.
        assert!(peer.is_pending(turn));
    }

    #[test]
    fn one_error_explains_a_non_zero_exit_to_every_waiter() {
        let (mut peer, mut transport, remote) = fixture();
        let first = peer
            .send_request(&mut transport, "session/new", Value::Null, None)
            .expect("stdin is open");
        let second = peer
            .send_request(&mut transport, "session/prompt", Value::Null, None)
            .expect("stdin is open");
        remote.send_stderr("boom: missing api key\n");
        remote.exit(ProcessExit::code(9));

        let error = peer
            .await_response(&mut transport, first, TICK)
            .expect_err("the process died");
        assert_eq!(error.kind, AgentErrorKind::Exited);
        assert_eq!(error.exit_code, Some(9));
        assert!(error.message.contains('9'));
        assert!(error.detail.as_deref().unwrap_or_default().contains("boom"));

        // The second waiter gets the same cause, not a second diagnosis.
        let same = peer
            .take_response(second)
            .expect("every pending request was failed")
            .expect_err("the process died");
        assert_eq!(same, error);
        assert_eq!(peer.pending_count(), 0);
        assert_eq!(peer.exit(), Some(&ProcessExit::code(9)));
    }

    #[test]
    fn a_closed_stdin_drops_notifications_and_refuses_requests() {
        let (mut peer, mut transport, remote) = fixture();
        transport.close_stdin();
        assert!(remote.stdin_closed());

        assert!(!peer.send_notification(&mut transport, "session/cancel", Value::Null));
        assert_eq!(peer.dropped_writes(), 1);
        let error = peer
            .send_request(&mut transport, "session/new", Value::Null, None)
            .expect_err("stdin is gone");
        assert_eq!(error.kind, AgentErrorKind::Transport);
        assert_eq!(peer.pending_count(), 0);
        assert!(remote.written().is_empty());
    }

    #[test]
    fn an_unexpected_response_id_is_a_notice_not_a_failure() {
        let (mut peer, mut transport, remote) = fixture();
        let id = peer
            .send_request(&mut transport, "session/new", Value::Null, None)
            .expect("stdin is open");
        remote.send_line(&json!({ "id": 99, "result": {} }).to_string());
        remote.send_line("codex: reading config");
        remote.send_line(&json!({ "id": id, "result": { "ok": true } }).to_string());

        let result = peer
            .await_response(&mut transport, id, TICK)
            .expect("the real answer still arrives");
        assert_eq!(result["ok"], true);
        assert_eq!(
            peer.take_notices(),
            vec![
                PeerNotice::Orphan(99),
                PeerNotice::Unparsed("codex: reading config".to_string()),
            ]
        );
    }

    #[test]
    fn a_clean_exit_after_the_last_frame_still_decodes_it() {
        let (mut peer, mut transport, remote) = fixture();
        let id = peer
            .send_request(&mut transport, "session/prompt", Value::Null, None)
            .expect("stdin is open");
        // No trailing newline: the provider exited the moment it finished writing.
        remote.send_chunk(&json!({ "id": id, "result": { "ok": true } }).to_string());
        remote.exit(ProcessExit::code(0));

        let result = peer
            .await_response(&mut transport, id, TICK)
            .expect("the tail of the stream still counts");
        assert_eq!(result["ok"], true);
        let expected = peer.termination_error(&ProcessExit::code(0));
        assert_eq!(
            peer.pump_once(&mut transport, TICK),
            PumpOutcome::Closed(expected)
        );
    }
}
