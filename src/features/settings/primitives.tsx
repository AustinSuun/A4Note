import type { ReactNode } from 'react';
import { Button } from '../../shared/ui';
import { zh } from '../../ui/zh';

/* --- layout ------------------------------------------------------------- */

export function SectionLayout({ id, title, description, headingRef, children }: { id: string; title: string; description?: string; headingRef?: (node: HTMLHeadingElement | null) => void; children: ReactNode }) {
  const headingId = `settings-section-${id}-heading`;
  return (
    <section className="settings-section" id={`settings-section-${id}`} data-settings-section={id} aria-labelledby={headingId}>
      <header className="settings-section-heading">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>{title}</h2>
        {description ? <p className="settings-section-description">{description}</p> : null}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export function SettingGroup({ title, description, actions, children, anchorId }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; anchorId?: string }) {
  return (
    <section className="soft-panel settings-group" id={anchorId ? `settings-group-${anchorId}` : undefined}>
      <div className="settings-group-heading">
        <h3 className="panel-title">{title}</h3>
        {actions ? <div className="settings-group-actions">{actions}</div> : null}
      </div>
      {description ? <p className="settings-group-description">{description}</p> : null}
      {children}
    </section>
  );
}

/* A field owns its visible label. `mode='label'` wraps a single control so the
   association is implicit (label element -> first labelable descendant) and also
   explicit for assistive tech that only reads `labels`; `mode='group'` labels a
   cluster of controls (segmented buttons, slider + output). */
export function SettingField({ id, label, description, hint, mode = 'group', children }: { id: string; label: string; description?: ReactNode; hint?: ReactNode; mode?: 'label' | 'group'; children: ReactNode }) {
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  if (mode === 'label') {
    return (
      <label className="settings-field settings-field--single" id={id}>
        <span className="settings-field-label" id={labelId}>{label}</span>
        {description ? <span className="settings-field-description" id={descriptionId}>{description}</span> : null}
        <span className="settings-field-control">{children}</span>
        {hint ? <span className="settings-field-hint">{hint}</span> : null}
      </label>
    );
  }
  return (
    <div className="settings-field" id={id} role="group" aria-labelledby={labelId} aria-describedby={description ? descriptionId : undefined}>
      <span className="settings-field-label" id={labelId}>{label}</span>
      {description ? <span className="settings-field-description" id={descriptionId}>{description}</span> : null}
      <span className="settings-field-control">{children}</span>
      {hint ? <span className="settings-field-hint">{hint}</span> : null}
    </div>
  );
}

export function ActionRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['settings-action-row', className].filter(Boolean).join(' ')}>{children}</div>;
}

/* --- feedback ----------------------------------------------------------- */

export type StatusTone = 'busy' | 'success' | 'error' | 'info';

export function StatusLine({ tone, message, id }: { tone: StatusTone; message: string; id?: string }) {
  if (!message) return null;
  const role = tone === 'error' ? 'alert' : 'status';
  return (
    <p className={`settings-status settings-status--${tone}`} id={id} role={role} aria-live={tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true" data-status-tone={tone}>
      {tone === 'busy' ? <span className="settings-status-spinner" aria-hidden="true" /> : null}
      <span>{message}</span>
    </p>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="settings-empty" role="note">
      <strong>{title}</strong>
      {description ? <small>{description}</small> : null}
    </div>
  );
}

/* --- rows --------------------------------------------------------------- */

export function ToggleRow({ id, label, description, checked, disabled, onChange }: { id: string; label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={['settings-toggle', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')} id={id}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-toggle-text">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function PathRow({ id, label, value, onCopy }: { id: string; label: string; value: string; onCopy: (value: string) => void | Promise<void> }) {
  return (
    <div className="settings-path-row" id={id}>
      <span className="settings-path-label">{label}</span>
      <code title={value}>{value}</code>
      <Button size="compact" aria-label={`复制${label}`} onClick={() => void onCopy(value)}>{zh.settings.copyPath}</Button>
    </div>
  );
}

export function ExtensionStatus({ label, value, status }: { label: string; value: string | number; status: string }) {
  return <div className="extension-status-item"><span>{label}</span><strong>{value}</strong><em>{status}</em></div>;
}

export function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return <div className="diagnostics-item"><span>{label}</span><code title={value}>{value}</code></div>;
}
