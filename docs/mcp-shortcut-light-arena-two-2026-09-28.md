# 命令面板常驻快捷键标签移除 + 浮动快捷键提示轻量底框 — 接管交付（arena-two，2026-09-28）

任务：`1f6e50b2-e068-4559-81fc-c8bc9007163d`（spec3）。原执行者（星序）已完成产品改动与定向验证但未合并本地 main、未提交验收（见 `docs/mcp-shortcut-light-xingxu-2026-09-27.md`）；用户 2026-09-28 明确指示由 arena-two 接手完成。

## 接管方式

- 未直接使用原 worktree `.worktrees/shortcut-light-xingxu`（其分支含两个与 main 并行的合并提交）。在自有 worktree `.worktrees/shortcut-light-arena-two` 上以当前本地 main `2a4ee34` 为基线 cherry-pick 原产品提交 `9b26596`（`style(shortcuts): remove permanent label and flatten hint surfaces`）。
- 仅 `docs/notes/AGENT_STATUS.md`、`plans/PROJECT_STATUS.json` 两处状态文件冲突，按「双方条目都保留、`updatedAt` 取 main」解决；产品代码与测试无冲突。
- 产品改动保持原样，未再扩大范围：
  - `src/workbench/ProjectSidebar.tsx`：删除命令面板按钮里的常驻 `<kbd>`（及因此无用的 `useShortcuts` / `formatBinding` 导入）；按钮、图标、可见标签、`title`、`aria-keyshortcuts`、点击与快捷键分发全部保留。
  - `src/shared/shortcuts/shortcuts.css`：浮动提示行 `::before` 与键帽共用不透明 `--surface-soft` 平面护底，4px 圆角，去掉阴影 / 背景模糊 / 文字光晕；禁用行只弱化文字颜色。键帽 16px、功能名 15px、compact 回退 14px、列宽与布局算法不变。
  - 验证环境：`scripts/dev-live-config.mjs` / `scripts/dev-live.mjs` 为每个 dev:live 身份使用独立 `viteCacheDir`（共享 `node_modules` junction 时不再串用 `.vite` 缓存），`scripts/verify-dev-live.mjs` 增加对应断言。
  - 回归：`scripts/fixtures/shortcuts.tsx` 新增 `?sidebar` 路由渲染真实 `ProjectSidebar`；`scripts/verify-shortcuts-browser.mjs` 断言平面不透明护底、无阴影 / 模糊 / 光晕、禁用行同底色、侧栏无 `kbd`、可访问名称 / `aria-keyshortcuts` / title、点击与 Ctrl+K / Ctrl+Shift+P / Enter 分发、无关徽标保留、持久自定义绑定不复现标签。

## 在当前 main 上的重新验证（arena-two）

| 项目 | 结果 |
| --- | --- |
| `npx tsc -p tsconfig.app.json --noEmit` | 0 错误 |
| `npm run build` | 通过 |
| `npm run test:shortcuts` | core / dispatcher 63 / layout 36 / settings 22 通过 |
| `npm run test:shortcuts-browser` | 508 项通过，0 浏览器错误 |
| `npm run test:dev-live` | 通过（含 viteCacheDir 隔离断言） |
| `npm run test:architecture` | 通过 |
| 原生改前（隔离实例 `arena-two-board`，main `2a4ee34` 代码，1499/9329） | 侧栏命令面板按钮含 1 个 `kbd`「Ctrl+K / Ctrl+Shift+P」；按住 Ctrl 的阅读器浮动提示 47 行：行底 `rgba(255,255,255,.94)` + `blur(12px)` + `0 2px 10px` 阴影 + 7px 圆角，键帽 `blur(8px)` + 阴影，功能名带白色光晕（midnight 同构） |
| 原生改后（隔离实例 `arena-two-light`，本分支，1499/9329） | 侧栏 `kbd` 0 个；可见标签「命令面板」、可访问名称「命令面板」、`title`「命令面板 · Ctrl+K / Ctrl+Shift+P」、`aria-keyshortcuts` `Control+K Control+Shift+P` 保留；点击与 Ctrl+K 均打开命令面板，Esc 关闭；设置入口与图标保留。阅读器 47 行提示：行底 `rgb(241,242,241)`（midnight `rgb(51,64,57)`）alpha 255、`box-shadow: none`、`backdrop-filter: none`、4px 圆角、0 边框；键帽同底色、无阴影 / 模糊、16px / 28px 高；功能名 15px、无光晕；全部行在视口内；松开 Ctrl 隐藏。两轮 pageerror / console.error 均为 0 |

证据：`docs/screenshots/shortcut-light-arena-two/`（`before-*` / `after-*`：侧栏全图与底部特写、命令面板打开、阅读器浅色 / midnight 提示全图与特写）；原始 `steps.json` 在 `.tmp/shots/shortcut-light-native/{before,after}/`；测试日志 `.tmp/test:*.txt`、`.tmp/build.txt`、`.tmp/tsc.txt`。

说明：原生 midnight 对照通过在页面上切换 `data-theme` 取得（与设置里切换主题作用的是同一属性），截图后恢复原主题；DEV 身份条在全部全图中可见；未触碰正式资料库，未打包 / 安装 / 推送 / 发布。

## 与相邻任务的关系

- 7e18e7d8（组合键提示抑制，已 review）与本改动作用于不同层：那边改显示时机，这里只改 `shortcuts.css` 外观与侧栏标签；两者在当前 main 上共存并通过同一套快捷键回归。
- 2e96c3ee / 63b530ee（键帽尺寸与对比度，已归档）确定的 16px 键帽 / 15px 功能名保持不变。
