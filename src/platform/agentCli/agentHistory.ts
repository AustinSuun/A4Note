/**
 * Agent history commands (CLI-4).
 *
 * Thin wrappers, like `./agentSession`: the rows' shape is
 * `src/core/agentHistory.ts`, the store is `src-tauri/src/agent_history.rs`, and
 * the commands live in `lib.rs` rather than `agent_bridge.rs` — the CLI's side of
 * that wall must never reach Aster's database.
 */
import { invoke } from '@tauri-apps/api/core';
import type { AgentMessageRecord } from '../../core/agentHistory';

/** Empty means the session has no history, which is the normal first case. */
export function loadAgentMessages(sessionId: string) {
  return invoke<AgentMessageRecord[]>('load_agent_messages', { request: { sessionId } });
}

/** An UPSERT of the rows given, not a rewrite: unlisted turns are left alone. */
export function saveAgentMessages(messages: AgentMessageRecord[]) {
  return invoke<void>('save_agent_messages', { request: { messages } });
}
