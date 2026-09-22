import { useEffect, useRef, useState } from 'react';
import { bindingsForCommand, formatBinding, normalizeBinding, replaceShortcutBinding, reservedShortcutReason, resetShortcutScope,
  resetShortcutOverride, shortcutBindingConflicts, type ShortcutBinding, type ShortcutCommand, type ShortcutScope } from '../../core/shortcuts';
import { hintKeycaps } from './hintKeycaps';
import { useShortcuts } from './ShortcutProvider';

function ShortcutKeycaps({ bindings, empty = '未绑定' }: { bindings: ShortcutBinding[]; empty?: string }) {
  if (!bindings.length) return <span className="shortcut-keycaps-empty">{empty}</span>;
  const label = bindings.map(formatBinding).join(' 或 ');
  return <span className="shortcut-keycaps" role="img" aria-label={label} title={label}>
    {bindings.map((binding, bindingIndex) => <span className="shortcut-keycap-binding" key={`${formatBinding(binding)}-${bindingIndex}`}>
      {bindingIndex > 0 && <span className="shortcut-keycap-or" aria-hidden="true">或</span>}
      {hintKeycaps(binding).map((key, keyIndex) => <span className="shortcut-keycap-part" key={`${key}-${keyIndex}`}>
        {keyIndex > 0 && <span className="shortcut-keycap-plus" aria-hidden="true">+</span>}
        <kbd>{key}</kbd>
      </span>)}
    </span>)}
  </span>;
}

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
      if (e.isComposing || e.getModifierState('AltGraph')) { setPreview('请结束输入法组合或松开 AltGraph 后重试'); return; }
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { finish(); return; }
      if (e.repeat) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { setCandidate([]); setPreview('清除快捷键'); return; }
      const modifiers = [e.ctrlKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', e.metaKey ? 'Meta' : ''].filter(Boolean);
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) { setPreview(modifiers.join('+') + '…'); return; }
      if (['Dead', 'Unidentified', 'Process'].includes(e.key)) { setPreview('无法使用此按键，请换一个组合'); return; }
      setCandidate([normalizeBinding({ type: 'keyboard', key: e.key, ...(physical ? { code: e.code, semantics: 'code' as const } : { semantics: 'key' as const }), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })]);
    };
    const mouse = (e: MouseEvent) => { if (e.button !== 3 && e.button !== 4) return; e.preventDefault(); e.stopImmediatePropagation(); if (e.type === 'mousedown') setCandidate([{ type: 'mouse', button: e.button }]); };
    const cancel = () => finish();
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
    const collision = commands.flatMap(c => shortcutBindingConflicts(store.commands(), next, c, bindingsForCommand(c, next))).filter(c => !commands.some(own => own.id === c.id));
    if (collision.length) { store.error = `恢复会与 ${[...new Set(collision.map(c => c.title))].join('、')} 冲突，请逐项恢复并确认替换。`; store.emit(); return; }
    store.save(next); setResetConfirm(false);
  };
  const filtered = commands.filter(c => `${c.title} ${c.id} ${c.group}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="shortcut-editor" id={sceneId ? 'reader-shortcut-editor' : 'setting-shortcuts'} aria-label={sceneId ? '阅读器快捷键' : '工作台快捷键'}>
    <div className="shortcut-editor-intro">
      <p className="shortcut-editor-lead">按住 <kbd>Ctrl</kbd> 约 150ms 查看当前快捷键。PDF 缩放使用 <kbd>Ctrl</kbd> 与加号、减号或 0；全局界面缩放还需按住 <kbd>Alt</kbd>。</p>
      <p className="shortcut-editor-note"><span className="shortcut-editor-note-badge">实验性</span> 鼠标第 4/5 键取决于驱动支持；系统保留键可能无法捕获。输入框、输入法与模态弹窗会保护各自操作。</p>
    </div>
    <div className="shortcut-editor-toolbar"><label className="shortcut-search-label"><span>筛选命令</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索命令或工作台" /></label>
      <button className="shortcut-button-secondary" type="button" disabled={!!recordingId} onClick={() => setResetConfirm(true)}>恢复本组默认</button></div>
    {resetConfirm && <div className="shortcut-editor-confirm" role="alert"><span>恢复本组的默认快捷键？其他场景配置会保留。</span><button className="shortcut-button-primary" type="button" onClick={reset}>确认恢复</button><button type="button" onClick={() => setResetConfirm(false)}>取消</button></div>}
    <label className="shortcut-editor-physical"><input type="checkbox" checked={physical} disabled={!!recordingId} onChange={e => setPhysical(e.target.checked)} /><span><strong>按物理键位识别</strong><small>默认按逻辑字符；键盘布局变化时可能产生冲突</small></span></label>
    {store.error && <p className="shortcut-editor-alert" role="alert">{store.error}</p>}
    <div className="shortcut-editor-list" role="list" aria-label="快捷键命令">
      {filtered.map(c => {
        const bindings = bindingsForCommand(c, store.overrides);
        const isRecording = recordingId === c.id;
        return <div key={c.id} className={`shortcut-editor-row${isRecording ? ' is-capturing' : ''}`} data-shortcut-row={c.id} role="listitem">
          <div className="shortcut-editor-command"><strong>{c.title}</strong><small>{c.group}</small></div>
          <div className={`shortcut-editor-binding${isRecording ? ' shortcut-editor-binding-capture' : ''}`}>
            {isRecording ? <div className="shortcut-inline-capture" role="status" aria-live="polite" aria-atomic="true">
              <span className="shortcut-inline-capture-label">正在更改</span>
              {candidate === null ? <strong>{preview || '请按下新快捷键或鼠标侧键'}</strong> : <ShortcutKeycaps bindings={candidate} empty="将清除快捷键" />}
              <small>Esc 取消 · Delete / Backspace 清除</small>
            </div> : <ShortcutKeycaps bindings={bindings} />}
          </div>
          <div className="shortcut-editor-actions">{isRecording ? <>
            <button className="shortcut-button-primary" ref={saveButton} type="button" disabled={candidate === null} onClick={save}>{conflicts.length ? '替换并保存' : warnings.length ? '确认风险并保存' : '保存更改'}</button>
            <button type="button" disabled={candidate === null} onClick={() => { setRestoringDefault(false); setCandidate(null); setPreview(''); }}>重新输入</button>
            <button type="button" onClick={finish}>取消</button>
          </> : <>
            <button className="shortcut-change-button" type="button" disabled={!!recordingId} onClick={e => start(c, null, e.currentTarget)}>更改</button>
            <button type="button" disabled={!!recordingId || !bindings.length} title="清除快捷键" aria-label={`清除“${c.title}”快捷键`} onClick={e => start(c, [], e.currentTarget)}>清除</button>
            <button type="button" disabled={!!recordingId} title="恢复此项默认快捷键" aria-label={`恢复“${c.title}”默认快捷键`} onClick={e => start(c, c.defaultBindings, e.currentTarget, true)}>重置</button>
          </>}</div>
          {isRecording && (conflicts.length > 0 || warnings.length > 0) && <div className="shortcut-editor-inline-feedback">
            {conflicts.length > 0 && <p className="shortcut-editor-alert" role="alert">与以下命令冲突：{[...new Set(conflicts.map(item => item.title))].join('、')}。保存会移除这些命令中冲突的绑定。</p>}
            {warnings.map((warning, index) => <p className="shortcut-editor-warning" role="alert" key={index}>{warning}</p>)}
          </div>}
        </div>;
      })}
      {!filtered.length && <p className="shortcut-editor-empty">没有匹配的命令</p>}
    </div>

  </section>;
}
