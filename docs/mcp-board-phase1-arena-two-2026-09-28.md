# 白板 · 阶段 1 交付：统一板面资源 + 自由白板 + 笔记/阅读器双入口共享（arena-two，2026-09-28）

任务：`4093839c-fc9a-41d6-9fc5-1b38a8701f55`（将自由白板/脑图/线索板集成到笔记并与文献阅读笔记共享）。
本文档只描述阶段 1 的实际交付；阶段 0 调研（865d6308）不是已批准设计，阶段 2/3 的范围见文末。

## 0. 用户确认的设计决策（2026-09-27/28）

| 议题 | 决定 |
| --- | --- |
| 画布引擎 | 自研（React + SVG），**不安装任何第三方依赖** |
| 分期 | ① 板面资源模型 + 自由白板 + 双入口共享（本次）→ ② 脑图 → ③ 线索板；每期独立合并、提交验收 |
| 存储 | 板面是笔记工作区内的**独立文件类别** `*.a4board`，在笔记文件树中新建/打开/编辑；Markdown 用 wiki 链接引用；阅读笔记通过引用**同一文件**共享 |
| 线索板来源（阶段 3） | 文献 / 整篇笔记 / PDF 标注：活导航引用 + 冻结摘录快照；来源失效 → 卡片显式失效、可手动重连 |
| 数据迁移 | **无**。不改写任何既有笔记、阅读笔记或文献数据；不新增全局存储 |

## 1. 交付范围（阶段 1）

1. **统一板面模型** `src/core/board/boardModel.ts`（纯函数，无 DOM）：文档结构、序列化/解析、命中测试、几何变换、连线绑定、历史（撤销/重做、合并、有界）、视口数学、`kind: 'whiteboard' | 'mindmap' | 'clueboard'` 预留给阶段 2/3。
2. **自由白板编辑器** `src/features/board/BoardEditor.tsx`：便签 / 文本 / 矩形 / 椭圆 / 连线（自动吸附绑定到图形）/ 画笔（整笔擦除）、选择（点选、框选、Shift 加选）、移动 / 缩放手柄、复制 / 粘贴 / 复制引用、键盘（工具快捷键 N/T/R/O/A/P/E/V/H、方向键微调、Shift 微调 ×10、Delete、Ctrl+Z/Y、Ctrl+A/D、Ctrl+0、Esc）、平移（空格 / 中键 / 滚轮）、缩放（Ctrl+滚轮、按钮、适配内容）、颜色 / 填充 / 线宽、可见的空状态 / 读取失败 / 解析失败 / 保存失败 / 冲突状态、触控（Pointer Events 统一鼠标 / 触摸 / 触笔）、明暗主题令牌、窄宽度换行工具栏、`aria-live` 状态播报。
3. **笔记入口**：文件树新增「新建白板」（工具栏 + 右键菜单）、`.a4board` 类型徽标；`markdown.core` 注册 `.a4board` 打开器 + 资源视图适配器；Markdown 中 `[[名称.a4board]]` / `[[名称]]`（同名笔记不存在时）解析并打开白板；白板工具栏「复制引用」写入 `[[名称.a4board]]`。
4. **阅读器入口** `src/features/reader/ReaderBoardEntry.tsx`：论文笔记的「切换论文文档」弹层新增「白板」分区（已关联列表、新建白板并关联、关联已有白板…、取消关联）；选中后**在笔记面板原位渲染同一文件**（`ReaderBoardSurface`，内嵌模式，带「返回笔记」和文献关联 chip）。
5. **共享语义**：两入口通过同一 `acquireTextDocument(path)` 会话读写同一文件 —— 内存内即时同步、磁盘 `expected_content` CAS，任一入口保存后另一入口立即看到；没有第二份拷贝，没有云同步声明。

## 2. 数据格式 `*.a4board`

```json
{
  "format": "a4board", "version": 1,
  "id": "b_muknlctk6263441164ec",
  "kind": "whiteboard", "title": "未命名白板",
  "createdAt": "…", "updatedAt": "…",
  "links": [{ "kind": "paper", "paperId": "paper-aster-guide", "title": "A4 Note 使用指南", "linkedAt": "…" }],
  "elements": [
    { "id": "e_…", "type": "note", "x": 0, "y": 0, "w": 180, "h": 140, "text": "…", "style": { "stroke": "auto", "fill": "#fef3c7", "width": 2 } },
    { "id": "e_…", "type": "arrow", "points": [{ "x": 0, "y": 0 }, { "x": 1, "y": 1 }], "from": { "elementId": "e_…", "fx": 1, "fy": 0.5 }, "to": null }
  ]
}
```

- **稳定身份**：`id` 在创建时生成并随文件移动 / 重命名不变；文件路径只是定位手段。
- **解析策略**：空文件 / 非 JSON / `format` 不符 / 版本高于当前 / 缺少 `id` → 明确的只读诊断（不会显示为「空白板」）；未知元素 / 关联类型 → 保留警告并跳过该项，其余照常打开；元素上限 `5000`、单笔画点数上限 `4000`。
- **迁移**：无既有数据需要迁移。`version` 字段留给未来格式演进；高版本文件拒绝编辑而不是静默降级。
- **关联**：文献关联记录存在**白板文件内**（`links`），不写入论文笔记 Markdown，也不新增数据库表；论文被删除后 `title` 冻结文本仍可读，chip 显示原标题。

## 3. 冲突 / 恢复策略（不静默覆盖）

| 场景 | 行为 | 验证 |
| --- | --- | --- |
| 两入口同时打开 | 同一会话对象，编辑即时互见；保存 500 ms 防抖 | 浏览器 e2e：便签 / 移动 / 删除 / 撤销在另一入口同步 |
| 外部程序改写文件 | CAS 失败 → 顶部冲突条「文件已被外部程序修改，已停止覆盖」+ 重试保存 / 重新加载磁盘版本 / 导出草稿；两入口同时显示 | 浏览器 e2e「a rejected write…」+ 原生复现（外部删除并重建同名文件后触发，重新加载磁盘版本恢复） |
| 文件被删除 / 移动 | 「无法打开白板 + 路径」显式错误，提供「重试」；不会自动新建空白板 | 浏览器 e2e「a missing file…」；原生重启后恢复的已删文件标签显示同一错误 |
| 同名文件被重新创建 | `createBoardFile` 广播 `a4note:board-file-created`，处于错误态的同路径标签重新读取 | 原生：重启后新建同名白板立即正常打开 |
| 撤销 / 重做 | 每个入口维护自己的历史；跨入口的改动不会进入对方历史；微调合并为单步；历史有界 | 浏览器 e2e + 单元测试 |
| 应用重启 | 文件即真相；工作台恢复标签后从磁盘重新读取，草稿由既有文本会话机制保留 | 原生 `restart` 阶段 |
| 关联 / 取消关联 | 通过同一会话写入 `links`，仅改关系不删文件 | 浏览器 e2e |

## 4. 代码变更

新增：`src/core/board/{boardModel.ts,index.ts}`、`src/features/board/{BoardEditor.tsx,BoardResourceTab.tsx,boardFiles.ts,board.css,index.ts}`、`src/features/reader/ReaderBoardEntry.tsx`、`scripts/verify-board-model.mjs`、`scripts/verify-board-browser.mjs`、`scripts/verify-board-native.mjs`。

修改：`src/core/markdownPlugin.ts`（`.a4board` 打开器）、`src/core/wikiLinks.ts`（板面链接解析）、`src/ui/App.tsx` / `src/ui/sceneAdapters.tsx`（板面视图适配、工作区根传递）、`src/features/markdown/contributions.tsx`（资源视图）、`src/features/explorer/{FileTreePanel.tsx,fileTreeDisplayName.ts,file-tree-types.css}`（新建白板、徽标）、`src/features/reader/ReaderMarkdown.tsx`（切换器白板分区 + 原位板面）、`package.json` / `scripts/verify-all.mjs`（`test:board`、`test:board-browser`、`test:board-native`）。

未触碰：PDF 渲染 / 标注 / 侧栏 / 浮动窗口代码路径；Markdown 正文与既有笔记数据；Rust 后端（复用 `create_text_file` / `read_text_file` / `write_text_file(expected_content)` / `list_directory_entries`）。

设计取舍：
- 复制 / 移动连线但未一起复制 / 移动其绑定目标时，连线**解除绑定**而不是留下悬空引用（`moveSet`）。
- 隐藏标签保持挂载（TabHost 行为），编辑器仅在 `active` 时接管键盘与 RAF。
- 白板工具栏在窄宽度下换行而不是隐藏工具，保证触控可用。
- 阅读器「新建白板并关联」放在 `<笔记根>/白板/<论文标题>.a4board`，同名自动追加序号。

## 5. 验证

| 项目 | 结果 |
| --- | --- |
| `npx tsc -p tsconfig.app.json --noEmit` | 0 错误 |
| `npm run build` | 通过 |
| `npm run test:board`（单元，16 项） | 通过：身份 / 序列化往返 / 拒绝策略 / 容错警告 / 上限 / 命中 / 变换 / 绑定 / z 序 / 历史 / 关联 / 路径 / 视口 / wiki 链接解析 |
| `npm run test:board-browser`（Playwright，45 项，两入口同页） | 通过，0 控制台错误：打开器 / 适配器注册、空状态、快捷键、便签同步、矩形 + 连线绑定、跨入口移动 / 撤销 / 重做、独立历史、画笔 / 整笔擦除、框选 / 删除 / 恢复、复制 / 微调 / 合并撤销、双击编辑文本、缩放 / 平移 / 适配、空格拖拽、触控点按、写失败 → 重试恢复、坏文件诊断 → 修复后重载、缺失文件、1500 元素 <6 s 渲染 / <3 s 框选、阅读器关联 / 新建 / 取消关联、暗色主题、窄视口 |
| 回归 | `test:architecture` `test:scene-plugins` `test:resource-views` `test:resources` `test:resource-openers` `test:core` `test:note-workbench` `test:reader-note-sidebar` `test:reader-note-markdown` `test:markdown-safety` `test:workspace` `test:plugin-bindings` 全部通过 |
| 原生（隔离 dev:live `arena-two-board`，1499/9329，独立测试库 + 独立 `.tmp/board-vault-arena-two` 笔记库） | `after`：9 步通过 —— 笔记树新建白板 → 空状态 → 便签 / 矩形 / 连线（绑定）/ 画笔落盘 → 撤销 / 重做落盘 → 阅读器切换器「0 个已关联」→ 关联已有白板 → 同一 `id` 原位渲染 4 元素 → 阅读器内新增便签 → 回到笔记入口看到 5 元素、库内仅 1 个文件；`restart`：3 步通过 —— 重启后同一 `id` / 5 元素 / 关联保留，阅读器切换器仍列出并可打开，返回笔记后文件字节不变。0 控制台错误 |

证据：`.tmp/board-browser/*.png`（01–08）、`.tmp/shots/board-native/{after,restart}/*.png` + `steps.json`、`.tmp/build.txt`、`.tmp/tsc3.txt`、`.tmp/regress.txt`。

已知边界（与 Markdown 笔记一致的既有行为）：离开笔记场景会关闭其标签，回来后从树中重新打开；文本会话按路径缓存，外部删除后再新建同名文件会先触发冲突保护（可「重新加载磁盘版本」）；本次未改变这些平台行为。

## 6. 阶段计划

- **阶段 2 · 脑图**：`kind: 'mindmap'`，层级节点 / 分支编辑 / 折叠 / 自动布局，复用同一文件格式、会话、入口与历史；新增 `node` 元素与父子关系字段（`version` 不变，旧文件不受影响）。
- **阶段 3 · 线索板**：`kind: 'clueboard'`，来源卡（文献 / 整篇笔记 / PDF 标注）含活引用 + 冻结摘录、用户关系与分组、双击回跳、来源失效可见并可重连。
- 两期均沿用：无第三方依赖、无迁移、CAS 冲突保护、隔离原生取证。
