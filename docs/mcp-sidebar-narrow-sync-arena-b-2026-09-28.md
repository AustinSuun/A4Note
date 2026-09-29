# 窄窗口侧栏状态同步（6f9e0947）交付记录 · arena-b · 2026-09-28

- 任务：`6f9e0947`（high）窄窗口 CSS 隐藏侧栏后，标题栏按钮与「返回场景」不同步，且无法重新打开侧栏
- 执行：arena-b（worker `a4f50d11`），分支 `fix/sidebar-sync-arena-b`，worktree `.worktrees/sidebar-sync-arena-b`，基线本地 main `b159a6a`
- 提交：本任务实现提交（见第 7 节「提交与合入」）；doc2x 启动阻塞见第 5 节

## 1. 根因

`src/ui/styles/workbench.css` 中 `@media (max-width: 1040px)` 直接给 `.workbench-sidebar` 设了 `display:none`。这条规则 React 不知情：

- 标题栏按钮只读持久化偏好 `aster.sidebarCollapsed`（仍为 `false`），于是显示「收起侧栏」+ 收起图标、`aria-expanded=true`，但侧栏其实已不可见；
- 点击按钮只是把偏好翻成 `true`，CSS 仍隐藏，再点翻回 `false`，仍隐藏 —— 窄窗口下**没有任何途径重新打开侧栏**；
- 「返回场景」入口只放在侧栏里 / 按偏好决定是否出现在标题栏，侧栏被 CSS 隐藏时就一起消失，用户被困在当前场景。

在 125% Windows 缩放下（本机实测 `devicePixelRatio = 1.25`），参考图中 1207 物理像素宽的窗口只有约 965 CSS px，低于 1040 断点，所以这是很常见的尺寸，并不是极端情况。

## 2. 设计

把「侧栏是否可见」从 CSS 挪回状态，由一个纯函数统一决定，标题栏、Shell、样式都读同一个结果。

- 新增纯模块 `src/workbench/sidebarVisibility.ts`
  - 状态 `{ userCollapsed, narrow, overlayOpen }` → `mode: 'docked' | 'overlay' | 'hidden'`，外加 `visible`
  - 宽窗口：切换 = 改用户偏好（与原行为一致，持久化）
  - 窄窗口：切换 = 打开/关闭**浮层抽屉**，**不改**持久化偏好；窗口变回宽时浮层自动关闭，恢复用户原来的停靠/收起状态
- 新增 `src/workbench/useNarrowViewport.ts`：订阅 `matchMedia(WORKBENCH_SIDEBAR_NARROW_QUERY)`
- **断点常量共享方式**：唯一来源是 `sidebarVisibility.ts` 导出的 `WORKBENCH_SIDEBAR_NARROW_MAX_WIDTH = 1040` 和由它拼出的 `WORKBENCH_SIDEBAR_NARROW_QUERY = (max-width: 1040px)`。样式表里**不再有** 1040 的媒体查询，抽屉/隐藏样式只根据 `.workbench-shell[data-sidebar-mode=overlay|hidden]` 生效，CSS 和 JS 不可能再各算各的；单元测试会断言查询字符串由常量生成，并且样式表不再用媒体查询单独隐藏侧栏。1180px 档（侧栏最小宽度）保持原样。
- `WorkbenchShell.tsx`：按 mode 渲染停靠侧栏 / 浮层抽屉 + 遮罩；Esc 或点遮罩关闭并把焦点还给标题栏按钮；根节点写 `data-sidebar-mode` 便于测试与样式
- `WindowTitleBar.tsx`：按钮文案、图标、`aria-expanded` 一律跟随**实际可见性**；侧栏不可见时，标题栏在切换按钮后显示紧凑的「返回场景」图标按钮（带 aria-label / title）
- `workbench.css`：删掉隐藏侧栏的媒体查询，新增抽屉与遮罩样式（不改 tokens.css）
- 未修改 `App.tsx` / `types.ts` / `lib.rs` / `tokens.css`；没有新增 `if (scene === …)` 分支；依赖方向 ui → workbench 保持不变（`test:architecture` 通过）

### 取舍

- 宽窗口下如果用户主动收起了侧栏，标题栏同样会出现紧凑的「返回场景」图标。这是有意为之：规则统一为「侧栏看不见，就在标题栏给出返回场景入口」，避免再次出现入口随侧栏消失的问题。代价是宽窗口收起状态下标题栏多一个小图标。
- 窄窗口的浮层打开/关闭不写入偏好，所以用户在宽窗口的选择不会被窄窗口操作污染（实机第 5/6 步验证）。

## 3. 测试

| 测试 | 新代码 | 旧代码（main 版本，临时 worktree） |
|---|---|---|
| `npm run test:sidebar-visibility`（`scripts/verify-sidebar-visibility.mjs`，纯状态机 8 项） | 8/8 通过 | 失败（模块不存在 / 行为不符） |
| `npm run test:sidebar-visibility-browser`（`scripts/verify-sidebar-visibility-browser.mjs` + `scripts/fixtures/workbench-sidebar-host.tsx`，真实 WorkbenchShell + WindowTitleBar，39 项） | 39/39 通过 | 7/39 |

两项均已加入 `scripts/verify-all.mjs`。浏览器测试覆盖：宽/窄 × 100%/118%/125% 根缩放、按钮文案/图标/aria-expanded 与实际可见一致、浮层打开后侧栏条目位于最上层可点击、Esc/遮罩关闭与焦点返回、窄窗口不改持久化偏好、窗口变宽恢复停靠、紧凑「返回场景」可见可点。

附带发现：headless 下根元素 CSS zoom 不影响媒体查询，断点只由 CSS 视口宽度决定，所以缩放场景真正起作用的是 Windows 显示缩放（DPR）。

其余回归：`npm run build` 通过；`test:architecture` 通过；`test:core` 通过（修复后，见第 5 节）；library-sidebar 13/13、reader-note-sidebar、scene-plugins、board 45/0 通过。

完整 `npm run verify`（PowerShell）：79 步中 78 步通过，唯一失败是 main 已有的 `test:ui-state`，见第 6 节。

证据：
- 新代码浏览器运行：`.tmp/shots/sidebar-visibility-browser/run-2026-09-28T13-56-07-673Z/`（result.json + screenshots）
- 旧代码浏览器运行：`.tmp/shots/sidebar-visibility-browser-before/run-2026-09-28T13-42-28-361Z/`

## 4. 真实应用（dev:live）验证

`npm run dev:live -- --instance arena-b --port 1451 --cdp-port 9251`，隔离测试库（DEV 条显示 `arena-b · 独立测试库`），不触碰正式库。窗口大小用 Win32 MoveWindow 实际调整原生窗口（不是模拟视口），通过 CDP 读取状态并截图。截图目录：`.tmp/shots/6f9e0947-devlive/`。

| 场景 / 缩放 | 窗口（CSS px） | 结果 |
|---|---|---|
| 文献库 100% | 1386 宽 | docked，「收起侧栏」，expanded=true，完整「返回场景」（`lib-1-wide`） |
| 文献库 100% | 986 窄 | hidden，「展开侧栏」+ 展开图标，expanded=false，标题栏紧凑返回场景（`lib-2-narrow-hidden`） |
| 同上 → 点按钮 | 986 | overlay 抽屉，侧栏条目在最上层（`lib-3-narrow-overlay`）；Esc → hidden（`lib-4-after-esc`）；点遮罩 → hidden |
| 同上 → 窗口变宽 | 1386 | 恢复 docked（`lib-restored-1-wide`） |
| 白板 118% | 1386 / 952 | 同上全套通过（`board118-1…4`、`board118-restored-1-wide`） |
| 白板：宽窗口主动收起后再变窄 | 952 → 1386 | 偏好 `true` 保持；窄窗口打开浮层不改偏好；变宽后仍保持用户收起（`board118-5/6`） |
| 阅读器（内置指南 PDF）125% | 1386 / 952 | 同上全套通过（`reader125-1…4`、`reader125-restored-1-wide`） |
| 断点边界 | 1023 / 1060 | 1023 → hidden + 紧凑返回场景；1060 → docked（`edge-1023css`、`edge-1060css`）。1023 ≈ 1207 物理 px @118% |

说明：应用的界面缩放就是 `App.tsx` 里设置的 `document.documentElement.style.zoom = uiZoom%`，所以实机用同样的方式设成 118%/125%，和设置里调缩放是同一机制（快照右侧被裁，是 CDP 截图在根 zoom 下的取景问题）。Chromium 的根 zoom 不改变 `innerWidth`，也不改变媒体查询结果；真正让 1207 物理像素宽的窗口落到断点以下的是 Windows 125% 显示缩放（本机 DPR=1.25，1207/1.25≈966 CSS px）。白板所用的笔记库是临时夹具 `.tmp/arena-b/notes-6f9e`（经 workbench store 打开，未弹原生对话框）。

### 改前（同一实例，同一隔离库）

做法：在正在运行的 arena-b 实例里，临时从改前的 main `a7d2023` 检出 `WindowTitleBar.tsx`、`WorkbenchShell.tsx`、`workbench.css`、`index.ts` 四个前端文件，Vite 热更新后整页刷新（确认 `.workbench-shell` 上没有 `data-sidebar-mode`），拍完再 `git checkout HEAD --` 恢复（恢复后确认 `data-sidebar-mode` 回来、worktree 与 HEAD 一致）。这个问题只涉及前端，Rust 部分完全相同，所以不必为改前单独重新编译一份原生程序。

| 场景 / 缩放 | 窄窗口（952–986 CSS px） | 点第 1 次 | 点第 2 次 |
|---|---|---|---|
| 白板 118% | 「收起侧栏」+ 收起图标，侧栏不可见，返回场景仍占位（`before-board118-2-narrow`） | 变为「展开侧栏」，侧栏仍不可见，返回场景消失，偏好被写成 true（`before-board118-3-after-click1`） | 回到「收起侧栏」，仍不可见（`before-board118-4-after-click2`） |
| 文献库 100% | 同上（`before-lib-2-narrow`） | 同上（`before-lib-3-after-click1`） | 同上 |
| 阅读器 125% | 同上（`before-reader125-2-narrow`） | 同上（`before-reader125-3-after-click1`） | 同上 |

改前三个场景都没有 `aria-expanded`。宽窗口（1386）下改前、改后都正常，本任务只影响窄窗口。

### Console / pageerror

`cdp-monitor` 持续记录到 `.tmp/arena-b/console-errors.jsonl`。
- 14:04:16 `pageerror: Plugin already registered: doc2x.core` —— main 自带的启动阻塞（第 5 节），修复前应用空白
- 14:07:12 `console.error: Failed to initialize native library database is locked` —— 修复后，Vite HMR 整页刷新与手动 reload 同时发生，两次加载争抢初始化导致，仅出现这一次
- 标记 `after-fix run start` 之后的全部场景操作（约 14:08–14:15），以及标记 `clean reload` 后的一次干净整页刷新：**0 条错误**（`final-after-clean-reload`）
- 第二段监控 `.tmp/arena-b/console-errors-2.jsonl`（15:22 起，rebase 后的代码）：改前取证、恢复、刷新以及最终宽窗口检查全程 **0 条错误**

## 5. 发现并修复的 main 阻塞：doc2x.core 重复注册

- 来源：`bbb5524`（doc2x: builtin plugin doc2x.core），main `b159a6a` 仍存在
- 现象：`src/core/asterCore.ts` 中 `registerPlugin(createDoc2xPlugin())` 与 `registeredBuiltinPluginIds.add(DOC2X_PLUGIN_ID)` 被放进了 `for (const definition of builtinSceneDefinitions)` 循环体内（大括号位置错误）。第二次迭代抛出 `Plugin already registered: doc2x.core`，`createAsterCore` 失败，dev/桌面启动后窗口空白（`#root` 为空）；`npm run test:core` 在 main 上同样失败。
- 修复：把这两行移到循环之后，只注册一次。我先在本分支做了独立提交 `63e4244`（只改 `src/core/asterCore.ts`）；合入前发现另一位 agent 已在本地 main 上提交了同样的修复 `3866352 fix(core): register doc2x plugin once`，因此 rebase 时丢弃 `63e4244`，最终以 main 的 `3866352` 为准，本任务不再改动 asterCore.ts。
- 回归覆盖：已有的 `npm run test:core`（`verify-core-smoke.mjs`）修复前失败、修复后通过，不需要另写测试。
- 影响：`b159a6a` 无法启动，`3866352` 起已恢复。

## 6. 完整 verify 与已知问题

- 第一轮 `npm run verify`（PowerShell，基线 b159a6a + 63e4244 + 本任务改动）：共 79 步，78 步通过，唯一失败是 `test:ui-state`。其中 `test:core` 通过、Rust 247 passed / 0 failed / 7 ignored、`test:sidebar-visibility` 8/8、`test:sidebar-visibility-browser` 39/39（verify 内这次运行的证据：`.tmp/shots/sidebar-visibility-browser/run-2026-09-28T14-20-08-953Z`）。日志：`.tmp/arena-b-verify.log`（UTF-16），UTF-8 副本：`.tmp/arena-b-verify.utf8.log`。
- 第二轮 `npm run verify`（PowerShell，rebase 到 main `a7d2023` 之后的最终代码）：共 81 步（main 新增 viewport-to-layout / popover-zoom-browser 两步），80 步通过，唯一失败仍是 `test:ui-state`；`test:core` 通过，Rust 247/0/7，sidebar 8/8、39/39（`.tmp/shots/sidebar-visibility-browser/run-2026-09-28T15-14-05-239Z`）。日志：`.tmp/arena-b-verify2.log`，UTF-8 副本：`.tmp/arena-b-verify2.utf8.log`。
- `test:ui-state` 第 383 行断言在 main `b159a6a` 与本分支上**同样失败**，与本任务无关（是 main 已有问题），这里如实记录。

## 7. 提交与合入

- 分支 `fix/sidebar-sync-arena-b`，开发基线 `b159a6a`。
- 合入前本地 main 已前进到 `a7d2023`（`3866352` doc2x 修复、`a7d2023` 界面缩放下弹层/拖拽跟随指针，任务 ae61143f）。rebase 时丢弃我重复的 `63e4244`；`WorkbenchShell.tsx` 只有 import 冲突（main 新增 `viewportDeltaToLayout`，本任务新增 sidebarVisibility / useNarrowViewport），两者都保留，没有覆盖对方改动。
- 最终是 main `a7d2023` 之上的一个实现提交，普通 fast-forward 合入本地 main；提交号以任务 submit 记录和 `git log` 为准。
- 实机截图是在 rebase 前的代码上拍的；rebase 只多带进 main 上两个与侧栏状态无关的提交，第二轮完整 verify（含 39 项真实组件浏览器回归）已在最终代码上通过。

## 8. 不在范围 / 未做

- 未安装、打包、发布，未推送；没有重启 4319，也没有碰正式库。
- `src-tauri/Cargo.toml`、`src-tauri/gen/schemas/*.json` 在 worktree 中出现只含行尾差异的改动，是 dev:live 构建的副产物，未提交。
