import { useEffect, useRef, useState } from 'react';
import { bindingsForCommand, formatBinding, normalizeBinding, replaceShortcutBinding, reservedShortcutReason, resetShortcutScope, resetShortcutOverride, shortcutBindingConflicts, type ShortcutBinding, type ShortcutCommand, type ShortcutScope } from '../../core/shortcuts';
import { useShortcuts } from './ShortcutProvider';

export function ShortcutEditor({ sceneId }: { sceneId?: string }) {
  const store = useShortcuts();
  const [query, setQuery] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ShortcutBinding[] | null>(null);
  const [preview, setPreview] = useState('');
  const [physical, setPhysical] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [restoringDefault, setRestoringDefault] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const saveButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (candidate !== null) saveButton.current?.focus(); }, [candidate]);
  const commands = [...new Map(store.commands().filter((c) => sceneId ? c.scope.kind === 'scene' && c.scope.sceneId === sceneId : c.scope.kind !== 'scene').map((c) => [c.id, c])).values()];
  const command = commands.find((c) => c.id === recordingId);
  const conflicts = command && candidate ? shortcutBindingConflicts(store.commands(), store.overrides, command, candidate) : [];
  const warnings = candidate?.map(reservedShortcutReason).filter(Boolean) ?? [];
  const finish = () => { setRecordingId(null); setCandidate(null); store.setRecording(false); requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus()); };
  const start = (c: ShortcutCommand, binding: ShortcutBinding[] | null, trigger: HTMLElement, restoreDefault = false) => {
    setRestoringDefault(restoreDefault);
    returnFocus.current = trigger; setRecordingId(c.id); setCandidate(binding); setPreview(''); setResetConfirm(false); store.setRecording(true);
  };
  useEffect(() => {
    if (!recordingId) return;
    store.setRecording(true);
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.getModifierState('AltGraph')) { setPreview('请结束输入法组合或松开 AltGraph 后录制'); return; }
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { finish(); return; }
      if (e.repeat) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { setCandidate([]); setPreview('清除绑定'); return; }
      const modifiers = [e.ctrlKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', e.metaKey ? 'Meta' : ''].filter(Boolean);
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) { setPreview(modifiers.join('+') + '…'); return; }
      if (['Dead', 'Unidentified', 'Process'].includes(e.key)) { setPreview('无法录制此按键，请换一个组合'); return; }
      setCandidate([normalizeBinding({ type: 'keyboard', key: e.key, ...(physical ? { code: e.code, semantics: 'code' as const } : { semantics: 'key' as const }), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })]);
    };
    const mouse = (e: MouseEvent) => { if (e.button !== 3 && e.button !== 4) return; e.preventDefault(); e.stopImmediatePropagation(); if (e.type === 'mousedown') setCandidate([{ type: 'mouse', button: e.button }]); };
    const cancel = () => finish();
    // Once a candidate exists, keyboard navigation works again. Normal dispatch stays paused.
    if (candidate === null) window.addEventListener('keydown', key, true);
    else window.addEventListener('keydown', escape, true);
    function escape(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(); } }
    window.addEventListener('mousedown', mouse, true); window.addEventListener('mouseup', mouse, true); window.addEventListener('auxclick', mouse, true);
    window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', cancel);
    return () => {
      window.removeEventListener('keydown', key, true); window.removeEventListener('keydown', escape, true);
      window.removeEventListener('mousedown', mouse, true); window.removeEventListener('mouseup', mouse, true); window.removeEventListener('auxclick', mouse, true);
      window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancel); store.setRecording(false);
    };
  }, [store, recordingId, physical, candidate]);
  useEffect(() => { if (recordingId && !command) finish(); }, [recordingId, command]);
  const save = () => {
    if (!command || candidate === null) return;
    let next = replaceShortcutBinding(store.commands(), store.overrides, command, candidate);
    if (restoringDefault) next = resetShortcutOverride(next, command.id);
    if (store.save(next)) finish();
  };
  const reset = () => {
    let next = store.overrides;
    for (const scope of (sceneId ? [{ kind: 'scene', sceneId }] : [{ kind: 'workbench' }, { kind: 'global' }]) as ShortcutScope[]) next = resetShortcutScope(next, store.commands(), scope);
    // Restoring a group can conflict with user overrides in another scope. Refuse
    // silently overwriting them; show the commands and let the user reset individually.
    const collision = commands.flatMap(c => shortcutBindingConflicts(store.commands(), next, c, bindingsForCommand(c, next))).filter(c => !commands.some(own => own.id === c.id));
    if (collision.length) { store.error = `恢复会与 ${[...new Set(collision.map(c => c.title))].join('、')} 冲突，请逐项恢复并确认替换。`; store.emit(); return; }
    store.save(next); setResetConfirm(false);
  };
  return <section className="shortcut-editor" id={sceneId ? 'reader-shortcut-editor' : 'setting-shortcuts'} aria-label={sceneId ? '阅读器快捷键' : '工作台快捷键'}>
    <p>按住 Ctrl 约 150ms 查看当前快捷键。PDF 缩放：Ctrl + 加/减/0；全局界面缩放：Ctrl+Alt + 加/减/0。仅当前窗口获得焦点时生效。</p>
    <p className="shortcut-editor-note">鼠标第 4/5 键为实验支持：部分驱动不会暴露侧键；映射成键盘键时按键盘组合录制。系统保留键可能无法捕获。输入框、输入法与模态弹窗会保护各自操作。</p>
    <div className="shortcut-editor-toolbar"><label>筛选命令 <input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button type="button" disabled={!!recordingId} onClick={() => setResetConfirm(true)}>恢复本组默认</button></div>
    {resetConfirm && <div className="shortcut-editor-confirm"><span>恢复本组默认绑定？其他场景的配置保留。</span><button type="button" onClick={reset}>确认恢复</button><button type="button" onClick={() => setResetConfirm(false)}>取消</button></div>}
    <label className="shortcut-editor-note"><input type="checkbox" checked={physical} disabled={!!recordingId} onChange={e => setPhysical(e.target.checked)} />按物理键位录制（默认按逻辑字符；布局变化可能与字符键冲突）</label>
    {store.error && <p role="alert">{store.error}</p>}
    {commands.filter(c => `${c.title} ${c.id} ${c.group}`.toLowerCase().includes(query.toLowerCase())).map(c => {
      const bindings = bindingsForCommand(c, store.overrides);
      return <div key={c.id} className="shortcut-editor-row" data-shortcut-row={c.id}>
        <div><strong>{c.title}</strong><small>{c.group}</small></div><kbd>{bindings.map(formatBinding).join(' / ') || '未绑定'}</kbd>
        <div className="shortcut-editor-actions"><button type="button" disabled={!!recordingId} onClick={e => start(c, null, e.currentTarget)}>录制</button>
          <button type="button" disabled={!!recordingId || !bindings.length} onClick={e => start(c, [], e.currentTarget)}>清除</button>
          <button type="button" disabled={!!recordingId} onClick={e => start(c, c.defaultBindings, e.currentTarget, true)}>默认</button></div>
      </div>;
    })}
    {recordingId && <div className="shortcut-recorder" role="region" aria-label="录制快捷键">
      <strong>{command?.title}</strong><p role="status">{candidate === null ? preview || '请按组合键或鼠标侧键；Esc 取消，Delete / Backspace 清除' : candidate.map(formatBinding).join(' / ') || '将清除绑定'}</p>
      {conflicts.length > 0 && <p role="alert">与以下命令冲突：{[...new Set(conflicts.map(c => c.title))].join('、')}。替换会移除这些命令中冲突的绑定。</p>}
      {warnings.map((w, i) => <p key={i}>{w}</p>)}
      <div className="shortcut-editor-actions"><button ref={saveButton} type="button" disabled={candidate === null} onClick={save}>{conflicts.length ? '替换并保存' : warnings.length ? '确认风险并保存' : '保存绑定'}</button>
        <button type="button" onClick={() => { setRestoringDefault(false); setCandidate(null); setPreview(''); }}>重新录制</button><button type="button" onClick={finish}>取消</button></div>
    </div>}
  </section>;
}
