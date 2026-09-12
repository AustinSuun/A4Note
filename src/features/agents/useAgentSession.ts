/**
 * One live Agent CLI session, driven through the Rust supervisor (CLI-2).
 *
 * The hook owns the transcript and the session's phase; every protocol decision
 * (which turn an event belongs to, when a turn is finished) stays in the pure
 * reducers of `src/core/agentProtocol.ts`.
 *
 * Two deliberate choices. A panel that unmounts — switching workspace — does not
 * kill the CLI: only the explicit "结束进程" button and app exit do, so a long task
 * survives a look at another tab. And because the process outlives the component,
 * mounting asks the runtime whether the session is already live and adopts it
 * instead of handshaking a second time.
 *
 * CLI-4 adds history: rows are read once per mount and prepended, and the
 * transcript is written back as it changes. The process is not restarted for them —
 * a restored turn is finished by definition, and its run id is marked so no live
 * event can land on it (`src/core/agentHistory.ts` explains why that matters).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  agentMessageDigest,
  agentMessageDigests,
  agentTranscriptToRecords,
  pendingAgentMessageWrites,
  restoreAgentTranscript,
} from '../../core/agentHistory';
import {
  appendAgentPrompt,
  applyAgentEventToTranscript,
  createAgentTranscript,
  formatAgentResourceContext,
  isAgentTranscriptBusy,
  isTerminalAgentEvent,
  toAgentError,
  type AgentError,
  type AgentEvent,
  type AgentResourceContext,
  type AgentTranscript,
} from '../../core/agentProtocol';
import type { AgentSession, AgentSessionStatus } from '../../core/workspace';
import {
  closeAgentSession,
  isAgentSessionRunning,
  listenAgentEvents,
  loadAgentMessages,
  saveAgentMessages,
  sendAgentMessage,
  startAgentSession,
  stopAgentSession,
} from '../../platform/agentCli';
import { isTauriRuntime } from '../../platform/projects';
import { zh } from '../../ui/zh';

/** `live` means the runtime has a process for this session; the rest is the UI's. */
type Phase = 'idle' | 'starting' | 'live' | 'failed' | 'closed';

/**
 * `ready` is the only state that may write. Without a baseline of what is already
 * stored, a new turn's `seq` could land on an existing row and overwrite a real
 * message — so a failed read disables writing for this mount instead of guessing.
 */
type HistoryPhase = 'loading' | 'ready' | 'unavailable';

/** How often a streaming turn is written. Long enough to not thrash SQLite. */
const HISTORY_WRITE_INTERVAL_MS = 400;

export interface AgentSessionRuntime {
  transcript: AgentTranscript;
  status: AgentSessionStatus;
  /** A turn is queued or streaming. */
  busy: boolean;
  /** The runtime has a process for this session, so closing it does something. */
  live: boolean;
  error: AgentError | null;
  start: () => Promise<void>;
  send: (content: string, resources?: AgentResourceContext[]) => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
  dismissError: () => void;
}

export interface UseAgentSessionOptions {
  onStatusChange?: (status: AgentSessionStatus) => void;
  /** The CLI's own conversation id, so a later start can resume it. */
  onProviderSessionId?: (providerSessionId: string) => void;
}

export function useAgentSession(session: AgentSession, options: UseAgentSessionOptions = {}): AgentSessionRuntime {
  const [transcript, setTranscript] = useState<AgentTranscript>(() => createAgentTranscript(session.id));
  const [phase, setPhase] = useState<Phase>('idle');
  const [historyPhase, setHistoryPhase] = useState<HistoryPhase>('loading');
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<AgentError | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const pendingRef = useRef(false);
  const listenerRef = useRef<Promise<unknown> | null>(null);
  /** seq -> digest of what is already stored, so a write only sends what moved. */
  const persistedRef = useRef<Map<number, string>>(new Map());
  const lastWriteRef = useRef(0);
  const callbacks = useRef(options);
  callbacks.current = options;

  const goto = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const busy = isAgentTranscriptBusy(transcript);
  const status: AgentSessionStatus = useMemo(() => {
    if (phase === 'starting' || phase === 'failed' || phase === 'closed') return phase;
    if (stopping && busy) return 'stopping';
    return busy ? 'running' : 'idle';
  }, [phase, stopping, busy]);

  /* One listener per panel, attached before anything can be started so no frame is
     missed; the payload names its session, so every other session is skipped. */
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const handleEvent = (event: AgentEvent) => {
      if (event.type === 'started') goto('live');
      if (event.type === 'failed') {
        setError(event.error);
        // A failed turn is not always a dead session; ask instead of guessing.
        void isAgentSessionRunning(session.id)
          .then((running) => {
            if (!running && !disposed) goto('failed');
          })
          .catch(() => undefined);
      }
      if (isTerminalAgentEvent(event)) setStopping(false);
    };

    const attached = listenAgentEvents((event) => {
      if (event.sessionId !== session.id) return;
      setTranscript((current) => applyAgentEventToTranscript(current, event));
      handleEvent(event);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    listenerRef.current = attached;

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [goto, session.id]);

  /* The process outlives this component, so a remount adopts what is already live
     rather than starting a second CLI. */
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    void isAgentSessionRunning(session.id)
      .then((running) => {
        if (running && !disposed && phaseRef.current === 'idle') goto('live');
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [goto, session.id]);

  useEffect(() => {
    callbacks.current.onStatusChange?.(status);
  }, [status]);

  /* CLI-4 read side. Once per mount, before any write is allowed: the baseline it
     records is what makes a later write safe. Browser preview has no database, so
     history is simply unavailable there rather than an error. */
  useEffect(() => {
    if (!isTauriRuntime()) {
      setHistoryPhase('unavailable');
      return;
    }
    let disposed = false;
    setHistoryPhase('loading');
    persistedRef.current = new Map();
    void loadAgentMessages(session.id)
      .then((records) => {
        if (disposed) return;
        persistedRef.current = agentMessageDigests(records);
        setHistoryPhase('ready');
        // Prepending is done in the reducer so a message sent while the rows were
        // still loading keeps its place — and therefore its seq.
        if (records.length > 0) setTranscript((current) => restoreAgentTranscript(current, records));
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        setHistoryPhase('unavailable');
        setError({ ...toAgentError(cause), message: zh.workbench.agentHistoryUnavailable });
      });
    return () => {
      disposed = true;
    };
  }, [session.id]);

  /* CLI-4 write side. It trails the transcript instead of hooking each event: a
     streaming answer rewrites one row many times and only its last state matters.
     Throttled rather than debounced — the delay counts from the last write, not the
     last delta, so an answer that streams for a minute is still saved along the way
     instead of only when it pauses. A turn that just ended flushes immediately, so
     quitting right after an answer keeps it. A rejected save leaves the row
     unmarked, which retries it on the next change. */
  useEffect(() => {
    if (historyPhase !== 'ready') return;
    const records = agentTranscriptToRecords(transcript, new Date().toISOString());
    const pending = pendingAgentMessageWrites(records, persistedRef.current);
    if (pending.length === 0) return;
    const delay = busy ? Math.max(0, HISTORY_WRITE_INTERVAL_MS - (Date.now() - lastWriteRef.current)) : 0;
    const timer = window.setTimeout(() => {
      lastWriteRef.current = Date.now();
      void saveAgentMessages(pending)
        .then(() => {
          for (const record of pending) persistedRef.current.set(record.seq, agentMessageDigest(record));
        })
        .catch(() => undefined);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [busy, historyPhase, transcript]);


  const start = useCallback(async () => {
    if (phaseRef.current === 'live' || phaseRef.current === 'starting') return;
    if (!isTauriRuntime()) {
      setError({ kind: 'internal', message: zh.workbench.agentDesktopOnly });
      return;
    }
    goto('starting');
    setError(null);
    await listenerRef.current;
    const attempt = (resume?: string) =>
      startAgentSession({
        sessionId: session.id,
        providerId: session.providerId,
        workingDirectory: session.workingDirectory,
        permissionMode: session.permissionMode,
        modelId: session.modelId,
        resumeProviderSessionId: resume,
      });
    try {
      const result = await attempt(session.providerSessionId).catch((cause: unknown) => {
        // A conversation the CLI has forgotten must not lock the session out of a
        // fresh one; anything else is the real error.
        const failure = toAgentError(cause);
        if (!session.providerSessionId || failure.kind !== 'handshakeFailed') throw cause;
        return attempt(undefined);
      });
      goto('live');
      if (result.textMode !== transcript.textMode) {
        setTranscript((current) => ({ ...current, textMode: result.textMode }));
      }
      if (result.providerSessionId && result.providerSessionId !== session.providerSessionId) {
        callbacks.current.onProviderSessionId?.(result.providerSessionId);
      }
    } catch (cause) {
      setError(toAgentError(cause));
      goto('failed');
    }
  }, [goto, session.id, session.modelId, session.permissionMode, session.providerId, session.providerSessionId, session.workingDirectory, transcript.textMode]);

  const send = useCallback(
    async (content: string, resources: AgentResourceContext[] = []) => {
      const text = content.trim();
      if (!text || pendingRef.current) return;
      const prompt = formatAgentResourceContext(text, resources);
      pendingRef.current = true;
      try {
        if (phaseRef.current !== 'live') await start();
        if (phaseRef.current !== 'live') return;
        // Optimistic: the prompt has to be in the transcript before `started`
        // arrives, or the turn it opens has nothing to pair with.
        setTranscript((current) => appendAgentPrompt(current, prompt));
        setError(null);
        try {
          await sendAgentMessage(session.id, prompt);
        } catch (cause) {
          setError(toAgentError(cause));
          setTranscript((current) => ({
            ...current,
            turns: current.turns.filter((turn, index) => turn.run || index !== current.turns.length - 1),
          }));
          // A CLI that died while idle is announced by nothing, so a rejected send is
          // the first hint: drop the phase, or every later message fails the same way
          // instead of starting a fresh process.
          const running = await isAgentSessionRunning(session.id).catch(() => true);
          if (!running) goto('failed');
        }
      } finally {
        pendingRef.current = false;
      }
    },
    [goto, session.id, start],
  );

  const stop = useCallback(async () => {
    if (phaseRef.current !== 'live') return;
    setStopping(true);
    try {
      await stopAgentSession(session.id);
    } catch (cause) {
      setStopping(false);
      setError(toAgentError(cause));
    }
  }, [session.id]);

  const close = useCallback(async () => {
    if (phaseRef.current !== 'live' && phaseRef.current !== 'starting') return;
    try {
      await closeAgentSession(session.id);
    } catch (cause) {
      setError(toAgentError(cause));
    }
    setStopping(false);
    goto('closed');
  }, [goto, session.id]);

  const dismissError = useCallback(() => setError(null), []);

  return { transcript, status, busy, live: phase === 'live' || phase === 'starting', error, start, send, stop, close, dismissError };
}
