# 快捷键提示按住延迟（ce00c501）— 听澜交付记录

- 任务：`ce00c501-7d5a-4243-8b36-993dafa5a773`（normal，spec1）：快捷键提示矩阵显示前增加按住延迟。用户在对话中授权 听澜 以 dispatcher（调度-听澜）发布任务，并由 worker 会话领取执行。
- 分支：`fix/shortcut-hint-delay-tinglan`（worktree `.worktrees/shortcut-hint-delay-tinglan`），原始基线 main `6b59170`，交付前整合 summary 交付 `9edc5d2`；实现提交 `30f476f` 已 ff 合入本地 main。
- 边界：只改提示显示时机与对应回归脚本的等待时长；未改快捷键清单/绑定、命令执行、提示布局/键帽/CSS、场景/笔记/资料数据；未打包、未安装、未推送、未发布。

## 1. 现状与需求

- 用户截图：阅读笔记页面按住 Ctrl 立即弹出整个快捷键提示矩阵（工具锚点 + 浮动行），遮挡正文。希望其"出现可以加一个延迟"，避免使用熟悉按键组合时频繁闪现。
- 根因（修改前 `src/shared/shortcuts/dispatcher.ts`）：Ctrl keydown 后 `setTimeout(..., 150)` 即 `store.setHint(true)`。熟悉组合键（Ctrl+B/H/Z/F…）的"修饰键按下→字母键按下"间隔很容易超过 150ms；快速点按 Ctrl 也可能短暂误触发。
- 需求：显示前增加明确按住延迟（≈500ms、单一可调常量），只有用户真正停下按住 Ctrl 才显示；既有抑制/清除逻辑（按下其他键构成组合、松开 Ctrl、窗口失焦、页面隐藏、场景切换、弹窗、录制、IME/AltGraph）全部保留。

## 2. 实现

### 2.1 唯一延迟常量（`src/shared/shortcuts/dispatcher.ts`）

- 新增导出 `HINT_HOLD_DELAY_MS = 500`（注释说明用途），替换 `setTimeout(..., 150)`。`setHint(true)` 全局仅这一处调用点，无第二触发路径。
- 常量是唯一的后续调优点；如未来需要用户级可调，可直接接到快捷键设置卡，无需再改调度逻辑。

### 2.2 回归脚本跟随（`scripts/`）

- `verify-shortcut-dispatcher.mjs`：阈值断言改为 `advance(HINT_HOLD_DELAY_MS - 1)` / `advance(1)`（假时钟）；新增"按 300ms 松开、再等 400ms 仍不出现"断言（`familiar quick phrases never flash hints`）；"组合键抑制"断言 `advance(200)`→`advance(600)`，在新阈值之后仍验证不显示。
- `shortcut-test-runtime.mjs`：把真实常量从 `dispatcher.ts` 透传给单测，不再硬编码数字，常量变更测试自动跟随。
- `verify-shortcuts-browser.mjs`：需要矩阵可见的 5 处 `keyboard.down('Control')` 后等待 180–200ms→650ms；原有"快速点按从不残留"断言保持 200ms 不变，恰好覆盖新阈值以内的行为。
- `verify-pdf-find-entry-browser.mjs`：Ctrl overlay 步骤等待 250→650ms。

## 3. 验证

- 单元：`test:shortcuts` — core 52 / dispatcher 63（原 50，净增新时序断言）/ hint-layout 36 / settings-ui 22。
- 真实浏览器（Vite 组件夹具 + 本机 Chrome headless）：`verify-shortcuts-browser.mjs` 491/491；`verify-pdf-find-entry-browser.mjs` 35/35。集成状态（rebase 到 9edc5d2 之后）又重放一遍同组全部通过。
- 静态：`npx tsc -b` 0 错误；`npm run build` 通过；`npm run test:architecture` 通过；worktree 范围 VS Code diagnostics 0。
- 原生 dev:live（实例 `tinglan`，port 5302 / CDP 9302；底部条实测 `DEV tinglan · 独立测试库（原生已核验 …）`、state=verified）：
  - 按住 Ctrl 300ms：`.shortcut-hints.is-visible` 不存在（修改前 150ms 已显示）— `01-quick-300ms-hold-hidden.png`；
  - 按住 Ctrl 900ms：矩阵正常显示（9 个 `data-hint-id` 条目）— `02-held-900ms-visible.png`；
  - 松开后 400ms：矩阵消失；全程 pageerror / console error 0。
  - 证据目录：`.tmp/shots/shortcut-hint-delay/`（两张截图 + `result.json`）。
- 工作树前置条件的发现（供后续 Agent 参考）：新 worktree 首次跑 `dev:live` 需从主检出复制被 gitignore 的 `src-tauri/resources/native-host/{a4note-native-host.exe, host-manifest.json}`，否则 `a4note` 的 build.rs 因资源缺失失败，失败只出现在编译日志、对前台像"无声停滞"。

## 4. 影响面与回退

- 影响面仅"Ctrl 按住提示"的出现时机；命令解析与执行（`resolveKeyboardCommand` / `execute`）零改动——熟悉组合键的行为完全不变，只是不再被提示矩阵打扰。
- 回退：单点常量，将 `HINT_HOLD_DELAY_MS` 改回 `150` 即恢复旧体验。

## 5. 合入与看板

- 实现 `30f476f` 已 ff 合入本地 main（对齐并行交付 `9edc5d2` 后重放验证再合入）。本交付文档与状态文件更新随 docs 提交合入。
- 看板任务 `ce00c501`：两张 dev:live 截图经 upload 作为 result 附件，submit 文本为本记录摘要；验收与归档由用户执行。
