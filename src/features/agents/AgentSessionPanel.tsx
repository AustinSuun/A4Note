import { useEffect, useRef, useState } from 'react';
import type { AgentTurn } from '../../core/agentProtocol';
import type { AgentResourceContext } from '../../core/agentProtocol';
import type { JsonValue } from '../../core/types';
import type { Resource } from '../../core/resources';
import type { AgentPermissionMode, AgentSession, AgentSessionStatus } from '../../core/workspace';
import { zh } from '../../ui/zh';
import type { AgentProviderState } from './useAgentProviders';
import { useAgentSession } from './useAgentSession';

export interface AgentSessionPanelProps {
  session: AgentSession;
  provider: AgentProviderState | null;
  detecting: boolean;
  onPermissionModeChange: (mode: AgentPermissionMode) => void;
  onStatusChange: (status: AgentSessionStatus) => void;
  onProviderSessionId: (providerSessionId: string) => void;
  onRedetect: () => void;
  onRemove: () => void;
  resources: Resource[];
}

/**
 * Session states, not turn states: a finished turn returns the session to `idle`.
 * Turn status is shown per turn in the transcript instead.
 */
const statusLabels: Record<AgentSessionStatus, string> = {
  idle: zh.workbench.agentStatusIdle,
  starting: zh.workbench.agentStatusStarting,
  running: zh.workbench.agentStatusRunning,
  stopping: zh.workbench.agentStatusStopping,
  closed: zh.workbench.agentStatusClosed,
  failed: zh.workbench.agentStatusFailed,
};

/**
 * The label says what the sandbox does, because that is the real control: A4Note
 * answers a CLI's own approval request with a refusal (see `agentApprovalNote`)
 * rather than turning it into a dialog.
 */
const permissionOptions: { value: AgentPermissionMode; label: string }[] = [
  { value: 'default', label: zh.workbench.agentPermissionDefault },
  { value: 'autoReview', label: zh.workbench.agentPermissionAutoReview },
  { value: 'fullAccess', label: zh.workbench.agentPermissionFullAccess },
];

/**
 * A real session: the transcript below is what the local CLI actually streamed
 * through the Rust supervisor, and the composer sends to that process.
 */
export function AgentSessionPanel({
  session,
  provider,
  detecting,
  onPermissionModeChange,
  onStatusChange,
  onProviderSessionId,
  onRedetect,
  onRemove,
  resources,
}: AgentSessionPanelProps) {
  const runtime = useAgentSession(session, { onStatusChange, onProviderSessionId });
  const [draft, setDraft] = useState('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const providerLabel = provider?.label ?? session.providerId;
  const unavailable = provider ? !provider.available && !detecting : false;
  const turns = runtime.transcript.turns;

  /* A streaming answer should stay in view, but only when the user is already at
     the bottom — scrolling up to read something must not be yanked back. */
  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight > 160) return;
    node.scrollTop = node.scrollHeight;
  }, [turns]);

  const submit = () => {
    const text = draft.trim();
    if (!text || unavailable) return;
    const selectedResources: AgentResourceContext[] = selectedResourceIds
      .map((id) => resources.find((resource) => resource.id === id))
      .filter((resource): resource is Resource => Boolean(resource))
      .map(({ id, title, uri }) => ({ id, title, uri }));
    setDraft('');
    setSelectedResourceIds([]);
    void runtime.send(text, selectedResources);
  };

  return (
    <section className="agent-session">
      <header className="agent-session-header">
        <div>
          <h2>{zh.workbench.agentSessionTitle(providerLabel)}</h2>
          <p className="agent-session-subtitle">
            {provider?.command ?? session.providerId}
            {provider?.version ? ` · ${provider.version}` : ''}
          </p>
        </div>
        <div className="agent-session-header-actions">
          <span className={provider?.available ? 'agent-pill ready' : 'agent-pill missing'}>
            {detecting ? zh.workbench.agentDetecting : provider?.checked === false ? '尚未检测' : provider?.available ? zh.workbench.agentAvailable : zh.workbench.agentUnavailable}
          </span>
          <button type="button" className="workbench-action" onClick={onRedetect} disabled={detecting}>
            {zh.workbench.agentRedetect}
          </button>
          <button type="button" className="workbench-action" onClick={() => void runtime.close()} disabled={!runtime.live}>
            {zh.workbench.agentCloseProcess}
          </button>
          <button type="button" className="workbench-action danger" onClick={onRemove}>
            {zh.workbench.agentRemoveSession}
          </button>
        </div>
      </header>

      <dl className="agent-session-facts">
        <div>
          <dt>{zh.workbench.agentStatus}</dt>
          <dd>{statusLabels[runtime.status]}</dd>
        </div>
        <div>
          <dt>{zh.workbench.agentWorkingDirectory}</dt>
          <dd title={session.workingDirectory}>{session.workingDirectory}</dd>
        </div>
        <div className="agent-session-permission">
          <dt>{zh.workbench.agentPermissionMode}</dt>
          <dd>
            {/* The sandbox is fixed when the process starts, so switching modes has to
                wait for the next one rather than silently doing nothing. */}
            <select
              value={session.permissionMode}
              onChange={(event) => onPermissionModeChange(event.target.value as AgentPermissionMode)}
              disabled={runtime.live}
            >
              {permissionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="agent-session-hint">{runtime.live ? zh.workbench.agentPermissionLockedHint : zh.workbench.agentApprovalNote}</p>
            {session.permissionMode === 'fullAccess' && <p className="agent-session-warning">{zh.workbench.agentPermissionFullAccessHint}</p>}
          </dd>
        </div>
      </dl>

      {unavailable && <p className="agent-session-notice">{provider?.error || zh.workbench.agentNoProvider}</p>}
      {runtime.error && (
        <p className="agent-session-error">
          <span>{errorText(runtime.error.message, runtime.error.detail)}</span>
          <button type="button" className="workbench-action" onClick={runtime.dismissError}>
            {zh.workbench.agentDismissError}
          </button>
        </p>
      )}

      <div className="agent-transcript" ref={transcriptRef}>
        {turns.length === 0 ? (
          <p className="agent-transcript-empty">{zh.workbench.agentTranscriptEmpty}</p>
        ) : (
          turns.map((turn, index) => <AgentTurnView key={turn.run?.runId ?? `pending-${index}`} turn={turn} onRetry={() => void runtime.send(turn.prompt)} disabled={runtime.busy || unavailable} />)
        )}
      </div>

      <div className="agent-session-composer">
        <div className="agent-resource-context">
          <label htmlFor={`agent-resource-picker-${session.id}`}>{zh.workbench.agentResourceLabel}</label>
          <select
            id={`agent-resource-picker-${session.id}`}
            value=""
            onChange={(event) => {
              const resourceId = event.target.value;
              if (!resourceId) return;
              setSelectedResourceIds((current) => (current.includes(resourceId) ? current : [...current, resourceId]));
            }}
            disabled={unavailable || resources.length === 0}
          >
            <option value="">{resources.length > 0 ? zh.workbench.agentResourcePlaceholder : zh.workbench.agentResourceEmpty}</option>
            {resources
              .filter((resource) => !selectedResourceIds.includes(resource.id))
              .map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.title}
                </option>
              ))}
          </select>
          {selectedResourceIds.length > 0 && (
            <div className="agent-resource-chips">
              {selectedResourceIds.map((resourceId) => {
                const resource = resources.find((candidate) => candidate.id === resourceId);
                if (!resource) return null;
                return (
                  <button
                    key={resource.id}
                    type="button"
                    className="agent-resource-chip"
                    title={resource.uri}
                    aria-label={`${zh.workbench.agentResourceRemove}: ${resource.title}`}
                    onClick={() => setSelectedResourceIds((current) => current.filter((id) => id !== resource.id))}
                  >
                    @{resource.title}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
          placeholder={unavailable ? zh.workbench.agentComposerBlocked : zh.workbench.agentComposerPlaceholder}
          rows={3}
          disabled={unavailable}
        />
        <div className="agent-composer-actions">
          {runtime.busy ? (
            <button type="button" className="workbench-action" onClick={() => void runtime.stop()} disabled={runtime.status === 'stopping'}>
              {zh.workbench.agentStopTurn}
            </button>
          ) : (
            <span className="agent-composer-hint">{zh.workbench.agentComposerHint}</span>
          )}
          <button type="button" className="workbench-action primary" onClick={submit} disabled={!draft.trim() || unavailable || runtime.status === 'starting'}>
            {runtime.status === 'starting' ? zh.workbench.agentStatusStarting : zh.workbench.agentSend}
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * One exchange. `run` stays absent until the runtime opens a turn for the prompt,
 * so a queued message is visible before the CLI has begun answering it.
 */
function AgentTurnView({ turn, onRetry, disabled }: { turn: AgentTurn; onRetry: () => void; disabled: boolean }) {
  const run = turn.run;
  return (
    <article className="agent-turn">
      {turn.prompt && <p className="agent-turn-prompt">{turn.prompt}</p>}
      {!run ? (
        <p className="agent-turn-pending">{zh.workbench.agentTurnPending}</p>
      ) : (
        <>
          {run.text && <p className="agent-turn-text">{run.text}</p>}
          {run.toolPayloads.length > 0 && (
            <ul className="agent-turn-tools">
              {run.toolPayloads.map((payload, index) => (
                <li key={index}>{toolNotice(payload)}</li>
              ))}
            </ul>
          )}
          {run.status === 'running' && !run.text && <p className="agent-turn-pending">{zh.workbench.agentTurnRunning}</p>}
          {run.status === 'stopped' && <p className="agent-turn-footer">{zh.workbench.agentTurnStopped}</p>}
          {run.status === 'failed' && (
            <div className="agent-turn-error">
              <span>{errorText(run.error?.message ?? zh.workbench.agentTurnFailed, run.error?.detail)}</span>
              <button type="button" className="workbench-action" onClick={onRetry} disabled={disabled}>
                {zh.workbench.agentRetryTurn}
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

/**
 * Tool frames stay provider-shaped JSON on purpose (the Codex adapter sends
 * `{kind, detail?, status?, exitCode?}`). Render what is recognized and fall back
 * to the raw kind, so a frame the UI has not learned yet is still shown.
 */
function toolNotice(payload: JsonValue): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return String(payload);
  const record = payload as Record<string, JsonValue | undefined>;
  const kind = typeof record.kind === 'string' ? record.kind : '';
  const head = [zh.workbench.agentToolKind(kind)];
  if (typeof record.detail === 'string' && record.detail) head.push(record.detail);
  const notes: string[] = [];
  if (typeof record.status === 'string' && record.status) notes.push(zh.workbench.agentToolStatus(record.status));
  if (typeof record.exitCode === 'number') notes.push(zh.workbench.agentToolExitCode(record.exitCode));
  return notes.length > 0 ? `${head.join('：')}（${notes.join('，')}）` : head.join('：');
}

/** `detail` is diagnostic text, never a whole log, so one line is enough for it. */
function errorText(message: string, detail?: string) {
  return detail ? `${message}（${detail}）` : message;
}
