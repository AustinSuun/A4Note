# 标题栏「打开 ▾」只作用于当前文件（bcabb18d）交付记录 · arena-b · 2026-09-29

- 任务：`bcabb18d` 标题栏「打开 ▾」按钮只在打开具体文件时出现，并作用于该文件
- 执行：arena-b（worker `a4f50d11`），分支 `fix/open-menu-file-arena-b`，worktree `.worktrees/open-menu-file-arena-b`，基线本地 main `a4f6a19`，交付前 rebase 到 main `c513766`（6d59b629 合入，无冲突）
- 提交与合入：见第 8 节

## 1. 问题

改前 `WorkbenchTopBar` 在每一页都渲染「打开 ▾」（总览、文献库列表、笔记场景空页、阅读器……），`canBrowseFolder` 为假时渲染成**禁用**按钮。菜单两项都作用于**文件夹项目根目录**（App.tsx 传 `revealPath(folderProjectPath)` / `openPathInVSCode(folderProjectPath)`），与用户当前看的文件无关。实测（dev:live，改前代码）：打开 `读书笔记.md` 后点「在文件管理器中显示」，Explorer 打开的是项目根目录，**没有选中任何文件**（`.tmp/shots/bcabb18d/before-8-explorer-desktop.png`）。

## 2. 规则表

判定集中在纯函数 `src/workbench/openMenuTarget.ts`：`openMenuSourceFromTab(tab, reader)` 把活动标签归一成来源，`resolveOpenMenuTarget(source, { projectRoot })` 返回 `{visible:true,target}` 或 `{visible:false,reason}`。

| 活动标签 | 按钮 | 在文件管理器中显示 | 在 VS Code 中打开 | 在 VS Code 中打开项目文件夹 |
|---|---|---|---|---|
| Markdown（`.md/.markdown/.mdx`） | 显示 | 选中该文件 | 打开该文件 | 文件在文件夹项目内时显示 |
| 文本/代码（json、txt、ts…） | 显示 | 选中该文件 | 打开该文件 | 同上 |
| HTML（`.html/.htm`） | 显示 | 选中该文件 | 打开该文件 | 同上 |
| 白板 `.a4board` | 显示 | 选中该文件 | **隐藏** | 同上 |
| 图片（png/jpg/svg/webp…） | 显示 | 选中该文件 | **隐藏** | 同上 |
| 工作区 PDF（文件树打开） | 显示 | 选中该文件 | **隐藏** | 同上 |
| 文献库论文（阅读器，原文 PDF） | 显示 | 选中库内 PDF | **隐藏** | 不显示（不属于文件夹项目） |
| 总览 / 文献库列表 / 笔记场景空页 / AI / 任务板等场景页 | **不渲染**（`scene`） | — | — | — |
| Agent 会话 / 终端 / Diff | **不渲染**（`session`） | — | — | — |
| 没有活动标签 | **不渲染**（`no-tab`） | — | — | — |
| 文件标签缺路径 / 相对路径 / 非 `file:` URI | **不渲染**（`no-local-path`），绝不回退到项目根目录 | — | — | — |
| 论文没有 PDF 文件记录 | **不渲染**（`paper-without-file`） | — | — | — |

「不渲染」指 DOM 中不存在 `.workbench-open-trigger`，不是禁用态也不是占位。

- tooltip（`title`）= 完整路径；超过 72 个**显示列**（CJK 记 2 列）时中间省略，保留开头与文件名，如 `D:\WorkSpace\Aster\.tmp\aren…\第三层\一个相当长的笔记文件名称用于测试.md`。完整路径另存 `data-path`，`aria-label` 为「打开：<文件名>」。
- 按钮跟随活动标签（App 用的 `hostActiveTabId = activeFileTabId ?? activeTab.id`，与主区域显示的是同一个标签）；目标 `key` 变化时自动关闭已展开的菜单；最后一个文件标签关闭后，活动标签回到场景标签，按钮随之消失。
- 与侧栏状态无耦合：判定只读活动标签、论文记录和项目根目录。

## 3. 各资源的路径来源

| 资源 | 路径来源 | reveal 方式 |
|---|---|---|
| Markdown / 白板 / HTML / 图片 / 工作区 PDF（`kind: 'file'` 或插件资源标签） | 标签 `state.path`（文件树打开时写入的绝对路径）；缺失时用 `state.uri` 经 `localPathFromResourceUri` 转本地路径 | `reveal_path({ path })` |
| 文献库论文（`kind: 'tool'`，key 为 `tool:reader:paper:<paperId>`） | `aster.documents.get(paperId)` 的 `sourcePdf`（仅用于 tooltip 展示）+ `sourceFileId` | `reveal_paper_file({ paper_id, kind:'source', file_id })`，由后端从数据库 `paper_files.path` 取路径，前端不猜路径 |

原生调用放在 `src/ui/openMenuActions.ts`（`revealOpenMenuTarget` / `openOpenMenuPathInVSCode`），因为 workbench 层不允许依赖 platform 层（`test:architecture`）。

## 4. IPC 变更（向后兼容）

- `reveal_path` 请求结构不变（`{ request: { path } }`）。目录：行为不变，打开该目录；**文件：由「打开父目录」改为「打开父目录并选中该文件」**。
- `reveal_paper_file` 请求结构不变，同样改为选中论文 PDF。
- 实现：`src-tauri/src/app_paths.rs` 新增 `reveal_in_file_manager(path)`
  - Windows：`explorer /select,"<path>"`，用 `raw_arg` 传参（否则 Rust 会把整个 `/select,...` 加引号，Explorer 不认）；`explorer_select_argument` 统一反斜杠并去掉 `\\?\` / `\\?\UNC\` 前缀
  - macOS：`open -R <path>`；Linux：没有通用的「选中」参数，打开所在目录
- `PdfResourceTab` 自带的「在文件管理器中显示」按钮也走 `reveal_path`，因此同样变为选中文件。
- Rust 单元测试 `app_paths::explorer_select_tests`（2 个）：空格/中文路径加引号、正斜杠转换、verbatim 前缀剥离。

## 5. 项目级入口去向

原来标题栏菜单的两个项目级动作：

- **「在 VS Code 中打开」（项目文件夹）** → 保留在同一个菜单里，改名为「在 VS Code 中打开项目文件夹」，当当前文件位于文件夹项目内时出现（Markdown、白板、图片、工作区 PDF 等）。
- **「在文件管理器中显示」（项目文件夹）** → 文件树右键菜单的「在文件管理器中显示」（App.tsx `revealPath(entry.path)`）：对文件夹打开该文件夹，对文件选中该文件；当前文件的 reveal 也会打开所在目录。

场景页（总览、文献库列表等）不再提供项目级入口（按任务要求不渲染按钮）。

## 6. 测试

| 测试 | 内容 | 改前 | 改后 |
|---|---|---|---|
| `npm run test:open-menu-target`（新增，纯函数） | md、pdf（工作区 + 论文）、board（`file` 与插件标签）、html、image、text；overview、library list、no tab、session；缺路径 / 空白 / 相对 / 非 file URI / 论文无文件；显示宽度中间省略；源码断言 TopBar 无旧 props、App 不再 reveal 项目根 | 失败（模块不存在） | 通过 |
| `npm run test:open-menu-browser`（新增，真实 DOM） | 真实 `WorkbenchTopBar` + 真实 platform 调用 + 录制 IPC mock，34 项：总览 / 文献库无按钮；md 按钮存在且 `reveal_path` 收到 md 路径、VS Code 打开 md 本身；白板按钮存在且隐藏 VS Code；论文走 `reveal_paper_file`；长路径 tooltip 省略；切换标签关闭旧菜单；收起/展开侧栏不影响；关闭最后一个文件标签后按钮消失；console 0 错误 | **失败 22/34**（包括任务要求的四条：md reveal 收到的是项目根、总览按钮在 DOM、白板有 VS Code、关闭标签后按钮仍在） | **通过 34/34** |
| `test:reader-labels`（更新） | TopBar SSR 改传 `openTarget` | — | 通过 |
| `cargo test --lib explorer_select`（新增） | Explorer `/select` 参数 | — | 2/2 通过 |

夹具 `scripts/fixtures/open-menu-host.tsx` 通过 `import.meta.glob` 加载新模块，并同时传旧 props（`canBrowseFolder` / `onRevealFolder`），所以同一个夹具在旧代码上能渲染，失败在行为断言上而不是 import 上。改前结果：`.tmp/shots/bcabb18d/old-code-browser-result.json`。

## 7. 真实应用（dev:live，`--instance arena-b --port 1451 --cdp-port 9251`）

测试文件夹 `.tmp/arena-b/openmenu-notes`（md、白板、HTML、图片、PDF、带空格的深层 md），通过应用自身的「打开已有笔记」流程打开。截图在 `.tmp/shots/bcabb18d/`。

| 场景 | 改前 | 改后 |
|---|---|---|
| 总览 | 按钮存在（`before-0-initial` 中为禁用态，有项目后可用） | 不存在（`after-2-overview`） |
| 文献库列表 | 按钮存在 | 不存在（`after-3-library`） |
| 笔记场景未打开文件 | 按钮存在 | 不存在（`after-3b-notes-no-file`） |
| md | 菜单两项作用于项目根 | 三项：显示 / VS Code 打开文件 / VS Code 打开项目文件夹；tooltip = 文件路径（`after-4-md-menu`） |
| md →「在文件管理器中显示」 | Explorer 打开项目根，无选中（`before-8-explorer-desktop`） | Explorer 选中 `读书笔记.md`（`after-9-md-explorer-select`，Shell COM 报告 `selected=[读书笔记.md]`） |
| 白板 | 菜单同上（项目根） | 显示 + VS Code 打开项目文件夹，无「在 VS Code 中打开」（`after-5-board-menu`） |
| 工作区 PDF | 同上 | 显示 + 打开项目文件夹（`after-6-workspace-pdf-menu`） |
| 文献库论文（阅读器） | 同上 | 仅「在文件管理器中显示」，tooltip 为中间省略的库内路径；Explorer 选中 `source.pdf`（`after-7-paper-reader-menu`、`after-8-paper-explorer-select`） |
| 深层带空格路径 md | — | tooltip 中间省略（`after-10-deep-md-tooltip`，原生 tooltip 截不到，图中深色条是按 `title` 属性值注入的可视化）；Explorer 选中该文件（COM 报告 `selected=[一个相当长的笔记文件名称用于测试.md]`） |
| 侧栏收起 / 展开 | 按钮不受影响（但指向项目根） | 按钮与目标不变（`after-11-md-sidebar-collapsed`、`after-11b-…`） |
| 关闭所有文件标签 | 按钮仍在（`before-9-tab-closed`） | 按钮消失（`after-12-all-file-tabs-closed`） |

说明：应用里 `__TAURI_INTERNALS__.invoke` 不可写，无法在真实应用里拦截 IPC，所以真实应用用 Explorer 实际选中结果作证据，IPC 参数由浏览器回归测试断言。

### Console / pageerror

- 改后完整流程（`.tmp/arena-b/console-final.jsonl`，01:25 起，覆盖上表全部场景）：**0 条**。
- 顺带修复的既有问题：打开**工作区 PDF**时持续刷 `Maximum update depth exceeded`（改前代码同样出现，见 `console-before.jsonl` 01:08:52 起，PDF 打开期间一直刷）。根因：`PdfResourceTab` 每次渲染都生成新的 `changeReaderState`，`PdfReader` 的 effect 依赖该回调并在其中回报 `{currentPage,totalPages}`，`setReaderState` 每次写入新对象 → 重新渲染 → 新回调 → 死循环。修复：值不变时保留原对象（3 行，`src/features/reader/PdfResourceTab.tsx`）。修复后打开并滚动 PDF：0 错误，页码正常跟随（`6 / 12`）。文献库阅读器传的是稳定的 `setState`，不受影响。

## 7b. 追加修复：下拉面板被标题栏裁剪（旧代码即存在）

- 现象：标题栏 `.window-titlebar` / `.window-titlebar-projectbar` 为 `overflow: hidden`、高 40px，面板原为 `position: absolute; top: calc(100% + 7px)`（top≈41px），整块被裁掉——DOM 里有菜单项、`el.click()` 也能触发，但用户看不到也点不到。旧代码截图 before-5 与新代码早期截图 after-4/5/7 均无可见面板，即旧问题。
- 修复（仅 `WorkbenchTopBar.tsx` 打开菜单块，未动 `workbench.css` / 标题栏样式）：面板 `createPortal` 到 `<body>`，按触发按钮 `getBoundingClientRect()` 以 `position: fixed` 锚定在按钮右下（除以 `currentCSSZoom`，兼容根 `zoom`）；`width: max-content; min-width: 190px; white-space: nowrap`，「在 VS Code 中打开项目文件夹」不再折行；外部点击判断同时排除 portal 面板；新增 Esc 与窗口 resize 关闭。
- 回归：`test:open-menu-browser` 夹具加 40px `overflow: hidden` 标题栏，新增 6 项（100%/125% 缩放下面板中心可命中、贴按钮、菜单项单行；Esc 关闭；真实 CDP 鼠标点击菜单项触发 `reveal_path` 且菜单关闭；点击外部关闭）。新代码 40/40；旧 TopBar 36/40（裁剪 ×2、Esc、真实点击失败）。
- 真实应用：after-13 / after-14 截图面板完整可见；Playwright 真实点击触发 → 资源管理器打开 `openmenu-notes` 并选中 `读书笔记.md`（`explorer-select-real-click.txt`）；期间 console/pageerror 0（`console-portal-fix.jsonl`）。

## 8. 完整 verify 与已知问题

- `npm run build`：通过。
- `npm run verify`（PowerShell，rebase 到 main `c513766` 之后）：83 步中 82 步通过（含 `test:open-menu-target`、`test:open-menu-browser` 34/34、cargo 249 通过），唯一失败 `test:ui-state`（`verify-ui-state.mjs:383`），main 上已有。
- 追加面板裁剪修复后再跑 PowerShell `npm run verify`：`test:open-menu-target` 通过、`test:open-menu-browser` 40/40；失败 2 步——`test:ui-state:383`（main 已有），以及 cargo 4 项 `managed_image_io` / `markdown_images` 报 `os error 32`（文件被其他进程占用，本轮未改 Rust）；单独重跑这 10 项及完整 `cargo test` 均通过（249 passed，`cargo-full-rerun.txt`），判定为 Windows 文件锁瞬时失败。`npm run build`、`test:architecture`、`test:agent-status` 通过。
- 已知且与本任务无关：`test:ui-state`（`verify-ui-state.mjs:383`）在 main 上已失败；未注册到 verify 的 `scripts/verify-note-toolbar.mjs` 在 main 上已失败（断言的 `DocumentToolbarProvider enabled=` 源码已被其他任务改掉）。均未修改。

## 9. 提交与合入

见 `plans/PROJECT_STATUS.json` / `docs/notes/AGENT_STATUS.md` 本任务条目与板上提交记录（delivery commit / merge commit）。

## 10. 改动文件

- 新增：`src/workbench/openMenuTarget.ts`、`src/ui/openMenuActions.ts`、`scripts/verify-open-menu-target.mjs`、`scripts/verify-open-menu-browser.mjs`、`scripts/fixtures/open-menu-host.tsx`、本文档
- 修改：`src/workbench/WorkbenchTopBar.tsx`（仅 `.workbench-topbar-actions` 内的打开菜单块和 props，面板 portal 到 body；`.workbench-document-controls` 未动）、`src/ui/App.tsx`（TopBar 接线 + 目标计算，约 20 行）、`src-tauri/src/app_paths.rs`、`src-tauri/src/project_commands.rs`、`src-tauri/src/library_import.rs`、`src/features/reader/PdfResourceTab.tsx`、`scripts/verify-reader-labels.mjs`、`scripts/verify-all.mjs`、`package.json`、状态文件
- 未新增 `if (scene === …)` 分支；未改 `types.ts` / `lib.rs` / `tokens.css` / `workbench.css`；依赖方向 ui → workbench → core 保持
