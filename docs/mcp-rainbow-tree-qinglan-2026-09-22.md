# 目录树彩虹层级线修复交接（青岚，2026-09-22）

任务：`7876734f-ed8d-4a06-a103-f4af379a785a`

## 根因与修复

共享 `TreeGuides` 原先直接把 `getBoundingClientRect()` 的已缩放视口坐标写回绝对定位 `left/top/height`。A4 Note 在 `App.tsx` 对根元素使用 CSS `zoom`（80%–150%），因此坐标会被再次缩放；嵌套越深，横向误差越大。另一个结构性问题是竖线一直延伸到最深后代的行底，而不是最后一个直接子项的连接点，造成父线跨入错误层级；旧实现也没有可验证的父子短横连接规则。

统一修复位于共享树层：

- `TreeGuides.tsx` 通过容器 `getBoundingClientRect()/offsetWidth|offsetHeight` 得到实际缩放比，将视口坐标还原为局部布局坐标后再定位；旋转箭头使用未变换 `offsetWidth` 作为安全终点。
- `normalizeTreeGuideAxes` 以 `--file-tree-depth-step` 将不同 DOM 形态（按钮、wrapper、重命名/新建行、文件 spacer）归一到固定层级轴。
- `treeGuideLayout` 只让竖线连接直接子项，末端停在最后一个直接子项中心；每个可见子项增加一条短横线并在箭头/spacer 前 2px 结束。
- Markdown/笔记文件树 `FileTreePanel` 与文献文件类树 `LibrarySceneSidebar` 均复用同一 `TreeGuides` 和 `workbench.css`，全仓没有第三处彩虹线实现或复制偏移。

## 几何证据

真实 React 组件 + Vite + Windows Chrome 回归：`npm run test:tree-guides-browser`。

- 两种适配 DOM：Explorer（`data-tree-row` 在按钮）与 Library（`data-tree-row` 在 wrapper）。
- 1–6 级；文件夹/文件、选中行、HTML 徽标、长中英文名称、窄容器。
- UI zoom：80%、100%、125%、150%；DPR：1、1.25、1.5，共 24 组。
- 最大竖线轴误差：`0.03125px`。
- 层级步长最大误差：`0px`。
- 末端连接最大误差：`0.1875px`。
- 24/24 通过，pageerror 与应用 console error 为 0。
- 证据：`.tmp/shots/tree-guides/2026-09-22T12-02-09-554Z/result.json` 与 `tree-guides-125pct-dpr125.png`。

## 回归与验证

- `npm run test:tree-guides-browser`：24/24 通过。
- `npm run test:library-behavior`：通过；包含直接子项收尾、可变行高、短横终点、6 级固定轴红测。
- `npm run test:note-workbench`：51/51。
- `npm run test:note-workbench-browser`：42/42，证据 `.tmp/shots/note-workbench/run-2026-09-22T11-59-02-350Z`。
- `npx tsc -b --pretty false`：通过。
- `npm run build`：通过（仅既有 chunk size / dynamic import 警告）。
- `npm run verify`：退出 0；完整前端矩阵与 Rust 215 项通过（5 ignored），仅既有编译警告。

未打包、安装、推送或发布；未访问或修改正式资料库。
