import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Eye, EyeOff, Layers, Plus, Trash2 } from 'lucide-react';
import type { AnnotationLayer, AnnotationLayerDeletePreview } from '../../core/types';
import { ReaderToolPopover } from './ReaderToolPopover';
import { useAnnotationLayersContext, type AnnotationLayersApi } from './useAnnotationLayers';
import './reader-annotation-layers.css';

/**
 * Compact layer entry that lives next to the annotation tools (fb5e3f2f): a stable stack icon plus
 * the visible/total count. It deliberately never renders the editable layer name (f6b927bb), so
 * renaming a layer to any length cannot resize this button or move its neighbours. The full active
 * name stays in the aria-label, the tooltip and the popover.
 */
export function AnnotationLayerPicker() {
  const layers = useAnnotationLayersContext();
  const [open, setOpen] = useState(false);
  if (!layers || !layers.state) return null;
  const usable = layers.layers.filter((layer) => !layer.archivedAt);
  const active = layers.activeLayer;
  const visibleCount = layers.visibleLayerIds.length;
  const blocked = layers.writeBlockedReason;
  return (
    <div className="annotation-tool-slot annotation-layer-slot">
      <button
        type="button"
        className={`annotation-tool-btn annotation-layer-btn ${open ? 'active' : ''} ${blocked ? 'blocked' : ''}`.trim()}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`标注图层：当前写入「${active?.name ?? '未选择'}」，显示 ${visibleCount}/${usable.length} 个图层${blocked ? `，${blocked}` : ''}`}
        title={blocked ?? `标注图层：${active?.name ?? '未选择'}（显示 ${visibleCount}/${usable.length}）`}
        data-active-layer={active?.id}
        data-visible-count={visibleCount}
        data-layer-total={usable.length}
      >
        <Layers aria-hidden="true" />
        <span className="annotation-layer-btn-count" aria-hidden="true">{visibleCount}/{usable.length}</span>
      </button>
      {open && (
        <ReaderToolPopover
          title="标注图层"
          onClose={() => setOpen(false)}
          headerAction={<button type="button" className="annotation-layer-action annotation-layer-action-primary" onClick={() => void layers.createLayer({ kind: 'layer', activate: true, solo: false })}><Plus size={14} aria-hidden="true" /> 新图层</button>}
        >
          <AnnotationLayerQuickPicker layers={layers} />
        </ReaderToolPopover>
      )}
    </div>
  );
}

function AnnotationLayerQuickPicker({ layers }: { layers: AnnotationLayersApi }) {
  const listRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirming, setConfirming] = useState<{ preview: AnnotationLayerDeletePreview; targetLayerId: string } | null>(null);
  const usable = layers.layers.filter((layer) => !layer.archivedAt);
  const activeId = layers.activeLayer?.id ?? null;
  const soleLayer = usable.length <= 1;
  useEffect(() => {
    // Keyboard users land on the active layer first.
    const target = listRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]') ?? listRef.current?.querySelector<HTMLButtonElement>('[role="radio"]');
    target?.focus();
  }, []);
  useEffect(() => {
    if (confirming) confirmRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming?.preview.layerId]);
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const radios = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    radios[(index + (event.key === 'ArrowDown' ? 1 : radios.length - 1)) % radios.length]?.focus();
  };
  const announce = (text: string) => setMessage(text);
  const commitRename = async () => {
    if (!renaming) return;
    const layer = usable.find((item) => item.id === renaming.id);
    const name = renaming.value.trim();
    setRenaming(null);
    if (!layer || !name || name === layer.name) return;
    await layers.renameLayer(layer.id, name);
    announce(`已重命名为「${name}」`);
  };
  const restoreListFocus = () => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true }));
  };
  const closeConfirm = (layerId?: string) => {
    const target = layerId ?? confirming?.preview.layerId ?? '';
    setConfirming(null);
    requestAnimationFrame(() => deleteRefs.current.get(target)?.focus({ preventScroll: true }));
  };
  /** A removed layer hands the active state to its nearest neighbour, not to an arbitrary row. */
  const neighbourOf = (layerId: string) => {
    const index = usable.findIndex((layer) => layer.id === layerId);
    if (index < 0) return null;
    return usable[index + 1] ?? usable[index - 1] ?? null;
  };
  const performDelete = async (layer: AnnotationLayer, mode: 'move' | 'purge', targetLayerId?: string) => {
    const neighbour = neighbourOf(layer.id);
    const wasActive = layer.id === activeId;
    const done = await layers.deleteLayer(layer.id, mode, targetLayerId);
    setConfirming(null);
    if (!done) {
      announce(`删除图层「${layer.name}」失败，请重试`);
      restoreListFocus();
      return;
    }
    if (wasActive && neighbour) {
      await layers.setActiveLayer(neighbour.id);
      announce(`已删除「${layer.name}」，已切换到「${neighbour.name}」`);
    } else {
      announce(`已删除图层「${layer.name}」`);
    }
    restoreListFocus();
  };
  const askDelete = async (layer: AnnotationLayer) => {
    const preview = await layers.previewDelete(layer.id);
    if (!preview) {
      announce('无法读取该图层的删除影响，请重试');
      return;
    }
    if (!preview.deletable) {
      announce(preview.reason ?? `图层「${layer.name}」不能删除`);
      return;
    }
    if (preview.annotationCount > 0 || preview.referencingNoteCount > 0) {
      setConfirming({ preview, targetLayerId: preview.moveTargets[0]?.id ?? '' });
      return;
    }
    await performDelete(layer, 'purge');
  };
  const confirmedLayer = confirming ? usable.find((layer) => layer.id === confirming.preview.layerId) ?? null : null;
  return (
    <div className="annotation-layer-picker" data-reader-layer="layer-picker">
      {layers.writeBlockedReason && <p className="annotation-layer-warning" role="alert">{layers.writeBlockedReason}</p>}
      {confirming && (
        <div
          ref={confirmRef}
          className="annotation-layer-confirm"
          role="alertdialog"
          aria-label={`删除图层「${confirming.preview.name}」`}
          data-layer-confirm={confirming.preview.layerId}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeConfirm(); } }}
        >
          <p className="annotation-layer-confirm-text">
            「{confirming.preview.name}」包含 {confirming.preview.annotationCount} 条标注
            {confirming.preview.referencingNoteCount > 0 ? `（${confirming.preview.referencingNoteCount} 处被笔记引用）` : ''}
            ，请先移动到其它图层或确认永久删除。
          </p>
          {confirming.preview.moveTargets.length > 0 && (
            <div className="annotation-layer-confirm-row">
              <label className="annotation-layer-confirm-label" htmlFor="annotation-layer-delete-target">移动标注到</label>
              <select
                id="annotation-layer-delete-target"
                className="annotation-layer-confirm-select"
                aria-label="接收标注的目标图层"
                value={confirming.targetLayerId}
                onChange={(event) => setConfirming({ ...confirming, targetLayerId: event.target.value })}
              >
                {confirming.preview.moveTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
              <button
                type="button"
                data-layer-confirm-move
                className="annotation-layer-action annotation-layer-action-primary"
                disabled={!confirming.targetLayerId || !confirmedLayer}
                onClick={() => { if (confirmedLayer) void performDelete(confirmedLayer, 'move', confirming.targetLayerId); }}
              >
                移动并删除
              </button>
            </div>
          )}
          <div className="annotation-layer-confirm-row">
            <button
              type="button"
              data-layer-confirm-purge
              className="annotation-layer-action annotation-layer-action-danger"
              disabled={!confirmedLayer}
              onClick={() => { if (confirmedLayer) void performDelete(confirmedLayer, 'purge'); }}
            >
              连同标注删除
            </button>
            <button type="button" className="annotation-layer-action" data-layer-confirm-cancel onClick={() => closeConfirm()}>取消</button>
          </div>
        </div>
      )}
      <div ref={listRef} className="annotation-layer-list" role="radiogroup" aria-label="活动图层（新标注写入的图层）" onKeyDown={moveFocus}>
        {usable.map((layer) => {
          const isActive = layer.id === activeId;
          const visible = layers.isLayerVisible(layer.id);
          return (
            <div key={layer.id} className={`annotation-layer-row ${isActive ? 'active' : ''} ${visible ? '' : 'hidden-layer'}`.trim()} data-layer-id={layer.id} data-layer-count={layer.annotationCount}>
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
                <button
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className="annotation-layer-select"
                  title={`${layer.name}${isActive ? '（当前活动图层）' : ''} · 双击名称可重命名`}
                  onClick={() => { if (!isActive) void layers.setActiveLayer(layer.id).then(() => announce(`已将「${layer.name}」设为活动图层`)); }}
                >
                  <span className="annotation-layer-name" title={layer.name} onDoubleClick={(event) => { event.stopPropagation(); setRenaming({ id: layer.id, value: layer.name }); }}>{layer.name}</span>
                </button>
              )}
              <button
                type="button"
                className="annotation-layer-icon-btn"
                aria-pressed={visible}
                aria-label={visible ? `隐藏图层「${layer.name}」` : `显示图层「${layer.name}」`}
                title={isActive ? '活动图层必须保持可见' : visible ? '隐藏' : '显示'}
                disabled={isActive && visible}
                onClick={() => void layers.setLayerVisible(layer.id, !visible).then(() => announce(`${visible ? '已隐藏' : '已显示'}「${layer.name}」`))}
              >
                {visible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
              </button>
              <button
                type="button"
                ref={(node) => { if (node) deleteRefs.current.set(layer.id, node); else deleteRefs.current.delete(layer.id); }}
                className="annotation-layer-icon-btn annotation-layer-delete"
                aria-label={`删除图层「${layer.name}」`}
                title={soleLayer ? '唯一图层不能删除' : `删除图层「${layer.name}」`}
                disabled={soleLayer}
                onClick={() => void askDelete(layer)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <p className="annotation-layer-status" role="status" aria-live="polite">{message ?? ''}</p>
    </div>
  );
}
