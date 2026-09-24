# 文献库列表：列设置弹层错位修复与顶部详情图标移除（ae98615a）— arena 交付记录

- 任务：`ae98615a-9a4f-4aab-854a-c5546a1d6185`（spec 2）。用户 854×392 截图里「列设置」弹层出现在按钮左侧数百像素处，并要求移除「N 条结果」旁的独立详情图标。
- 分支：`fix/library-column-settings-arena`（worktree `.worktrees/library-polish-arena`），基线 main `cd6329c`；交付与合并 SHA 见任务卡。

## 根因（真实 DOM 量测，dev:live `arena-library`）

`ColumnSettings` 把 `trigger/panel.getBoundingClientRect()` 与 `window.innerWidth/innerHeight` 直接写进 body portal 上 `position: fixed` 面板的 `left/top`。应用的 UI 缩放是给 `document.documentElement` 设 CSS `zoom`（`src/ui/App.tsx`）：在 zoom ≠ 1 时 `getBoundingClientRect()`、`innerWidth` 是视口像素，而 fixed 元素的 `left/top` 按缩放后的 CSS 像素解释，渲染位置 = 写入值 × zoom。量测：zoom 80% 时 `style.left 1091px` → 面板实际 `left 873`（按钮 `left 1209`，向左偏约 300px，即用户截图）；zoom 125% 时 `style.left 917.8px` → 实际 `1147`（向右偏出）；zoom 100% 与 854×392 窗口本身正确。不是 margin、滚动容器或 ResizeObserver 时序问题。

## 改动

- `src/features/library/portalPlacement.ts`（新增）：`viewportScale(element)`（元素视口矩形宽 ÷ `offsetWidth`，得到任何祖先 zoom/transform 的有效缩放）、`anchoredPlacement(trigger, panel, viewport)`（右对齐、紧贴按钮下方 4px、下方不足时贴上方、左右仅在越界时钳制 8px）、`pointPlacement(point, panel, viewport)`（指针锚点、下方溢出上翻、钳制）、`toCssPixels(placement, scale)`（视口像素 → fixed 需要的 CSS 像素）。全部以视口像素计算，最后统一换算一次。
- `src/features/library/ColumnSettings.tsx`：`place()` 改用 `toCssPixels(anchoredPlacement(...), viewportScale(panel))`；列表与综览两个视图共用，无 UI 差异；开合/Esc 焦点归还/点外关闭/滚动关闭/ResizeObserver 不变，不改列显隐持久化与固定标题。
- `src/features/library/PaperContextMenu.tsx`：同一缺陷（右键菜单 `anchor.x/y` 也是视口像素）改用 `pointPlacement` + `toCssPixels`，zoom 100% 下数值与旧算法完全一致（`test:library-context-menu-browser` 22/22 不变）。
- `src/features/library/LibraryScene.tsx`：删除命令栏「N 条结果」右侧的独立详情图标按钮（`library-icon-button` + `LibraryIcon details`，`onDetailOpenChange` 开关）。「列设置」、搜索、结果数、「从 PDF 导入」与列表/综览/笔记切换保持；行末「…」与右键菜单的「详情」仍调用 `onDetailOpenChange(true)` 打开详情面板，面板关闭按钮保留；`.library-icon-button` 样式仍由行末「…」使用。
- `scripts/verify-ui-state.mjs`：补两条源码契约（命令栏不再有 `LibraryIcon name="details"`、行菜单仍接 `onDetailOpenChange(true)`；`ColumnSettings` 使用 `toCssPixels(anchoredPlacement(`）。

## 回归

- 新增 `scripts/verify-library-column-settings-browser.mjs` + `scripts/fixtures/library-column-settings-host.tsx`（`npm run test:library-column-settings-browser`，已入 `verify-all`）：21 项——纯函数（下方/上方/左钳制/像素换算/指针锚点）、真实 DOM 在 UI 缩放 100/125/80% 下面板右对齐紧贴按钮下方且在窗口内、打开后焦点进入面板、854×392 窗口无横向空档、底部空间不足时贴上方、标题固定禁用、勾选/取消上报 `onChange(id, visible)` 且面板保持、Esc 归还焦点并 `aria-expanded=false`、点外关闭、再点触发关闭、无 pageerror。
- 旧代码红测：换回 main 的 `ColumnSettings.tsx` 后 19/21，失败项正是 125% 与 80% 的对齐断言。
- `test:library-context-menu-browser` 22/22、`test:ui-state`、`npx tsc --noEmit` 0、`npm run build`、`test:architecture`、`test:agent-status` 通过。

## dev:live 证据（`arena-library`，1469 / CDP 9369，含 DEV 状态条，pageerror/console 0）

`.tmp/shots/library-column-settings/{before,after}/`：`00-commandbar`（before 有详情图标，after 无）、`01-window-854x392-zoom80`（before：按钮 right 483、面板 left 243/right 422，偏左约 180px 视口像素；after：面板 right 731 = 按钮 right，top = 按钮 bottom+4）、`01-window-854x392-zoom100`、`01-desktop-zoom125`（before 面板 right 1072 > 按钮 right 914 偏右；after 对齐）、`01-desktop-zoom100`、`02-dark-zoom100`、`03-overview-column-settings`（综览视图共用组件同样对齐）、`04-details-from-row-menu`（行末「…」→「详情」仍打开详情面板，`detail-open` 为真）+ `result.json` 内每一步的按钮/面板矩形。

## 边界

未打包/推送/发布；不改论文数据、列显隐 localStorage、排序与固定标题；总览字段管理任务 7603aaaf 未受影响（仅定位逻辑）；dev:live 实例 `arena-library` 交付时仍在运行。
