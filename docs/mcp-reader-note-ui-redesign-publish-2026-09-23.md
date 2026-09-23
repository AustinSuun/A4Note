# 阅读器笔记界面重构任务发布报告 (2026-09-23)

## 1. 发布概况
- **Task ID**: `d6254b8f-479f-4e77-8f5d-3a216854b70b`
- **任务标题**: 阅读器笔记界面重构：简洁顶部拖动横条、侧栏收起手柄视觉/光标优化与三种模式进退场动画
- **发布角色**: Dispatcher Agent (`ArenaDispatcher`)
- **任务状态**: `queued` (已进入队列，等待执行 Agent 授权领取)
- **优先级**: `high`
- **Revision**: 4

## 2. 需求要点整理
1. **拖动手柄（Drag Handle）重构**:
   - 将悬浮笔记顶部文字/图标样式的拖动手柄，重构为顶部居中的简洁横条按钮（类似移动端 Bottom Sheet / 小屏面板顶部的拖拽 Pill 胶囊条）。
   - 保证面板拖拽功能正常且触摸/鼠标触感自然。
2. **侧栏收起手柄（Edge Handle）与光标修复**:
   - 优化侧栏收起手柄的视觉外观，使其更精致。
   - 修复“边读边记”模式下鼠标悬停手柄时异常显示为双向/滑动箭头光标的问题，矫正为正确的 `pointer` / 专属手柄光标。
3. **三种模式（侧栏、抽屉、悬浮）进退场动画**:
   - 侧栏 / 抽屉模式：实现抽屉滑动进出效果（Slide-in / Slide-out）。
   - 悬浮模式：实现展开缩回、弹出与缩回动画（Pop-in / Scale-out + Fade）。
   - 仅使用 `transform` 与 `opacity` 合成器属性，保证 60fps，并支持 `prefers-reduced-motion` 降级。

## 3. 关联附件 (`reference`)
- `note-drag-handle-ref-1.png` (ID: `d9325b3c-2593-497d-a1fa-c05d1a8403ec`): 悬浮笔记顶部拖动按钮与文档操作菜单参考图。
- `note-drag-handle-ref-2.png` (ID: `93d2284b-cdff-49e3-bc62-e28ad0c6a5b1`): 悬浮笔记顶部拖动区域与简洁横条设计目标特写。
- `note-edge-handle-ref-3.png` (ID: `67bd0952-2747-4ac8-9098-73f69abf6110`): 侧栏收起手柄位置与光标问题参考图。
