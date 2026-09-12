//! The seam between the Agent CLI runtime (`crate::agent_cli`) and Tauri (CLI-2).
//!
//! This is the only file that knows both, on purpose: `agent_cli` stays testable
//! with plain `cargo test`, and `lib.rs` gains five commands instead of a runtime.
//! Nothing here interprets a CLI's dialect — that belongs to a provider adapter —
//! and nothing here touches Aster's SQLite, so a CLI can never write it.
//!
//! Errors cross as [`AgentError`], not as strings: the UI's `AgentError` in
//! `src/core/agentProtocol.ts` has the same fields, so a failed spawn keeps its
//! kind, exit code and stderr tail instead of collapsing into one sentence.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent_cli::{
    AgentError, AgentErrorKind, AgentEvent, AgentSupervisor, ClaudeSession, CodexSession,
    ProviderHandle, ProviderSession, SessionSink, SessionSpec,
};
use crate::workspace_fs;

/// The single event channel. Every payload names its `sessionId`, so one listener
/// can route to the right tab and a second window still only sees its own runs.
pub const AGENT_EVENT: &str = "agent://event";

/// Both adapters stream incremental text: codex sends `item/agentMessage/delta`, and
/// `claude -p --include-partial-messages` forwards Anthropic's own `text_delta`
/// events. Still declared per session rather than assumed, because an adapter that
/// can only resend the whole answer has to be able to say so.
const DELTA_TEXT_MODE: &str = "delta";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionRequest {
    pub session_id: String,
    pub provider_id: String,
    /// Already restricted by the caller to the Project root or a folder the user
    /// picked; re-checked here because a command is reachable from anywhere.
    pub working_directory: String,
    pub permission_mode: String,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub resume_provider_session_id: Option<String>,
}

/// Mirrors `StartAgentSessionResult` in `src/core/agentProtocol.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionResult {
    pub session_id: String,
    /// The CLI's own conversation id, so a later session can resume it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    pub text_mode: String,
    /// True only when an adapter had to fall back to scraping human-readable
    /// stdout. The Codex adapter speaks JSON-RPC, so it never does.
    pub degraded: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentMessageRequest {
    pub session_id: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRequest {
    pub session_id: String,
}

/// Builds the supervisor with a sink that emits straight to the front end, and hands
/// it to Tauri's state. Called once from `setup`, before any window can invoke.
pub fn register(app: &AppHandle) {
    let emitter = app.clone();
    let sink: SessionSink = Arc::new(move |event: AgentEvent| {
        if let Err(error) = emitter.emit(AGENT_EVENT, &event) {
            eprintln!("Agent 事件发送失败：{error}");
        }
    });
    app.manage(AgentSupervisor::new(sink));
}

/// Every CLI must die with the window that started it. Tauri's exit path does not
/// run destructors, so the sessions are closed explicitly on `RunEvent::Exit`.
pub fn shutdown(app: &AppHandle) {
    if let Some(supervisor) = app.try_state::<AgentSupervisor>() {
        supervisor.close_all();
    }
}

/// Connects and handshakes before returning, so "not installed" and "handshake
/// failed" reach the caller as an `Err` instead of arriving as an event for a
/// session the UI still believes is starting. `async` because that handshake blocks
/// and the main thread must keep painting.
#[tauri::command(async)]
pub fn start_agent_session(
    request: StartAgentSessionRequest,
    supervisor: State<'_, AgentSupervisor>,
) -> Result<StartAgentSessionResult, AgentError> {
    let working_directory = working_directory(&request.working_directory)?;
    let spec = SessionSpec::new(&request.session_id, working_directory)
        .with_permission_mode(&request.permission_mode);
    let (provider, handle) = provider_for(&request)?;
    supervisor.start(spec, provider)?;
    Ok(StartAgentSessionResult {
        session_id: request.session_id,
        provider_session_id: handle.and_then(|handle| handle.conversation_id()),
        text_mode: DELTA_TEXT_MODE.to_string(),
        degraded: false,
    })
}

/// Queues one user message. Returns as soon as the session has it: the turn's own
/// id arrives with the `started` event, because a message sent during a turn waits
/// for it and its run id cannot be known yet.
#[tauri::command(async)]
pub fn send_agent_message(
    request: SendAgentMessageRequest,
    supervisor: State<'_, AgentSupervisor>,
) -> Result<(), AgentError> {
    if request.content.trim().is_empty() {
        return Err(AgentError::new(AgentErrorKind::Internal, "消息内容为空"));
    }
    supervisor.send(&request.session_id, request.content)
}

/// Ends the open turn. The session stays alive and can take the next message.
#[tauri::command(async)]
pub fn stop_agent_session(
    request: AgentSessionRequest,
    supervisor: State<'_, AgentSupervisor>,
) -> Result<(), AgentError> {
    supervisor.stop(&request.session_id)
}

/// Ends the session itself: the CLI process is gone before this returns. Separate
/// from `stop` because closing a tab must not leave a child process behind.
#[tauri::command(async)]
pub fn close_agent_session(
    request: AgentSessionRequest,
    supervisor: State<'_, AgentSupervisor>,
) -> bool {
    supervisor.close(&request.session_id)
}

/// Whether the runtime still has a live process for this session. The UI's own
/// status can go stale — a CLI that crashed answers `false` here.
#[tauri::command]
pub fn agent_session_running(
    request: AgentSessionRequest,
    supervisor: State<'_, AgentSupervisor>,
) -> bool {
    supervisor.is_running(&request.session_id)
}

/// One adapter per provider id. An unknown id is refused rather than silently
/// started as Codex, and the handle is how `providerSessionId` is read back after
/// the adapter has been moved into the supervisor.
fn provider_for(
    request: &StartAgentSessionRequest,
) -> Result<(Box<dyn ProviderSession>, Option<ProviderHandle>), AgentError> {
    match request.provider_id.as_str() {
        "codex" => {
            let session = CodexSession::new()
                .with_model(request.model_id.clone())
                .resuming(request.resume_provider_session_id.clone());
            let handle = session.handle();
            Ok((Box::new(session), Some(handle)))
        }
        "claude" => {
            let session = ClaudeSession::new()
                .with_model(request.model_id.clone())
                .resuming(request.resume_provider_session_id.clone());
            let handle = session.handle();
            Ok((Box::new(session), Some(handle)))
        }
        other => Err(AgentError::new(
            AgentErrorKind::NotInstalled,
            format!("暂不支持这个 Agent CLI：{other}"),
        )),
    }
}

/// An absolute, existing directory or nothing. `SpawnFailed` to match the same
/// check inside `LaunchConfig::build_command`, which the caller would hit anyway.
fn working_directory(raw: &str) -> Result<PathBuf, AgentError> {
    let path = workspace_fs::resolve_existing_path(raw)
        .map_err(|error| AgentError::new(AgentErrorKind::SpawnFailed, error))?;
    if !path.is_dir() {
        return Err(AgentError::new(
            AgentErrorKind::SpawnFailed,
            format!("工作目录不是文件夹：{}", path.display()),
        ));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(provider_id: &str, working_directory: &str) -> StartAgentSessionRequest {
        StartAgentSessionRequest {
            session_id: "s1".to_string(),
            provider_id: provider_id.to_string(),
            working_directory: working_directory.to_string(),
            permission_mode: "default".to_string(),
            model_id: None,
            resume_provider_session_id: None,
        }
    }

    #[test]
    fn only_known_providers_get_an_adapter() {
        for provider_id in ["codex", "claude"] {
            let (_, handle) =
                provider_for(&request(provider_id, "")).expect("已支持的 provider 必须有适配器");
            assert!(
                handle
                    .expect("已支持的 provider 必须给出句柄")
                    .conversation_id()
                    .is_none(),
                "握手之前还没有会话 id：{provider_id}"
            );
        }
        // An id the frontend does not have a descriptor for must be refused rather
        // than silently started as whichever adapter happens to be first.
        let Err(error) = provider_for(&request("local", "")) else {
            panic!("未知 provider 必须被拒绝");
        };
        assert_eq!(error.kind, AgentErrorKind::NotInstalled);
        assert!(error.message.contains("local"));
    }

    #[test]
    fn the_working_directory_must_exist_and_be_a_folder() {
        let temp = std::env::temp_dir();
        assert_eq!(
            working_directory(temp.to_str().expect("临时目录路径")).expect("已存在的目录"),
            temp
        );
        for raw in ["", "relative/path", "Z:\\a4note-not-there-42"] {
            let error = working_directory(raw).expect_err("非法工作目录必须失败");
            assert_eq!(error.kind, AgentErrorKind::SpawnFailed);
        }
    }

    /// The UI listens on exactly one name; a rename here without a rename there
    /// silently stops every transcript.
    #[test]
    fn the_event_channel_is_the_one_the_ui_listens_on() {
        assert_eq!(AGENT_EVENT, "agent://event");
    }
}
