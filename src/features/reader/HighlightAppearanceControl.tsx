import { useHighlightAppearance } from './pdf/useHighlightAppearance';
import { MAX_HIGHLIGHT_OPACITY, MIN_HIGHLIGHT_OPACITY } from './pdf/pdfHighlightAppearance';

export function HighlightAppearanceControl() {
  const { appearance, setAppearance, storageFailed } = useHighlightAppearance();
  return <div className="tool-option-block highlight-appearance-control">
    <label>高亮不透明度 <output>{appearance.opacity}%</output>
      <input type="range" aria-label="高亮不透明度" min={MIN_HIGHLIGHT_OPACITY} max={MAX_HIGHLIGHT_OPACITY} step={1} value={appearance.opacity}
        onChange={event => setAppearance({ ...appearance, opacity: Number(event.target.value) })} />
    </label>
    <small>数值越小越淡；应用于当前应用配置中的所有新旧高亮，仅改变显示，不修改标注内容。</small>
    <label>文字对比方式
      <select aria-label="高亮混合方式" value={appearance.blend}
        onChange={event => setAppearance({ ...appearance, blend: event.target.value === 'normal' ? 'normal' : 'multiply' })}>
        <option value="multiply">增强文字对比（正片叠底）</option>
        <option value="normal">普通透明叠加（兼容模式）</option>
      </select>
    </label>
    <small>重叠区域显示上层标注颜色，不累加深度；各条标注仍独立保留。</small>
    {storageFailed && <small role="status">显示设置暂未保存，当前窗口内有效。</small>}
  </div>;
}
