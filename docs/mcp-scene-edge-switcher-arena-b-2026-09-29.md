# 左缘悬停场景切换器（arena-b，2026-09-29）

任务：`80263463-ac0f-48ac-962a-9b46b45e3738`（spec_revision 2）
分支：`feat/scene-edge-arena-b`（worktree `.worktrees/scene-edge-arena-b`）

## 结论

内容区左缘新增一条低干扰细把手与 8px 热区。停留 150ms 后弹出场景面板，面板列出与侧栏同源的分组场景（科研阅读 / 工作区 / 自定义）并高亮当前场景；点选后调用现有 `onOpenScene`（即 `setScene`）并收起。快速划过、文件拖拽、侧栏拖宽、阅读器笔记把手、PDF 拖选和窗口左缘缩放都不会误触发。动画只用 transform + opacity；dev:live 下 10 次进出的 trace 为 0 长任务、0 掉帧。设置项「左缘场景切换」默认开启，通过 `usePersistedUiState` 持久化。

## 改动范围

| 文件 | 内容 |
|---|---|
| `src/workbench/sceneEdgeSwitcherModel.ts`（新） | 纯函数状态机 `reduceSceneEdge`、安全三角 `isOnSafePath`、面板定位 `placeSceneEdgePanel`、动效契约 `sceneEdgeMotion`、让位选择器 `SCENE_EDGE_YIELD_SELECTOR` |
| `src/workbench/SceneEdgeSwitcher.tsx`（新） | 组件：指针 / 键盘 / 触控接线、计时器、焦点管理、快捷键徽标 |
| `src/workbench/scene-edge-switcher.css`（新） | 把手、面板、过渡与 reduced-motion 分支 |
| `src/workbench/sceneGroups.ts`（新） | `groupSidebarScenes`，侧栏场景列表与边缘面板共用的唯一分组来源 |
| `src/workbench/ProjectSidebar.tsx` | 改用 `groupSidebarScenes`，行为不变 |
| `src/workbench/WorkbenchShell.tsx` | 新增 `edgeSwitcher` 插槽，挂在内容区 |
| `src/ui/App.tsx` | `edgeSwitcher={<SceneEdgeSwitcher scenes={sidebarScenes} activeSceneId={activeScene} onOpenScene={setScene} />}`，没有 `if (scene === …)` 分支 |
| `src/shared/hooks/usePersistedUiState.ts` | 新字段 `sceneEdgeSwitcher`（默认 true；只有显式 false 才关闭） |
| `src/features/settings/*` | 外观页开关 `setting-scene-edge-switcher` 与设置目录条目 |
| `src/ui/zh.ts` | 文案 |
| `scripts/verify-scene-edge-switcher.mjs`（新） | 单元回归 |
| `scripts/verify-scene-edge-switcher-browser.mjs`、`scripts/fixtures/scene-edge-host.tsx`（新） | Playwright 回归 |
| `package.json`、`scripts/verify-all.mjs` | 注册 `test:scene-edge-switcher`、`test:scene-edge-switcher-browser` |

场景数据只有一个来源：面板直接使用 App 传给侧栏的 `sidebarScenes`，插件场景会自动出现，没有第二份列表。

## 时序参数

| 参数 | 值 | spec 范围 |
|---|---|---|
| 热区宽度 `SCENE_EDGE_HOT_ZONE_PX` | 8 layout px（随界面缩放：118% 时 9.4 viewport px） | 6–10px |
| 打开停留 `SCENE_EDGE_OPEN_DELAY_MS` | 150ms | 120–180ms |
| 离开宽限 `SCENE_EDGE_CLOSE_GRACE_MS` | 240ms | 200–300ms |
| 安全路径宽限 `SCENE_EDGE_SAFE_PATH_GRACE_MS` | 480ms | 大于离开宽限 |
| 面板距窗口左缘 | 12 layout px | — |
| 面板上下留白 | 8 layout px；面板超高时顶端对齐并滚动（`maxHeight`） | — |
| 进入动画 | 200ms，`var(--motion-panel-ease-out)` | 180–220ms |
| 退出动画 | 140ms，`var(--motion-panel-ease-in)` | 120–160ms |
| 条目级联 | 0ms（整块面板作为一个合成层移动；逐行动画会让面板每帧重绘） | ≤30ms，总计 ≤260ms |
| reduced-motion | 只淡入淡出：进入 160ms、退出 120ms，linear，`transform: none` | 只淡入淡出 |

缓动使用现有的面板 token（`tokens.css` 中的 `--motion-panel-ease-out` / `--motion-panel-ease-in`），没有新增 token。

## 状态机

相位：`closed → pending → open ⇄ leaving → closed`；打开来源 `source ∈ hover | press | keyboard`。

- **closed**：只有「指针在热区内、没有按键按下、不是 touch/pen 悬停」时才进入 pending，并安排 open 计时器。
- **pending**：在热区内移动只更新锚点；离开热区或按下按键即取消（这就是「快速划过不打开」）。open 计时器到点才进入 open。
- **open（hover）**：指针离开面板和热区后进入 leaving，安排 close 计时器；回到面板或热区即取消。
- **press / keyboard 打开**：不随指针离开而关闭，只由外部点击、Esc、选中场景或再次激活关闭。
- 悬停打开后在把手上点击会把面板「钉住」（source 变为 press），不会把它切换关闭。
- touch / pen：悬停永不触发；点按把手切换开合。
- 设置关闭：直接进入 closed，之后忽略一切事件；重新开启时从初始状态开始。

## 安全三角算法

目的是让指针从左缘斜着移向面板时，路过面板外的空白也不会触发关闭。

1. 指针在热区或面板内时，记录最后一个点作为三角形顶点 `apex`。
2. 指针离开后，若当前点落在由 `apex`、面板左上角、面板左下角构成的三角形内（重心坐标同号判定，边上算在内），并且 `apex.x ≤ x ≤ panel.left`，就视为「正在前往面板」：close 计时器用 480ms。
3. 在 leaving 期间一旦离开三角形，就取消 480ms 计时器并改用正常的 240ms。
4. `apex` 已在面板左缘右侧（即指针来自面板而不是来自左缘）时不启用安全路径。

对应单测：斜向进入走长宽限；在面板上方或越过面板都不算；离开三角形退回正常宽限；到达面板保持打开。

## 让位规则

| 冲突对象 | 规则 | 证据 |
|---|---|---|
| 侧栏拖宽把手 `.workbench-sidebar-resizer` | 位于 `SCENE_EDGE_YIELD_SELECTOR`；拖动时 `body.is-horizontal-resizing` 使指针被判为 outside；拖动结束派发 `workbench-resize-end` 后压制 400ms；按键按下期间不武装 | dev:live：把手拖到左缘，面板未打开，宽度 300→300；浏览器回归同项 |
| 文件拖拽 | `dragenter` / `dragover` 触发 suppress，关闭并压制 400ms；按键按下时不武装 | dev:live：文件树行拖过左缘，面板未打开；浏览器回归同项 |
| 阅读器笔记把手 `.reader-note-edge-handle` / `.reader-note-edge-entry` | 位于让位选择器；指针下的元素命中选择器时判为 outside。常规模式下该把手在右缘（x=1222），与左缘无交集 | dev:live：悬停、连续点击两次，面板均未打开；浏览器回归中把把手放到左缘验证让位 |
| 专注写作 | 写作模式（`note-mode-writing`，需侧栏收起以留出宽度）下，笔记把手移到阅读区左侧 x=28–56，与 8px 热区（x=0–8）相隔 20px；即使在更高缩放下重叠，让位选择器也会让出。热区其余位置照常可用 | dev:live `focus-writing-check.json`：在写作把手上停留未打开，点击把手正常切回阅读模式；远离把手处停留正常打开 |
| PDF 文字拖选 | 按键按下时不武装；pending 中按下按键立即取消 | dev:live：在真实 PDF 页面上拖选到左缘，面板未打开 |
| 窗口左缘缩放 | 指针离开 webview（`mouseout` 且 `relatedTarget === null`）时：pending 立即取消；hover 打开的面板进入 240ms 宽限 | dev:live：CDP 把指针移到 x=-3，pending 被取消 |
| 对话框 / 右键菜单 | `[role=dialog]`、`[role=alertdialog]`、文件树与编辑器右键菜单在让位选择器中；有模态框打开时 closed 状态不武装 | 单测检查组件使用 `hit.closest(SCENE_EDGE_YIELD_SELECTOR)` |
| 窗口失焦 | `blur` 触发 suppress | — |

## 不阻挡内容区

- 根容器 `.scene-edge` 是 0×0 的 fixed 元素；面板关闭时 `pointer-events: none`，只有打开时（`[data-open]`）才接收指针。除了 8×64 的把手和打开时的面板本体，内容区的滚轮与点击都不受影响。
- 外部点击：`pointerdown` 捕获监听只读取目标，不调用 `preventDefault` / `stopPropagation`（单测检查源码）。面板关闭，同一次点击照常到达目标。
- dev:live 实测：面板打开时在 PDF 上滚轮，`pdf-document` 的 scrollTop 0→360，面板保持打开；键盘打开面板后点击 PDF，面板关闭，window click 监听依次看到 `scene-edge`（Enter 在把手上产生的点击）和 `content`。
- 侧栏展开时，面板以 z-index 45 覆盖在侧栏上方（见截图 after-22、after-23、after-26）。

## 共存与快捷键

- 保留侧栏场景列表与「返回场景」入口，两者与面板调用同一个 `setScene`。
- 场景条目显示已有场景命令 `scene.<id>` 的绑定（例如 总览 Ctrl 1、文献库 Ctrl 2、阅读 Ctrl 3、笔记 Ctrl 5），读取自 `useShortcuts().bindings`，没有新增命令 ID。
- 设置：外观 → 左缘场景切换（`setting-scene-edge-switcher`），默认开启，存入 `usePersistedUiState.sceneEdgeSwitcher`。截图 after-12 / after-13 为开 / 关状态。

## 键盘

把手可聚焦（`button`，`aria-expanded` / `aria-controls`）。Enter / Space 打开并聚焦当前场景；↑ / ↓ 移动（循环），Home / End 跳到首尾；Enter 切换场景、关闭并把焦点还给把手；Esc 关闭并还焦点；在面板内按 Tab 也会关闭。把手上按 → / ↓ 也会打开。

## 布局与缩放

面板位置用 `ae61143f` 的坐标工具（`shared/ui/viewportToLayout.ts`）换算：命中测试使用 viewport px 并乘以根缩放，定位输出 layout px，所以不会出现缩放偏移。

| 截图 | 条件 | 面板 viewport 坐标 |
|---|---|---|
| after-23 | 浅色，侧栏展开，100% | x 12，宽 244 |
| after-24 | 浅色，侧栏收起 | x 12，宽 244 |
| after-25 | 深色（深夜专注），侧栏收起 | x 12，宽 244 |
| after-26 | 深色，侧栏展开 | x 12，宽 244 |
| after-27 | 浅色，118% | x 14.2（=12×1.18），宽 287.9（=244×1.18）；把手 9.4px（=8×1.18） |
| after-28 | 浅色，1000px 宽（侧栏自动改为覆盖模式） | x 12，宽 244 |

六张截图的计算样式 `transition-property` 都是 `transform, opacity`，console / pageerror 均为 0（`layout-shots.json`）。更早的 after-06（118%）、after-07（150%）、after-10（1000px）为同一实现在总览页的补充截图。

## 动画与性能（dev:live，CDP trace）

环境：1280×820，dpr 1.25，缩放 100%，侧栏展开，显示器 60Hz。每组 10 次进出。

| 指标 | 默认 | reduced-motion |
|---|---|---|
| 打开 / 关闭次数 | 10 / 10 | 10 / 10 |
| 长任务（>50ms） | 0 | 0 |
| 掉帧（合计 / 单次过渡最大） | 0 / 0 | 0 / 0 |
| 平均帧时间 | 16.67ms | 16.67ms |
| 最大帧时间 | 17.3ms | 17.5ms |
| 停留到打开（含轮询） | 169–182ms | 169–183ms |
| 离开到关闭 | 241–255ms | 未记录 |

掉帧口径：只统计进入窗口（打开前 20ms 至后 240ms）和退出窗口（关闭前 20ms 至后 180ms）内的帧；刷新周期取 rAF 间隔中位数，`round(delta / refresh) − 1 > 0` 记为掉帧。

**120Hz 限制**：测试机显示器为 60Hz，CDP 无法改变 WebView2 的刷新率，所以只有 60Hz 实测数据。动画完全由合成器上的 transform / opacity 驱动，没有 JS 逐帧计算，也没有 `setTimeout` 布局动画，理论上与刷新率无关；120Hz 的实测仍待有高刷设备时补充。

逐帧证据：after-17（进入，由左滑入并淡入）、after-18（退出）、after-19（reduced-motion 原地淡入）都来自 dev:live screencast（帧间隔约 16ms，默认 35 帧，reduced 31 帧）。after-16 为 reduced-motion 打开态：`transform: none`，`transition: opacity 0.16s linear`。

把手：after-14 为默认态（grip 不透明度 0.14），after-15 为悬停武装态（0.78）。

## 误触清单（dev:live 逐项，`misfire-check.json`）

| 场景 | 结果 |
|---|---|
| 文件树行拖过左缘 | 未打开 |
| 侧栏拖宽把手拖到左缘 | 未打开，宽度 300→300 |
| 阅读器笔记把手（右缘 x=1222）悬停 | 未打开 |
| 阅读器笔记把手连续点击两次 | 未打开 |
| 专注写作下的笔记把手（x=28）停留与点击 | 未打开（`focus-writing-check.json`） |
| 真实 PDF 页面拖选到左缘 | 未打开 |
| 停留期间从窗口左缘移出（CDP 移到 x=-3） | pending 被取消，未打开 |
| 面板打开时在内容区滚轮 | PDF 滚动 0→360，滚轮正常穿透 |
| 键盘打开后点击内容区 | 面板关闭，点击到达 PDF |
| 通过面板切换场景 | 笔记→阅读切换正常（after-20、after-21、after-22） |

全程 console / pageerror 为 0。

## 回归

- `npm run test:scene-edge-switcher`：纯模型单测，覆盖停留与快速划过、按键 / 触控守卫、宽限与安全三角、外部点击、键盘、触控切换、设置、定位、动效契约、CSS 只过渡 transform / opacity、接线（同一 `sidebarScenes` 与 `setScene`）。在旧代码上失败（模块不存在，ENOENT）。
- `npm run test:scene-edge-switcher-browser`：Vite 挂载夹具 + Playwright，41 项全过。覆盖：边缘→面板→点击→`onOpenScene` 调用一次并关闭；快速划过不打开；Esc 与键盘路径；`getAnimations` / 计算样式只有 transform / opacity；reduced-motion；118% 下的触发宽度与位置；文件拖拽、拖宽、笔记把手让位；外部点击关闭且点击穿透。在旧代码上运行 37 项、30 项失败（剩余 7 项是「不打开」一类的否定检查，没有切换器时天然成立），结果见 `old-code-browser-result.json`。

## 已知情况（与本任务无关）

在这个 dev:live 隔离库中，通过任何场景入口（侧栏场景列表或边缘面板，两者都调用 `setScene('reader')`）进入阅读场景时，阅读区显示「还没有可阅读的文献」，需要点侧栏「正在阅读」条目才会显示文档。两个入口表现一致，属于现有行为，本任务没有改动。

## 证据

`.tmp/shots/80263463/`：after-01…after-30 截图、`frames/`、`perf/edge-perf*.json`、`perf/trace-edge*.slim.json.gz`（参数字符串截到 300 字符后 gzip）、`edge-shots.json`、`layout-shots.json`、`misfire-check.json`、`focus-writing-check.json`、`old-code-browser-result.json`。
