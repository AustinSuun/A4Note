# 阅读器笔记面板视觉与交互修订（3932f561）— arena 交付记录

- 任务：`3932f561-3433-4d23-94a7-8972fd40eb15`（high，spec 4）：边界把手样式、侧栏/悬浮卡进出动画重设计、悬浮卡布局与四角缩放、标题行对齐、文档下拉字号。由用户在对话中授权 arena 以 dispatcher 会话发布并由 arena worker 会话领取执行。
- 分支：`feat/reader-note-panel-polish-arena`（worktree `.worktrees/note-panel-polish-arena`），基线 main `fc6be92`；`4d6411d`（实现 + 回归）、`4d86f75`（下拉锚点）已 ff 合入本地 main，文档/状态提交见任务卡。
- 边界：未打包、未安装、未推送、未发布；未改笔记数据、保存语义、快捷键、命令 id、焦点顺序；未改 PDF 渲染/标注/图层/底部工具栏。

## 1. 现状与根因（dev:live `arena-polish`，main fc6be92）

| 用户反馈 | 运行时核实 |
| --- | --- |
| 把手难看 | 打开态 `.reader-note-edge-handle.active` 为 16×56 实心强调色胶囊 + 常显 chevron，骑在分隔条内侧 5px |
| 侧栏出现/回去"不像左侧栏" | 左侧工作台栏对 `grid-template-columns` 做 .24s 过渡；笔记侧栏则是 PDF 列瞬间重排、抽屉再做 28px 位移淡入（before 采样：轨道值恒为 534，`transforms` 28→0） |
| 悬浮卡弹出/收回 | 从卡片顶部中点 `scale(.96)` 长出（origin `533px 0px`），与把手位置无关；模式切换先淡出再淡入 |
| 顶部缝隙大 | 拖动握把 22px 高 + header `padding-top: 28px` |
| 悬浮态左缘"无意义的条" | `ReaderDrawerResizer` 在悬浮态仍渲染（10px 拖宽条 + 强调色握柄） |
| 工具栏适配 | `.markdown-authoring-dock` 沿用独立编辑器的 `left:50%; translateX(-50%); grid 11 列` 定位，不随卡片宽度换行 |
| 右下角缩放按钮 | 单个 20px `◢` 按钮，只能从右下角放大 |
| 已保存 | `.note-save-state` 10px 文字 + 图标常显 |
| 标题行 | `.note-history-shell { flex: 1 1 0 }` 令触发按钮撑满整行（宽 396px），chevron 远离标题 |
| 下拉字号 | 标题 13 / 计数 10 / 条目 12 / 摘要 10 / 时间 9 px；底部操作按钮无字号声明，继承编辑器 18px |

## 2. 实现

### 2.1 侧栏：网格轨道连续滑开/收回（`ReaderScene.tsx`、`reader-writing-layout.css`）
- `ReaderScene` 把 `--reader-side-width`（轨道）与 `--reader-side-target`（抽屉宽）分开：presence 为 hidden/entering/exiting 时轨道为 0，entered 后为目标宽；`.reader-workspace-shell.workspace-open` 对 `grid-template-columns` 做 220ms 过渡（`--motion-panel-duration` / ease-out，退场 ease-in），拖宽时（`data-note-resizing`）关闭过渡。
- 停靠抽屉改为 `width: var(--reader-side-target) !important; justify-self: start`，被外壳 `overflow: hidden` 裁切：轨道展开时抽屉左缘随轨道左移（从右缘滑入），内容不重排；PDF 列（`minmax(0,1fr)`）同步连续让位。
- 把手 `.reader-note-edge-entry` 的 `right` 改为 `calc(var(--reader-side-width) - 8px)` 并同参数过渡，随分隔线一起移动；`docked` 在退场期间保持为真。
- 写作态与窄窗覆盖态没有轨道：改为从右缘 56px 位移 + 透明度滑入；悬浮卡见 2.3。

### 2.2 可见态模式切换：FLIP 连续过渡（`useNoteLayoutFlip.ts`、`useNotePanelPresence.ts`、`noteEnterMotion.ts`）
- `useNotePanelPresence`：面板已在屏幕上时的模式切换不再回到 entering，直接 `entered`（新模式）。
- `useNoteLayoutFlip(containerRef, mode, visible, geometryKey)`：每次几何/模式提交后记录抽屉包围盒；模式变化时用 `flipTransform(first, last)`（平移 + 统一缩放，`transform-origin: 0 0`）把抽屉与悬浮控件层内联停在旧盒上一帧（`data-note-flip` 关闭过渡），下一帧释放，由共享的 transform 过渡（220ms）带到新盒。reduced-motion 直接到位。
- 覆盖：分屏 ⇄ 悬浮 ⇄ 写作、窄窗回退与恢复；不影响拖动/缩放（几何键变化不触发 FLIP）。

### 2.3 悬浮卡：从把手处弹出（`noteEnterMotion.ts`、`tokens.css`）
- `floatingPopOrigin(rect)` 把"外壳右缘、垂直中点"（把手所在）换算到卡片百分比空间（可超出 100%），弹出/收回都朝把手生长/缩回；令牌 `--motion-panel-pop-scale .96 → .88`、`--motion-panel-pop-lift 10px → 6px`，回弹缓动不变。

### 2.4 悬浮卡布局与四角缩放（`ReaderNoteFloatingControls.tsx`、CSS）
- 新组件 `ReaderNoteFloatingControls`：顶部握把（16px 高、top 2px）+ 四个 `.reader-note-floating-corner[data-corner]`（26px，位于卡角外侧 8px，用两侧 3px 边框 + 18px 圆角画出弧形；悬停/聚焦/拖动加深并放大 1.08）。`resizeFloatingRect(origin, corner, dx, dy)` 从任一角缩放、对角固定、最小 24%、不出工作区；键盘方向键 2%/5%；拖动用 pointer capture，触控可用。旧 `.reader-note-floating-resize` 移除。
- header `padding-top 28px → 14px`；悬浮态 `.note-save-state { display: none }`；`ReaderSideDrawer` 在 `noteMode === 'floating'` 时不渲染 `ReaderDrawerResizer`。
- 标题行：`.note-history-shell { flex: 0 1 auto; max-width: calc(100% - 96px) }`、触发按钮 `width: auto`、`.note-document-actions { margin-left: auto }`；下拉改为锚定触发按钮左缘（`4d86f75`）。
- 工具栏：悬浮态 `.markdown-authoring-dock { left/right/bottom: 10px; width: auto; transform: none }`，`.markdown-authoring-actions` 改 `flex-wrap` 居中换行 —— 纯 CSS 随卡片宽度变化，缩放后无需脚本即自适应；`.workspace-panel-content` 在悬浮态 `flex: 1 1 auto; min-width: 0`。

### 2.5 把手（CSS）
- 打开态：16×56 透明按钮（命中区经 `::after` 再外扩 8/6px），可见部分是 `::before` 中性握条（`scale(.5, .8)`，即 8×45），悬停/聚焦/拖宽时 `::before` 放大到全尺寸并变为 `--accent-soft`、chevron 淡入；无边框、无实心填充。收起态书签、写作态左缘返回把手不变。只过渡 transform/opacity/颜色。

### 2.6 文档下拉字号（`reader.css`）
- 标题/条目标题/底部操作按钮 `var(--ui-control-font-size)`（13px @100%），计数/时间 `var(--ui-caption-font-size)`（11px），摘要 12px；随 `--ui-zoom` 缩放。

## 3. 回归

- `scripts/verify-note-enter-motion-browser.mjs`（`npm run test:note-enter-motion-browser`，verify-all 已含）重写为 68 项：轨道首帧 0 / 抽屉定宽被裁切 / 220ms grid-template-columns 单条过渡 / 定点采样 0–220ms 轨道单调、PDF 列同步让位、抽屉宽度恒定；退场 ease-in 轨道收窄；浮卡首帧 `scale(.88)+6px`、origin 超出右缘；14px 握把区、无已保存/拖宽条/旧按钮、四角柄尺寸与光标、工具栏在卡内 flex 换行、最小卡片下换行不溢出；四角各拖一次（对角固定、不重放）+ 键盘缩放；拖动不重放；分屏⇄悬浮⇄写作 FLIP（首帧变换盒 = 旧盒、presence 保持 entered、`data-note-flip` 出现、仅 transform 过渡）；窄窗回退/恢复走 FLIP；reduced-motion 首帧到位无过渡。worktree 内三轮 68/68。夹具 `scripts/fixtures/note-enter-motion-host.tsx` 改用真实 `ReaderNoteFloatingControls` / `useNoteLayoutFlip` / 轨道变量 / 真实 header 与 Markdown dock 结构。
- 旧代码红测：在 `fc6be92` 上（夹具中两个新模块以 shim 顶替以便加载）23/42 后中止：令牌、轨道过渡、标题行、握把区、已保存/拖宽条、角柄、工具栏等全部失败。日志 `.tmp/arena-polish/proof-old.log`。
- `scripts/verify-note-workbench-browser.mjs`：缩放步骤改用 se 角柄，新增 nw 角柄对角固定、四角柄/无旧按钮/无左缘拖宽条、把手握条形态断言（94/94）；`scripts/verify-note-workbench.mjs` 新增 4 项静态守卫（65/65）；`scripts/fixtures/note-edge-host.tsx` 改用新控件。

## 4. 运行时证据（dev:live `arena-polish`，1461/CDP 9361，1800×1000，DEV 状态条；before = fc6be92，after = 4d86f75，另存 `after-4d6411d/`）

- 截图与 result.json：`.tmp/shots/note-panel-polish/{before,after}/`（各 35/38 张：00 基线、01 轨道滑开 + 90ms 中间帧、02 把手悬停、03 文档下拉、04 分屏→悬浮 + 70ms 中间帧、05 角柄悬停、06/07 右下/左上角缩放、08 小卡片、09 悬浮→分屏、10 收起 + 中间帧、11 快捷键弹出 + 中间帧、12 收回、13/14 窄窗/宽窗、matrix-{light,dark}-{100,125,150}-{split,floating,picker}）。before/after 均 0 pageerror、0 console error。
- 轨道滑开（after 10b 再次打开）：`entered` 后 260ms 窗口 16 帧、均值 16.66ms、最大 17.1ms，轨道 203→360→469→539→583→609→626→635→645，PDF 列同步 13 个值，抽屉宽度恒为 645，把手 left 1555→1401→1293→1224→1181→1154；收起（10）16 帧 16.66/16.8ms、轨道 638→357→…；首次打开（01）含一帧 117ms 冷启动布局（before 同样存在）。before 的同一场景轨道值恒为 534、只有抽屉自身 28px 位移。
- 90ms 中间帧：分屏打开轨道 595px/645，抽屉不透明、无自身变换；收起 495px。
- 分屏→悬浮（04）：`entered/floating` 直接翻转、`data-note-flip` 出现、仅 transform 过渡（卡片 + 控件层），首帧 `matrix(.6636, …, 1000, −64)` 覆盖旧侧栏盒，70ms 中间帧 `matrix(.939, …, 64, −12)`；15 帧 16.66/16.8ms。悬浮→分屏（09）`matrix(1.693, …, −475, 4)` 起步，把手 `right` 同步过渡。before：先 `entering` 淡出再淡入（`transforms .96→1`）。
- 快捷键弹出（11）：首帧 `matrix(.88,…,0,6)`，origin `1111.98px 439.7px`（卡宽 1092 → 101.8%，即把手方向）；before origin `512px 0px`（50% 0%）。
- 悬浮卡 chrome（after）：header 顶部 14px、握把 68×16 @ top 2px、`.note-save-state` display none、无拖宽条、无旧按钮、四角柄 nw/ne/sw/se 各 26px 光标 nwse/nesw；标题触发 90px 靠左（left 782.8）、按钮组右缘 1733（卡右缘 1744）；工具栏 flex 换行在卡内（972 宽卡 1 行；缩到 732/612 宽 → 2 行，`insideCard` true）。before：28px、22px 握把、已保存显示、拖宽条与旧按钮存在、触发按钮 396px 宽、工具栏 grid 2 行。
- 四角缩放（after）：se 拖 (+140,+90)：右下角随手、左上固定（左缘因 28px 安全条被 CSS 夹紧 20px）；nw 拖 (−120,−60)：左上随手、右下固定（1744/918.8 不变）。
- 文档下拉字号 after：标题 13 / 计数 11 / 条目 13 / 摘要 12 / 时间 11 / 操作 13 px（before 13/10/12/10/9/18）。
- 主题 × 缩放矩阵（a4note/midnight × 100/125/150%）：分屏把手 16×56（125% 20×70、150% 24×84）握条 `matrix(.5,0,0,.8,0,0)`；悬浮卡全部在外壳内、四角柄 4、已保存隐藏、无拖宽条、header 14px、工具栏在卡内（150% 时换成 2 行）、字号 13/13；无裁切、无焦点丢失（activeElement 均在面板内）。

## 5. 验证

- worktree：`npx tsc --noEmit` 0；`npm run build` 通过；`test:note-workbench` 65/65、`test:reader-note-sidebar` 16/16、`test:reader`、`test:reader-helpers`、`test:ui-state`、`test:architecture` 通过、`test:reader-note-sidebar-browser` 通过、`test:note-workbench-browser` 94/94、`test:note-enter-motion-browser` 68/68；`get_diagnostics` 0；完整 `npm run verify`（4d86f75）退出 0，5m13s，含 build、全部浏览器 harness、`cargo test` 215 passed / 0 failed / 5 ignored。
- `npm run test:agent-status` 通过（状态更新后）。

## 6. 限制与后续

- 分屏 ⇄ 悬浮 切换时 PDF 列仍是瞬时让位/复位（卡片本身 FLIP 连续），如需 PDF 列也连续可让浮卡切换先经轨道收回再弹出，本轮未做。
- 首次打开（冷启动，编辑器首次挂载）的第一帧仍有约 100ms 布局长帧，与 1f484418 记录一致。
- 悬浮卡右缘保留 28px 把手安全条，向右拖角柄到边界时 CSS 会把卡片整体左移以保持安全条，属既有约束。
- 主仓库根目录当前有其他 Agent 未提交的改动（`src/features/explorer/MarkdownLivePreviewEditor.tsx` 等），dev:live 截图运行于该工作树之上，与本任务文件无交集。
- dev:live 实例 `arena-polish`（1461/CDP 9361）交付时仍在运行，按规则未由 agent 结束，请用户验收后关闭。
