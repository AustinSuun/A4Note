/**
 * Agent session commands and the event channel (CLI-2).
 *
 * Thin wrappers only: the supervisor lives in Rust
 * (`src-tauri/src/agent_cli/`), the commands in `src-tauri/src/agent_bridge.rs`,
 * and the shape of what crosses is `src/core/agentProtocol.ts`. Nothing here
 * interprets a CLI's output or keeps session state.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AgentEvent,
  StartAgentSessionRequest,
  StartAgentSessionResult,
} from '../../core/agentProtocol';

/** Must match `AGENT_EVENT` in `src-tauri/src/agent_bridge.rs`. */
export const AGENT_EVENT_CHANNEL = 'agent://event';

/**
 * Rejects with an `AgentError` (kind, detail, exit code) rather than a string:
 * "not installed" and "handshake failed" have to be told apart by the caller.
 */
export function startAgentSession(request: StartAgentSessionRequest) {
  return invoke<StartAgentSessionResult>('start_agent_session', { request });
}

/** Queues one message. The run id arrives with the `started` event. */
export function sendAgentMessage(sessionId: string, content: string) {
  return invoke<void>('send_agent_message', { request: { sessionId, content } });
}

/** Ends the open turn; the session stays alive for the next message. */
export function stopAgentSession(sessionId: string) {
  return invoke<void>('stop_agent_session', { request: { sessionId } });
}

/** Ends the session itself. False means there was nothing left to close. */
export function closeAgentSession(sessionId: string) {
  return invoke<boolean>('close_agent_session', { request: { sessionId } });
}

/** Whether the runtime still has a live process — the UI's status can go stale. */
export function isAgentSessionRunning(sessionId: string) {
  return invoke<boolean>('agent_session_running', { request: { sessionId } });
}

/**
 * One channel for every session; the payload names its own `sessionId`, so each
 * listener filters rather than subscribing per session.
 */
export function listenAgentEvents(handler: (event: AgentEvent) => void): Promise<UnlistenFn> {
  return listen<AgentEvent>(AGENT_EVENT_CHANNEL, (message) => handler(message.payload));
}
