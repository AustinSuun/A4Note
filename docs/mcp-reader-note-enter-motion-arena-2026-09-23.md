# 阅读器笔记入场动效（1f484418）— arena 交付记录

- 任务：`1f484418-54e8-4b1a-beb9-4df0545cbdfc` 阅读器笔记入场动效：常规笔记滑动进入、悬浮笔记弹出，整体丝滑流畅（spec 3）。
- 执行：arena（用户授权接手前任 arena 会话；前任 worktree 未提交的关键帧方案基于 33b9bfd，与 main 上 373f54d 的 presence 模型冲突，已归档到 `.tmp/arena-motion/predecessor/` 仅作参考，未合入）。
- 分支：`feat/reader-note-enter-motion-arena`（worktree `.worktrees/note-enter-motion-arena`），基线 main `a8fab19`，rebase 到 `0491fc0` 后以 `37a7442`（实现 + 回归）与 `8065f6b`（入场延后一帧）ff 合入本地 main；文档/状态提交见任务卡。
- 边界：未打包、未安装、未推送、未发布；未改笔记数据、保存语义、快捷键、焦点顺序与点击区域。

## 1. 现状盘点（main a8fab19，运行时核实）

main 已含 373f54d 的 presence 模型：`useNotePanelPresence(visible, mode)` 给 `.reader-workspace-shell` 写 `data-note-presence`（hidden/entering/entered/exiting）与 `data-note-motion-mode`，CSS 对 `.reader-workspace-drawer.notes-active` / `.reader-note-floating-controls` 做 220ms transform+opacity 过渡。用 dev:live 隔离实例逐场景抓 MutationObserver 首帧 + rAF 帧序列后确认的缺口：

| 缺口 | 证据（before，`.tmp/shots/note-enter-motion/before/result.json`） |
| --- | --- |
| 模式切换不重放入场，而是「先淡出再淡入」 | 分屏→悬浮 首帧 `presence=entering` 但 `opacity=1 / transform=identity`，过渡向起始姿态倒退；90ms 冻结帧 `opacity 0.078 / scale 0.963`（正在淡出），`entered` 在 351ms 才翻转再淡入 |
| 悬浮卡 `transform-origin` 固定 `top center` | 右侧默认位置的卡 origin `303px 0px`（= 50%），弹出从顶部中点长出，与卡所在侧无关 |
| 无回弹、无统一令牌 | `:root` 无任何 `--motion-*`，shell 内联 `--note-transition-duration: 220ms` 与贝塞尔字面量；悬浮与侧栏共用同一条 ease-out |
| 入场首帧姿态依赖「新挂载元素无过渡」 | 挂载后首次打开正确（首帧 opacity 0 / translate 28px），但任何已挂载状态下的重放都不成立（见第一条） |
| 无回归 | 仅 `verify-note-workbench-browser.mjs` 第 9 步检查 220ms 与 presenceLog 含 entering，不验证首帧姿态、过渡属性、几何稳定、origin、reduced-motion |

App 无自有「减弱动效」设置（仅 `prefers-reduced-motion` 媒体查询，`src/` 全局搜索确认），故 spec 中「接入既有动效开关」不适用，继续沿用系统偏好。

## 2. 场景清单（笔记面板出现的全部触发路径，dev:live 实例逐一触发）

| # | 触发 | 代码路径 | 形态 | before 首帧 → entered | after 首帧 → entered |
| --- | --- | --- | --- | --- | --- |
| 01 | 阅读态点击右缘「笔记」书签把手 | `ReaderNoteWorkbenchMenu` toggle → `useNoteWorkbench.setMode(wideMode)` | 分屏滑入 | op 0 / tx 28px → 30ms 后 entered | 同左，首帧 `transition-duration 0s` |
| 02 | 侧栏头部模式开关「悬浮速记」 | `ReaderNoteModeSwitch` → `setMode('floating')` | 浮卡弹出 | op 1（不重放，先淡出） | op 0 / scale .96 / +10px，origin `88% 0%`，回弹缓动 |
| 03 | 模式开关「专注写作」 | `setMode('writing')` | 写作面板滑入 | op 1（不重放） | op 0 / tx 28px |
| 04 | 模式开关「边读边记」 | `setMode('split')` | 分屏滑入 | op 1（不重放） | op 0 / tx 28px |
| 05 | 把手收起 | `exitNoteMode()` | 退场（未改） | exiting，ease-in | 同左，ease-in 令牌 |
| 06 | 收起后再次点击把手 | 重新挂载 drawer | 分屏滑入 | op 0 / tx 28px | 同左 |
| 07 | 快捷键 Ctrl+Alt+Q（悬浮速记） | `useReaderWritingShortcuts` → `reader.notes.quickCapture` | 浮卡弹出 | op 0 / scale .96，origin 50% | origin `88% 0%`，回弹缓动 |
| 08 | 快捷键 Ctrl+Alt+2（边读边记） | `reader.notes.mode.split` | 分屏滑入 | op 0 / tx 28px | 同左 |
| 09 | 窗口收窄到 900px（<980 断点） | `useNoteWorkbench` 临时回退 floating | 浮卡弹出 | op 1（不重放） | op 0 / scale .96 |
| 10 | 窗口恢复 1800px | 恢复 split | 分屏滑入 | op 1（不重放） | op 0 / tx 28px |
| 11 | 侧栏其它页签 → 「笔记」页签 | `sidePanelTab==='notes'` → `notesVisible` | — | 本构建 drawer 仅有「笔记」一个页签，无法触发；与 01/06 同一 `notePanelVisible` 路径 | 同左 |
| 12 | 把手右键菜单「悬浮速记」 | `ReaderNoteWorkbenchMenu` menuitemradio | 浮卡弹出 | op 0，origin 50% | origin `88% 0%`，回弹缓动 |
| — | 应用启动时笔记已打开 / 切换论文 | `useNotePanelPresence` 初始 `entered`；deps `[visible, mode]` 不含 paperId | 不播放（设计如此，未改） | 同左 |

## 3. 实现

### 3.1 动效令牌（`src/ui/styles/tokens.css` `:root`）

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--motion-panel-duration` | `220ms` | 入场/退场时长 |
| `--motion-panel-ease-out` | `cubic-bezier(.22, 1, .36, 1)` | 侧栏/写作面板滑入 |
| `--motion-panel-ease-in` | `cubic-bezier(.4, 0, 1, 1)` | 全部退场 |
| `--motion-panel-ease-pop` | `cubic-bezier(.34, 1.3, .64, 1)` | 浮卡弹出（52% 时长到位，最大过冲 3%，即 scale 峰值 ≈1.0012、上浮 ≈0.3px 的轻微回弹） |
| `--motion-panel-slide-distance` | `28px` | 滑入起始水平偏移（面板位于右侧，从右向左进入） |
| `--motion-panel-pop-lift` | `10px` | 浮卡起始下沉 |
| `--motion-panel-pop-scale` | `.96` | 浮卡起始缩放 |

### 3.2 布局 CSS（`src/features/reader/reader-writing-layout.css`）

- `.reader-workspace-shell` 的 `--note-transition-duration/--note-transition-ease` 改为消费令牌（计算值仍为 `220ms` / ease-out，既有 `verify-note-workbench-browser` 第 9 步与 `verify-note-workbench` 正则不变）；新增 `--note-transition-ease-exit / -pop`、`--note-slide-distance`、`--note-pop-lift`、`--note-pop-scale`。
- `[data-note-presence="entering"]` 时 `transition-duration: 0s`：入场起始姿态一帧内瞬时落位，不再向起始姿态「倒放」；随后 `entered` 从该姿态起过渡。这就是模式切换能重放的根本原因。
- `[data-note-motion-mode="floating"][data-note-presence="entered"]` 使用回弹缓动（过渡的 timing 取自变化后的样式，因此只影响弹入，不影响退场的 ease-in）。
- `transform-origin: var(--note-pop-origin, 50% 0%)`，由 `ReaderScene` 依浮卡位置写入。
- 过渡属性始终只有 `transform, opacity`，没有 width/left/top 等布局属性，也没有关键帧动画叠加；`will-change` 仅在 entering/exiting 期间声明（未改）。
- `@media (prefers-reduced-motion: reduce)` 除既有 `transition: none` 外把 `--note-transition-duration` 归零，令牌消费方读到 `0s`。

### 3.3 位置感知的弹出原点（`src/features/reader/noteEnterMotion.ts`，新增）

`floatingPopOrigin(rect)`：按浮卡中心的容器比例，左侧（<0.4）→ `12% 0%`，右侧（>0.6）→ `88% 0%`，居中 → `50% 0%`。`ReaderScene.tsx` 的 floatingStyle 追加 `'--note-pop-origin'`；纯函数、无 DOM。

### 3.4 presence hook（`src/features/reader/useNotePanelPresence.ts`）

`entering → entered` 改为在第二个动画帧翻转：第一帧绘制起始姿态并吸收模式切换带来的同步布局工作（PDF 列重排、编辑器挂载），过渡从第二帧开始；翻转前仍读取一次 `document.documentElement.offsetWidth`，保证前一帧被跳过（后台标签、节流）时过渡也有起点。`NOTE_PANEL_MOTION_MS` 注明镜像 `--motion-panel-duration`，只用于退场计时。reduced-motion 分支不变（直接 `entered`）。

### 3.5 回归（新增）

- `scripts/verify-note-enter-motion-browser.mjs` + `scripts/fixtures/note-enter-motion-host.tsx`，`npm run test:note-enter-motion-browser`，已加入 `scripts/verify-all.mjs`。夹具复用真实 `useNoteWorkbench` / `useNotePanelPresence` / `floatingPopOrigin` / `floatingCardBox` / `ReaderNoteModeSwitch` 与应用 CSS，镜像 `ReaderScene` 外壳属性；用真实 DOM 点击 + 微任务 flush 读取「提交后、绘制前」的首帧。
- 47 项断言：令牌存在且被 shell 消费；分屏首帧 `entering / opacity 0 / matrix(1,0,0,1,28,0) / duration 0s / will-change transform, opacity / 无关键帧`；下一帧 entered 且 `getAnimations()` 只有 transform/opacity 两条 CSSTransition、220ms、缓动等于令牌；过渡中与结束后 offset 盒与首帧一致、连续两帧稳定；退场 ease-in 并在结束后卸载；浮卡首帧 `matrix(.96,0,0,.96,0,10)`、控件同步、右/左/居中 origin = 88%/12%/50%、回弹缓动 y1>1、60ms 冻结帧半透明、结束几何 = `floatingCardBox`；拖动后位置更新且不重放；浮卡→分屏→浮卡→写作切换均从起始姿态重放；收起再开、窄窗回退、宽窗恢复重放；reduced-motion 首帧直接 entered、0s、无 CSSTransition、shell 令牌 0s；无 pageerror/console error；源码未被改动。
- 旧代码红测：在 main `a8fab19`（把夹具里的 `floatingPopOrigin` 导入替换为常量 shim 后运行）31/47，失败项正是令牌缺失、entering 仍 0.22s、三次模式切换首帧 opacity 1、origin 50%、无回弹、reduced-motion 令牌；在 `33b9bfd`（无 presence hook）夹具无法解析 `useNotePanelPresence`，脚本以「执行失败」退出 1。日志 `.tmp/arena-motion/proof-main.log`、`.tmp/arena-motion/proof-33b9bfd.log`。
- 顺带：`verify-note-enter-motion-browser.mjs` 与 `verify-note-workbench-browser.mjs` 的 vite 开发服务器加了 `watch.ignored`（`.build/.tmp/.worktrees/node_modules/src-tauri/target`）。仓库根目录现有多份 dev:live cargo target 与 WebView 配置目录，未忽略时首个页面加载会卡到 `Page.navigate` 30s 超时（本轮在 main 根目录实测 `verify-note-workbench-browser` 亦超时，加忽略后恢复）。`scripts/` 内其它三个仍未加忽略的浏览器 harness（含 verify-all 里的 sidebar/tree-guides/text-layer-offset）未动，如在根目录超时可照此处理。

## 4. 参数与时序证据（dev:live `arena-note-motion`，1800×1000；before = a8fab19，after = 8065f6b，另保留 `after-37a7442/` 供对照）

- 时长 220ms；侧栏/写作 `translate3d(28px,0,0)+opacity 0 → 0/1`，ease-out；浮卡 `translate3d(0,10px,0) scale(.96)+opacity 0 → 0/1/1`，`cubic-bezier(.34,1.3,.64,1)`；退场 `cubic-bezier(.4,0,1,1)`；origin 右 88%/左 12%/中 50%（顶部）。
- after 过渡窗口（`entered` 后 260ms 内 rAF 采样，场景 02/02b/03/06/07/08/09/10/12）：15–16 帧、均值 16.66–17.71ms、最大 16.7–33.4ms（最多 1 帧 >25ms），悬浮 opacity 轨迹 `0 .27 .49 .66 .80 .90 .96 1`，滑入 `0 .31 .56 .73 .84 .90 .94 .97 .98 .99 1`；过渡期间 drawer `offsetWidth` 只有一个取值（645 / 732 / 1744 / 361），首帧、过渡中与结束后 offset 盒一致（浮卡 `926,196,703×529` 是 scale .96 的视觉盒，布局盒 `900,186,732×551` 全程不变），无重排。
- 90ms 冻结帧（`Animation.pause()` 后截图）：分屏 `opacity .922 / translateX 2.17px`；浮卡 `opacity .927 / scale .997 / +0.73px`（before 同点位是 `opacity .078 / scale .963`，正处于淡出）。
- 长帧归因：每个场景 `entering → entered` 之间有一帧 170–550ms（before/after 相同），来自模式切换引起的 PDF 列重排/重绘与编辑器挂载；after 中它发生在过渡开始之前，不在动效窗口内。例外是应用刷新后的首次打开（场景 01）：编辑器首次挂载/懒加载落在 `entered` 之后（after 采样 316ms，before 533ms），该次入场大部分被吞掉，只在冷启动后第一次出现，后续打开/切换均为完整 60fps 窗口。本任务不改布局与加载语义，记为后续优化项（预热编辑器 chunk 或把重排前置）。
- 焦点：所有场景 entered 后 `document.activeElement` 位于 drawer 内（模式开关按钮或论文文档下拉），无焦点丢失。
- 主题 × UI 缩放矩阵（a4note/midnight × 100/125/150%，缩放采用 App 自身 `documentElement.style.zoom + --ui-zoom` 机制）：分屏与浮卡 12 组 settled 均 `opacity 1 / transform identity`、控件 opacity 1、盒子在视口/外壳内（150% 分屏盒 `1124,93,635×832`，右缘 1759 < 1800）、焦点在面板内。capture 脚本里 `inViewport` 把坐标额外乘了 zoom 因子导致 125/150% 记为 false，属脚本口径错误，已按原始坐标复核。
- 无 pageerror、无 console error、无请求失败（before/after 各 27 图，含 `favicon` 在内的 requestfailed 为 0）。
- 截图与 result.json：`.tmp/shots/note-enter-motion/before/`、`.tmp/shots/note-enter-motion/after/`（`00-reading-baseline`、`01…12` 场景 settled、`*-mid90ms` 冻结中间帧、`matrix-{light,dark}-{100,125,150}-{split,floating}`）；浏览器回归证据 `.tmp/shots/note-enter-motion-browser/<run>/`。均带底部 `DEV arena-note-motion · 独立测试库（原生已核验 …/AsterData）` 状态条。

## 5. 验证

- 37a7442：`npx tsc --noEmit` 0；`npm run build` 通过；`get_diagnostics` 0；`test:note-workbench` 61/61、`test:reader-note-sidebar` 16/16、`test:note-workbench-browser` 91/91、`test:reader-note-sidebar-browser` 通过、`test:reader`、`test:reader-helpers`、`test:ui-state` 通过、`test:note-enter-motion-browser` 47/47；worktree 内完整 `npm run verify` 退出 0（5m47s，含 build、全部浏览器 harness、`cargo test` 215 passed / 0 failed / 5 ignored）。
- 8065f6b（仅 hook 双 rAF）：`tsc` 0、`test:note-enter-motion-browser` 47/47、`test:note-workbench-browser` 91/91、`test:note-workbench` 61/61、`test:reader-note-sidebar-browser` 通过、`npm run build` 通过（见 `.tmp/arena-motion/checks2.log`）。
- `npm run test:agent-status` 通过（状态更新后）。

## 6. 限制与后续

- 冷启动后的首次打开见第 4 节：长帧落在 `entered` 之后时过渡被吞，双 rAF 只能保证起始姿态先绘制，不能等待懒加载；稳态场景均正常。
- 回弹幅度按令牌定义仅 3%（scale 峰值 ≈1.0012），是有意的「轻微」；如需更明显可只改 `--motion-panel-ease-pop`。
- 浏览器回归运行在 headless Chrome 的合成夹具中，不是打包应用；原生行为以 dev:live 截图与 result.json 为准。
- 未打包/安装/推送/发布。dev:live 实例 `arena-note-motion`（1433/CDP 9333）与前任遗留的 `arena-before`（1422/CDP 9231）在交付时仍在运行，按仓库规则未由 agent 结束，请用户在验收后自行关闭。
