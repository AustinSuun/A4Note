/**
 * CLI-4: the transcript's SQLite shape, and the two pure maps between them.
 *
 * The transcript (`./agentProtocol`) is the live model; this module is only its
 * projection to rows and back. No React, no Tauri, no SQL — the store is
 * `src-tauri/src/agent_history.rs` and it stores exactly this shape.
 *
 * Two rules earn their own names here, because getting either wrong is silent:
 *
 * 1. `seq` counts turns that actually opened a run. A queued prompt has no run
 *    yet, so it is not history — persisting it would resurrect a message the CLI
 *    never saw, and would shift every later `seq` once its run did open.
 * 2. A restored run id is marked (`#restored{seq}`) on the way in and stripped on
 *    the way out. The supervisor's counter restarts with the process
 *    (`run_id = "{sessionId}-{n}"`, see `agent_cli/supervisor.rs`), so a fresh run
 *    can be handed the same id a restored turn already carries; without the mark,
 *    `applyAgentEventToTranscript` would stream a new answer into an old turn.
 *    Stripping on write keeps the real id in the database, where it belongs.
 */
import type { AgentError, AgentRunStatus, AgentTranscript, AgentTurn } from './agentProtocol';
import type { JsonValue } from './types';

/**
 * One exchange. `(sessionId, seq)` is the identity, so a streaming answer updates
 * one row instead of appending. Camel case because it crosses `invoke` as-is.
 */
export interface AgentMessageRecord {
  sessionId: string;
  seq: number;
  prompt: string;
  runId: string;
  status: AgentRunStatus;
  answer: string;
  toolPayloads: JsonValue[];
  error?: AgentError;
  createdAt: string;
  updatedAt: string;
}

export const AGENT_RESTORED_RUN_MARKER = '#restored';

/** Idempotent: restoring a transcript twice must not stack markers. */
export function restoredAgentRunId(runId: string, seq: number) {
  return isRestoredAgentRun(runId) ? runId : `${runId}${AGENT_RESTORED_RUN_MARKER}${seq}`;
}

/** A marked run is history: no live event can ever match it, by construction. */
export function isRestoredAgentRun(runId: string) {
  return runId.includes(AGENT_RESTORED_RUN_MARKER);
}

/** The id the runtime actually minted, which is what the database keeps. */
export function storedAgentRunId(runId: string) {
  const marker = runId.indexOf(AGENT_RESTORED_RUN_MARKER);
  return marker < 0 ? runId : runId.slice(0, marker);
}

/**
 * Rows for every turn that has a run, in transcript order. `createdAt` is sent
 * for the insert case only — the store keeps the first one it was given, because
 * that is when the user sent the message.
 */
export function agentTranscriptToRecords(transcript: AgentTranscript, now: string): AgentMessageRecord[] {
  const records: AgentMessageRecord[] = [];
  for (const turn of transcript.turns) {
    const run = turn.run;
    if (!run) continue;
    records.push({
      sessionId: transcript.sessionId,
      seq: records.length,
      prompt: turn.prompt,
      runId: storedAgentRunId(run.runId),
      status: run.status,
      answer: run.text,
      toolPayloads: run.toolPayloads,
      ...(run.error ? { error: run.error } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  return records;
}

/**
 * `running` becomes `stopped`: the process died with the app, so the turn did
 * end — and leaving it `running` would keep `isAgentTranscriptBusy` true forever,
 * freezing the composer behind a stop button with nothing to stop. An unknown
 * status gets the same treatment rather than a guess at success or failure.
 */
export function restoredAgentRunStatus(status: string): AgentRunStatus {
  return status === 'completed' || status === 'failed' || status === 'stopped' ? status : 'stopped';
}

/**
 * Keeps an error only if it still looks like one. A `failed` turn without a
 * readable error falls back to the panel's generic text, which is honest; making
 * one up from a corrupt column would not be.
 */
export function restoredAgentError(value: unknown): AgentError | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as { kind?: unknown; message?: unknown };
  if (typeof candidate.kind !== 'string' || typeof candidate.message !== 'string') return undefined;
  return value as AgentError;
}

/**
 * History above whatever the panel has already started, so a message sent while
 * the rows were still loading keeps its place at the end — and therefore its
 * `seq`. Returns the same reference when there is nothing to restore.
 */
export function restoreAgentTranscript(
  transcript: AgentTranscript,
  records: AgentMessageRecord[],
): AgentTranscript {
  const mine = records
    .filter((record) => record.sessionId === transcript.sessionId)
    .slice()
    .sort((left, right) => left.seq - right.seq);
  if (mine.length === 0) return transcript;
  const restored: AgentTurn[] = mine.map((record, index) => ({
    prompt: record.prompt,
    run: {
      sessionId: transcript.sessionId,
      runId: restoredAgentRunId(record.runId, index),
      status: restoredAgentRunStatus(record.status),
      textMode: transcript.textMode,
      text: record.answer,
      toolPayloads: Array.isArray(record.toolPayloads) ? record.toolPayloads : [],
      ...(restoredAgentError(record.error) ? { error: restoredAgentError(record.error) as AgentError } : {}),
    },
  }));
  return { ...transcript, turns: [...restored, ...transcript.turns] };
}

/**
 * Content only — timestamps are excluded on purpose. A restored row and the row
 * it came from therefore hash the same, so opening a session writes nothing; the
 * one exception is an interrupted turn, whose repaired status heals the row.
 */
export function agentMessageDigest(record: AgentMessageRecord) {
  return JSON.stringify([
    record.prompt,
    storedAgentRunId(record.runId),
    record.status,
    record.answer,
    record.toolPayloads,
    record.error ?? null,
  ]);
}

export function agentMessageDigests(records: AgentMessageRecord[]) {
  return new Map(records.map((record) => [record.seq, agentMessageDigest(record)]));
}

/** Only the rows whose content moved, so a streaming answer writes one row. */
export function pendingAgentMessageWrites(
  records: AgentMessageRecord[],
  persisted: Map<number, string>,
): AgentMessageRecord[] {
  return records.filter((record) => persisted.get(record.seq) !== agentMessageDigest(record));
}
