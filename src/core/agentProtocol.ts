/**
 * CLI-0: the normalized Agent CLI contract shared by every provider.
 *
 * Pure types and pure reducers only — no React, no Tauri, no process handling.
 * The UI never parses raw CLI output: adapters translate provider frames into
 * the `AgentEvent` union below, and the Rust supervisor (CLI-1) owns processes.
 *
 * Session status (`AgentSessionStatus` in `./workspace`) and turn status are
 * deliberately separate: a finished turn emits `completed` and leaves the
 * session at `idle`, ready for the next message.
 */
import type { JsonValue } from './types';
import type { AgentPermissionMode, AgentProviderId } from './workspace';

/**
 * Some providers stream incremental text, others resend the whole answer in
 * every frame. Adapters declare which one they are so the UI never guesses.
 */
export type AgentTextMode = 'delta' | 'snapshot';

export type AgentErrorKind =
  | 'notInstalled'
  | 'spawnFailed'
  | 'handshakeFailed'
  | 'protocol'
  | 'transport'
  | 'timeout'
  | 'exited'
  | 'canceled'
  | 'permissionDenied'
  | 'internal';

/**
 * One error, not a stream: process exit code, signal and the tail of stderr are
 * folded into a single record (`detail` is diagnostic text, never a whole log).
 */
export interface AgentError {
  kind: AgentErrorKind;
  message: string;
  detail?: string;
  exitCode?: number;
  signal?: string;
  providerId?: AgentProviderId;
}

export type AgentEvent =
  | { type: 'started'; sessionId: string; runId: string }
  | { type: 'delta'; sessionId: string; runId: string; content: string }
  | { type: 'tool'; sessionId: string; runId: string; payload: JsonValue }
  | { type: 'completed'; sessionId: string; runId: string }
  | { type: 'stopped'; sessionId: string; runId: string }
  | { type: 'failed'; sessionId: string; runId: string; error: AgentError };

export type AgentEventType = AgentEvent['type'];

export const terminalAgentEventTypes: AgentEventType[] = ['completed', 'stopped', 'failed'];

export function isTerminalAgentEvent(event: AgentEvent) {
  return terminalAgentEventTypes.includes(event.type);
}

export interface AgentProviderStatus {
  providerId: AgentProviderId;
  command: string;
  available: boolean;
  executablePath?: string;
  version?: string;
  error?: AgentError;
}

export interface StartAgentSessionRequest {
  sessionId: string;
  providerId: AgentProviderId;
  /** Restricted to the project root or a folder the user picked explicitly. */
  workingDirectory: string;
  permissionMode: AgentPermissionMode;
  modelId?: string;
  /** Resume an earlier provider-side conversation instead of starting a new one. */
  resumeProviderSessionId?: string;
}

export interface StartAgentSessionResult {
  sessionId: string;
  providerSessionId?: string;
  textMode: AgentTextMode;
  /** True when the adapter fell back to scraping human-readable stdout. */
  degraded: boolean;
}

export interface SendAgentMessageRequest {
  sessionId: string;
  content: string;
}

/** A resource reference attached to one agent prompt (AGT-4). */
export interface AgentResourceContext {
  id: string;
  title: string;
  uri: string;
}

/**
 * Makes resource selection explicit in the prompt without pretending the CLI
 * has already read the file. Providers receive stable ids and canonical URIs;
 * a later provider capability can resolve the same references to file content.
 */
export function formatAgentResourceContext(content: string, resources: AgentResourceContext[] = []) {
  const unique = resources.filter(
    (resource, index, all) => resource.id.trim() && all.findIndex((candidate) => candidate.id === resource.id) === index,
  );
  if (unique.length === 0) return content;
  const lines = unique.map((resource) => `- @resource(${resource.id}) ${resource.title} <${resource.uri}>`);
  return `${content}\n\n[Attached resources]\n${lines.join('\n')}\n[/Attached resources]`;
}

export interface AgentRunHandle {
  sessionId: string;
  runId: string;
}

export interface AgentProviderAdapter {
  detect(): Promise<AgentProviderStatus>;
  start(request: StartAgentSessionRequest): Promise<StartAgentSessionResult>;
  /**
   * Queues the message and returns. The run id is minted by the runtime when the
   * turn actually opens — a message sent during a turn waits for it — so it
   * arrives with the `started` event instead of with this promise.
   */
  send(request: SendAgentMessageRequest): Promise<void>;
  stop(sessionId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
}

/**
 * A command can reject with the runtime's own `AgentError`, with a thrown `Error`,
 * or with a bare string; the UI needs one shape either way. An object that carries
 * a message but no kind keeps its message rather than becoming `[object Object]`.
 */
export function toAgentError(cause: unknown): AgentError {
  if (typeof cause === 'object' && cause !== null) {
    const candidate = cause as { kind?: unknown; message?: unknown };
    if (typeof candidate.message === 'string') {
      return typeof candidate.kind === 'string'
        ? (cause as AgentError)
        : { kind: 'internal', message: candidate.message };
    }
  }
  return { kind: 'internal', message: cause instanceof Error ? cause.message : String(cause) };
}

export type AgentRunStatus = 'running' | 'completed' | 'stopped' | 'failed';

export interface AgentRunState {
  sessionId: string;
  runId: string;
  status: AgentRunStatus;
  textMode: AgentTextMode;
  text: string;
  toolPayloads: JsonValue[];
  error?: AgentError;
}

export function createAgentRunState(
  sessionId: string,
  runId: string,
  textMode: AgentTextMode = 'delta',
): AgentRunState {
  return { sessionId, runId, status: 'running', textMode, text: '', toolPayloads: [] };
}

/**
 * Events from an earlier run must never bleed into the current one: the run id
 * is the only filter, because a stopped run can still flush queued frames.
 */
export function acceptsAgentEvent(state: AgentRunState, event: AgentEvent) {
  return event.sessionId === state.sessionId && event.runId === state.runId;
}

/**
 * Returns the same reference when nothing changed, so callers can skip a render
 * or a write without diffing. Events for another run are ignored, not thrown.
 */
export function applyAgentEvent(state: AgentRunState, event: AgentEvent): AgentRunState {
  if (!acceptsAgentEvent(state, event)) return state;
  switch (event.type) {
    case 'started':
      return state.status === 'running' && state.text === '' ? state : { ...state, status: 'running', text: '' };
    case 'delta':
      if (!event.content) return state;
      return { ...state, text: state.textMode === 'snapshot' ? event.content : state.text + event.content };
    case 'tool':
      return { ...state, toolPayloads: [...state.toolPayloads, event.payload] };
    case 'completed':
      return { ...state, status: 'completed' };
    case 'stopped':
      return { ...state, status: 'stopped' };
    case 'failed':
      return { ...state, status: 'failed', error: event.error };
    default:
      return state;
  }
}

export function reduceAgentEvents(state: AgentRunState, events: AgentEvent[]): AgentRunState {
  return events.reduce(applyAgentEvent, state);
}

/**
 * A provider can emit its first frames before `send()` has returned the run id.
 * Buffer those, replay the matching ones once the id is known, drop the rest.
 * Mirrors the supervisor-side gate in `src-tauri/src/agent_cli/turn.rs`.
 */
export interface AgentRunGate {
  runId?: string;
  buffered: AgentEvent[];
}

export function createAgentRunGate(): AgentRunGate {
  return { buffered: [] };
}

export function bufferAgentEvent(gate: AgentRunGate, event: AgentEvent): AgentRunGate {
  if (gate.runId) return gate;
  return { ...gate, buffered: [...gate.buffered, event] };
}

export function openAgentRunGate(gate: AgentRunGate, runId: string): { gate: AgentRunGate; replay: AgentEvent[] } {
  const replay = gate.buffered.filter((event) => event.runId === runId);
  return { gate: { runId, buffered: [] }, replay };
}

/**
 * One exchange: what the user sent, plus the run the runtime opened for it. `run`
 * stays absent until the `started` event names the run id, so a queued message is
 * visible in the transcript before the CLI has begun answering it.
 */
export interface AgentTurn {
  prompt: string;
  run?: AgentRunState;
}

export interface AgentTranscript {
  sessionId: string;
  textMode: AgentTextMode;
  turns: AgentTurn[];
}

export function createAgentTranscript(sessionId: string, textMode: AgentTextMode = 'delta'): AgentTranscript {
  return { sessionId, textMode, turns: [] };
}

/** Records a message the user just sent, before the runtime has opened its run. */
export function appendAgentPrompt(transcript: AgentTranscript, prompt: string): AgentTranscript {
  return { ...transcript, turns: [...transcript.turns, { prompt }] };
}

/**
 * Returns the same reference when nothing changed, so a hidden tab can skip its
 * render. A `started` for an unknown run adopts the oldest turn still waiting for
 * an id; if none is waiting it appends a turn of its own — a resumed conversation
 * or a second window must not be dropped on the floor.
 */
export function applyAgentEventToTranscript(transcript: AgentTranscript, event: AgentEvent): AgentTranscript {
  if (event.sessionId !== transcript.sessionId) return transcript;
  const index = transcript.turns.findIndex((turn) => turn.run?.runId === event.runId);
  if (index < 0) {
    if (event.type !== 'started') return transcript;
    const run = createAgentRunState(transcript.sessionId, event.runId, transcript.textMode);
    const pending = transcript.turns.findIndex((turn) => !turn.run);
    const turns = [...transcript.turns];
    if (pending < 0) turns.push({ prompt: '', run });
    else turns[pending] = { ...turns[pending], run };
    return { ...transcript, turns };
  }
  const current = transcript.turns[index].run as AgentRunState;
  const next = applyAgentEvent(current, event);
  if (next === current) return transcript;
  const turns = [...transcript.turns];
  turns[index] = { ...turns[index], run: next };
  return { ...transcript, turns };
}

/** True while anything is queued or streaming — what a stop button follows. */
export function isAgentTranscriptBusy(transcript: AgentTranscript) {
  return transcript.turns.some((turn) => !turn.run || turn.run.status === 'running');
}
