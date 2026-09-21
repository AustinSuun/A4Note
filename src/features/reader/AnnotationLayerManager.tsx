import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Pencil, Trash2, X } from 'lucide-react';
import type { AnnotationLayer, AnnotationLayerDeletePreview, PaperDocument } from '../../core/types';
import type { AnnotationLayersApi } from './useAnnotationLayers';
import './reader-annotation-layers.css';

/**
 * Full layer management page (fb5e3f2f), shown inside the annotations side panel: create, rename,
 * reorder, show/hide, lock, archive/restore, move a whole layer's annotations and delete with a
 * two-step confirmation that spells out the affected annotations and note references.
 */
export function AnnotationLayerManager({ layers, paper, onClose }: { layers: AnnotationLayersApi; paper: PaperDocument; onClose: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<{ layer: AnnotationLayer; preview: AnnotationLayerDeletePreview; trigger: HTMLElement | null } | null>(null);
  const [moving, setMoving] = useState<{ from: string; to: string } | null>(null);
  const active = layers.layers.filter((layer) => !layer.archivedAt);
  const archived = layers.layers.filter((layer) => layer.archivedAt);
  const activeId = layers.activeLayer?.id ?? null;
  const say = (text: string) => setMessage(text);

  const commitRename = async () => {
    if (!renaming) return;
    const layer = layers.layers.find((item) => item.id === renaming.id);
    setRenaming(null);
    if (!layer || !renaming.value.trim() || renaming.value.trim() === layer.name) return;
    await layers.renameLayer(layer.id, renaming.value);
    say(`已重命名为「${renaming.value.trim()}」`);
  };

  const reorder = async (layer: AnnotationLayer, direction: -1 | 1) => {
    const ids = layers.layers.map((item) => item.id);
    const index = ids.indexOf(layer.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await layers.reorderLayers(ids);
    say(`已${direction < 0 ? '上移' : '下移'}「${layer.name}」`);
  };

  const requestDelete = async (layer: AnnotationLayer, trigger: HTMLElement | null) => {
    const preview = await layers.previewDelete(layer.id);
    if (!preview) return;
    setDeleting({ layer, preview, trigger });
  };

  const moveWholeLayer = async () => {
    if (!moving || !moving.to || moving.from === moving.to) return;
    // Hidden layers are not in memory yet: showing the source loads its annotations first.
    if (!layers.isLayerVisible(moving.from)) await layers.setLayerVisible(moving.from, true);
    const ids = paper.annotations.filter((annotation) => annotation.layerId === moving.from).map((annotation) => annotation.id);
    const count = await layers.moveAnnotations(ids, moving.to);
    say(`已移动 ${count} 条标注到「${layers.layerName(moving.to)}」`);
    setMoving(null);
  };

  return (
    <section className="annotation-layer-manager" aria-label="图层管理" data-reader-layer="layer-manager">
      <header className="annotation-layer-manager-header">
        <h3>图层管理</h3>
        <button type="button" className="annotation-layer-icon-btn" onClick={onClose} aria-label="关闭图层管理，返回标注列表"><X size={16} aria-hidden="true" /></button>
      </header>
      <p className="annotation-layer-hint">活动图层接收新标注；可见图层同时显示；锁定后不能新增、修改或删除其中的标注。归档是安全的隐藏方式，随时可恢复。</p>
      <div className="annotation-layer-manager-actions">
        <button type="button" className="annotation-layer-action" onClick={() => void layers.createLayer({ kind: 'layer', activate: false, solo: false }).then((layer) => layer && say(`已新建图层「${layer.name}」`))}>新建空白图层</button>
        <button type="button" className="annotation-layer-action primary" onClick={() => void layers.createLayer({ kind: 'attempt', activate: true, solo: true }).then((layer) => layer && say(`已开始「${layer.name}」`))}>新建学习记录</button>
      </div>
      <ul className="annotation-layer-manager-list" aria-label="使用中的图层">
        {active.map((layer, index) => {
          const isActive = layer.id === activeId;
          const visible = layers.isLayerVisible(layer.id);
          return (
            <li key={layer.id} className={`annotation-layer-manager-row ${isActive ? 'active' : ''}`.trim()} data-layer-id={layer.id}>
              <div className="annotation-layer-manager-main">
                {renaming?.id === layer.id ? (
                  <input
                    className="annotation-layer-rename"
                    value={renaming.value}
                    autoFocus
                    aria-label={`图层名称：${layer.name}`}
                    onChange={(event) => setRenaming({ id: layer.id, value: event.target.value })}
                    onBlur={() => void commitRename()}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commitRename(); } if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); } }}
                  />
                ) : (
                  <button type="button" className="annotation-layer-manager-name" aria-pressed={isActive} title={isActive ? '当前活动图层' : '设为活动图层'} onClick={() => { if (!isActive) void layers.setActiveLayer(layer.id).then(() => say(`已将「${layer.name}」设为活动图层`)); }}>
                    <span className="annotation-layer-dot" aria-hidden="true" />
                    <span>{layer.name}</span>
                    {layer.kind === 'attempt' && <span className="annotation-layer-kind">学习记录</span>}
                    {layer.kind === 'default' && <span className="annotation-layer-kind">默认</span>}
                    {isActive && <span className="annotation-layer-kind active">活动</span>}
                  </button>
                )}
                <span className="annotation-layer-count" aria-label={`${layer.annotationCount} 条标注`}>{layer.annotationCount} 条</span>
              </div>
              <div className="annotation-layer-manager-controls" role="group" aria-label={`图层「${layer.name}」操作`}>
                <button type="button" className="annotation-layer-icon-btn" aria-label={`重命名图层「${layer.name}」`} title="重命名" onClick={() => setRenaming({ id: layer.id, value: layer.name })}><Pencil size={14} aria-hidden="true" /></button>
                <button type="button" className="annotation-layer-icon-btn" aria-pressed={visible} aria-label={visible ? `隐藏图层「${layer.name}」` : `显示图层「${layer.name}」`} title={isActive ? '活动图层必须保持可见' : visible ? '隐藏' : '显示'} disabled={isActive && visible} onClick={() => void layers.setLayerVisible(layer.id, !visible).then(() => say(`${visible ? '已隐藏' : '已显示'}「${layer.name}」`))}>
                  {visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                </button>
                <button type="button" className="annotation-layer-icon-btn" aria-pressed={layer.locked} aria-label={layer.locked ? `解锁图层「${layer.name}」` : `锁定图层「${layer.name}」`} title={layer.locked ? '解锁' : '锁定'} onClick={() => void layers.setLayerLocked(layer.id, !layer.locked).then(() => say(`${layer.locked ? '已解锁' : '已锁定'}「${layer.name}」`))}>
                  {layer.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
                </button>
                <button type="button" className="annotation-layer-icon-btn" aria-label={`上移图层「${layer.name}」`} title="上移" disabled={index === 0} onClick={() => void reorder(layer, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                <button type="button" className="annotation-layer-icon-btn" aria-label={`下移图层「${layer.name}」`} title="下移" disabled={index === active.length - 1} onClick={() => void reorder(layer, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                <button type="button" className="annotation-layer-icon-btn" aria-label={`归档图层「${layer.name}」`} title="归档（安全隐藏，可恢复）" disabled={active.length <= 1} onClick={() => void layers.setLayerArchived(layer.id, true).then(() => say(`已归档「${layer.name}」`))}><Archive size={14} aria-hidden="true" /></button>
                <button type="button" className="annotation-layer-icon-btn danger" aria-label={`删除图层「${layer.name}」`} title="永久删除…" disabled={active.length <= 1} onClick={(event) => void requestDelete(layer, event.currentTarget)}><Trash2 size={14} aria-hidden="true" /></button>
              </div>
            </li>
          );
        })}
      </ul>
      {layers.layers.length > 1 && (
        <div className="annotation-layer-move" role="group" aria-label="移动整层标注">
          <label>
            把图层
            <select value={moving?.from ?? ''} onChange={(event) => setMoving({ from: event.target.value, to: moving?.to ?? '' })} aria-label="来源图层">
              <option value="">选择来源</option>
              {layers.layers.filter((layer) => !layer.locked).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}（{layer.annotationCount}）</option>)}
            </select>
          </label>
          <label>
            的全部标注移到
            <select value={moving?.to ?? ''} onChange={(event) => setMoving({ from: moving?.from ?? '', to: event.target.value })} aria-label="目标图层">
              <option value="">选择目标</option>
              {active.filter((layer) => !layer.locked && layer.id !== moving?.from).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
            </select>
          </label>
          <button type="button" className="annotation-layer-action" disabled={!moving?.from || !moving?.to || layers.busy} onClick={() => void moveWholeLayer()}>移动</button>
        </div>
      )}
      {archived.length > 0 && (
        <ul className="annotation-layer-manager-list archived" aria-label="已归档的图层">
          {archived.map((layer) => (
            <li key={layer.id} className="annotation-layer-manager-row archived" data-layer-id={layer.id}>
              <div className="annotation-layer-manager-main">
                <span className="annotation-layer-manager-name muted"><Archive size={13} aria-hidden="true" /> {layer.name}</span>
                <span className="annotation-layer-count">{layer.annotationCount} 条</span>
              </div>
              <div className="annotation-layer-manager-controls">
                <button type="button" className="annotation-layer-icon-btn" aria-label={`恢复图层「${layer.name}」`} title="恢复" onClick={() => void layers.setLayerArchived(layer.id, false).then(() => say(`已恢复「${layer.name}」`))}><ArchiveRestore size={14} aria-hidden="true" /></button>
                <button type="button" className="annotation-layer-icon-btn danger" aria-label={`删除图层「${layer.name}」`} title="永久删除…" onClick={(event) => void requestDelete(layer, event.currentTarget)}><Trash2 size={14} aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="annotation-layer-status" role="status" aria-live="polite">{message ?? (layers.error ?? '')}</p>
      {deleting && (
        <DeleteLayerDialog
          layer={deleting.layer}
          preview={deleting.preview}
          busy={layers.busy}
          onCancel={() => { const trigger = deleting.trigger; setDeleting(null); trigger?.focus(); }}
          onConfirm={async (mode, target) => {
            const ok = await layers.deleteLayer(deleting.layer.id, mode, target);
            const trigger = deleting.trigger;
            setDeleting(null);
            if (ok) say(mode === 'move' ? `已删除「${deleting.layer.name}」，其标注已移到「${layers.layerName(target ?? '')}」` : `已永久删除「${deleting.layer.name}」及其标注`);
            trigger?.focus();
          }}
        />
      )}
    </section>
  );
}

function DeleteLayerDialog({ layer, preview, busy, onCancel, onConfirm }: { layer: AnnotationLayer; preview: AnnotationLayerDeletePreview; busy: boolean; onCancel: () => void; onConfirm: (mode: 'move' | 'purge', target?: string) => Promise<void> }) {
  const [mode, setMode] = useState<'move' | 'purge'>(preview.moveTargets.length ? 'move' : 'purge');
  const [target, setTarget] = useState(preview.moveTargets[0]?.id ?? '');
  const [armed, setArmed] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const canConfirm = preview.deletable && (mode === 'move' ? !!target : armed) && !busy;
  return (
    <div className="annotation-layer-dialog-backdrop" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}>
      <div className="annotation-layer-dialog" role="alertdialog" aria-modal="true" aria-labelledby="annotation-layer-dialog-title" aria-describedby="annotation-layer-dialog-body">
        <h4 id="annotation-layer-dialog-title">删除图层「{layer.name}」</h4>
        <div id="annotation-layer-dialog-body" className="annotation-layer-dialog-body">
          <p>该图层包含 <strong>{preview.annotationCount}</strong> 条标注{preview.referencingNoteCount > 0 ? <>，其中的标注被 <strong>{preview.referencingNoteCount}</strong> 篇笔记以 @annotation(id) 引用</> : null}。</p>
          {preview.reason && <p className="annotation-layer-warning" role="alert">{preview.reason}</p>}
          {preview.deletable && (
            <div className="annotation-layer-dialog-options" role="radiogroup" aria-label="标注处理方式">
              <label className={preview.moveTargets.length ? '' : 'disabled'}>
                <input type="radio" name="layer-delete-mode" value="move" checked={mode === 'move'} disabled={!preview.moveTargets.length} onChange={() => setMode('move')} />
                先把标注移到其他图层（保留标注、id 与笔记引用）
                {mode === 'move' && (
                  <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="接收标注的图层">
                    {preview.moveTargets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                  </select>
                )}
              </label>
              <label>
                <input type="radio" name="layer-delete-mode" value="purge" checked={mode === 'purge'} onChange={() => setMode('purge')} />
                连同 {preview.annotationCount} 条标注一起永久删除（笔记中的引用将失效）
                {mode === 'purge' && (
                  <label className="annotation-layer-arm">
                    <input type="checkbox" checked={armed} onChange={(event) => setArmed(event.target.checked)} /> 我确认永久删除，此操作不可撤销
                  </label>
                )}
              </label>
            </div>
          )}
        </div>
        <div className="annotation-layer-dialog-actions">
          <button ref={first} type="button" className="annotation-layer-action" onClick={onCancel}>取消</button>
          <button type="button" className="annotation-layer-action danger" disabled={!canConfirm} onClick={() => void onConfirm(mode, mode === 'move' ? target : undefined)}>
            {mode === 'move' ? '移动并删除图层' : '永久删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
