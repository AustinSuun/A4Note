# 阅读器「正在阅读」展开/收起与关闭按钮：去掉鼠标交互绿色外框 — 竞行执行记录（2026-09-22）

- 任务：`3580532a-21e8-4806-b7c5-8909f27caa16`（normal）「阅读器「正在阅读」列表：移除展开/收起按钮点击后的绿色外框，悬停与按下只保留浅色背景，键盘焦点轮廓保留」
- 执行：竞行（worker 会话 `arena-worker-jingxing`），分支 `fix/reader-expand-outline-jingxing`，基线 main `e071e00`。为复用已编译好的 dev:live 隔离实例（vite 1425 / CDP 9235），分支直接在既有 worktree 目录 `.worktrees/task-titlebar-drag-jingxing` 内检出，目录名沿用上一任务，不影响内容。
- 用户现象：点击「正在阅读」条目左侧的展开/收起箭头后，按钮四周出现一圈绿色外框（附件 `reader-expand-outline-reference.png`）。

## 根因（隔离实例真实鼠标事件复现，非静态推断）

`src/features/paper-notes.css` 中 `.reader-scene-sidebar .reader-paper-row .reader-paper-expand / .scene-context-item-close` 的鼠标反馈规则：

| 时刻 | 修复前 computed（隔离实例 CDP `Input.dispatchMouseEvent`） | 来源 |
| --- | --- | --- |
| 悬停 | `border-color: rgb(82,123,104)`（`--accent`），背景 `--accent-soft` | `:hover { border-color: var(--accent) }` |
| 按下 | 同上 + `box-shadow: rgb(82,123,104) 0 0 0 2px inset` | `:active { box-shadow: inset 0 0 0 2px var(--accent) }` |
| 点击后鼠标仍停留 | `border-color: rgb(82,123,104)` 持续（这就是用户看到的"点击后的绿色外框"） | `:hover` 仍匹配 |
| 鼠标移开 | 恢复透明 | — |
| 展开态再悬停/按下 | 与上相同 | 同上 |
| 关闭按钮 | 与上相同 | 同一组规则 |

键盘 `:focus-visible` 的 2px 轮廓是独立规则，鼠标点击后 `:focus-visible` 不匹配（修复前后均为 `false`），不是外框来源。7ef5d0fd 当时有意保留了这套"边框 + 内阴影"按下反馈，本任务按用户要求收窄为仅背景。

## 修改

| 文件 | 改动 |
| --- | --- |
| `src/features/paper-notes.css` | `:hover` 改为 `background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: transparent; box-shadow: none`；`:active` 改为 24% 半透明 accent 背景，`border-color: transparent; box-shadow: none`；新增 `:focus:not(:focus-visible)` 兜底（outline/box-shadow/border 全清）；`button:focus-visible` 2px 轮廓规则原样保留。选择器仍限定在 `.reader-scene-sidebar .reader-paper-row` 内，`li.active` 背景与其他场景的 `.scene-context-item-close` 规则未动。 |
| `scripts/verify-reader-list-browser.mjs` | 旧断言「Visible pressed state」（要求 `box-shadow !== none`）改为「pressed state is background only」；新增 `frameOf`/`sweep`：展开按钮、展开态按钮、关闭按钮各自走 悬停 → 按下 → 松开（鼠标仍停留）→ 移开 的 CDP 鼠标序列，断言 computed `outline none / box-shadow none / border 透明`、背景确有变化、移开后无残留、34×34 几何 ±1px、点击仍切换笔记列表、展开态仅由箭头表达；以及扫完鼠标后键盘 Tab 到展开按钮仍 `:focus-visible` 有轮廓。 |
| `docs/evidence/reader-expand-outline-jingxing-2026-09-22/*` | 原生与浏览器证据（见下）。 |

背景改用半透明 accent 而不是 `--accent-soft`，是因为当前行 `li.active` 的背景本身就是 `--accent-soft`（`rgb(232,238,233)`），若沿用则悬停在当前行上完全看不出反馈；半透明色在三套主题下叠加在任意行背景上都可见。

## 验证

### 回归脚本（Windows 隔离 Chromium + 真实 React 组件夹具）

- 红：旧 CSS（`git show HEAD:src/features/paper-notes.css`）+ 新脚本 → `passed 35 failed 9`，失败项恰为 9 条外框断言（`Visible pressed state is background only`、`Expand chevron / Expanded chevron: hover / press / released with pointer still over`、`Close button: hover / press`），日志 `.tmp/jingxing/reader-list-red.log`。
- 绿：修复后 → `passed 44 failed 0`，证据目录 `.a4-tests/reader-list/reader-list-2026-09-22T13-02-44-562Z`，截图见 `docs/evidence/.../browser-harness-green.png`。

### 隔离实例原生取证（dev:live `jingxing`，WebView2，DEV 条 `app.aster.research.dev.jingxing.w03dd305da8`）

驱动 `.tmp/jingxing/expand-outline-check.mjs`（playwright-core `connectOverCDP` + 原生 CDP `Input.dispatchMouseEvent/KeyEvent`）：先通过真实 `import_pdf_to_library` 命令把 `docs/pdf_test/2505.13447v1.pdf` 导入隔离库（`paper-2e8fe125…`），从文献库双击打开进入阅读器，再对 `.reader-paper-expand` / `.scene-context-item-close` 逐时刻读取 computed style 并截图。完整数据 `native-results-before.json` / `native-results-after.json`。

| 时刻（修复后） | border | box-shadow | outline | 背景 | 尺寸 |
| --- | --- | --- | --- | --- | --- |
| 悬停 | transparent | none | none | `color(srgb … / 0.14)` | 34×34 |
| 按下 | transparent | none | none | `color(srgb … / 0.24)` | 34×34 |
| 点击后鼠标仍停留（已展开 `aria-expanded=true`） | transparent | none | none | 0.14 tint | 34×34 |
| 鼠标移开 | transparent | none | none | transparent | 34×34 |
| 展开态静止 / 展开态悬停 / 展开态按下 / 再次点击收起 | transparent | none | none | 同上 | 34×34 |
| 关闭按钮 悬停 / 按下 / 拖离松开 | transparent | none | none | 同上 | 34×34 |

- 键盘：Tab 到展开按钮与关闭按钮 `:focus-visible` 均为 `true`，`outline solid`（accent）；Enter 切换展开；随后用鼠标点击展开按钮，`:focus-visible=false`、移开后无任何残留（`native-keyboard-focus-kept.png`）。
- 主题 × 缩放 × 窄宽：default / paper / midnight × body zoom 1 / 1.25 × `--sidebar-width` 220 / 260 / 320，共 18 组，展开与关闭按钮的悬停、按下全部 frameless，侧栏 `scrollWidth - clientWidth = 0`，恢复后尺寸仍 34×34（`native-theme-zoom-narrow-pressed.png`，`results.matrix`）。
- 修复前后两轮原生取证控制台/页面错误均为 0。
- 修复前同一驱动的对照：悬停/按下/点击后停留 `frameless=false`（见根因表与 `native-six-moments-before-after.png`）。

### 构建与全量

- `npm run build`（`tsc -b && vite build`）EXIT 0（`.tmp/jingxing/expand-build.log`）。
- `npm run verify`（`scripts/verify-all.mjs`）：见下文「全量结果」。

## 全量结果

- `npm run verify`（`scripts/verify-all.mjs`，60 步，独立控制台运行，日志 `.tmp/jingxing/expand-verify.log`）：59 步通过，含 `cargo test` 215 passed / 0 failed / 5 ignored；唯一失败 `npm run test:project-tasks` → `apps/project-tasks/test/tools.test.mjs`「real CLI and MCP stdio clients share tasks but not agent identities」报「看板服务身份不匹配：不是当前项目，未发送任何连接凭据」，与本次改动无关（上一任务 8cc3cc88 在未修改 main 上同样失败，属本机看板环境差异）。
- `scripts/verify-reader-list-browser.mjs` 不在 verify-all 内，单独运行：旧 CSS 35/44（9 项外框断言失败）→ 新 CSS 44/44。
- 隔离实例两轮原生取证（修复前 / 修复后）`consoleErrors = 0`。

## 未覆盖 / 边界

- 未做打包、安装、发布；隔离实例为 dev:live 开发态 WebView2，生产包中同一 CSS 同源。
- 其他场景侧栏（任务、文献库等）的 `.scene-context-item-close` 走 `workbench.css` 原规则，本次未改动，也未逐场景截图。
- `color-mix()` 在仓库 CSS 中已有 140+ 处使用，WebView2 支持无需回退。
