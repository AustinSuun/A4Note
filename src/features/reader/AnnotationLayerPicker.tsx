import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Eye, EyeOff, Layers, Lock, LockOpen, Plus, Settings2, Sparkles } from 'lucide-react';
import { useReaderContext } from './ReaderContext';
import { ReaderToolPopover } from './ReaderToolPopover';
import { useAnnotationLayersContext, type AnnotationLayersApi } from './useAnnotationLayers';
import './reader-annotation-layers.css';

/**
 * Compact layer entry that lives next to the annotation tools (fb5e3f2f): shows the active
 * (writing) layer and how many layers are visible, and opens the quick picker. Rendered inside a
 * `.annotation-tool-slot` so the popover anchors like the tool settings do.
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
      >
        <Layers aria-hidden="true" />
        <span className="annotation-layer-btn-name">{active?.name ?? '图层'}</span>
        <span className="annotation-layer-btn-count" aria-hidden="true">{visibleCount}/{usable.length}</span>
      </button>
      {open && (
        <ReaderToolPopover title="标注图层" onClose={() => setOpen(false)}>
          <AnnotationLayerQuickPicker layers={layers} onClose={() => setOpen(false)} />
        </ReaderToolPopover>
      )}
    </div>
  );
}

function AnnotationLayerQuickPicker({ layers, onClose }: { layers: AnnotationLayersApi; onClose: () => void }) {
  const reader = useReaderContext();
  const listRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const usable = layers.layers.filter((layer) => !layer.archivedAt);
  const activeId = layers.activeLayer?.id ?? null;
  useEffect(() => {
    // Keyboard users land on the active layer first.
    const target = listRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]') ?? listRef.current?.querySelector<HTMLButtonElement>('[role="radio"]');
    target?.focus();
  }, []);
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const radios = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    radios[(index + (event.key === 'ArrowDown' ? 1 : radios.length - 1)) % radios.length]?.focus();
  };
  const announce = (text: string) => setMessage(text);
  const openManager = () => {
    layers.setManagerOpen(true);
    reader.setSidePanelTab('annotations');
    reader.setSidePanelOpen(true);
    onClose();
  };
  return (
    <div className="annotation-layer-picker" data-reader-layer="layer-picker">
      {layers.writeBlockedReason && <p className="annotation-layer-warning" role="alert">{layers.writeBlockedReason}</p>}
      <div ref={listRef} className="annotation-layer-list" role="radiogroup" aria-label="活动图层（新标注写入的图层）" onKeyDown={moveFocus}>
        {usable.map((layer) => {
          const isActive = layer.id === activeId;
          const visible = layers.isLayerVisible(layer.id);
          return (
            <div key={layer.id} className={`annotation-layer-row ${isActive ? 'active' : ''} ${visible ? '' : 'hidden-layer'}`.trim()} data-layer-id={layer.id}>
              <button
                type="button"
                role="radio"
                aria-checked={isActive}
                className="annotation-layer-select"
                onClick={() => { if (!isActive) void layers.setActiveLayer(layer.id).then(() => announce(`已将「${layer.name}」设为活动图层`)); }}
                title={isActive ? '当前活动图层' : `设为活动图层：${layer.name}`}
              >
                <span className="annotation-layer-dot" aria-hidden="true" />
                <span className="annotation-layer-name">{layer.name}</span>
                {layer.kind === 'attempt' && <span className="annotation-layer-kind">学习记录</span>}
                <span className="annotation-layer-count" aria-label={`${layer.annotationCount} 条标注`}>{layer.annotationCount}</span>
              </button>
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
                className="annotation-layer-icon-btn"
                aria-pressed={layer.locked}
                aria-label={layer.locked ? `解锁图层「${layer.name}」` : `锁定图层「${layer.name}」（禁止新增、编辑和删除）`}
                title={layer.locked ? '已锁定：点击解锁' : '锁定'}
                onClick={() => void layers.setLayerLocked(layer.id, !layer.locked).then(() => announce(`${layer.locked ? '已解锁' : '已锁定'}「${layer.name}」`))}
              >
                {layer.locked ? <Lock size={15} aria-hidden="true" /> : <LockOpen size={15} aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="annotation-layer-actions">
        <button type="button" className="annotation-layer-action" onClick={() => void layers.createLayer({ kind: 'layer', activate: true, solo: false }).then((layer) => layer && announce(`已新建图层「${layer.name}」`))}>
          <Plus size={14} aria-hidden="true" /> 新建空白图层
        </button>
        <button type="button" className="annotation-layer-action primary" onClick={() => void layers.createLayer({ kind: 'attempt', activate: true, solo: true }).then((layer) => layer && announce(`已开始「${layer.name}」，只显示新图层`))} title="新建一次学习记录：空白图层设为活动层，并暂时隐藏其他图层">
          <Sparkles size={14} aria-hidden="true" /> 新建学习记录
        </button>
        <button type="button" className="annotation-layer-action" onClick={openManager}>
          <Settings2 size={14} aria-hidden="true" /> 管理图层…
        </button>
      </div>
      <p className="annotation-layer-status" role="status" aria-live="polite">{message ?? ''}</p>
    </div>
  );
}
