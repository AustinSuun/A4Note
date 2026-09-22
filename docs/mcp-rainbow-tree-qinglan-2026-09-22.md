# 目录树彩虹层级线恢复修复交接（青岚，2026-09-22）

任务：`7876734f-ed8d-4a06-a103-f4af379a785a`（用户退回后的恢复修订）

## 退回审计与恢复

用户指出上一版截图“捣乱了，让效果更糟糕”。对比原实现 `38fe2e1` 与被退回提交 `9e32e07` 后确认，上一版改变了既有视觉语言：新增每行水平连接臂，并让父级竖线在最后一个直接子项处提前截止，导致嵌套树中父级层级不再连续。

本修订先恢复视觉，再保留必要的根因修复：

- 删除 `.file-tree-guide-branch` 的 DOM、CSS 和几何 API，不再绘制参考效果中不存在的水平线。
- 恢复父级竖线覆盖完整可见子树；折叠、空文件夹和末端仍不产生幽灵线。
- 保留 CSS `zoom` 坐标反变换：用容器 `getBoundingClientRect()/offsetWidth|offsetHeight` 得到实际比例，将视口测量还原为局部布局坐标，避免坐标写回后再次缩放。
- 保留共享深度轴归一化：Explorer 按钮行、Library wrapper 行、选中/编辑/长名称等不同 DOM 状态都使用同一 `--file-tree-depth-step` 网格，不做截图层级固定补偿。
- Markdown/笔记 Explorer 与 Library 文件类树仍共用 `TreeGuides`，未改变展开、选择、键盘、重命名、新建、菜单、拖拽、滚动或持久化逻辑。

## 真实组件几何证据

`npm run test:tree-guides-browser` 使用真实 React 组件、Vite 和 Windows Chrome，覆盖：

- Explorer 与 Library 两种适配 DOM；
- 1–6 级、文件夹/文件、选中行、徽标、长中英文名称和窄容器；
- UI zoom 80%、100%、125%、150%；DPR 1、1.25、1.5，共 24 组；
- 断言零水平连接臂、父级竖线覆盖完整可见子树、轴线与深度步长稳定。

结果：24/24 通过；最大竖线轴误差 `0.03125px`，层级步长最大误差 `0px`，完整子树末端最大误差 `0.203125px`；pageerror 与应用 console error 为 0。证据位于 `.tmp/shots/tree-guides/2026-09-22T13-00-35-632Z/`。

## 验证

- `npm run test:library-behavior`：通过；覆盖完整可见子树、折叠/空节点、可变行高、固定层级轴与零连接臂。
- `npm run test:tree-guides-browser`：24/24。
- `npm run test:note-workbench`：51/51。
- `npm run test:note-workbench-browser`：42/42。
- `npm run test:reader`：通过。
- `npx tsc -b --pretty false`：通过。
- `npm run build`：通过（仅既有 chunk size / dynamic import 警告）。
- `npm run verify`：通过；A4Note verification passed，Rust 215 passed / 5 ignored。
- `npm run test:agent-status`、`git diff --check`：通过。

未打包、安装、推送或发布；未访问或修改正式资料库。
