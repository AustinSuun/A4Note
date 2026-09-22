# MCP 交付：移除阅读器常驻「查找」按钮，PDF 搜索仅由 `reader.search` 快捷键 / 命令面板触发（arena-two，2026-09-22）

- 任务卡：`6a2240f7`（spec_revision 2）
- 分支：`fix/reader-find-trigger-arena-two`（worktree `.worktrees/find-trigger-arena-two`，基线 `c056588`）
- 提交：`bb020ee` fix(reader): remove the resident PDF 查找 button; search opens only via the reader.search shortcut（+ 本文档提交）

## 1. 问题

`PdfFindBar` 在未打开时渲染一个常驻的 `.pdf-find-trigger`「查找」按钮（PDF 页面右上角），与用户要求的「搜索只由快捷键触发」相冲突；同时快捷键提示层（卡 9230f8ce）把 `reader.search` 锚定到该按钮。

## 2. 变更

| 文件 | 变更 |
| --- | --- |
| `src/features/reader/pdf/PdfFindBar.tsx` | 删除 `.pdf-find-trigger` 按钮及其 `useShortcutProps('reader.search')` 锚点；未打开时 `return null`（DOM 中不存在任何节点，不用 `display:none`）。打开/重选输入框的聚焦改为 `focusRequest` 计数 + `useEffect([open, focusRequest])`（原 rAF 聚焦在事件派发后与 canvas 焦点竞争，会丢焦点）。打开态 UI/行为（输入、↑/↓、×、Esc、Enter/Shift+Enter、Ctrl+F 重选）未改。 |
| `src/features/reader/reader-reliability.css` | 删除 `.pdf-find-trigger` 相关死样式。 |
| `scripts/fixtures/pdf-find-entry.tsx` | 新增：挂载 `PdfFindBar` + 快捷键 dispatcher + 命令注册的浏览器夹具（含 PDF 模式 / 非 PDF 模式切换）。 |
| `scripts/verify-pdf-find-entry-browser.mjs` | 新增回归 `test:pdf-find-entry`（35 项断言）：源码层断言不存在 `.pdf-find-trigger` 控件与样式、不再用 rAF 聚焦；运行时断言关闭态 `PdfFindBar` 渲染为空；`reader-find` 事件打开搜索条并聚焦；`reader.search` 已注册且默认绑定 Ctrl+F；再次 Ctrl+F 只重选输入框；Enter/Shift+Enter/Esc；非 PDF 模式不打开且无 pageerror/console error；Ctrl 提示层中 `reader.search` 作为非锚定 floating 提示出现。截图 `.tmp/shots/pdf-find-entry/{01..03}.png`。 |
| `package.json` / `scripts/verify-all.mjs` | 注册 `test:pdf-find-entry`（`test:shortcuts` 之后）。 |

未新增任何入口（工具栏按钮、右键菜单等）。`reader.search` 仍在 `src/ui/shortcuts/appShortcutCommands.ts` 中注册（默认 Ctrl+F，可在快捷键设置中改绑），并作为命令面板项「搜索当前 PDF」出现。

## 3. 「在旧代码上失败」证明

在 `c056588` 上 `git stash` 源码改动后运行 `npm run test:pdf-find-entry` → 退出码 1，首个失败断言 `no .pdf-find-trigger control or style remains`；恢复改动后 35/35 通过。

## 4. 验证矩阵

| 步骤 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `npm run test:pdf-find-entry` | 35/35 通过 |
| `npm run test:shortcuts` / `test:shortcuts-browser` | 通过（提示层：`reader.search` 以 floating 提示出现，无锚点报错） |
| `npm run test:reader` / `test:ui-state` / `test:architecture` | 通过 |
| `node scripts/verify-reader-priority-fixes.mjs` | 通过 |
| `npm run build` | 通过 |
| `npm run verify` | 通过（`A4Note verification passed`，日志 `.tmp/verify-find.log`） |

## 5. dev:live 隔离实例（原生窗口）验收

- 二进制：`node .tmp/native/build-native.mjs after` → `tauri build --debug --no-bundle`，独立 identifier `app.aster.research.dev.arena-two-find.wcb085547e0`，端口 1498 / CDP 9328，`.tmp/native/bin/a4note-after.exe`（TAURI_BUILD_EXIT=0）。
- 驱动：`node .tmp/native/find-driver.mjs after`（独立 `home`/WebView2 profile，`checkDevAdmission` 准入，CDP 真实键盘事件；合成 30 行 PDF `Find Entry …` 导入到隔离库）。结果 **18 PASS / 0 FAIL**（`.tmp/native/evidence/after/summary.json`、`driver.log`、`app.log`）。

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | 隔离实例：库根位于隔离身份 AppData 下（非生产库） | PASS |
| 2 | DEV 状态条显示 `DEV arena-two-find · 独立测试库（原生已核验 …）` | PASS |
| 3 | 阅读器打开夹具；`.pdf-find-trigger` 数量 0；PDF 区域右上角无任何常驻控件；搜索条关闭 | PASS（`01-reader-rest.png`，与用户截图同区域已无「查找」按钮） |
| 4 | Ctrl+F 打开搜索条并聚焦输入框（activeElement aria-label=`查找文本`） | PASS（`02-ctrl-f-open.png`） |
| 5 | 输入 `flow` → 高亮并计数 `1/60`；Enter → `2/60`；Shift+Enter → `1/60` | PASS |
| 6 | 搜索条打开时再按 Ctrl+F：仍只有 1 个搜索条，输入框全选 `flow`（0–4） | PASS |
| 7 | Esc 关闭搜索条，关闭后仍无 trigger | PASS（`03-after-escape.png`） |
| 8 | Ctrl+K 命令面板 → 「搜索当前 PDF」→ 打开搜索条并聚焦 | PASS（`04-palette.png`） |
| 9 | 长按 Ctrl 提示层：`reader.search` 以 floating（非锚定）提示出现，键帽 `Ctrl + F` + 功能名「搜索当前 PDF」；按钮类提示（zoomIn）仍为 adjacent 锚定 | PASS（`05-ctrl-hints.png`） |
| 10 | 非 PDF 模式：合成夹具无译文，切「译文」后 surface 仍为 PDF（`原文译文对照118%`）— 原生无法进入非 PDF 分支，记为 NOTE；该分支由浏览器回归 `test:pdf-find-entry`（非 PDF 模式 Ctrl+F 不打开、无 pageerror/console error）覆盖 | NOTE（`06-non-pdf-attempt.png`） |
| 11 | 全程无 uncaught pageerror / console error | PASS |

未重启 4319 开发实例，未触碰真实文献库。

## 6. 约束遵守

- 独立 worktree；未安装/打包/发布；未重启 4319；未触碰真实文献库（隔离实例使用独立 `home`/profile 与独立 identifier）。
- 交付后合并到本地 `main`，并通过任务看板提交 delivery JSON（kind=code，base `c056588`）。
