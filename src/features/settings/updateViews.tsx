import type { ReactNode } from 'react';
import type { UpdateModel } from './updateModel';

export function UpdateNotes({ notes, className, limitLines }: { notes: UpdateModel['notes']; className?: string; limitLines?: number }) {
  if (!notes.hasAny) return null;
  const items = typeof limitLines === 'number' ? notes.items.slice(0, limitLines) : notes.items;
  const trimmed = typeof limitLines === 'number' && notes.items.length > limitLines;
  return (
    <div className={['settings-update-notes', className].filter(Boolean).join(' ')} aria-label="更新内容">
      {items.length > 0 ? (
        <ul className="settings-update-note-list">
          {items.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      ) : null}
      {notes.reminders.map((line, index) => <p key={index} className="settings-update-note-reminder">{line}</p>)}
      {(notes.truncated || trimmed) ? <p className="settings-update-note-more">更多内容请查看 GitHub 发布说明。</p> : null}
    </div>
  );
}

export function UpdateProgress({ model, label = '正在下载并校验', compact = false }: { model: UpdateModel; label?: string; compact?: boolean }) {
  return (
    <div className={compact ? 'settings-update-progress is-compact' : 'settings-update-progress'} aria-busy="true">
      <div className="settings-update-progress-meta">
        <span role="status">{label}：{model.sizeLabel}</span>
        {typeof model.progressPercent === 'number' ? <span className="settings-update-progress-percent">{model.progressPercent}%</span> : null}
      </div>
      <progress aria-label="更新下载进度" max={model.total || undefined} value={model.total ? Math.min(model.received, model.total) : undefined} />
    </div>
  );
}

export function UpdateConsent({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; children?: ReactNode }) {
  return (
    <label className="settings-toggle settings-update-consent">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-toggle-text"><strong>{children ?? '我了解备份范围，同意自动备份资料库后退出安装。'}</strong></span>
    </label>
  );
}
