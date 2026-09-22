# 任务场景标题栏空白区可拖动 — 竞行执行记录（2026-09-22）

- 任务：`8cc3cc88-3837-434d-ae0f-34e294972aff`（normal）「任务场景标题栏：流程切换与右侧按钮之间的空白区必须能拖动窗口 / 双击最大化」
- 执行：竞行（worker 会话 `arena-worker-jingxing`），worktree `.worktrees/task-titlebar-drag-jingxing`，分支 `fix/task-titlebar-drag-jingxing`，基线 main `38fe2e1`
- 用户现象：任务界面标题栏里「总览 / 任务队列 / 正在进行 / 待检查效果 / 已归档」右侧的大片空白按住鼠标不能拖动窗口（截图红圈）。

## 根因

- `src/workbench/windowTitlebarGestures.ts` 的空白判定会沿祖先链查找 `[data-window-no-drag]`；命中即视为控件、不启动拖动。
- `TaskStageSwitcher` 把 `data-window-no-drag` 放在外层 `<nav class="tb-stage-nav">` 上，而 `.tb-stage-nav` 的公共样式是 `flex: 1 1 auto; min-width: 0`（`task-stage-views.css`，为 `.tb-filters` 行内布局服务）。放进标题栏后 `nav` 从切换器右缘一直生长到「发布者提示词」左侧，`document.elementFromPoint` 在整段空白上返回的都是 `nav.tb-stage-nav[data-window-no-drag]`，因此 mousedown / dblclick 都被判定为「控件」而不是空白。
- `task-titlebar-actions.css` 第 4 行的 `-webkit-app-region: no-drag` 与注释「空白带必须保持可拖动」在 WebView2 / 本仓库自研手势下毫无作用，反而掩盖了真正的边界。
- 旧代码红测（未改 src，只加新断言）：`Titlebar blank strip at x=761 … {"tag":"NAV","cls":"tb-stage-nav","noDrag":true}`，见 `.tmp/jingxing/stage-red-final.log`。

## 修改

| 文件 | 改动 |
| --- | --- |
| `src/features/taskboard/TaskStageViews.tsx` | `data-window-no-drag` 从 `<nav>` 移到真正的控件面 `.tb-stage-switch`；`nav` 只做布局盒。 |
| `src/features/taskboard/task-titlebar-actions.css` | 删除无效的 `-webkit-app-region` 规则与误导性注释，改为说明手势来源；标题栏内 `.tb-titlebar-actions > .tb-stage-nav { flex: 0 1 auto; margin-right: auto }`：不再生长进空白带，窄窗仍可收缩（`min-width: 0` + `overflow-x: auto` 保留在 `task-stage-views.css`），空白带归属普通容器 `.tb-titlebar-actions`。 |
| `scripts/verify-task-stage-integration.mjs` | 夹具 Host 改为真实壳结构 `header.workbench-topbar > .workbench-breadcrumb + .workbench-document-controls + .workbench-topbar-actions`（此前 controls 不会像生产一样 `flex:1 1 auto` 拉伸，无法复现问题）；新增坐标级断言：切换器右缘到右侧首个控件之间的左/中/右三点 `elementFromPoint` 不在 no-drag/控件内，且用 CDP `Input.dispatchMouseEvent` 真实指针 mousedown+dblclick 得到 `start_dragging,toggle_maximize`；阶段按钮与切换器内衬垫上的真实指针不触发任何手势；工作区位置断言附带数值。 |
| `scripts/verify-taskboard-compact.mjs` | 拖动边界断言改为：`.tb-titlebar-actions` 与 `nav` 均无 `data-window-no-drag`，`.tb-stage-switch` 有，且 `nav` 宽度 ≤ 切换器宽度 + 8。 |
| `docs/evidence/task-titlebar-drag-jingxing-2026-09-22/*.png` | 原生与浏览器证据（见下）。 |

未新增第二套手势监听；`.tb-filters > .tb-stage-nav { flex: 1 1 480px }` 的页面内布局未动。

### 其他场景标题栏宿主审计

`data-window-no-drag` 在 `src/` 中仅此一处使用；`INTERACTIVE_TARGET` 只识别 `button/[role=tab|button|menuitem*]/a[href]/input/select/textarea/[contenteditable]/[data-window-no-drag]`。文献库视图切换（`role="group"`）、阅读器 `header.reader-toolbar`（`tabIndex=0`）、Markdown 模式切换均不会把生长容器标记为控件，原生实测「总览 / 文献库 / 阅读 / 笔记」标题栏空白三点均 `start_dragging`。

## 验证

### 浏览器回归（Chrome headless，真实 CDP 指针）

- 红测：旧 src + 新脚本 → 断言在 x=761 命中 `nav[data-window-no-drag]` 失败（预期）。
- 绿测（本分支）：新增坐标断言全部通过；三点 hit 均为 `div.tb-titlebar-actions`，手势 `start_dragging,toggle_maximize`；阶段按钮 / 切换器衬垫 → 空。
- 既有失败边界（与本任务无关，main 上同样失败，已复核）：
  - `verify-task-stage-integration.mjs` 在本分支与未修改 main 均止于后段「Developer report is not fabricated independent approval」（`.tb-review-summary` 文案已变）。
  - `verify-taskboard-compact.mjs` 在本分支与未修改 main 均止于第 144 行字号快照（`15→16px`、`25→27px` 等，全局字号漂移），本任务新增的边界断言（第 120 行）在其之前通过。
  - 两脚本均不在 `npm run verify`（`scripts/verify-all.mjs`）之内。

### 原生隔离实例（`npm run dev:live -- --instance jingxing --port 1425 --cdp-port 9235`，worktree 内新建，状态条 `DEV jingxing · 独立测试库（原生已核验 …/AsterData）`）

- 连接态由临时 `createTaskServer`（系统临时目录、3 条夹具任务）经「手动连接 / 远程服务」表单接入，**未触碰 4319 生产看板与其凭据**；观察手势用 CDP 网络事件只读记录 `ipc.localhost/perform_window_command` 的 `{command}`，不劫持 IPC。
- DPR 1.25；窗口宽度用 `MoveWindow` 设为 2400 / 1568 / 1280 / 1050 CSS px：

| 宽度 | 切换器右缘→右侧首控件 | 三点 hit | mousedown | 中点 dblclick | 阶段按钮 dblclick |
| --- | --- | --- | --- | --- | --- |
| 2400（用户最大化宽度） | 750→1300（550px） | 均 `div.tb-titlebar-actions` | `start_dragging`×3 | `start_dragging,toggle_maximize`，窗口真实最大化后还原 | 空 |
| 1568 | 750→884（134px） | 同上 | `start_dragging`×3 | 同上 | 空 |
| 1280 | nav 收缩 398/438，无空白带（间距 8px） | — | — | — | 空；nav 仍可横向滚动 |
| 1050 | nav 收缩 241/438，无空白带 | — | — | — | 空 |

- 未连接态任务场景（标题栏仅提示词按钮）：空白点 hit `header.workbench-topbar` → `start_dragging` / `start_dragging,toggle_maximize`。
- 主题 `midnight` 与界面缩放 125% / 150%（2400 宽）：空白中点均 `start_dragging` 与 `start_dragging,toggle_maximize`。
- 真实系统鼠标（`SetCursorPos + mouse_event`，run2）：在 1568 宽空白中点（CSS 817,20 → 物理 1070,66）按下并移动 180×60 px，窗口 `GetWindowRect` 从 (40,40) 移到 (220,100)；同点真实双击 → `IsZoomed=true`（3042×1254），再次双击 → 还原 1978×1266；真实单击「任务队列」按钮 → 阶段切到 `queued`，窗口位移 0。
- 后续 run4 重跑时目标窗口不在前台 / 被最小化，`win.ps1` 的守卫（`WindowFromPoint`+前台校验）直接放弃系统级注入（`moved 0`），CDP 部分结果不受影响。

### 证据文件

- `docs/evidence/task-titlebar-drag-jingxing-2026-09-22/native-titlebars-2400-1568-1280-unconnected-midnight.png`：原生标题栏五行（红点为实测坐标）。
- `docs/evidence/task-titlebar-drag-jingxing-2026-09-22/native-os-drag-before-after.png`：系统鼠标拖动前后（窗口相对桌面位移）。
- `docs/evidence/task-titlebar-drag-jingxing-2026-09-22/native-dblclick-maximized-with-dev-strip.png`：双击后最大化，底部 DEV 状态条。
- `docs/evidence/task-titlebar-drag-jingxing-2026-09-22/browser-harness-titlebar-1568-after-fix.png`：浏览器夹具修复后标题栏。
- 原始日志 / 全尺寸截图：`.worktrees/task-titlebar-drag-jingxing/.tmp/jingxing/`（`stage-red-final.log`、`stage-green3.log`、`compact-green.log`、`native-check.log`、`native-results.json`、`shots/`、`shots-run2/`），不入库。

### 构建与全量验证

- `npm run build`（tsc -b && vite build）退出 0。
- `npm run verify`（`scripts/verify-all.mjs`，57 步，独立控制台运行；首次在 PTY 后台运行时 cargo 收到 CONTROL_C 中断故重跑）：56 步通过，含 `cargo test` 215 passed / 0 failed / 5 ignored；仅 `npm run test:project-tasks` 的 `tools.test.mjs`「real CLI and MCP stdio clients share tasks but not agent identities」失败，报错 `看板服务身份不匹配：不是当前项目`。该用例在未修改的 `D:\WorkSpace\Aster` main 上、清空 `TASKS_PROJECT_ROOT/TASKS_EXPECTED_PROJECT_ID` 后同样失败（`.tmp/jingxing/test-project-tasks-main.log`）：本机已为生产项目确认看板身份，CLI `join` 的 `checkService` 用该 projectId 校验测试临时服务，属环境/既有问题，与本任务改动（仅任务看板 UI 与两份浏览器回归脚本）无关。
- `get_diagnostics`（VS Code 语言服务，全工作区）：0 条。

## 边界与未做

- 未打包、未安装、未推送、未发布。
- 未修改生产看板服务、未运行 `access`。
- 原生取证的连接态来自临时服务，与生产项目列表无关（截图中「暂无项目」属预期）。
- 1280 px 及以下宽度本就没有空白带（nav 收缩、可滚动），此为既有窄窗布局，不在本任务范围。

