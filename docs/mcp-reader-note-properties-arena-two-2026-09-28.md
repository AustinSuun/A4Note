# 阅读器侧栏笔记的「笔记属性」区（arena-two · 2026-09-28）

任务 `3eabf1ac`：阅读器侧栏 / 悬浮 / 专注写作三种形态下的笔记，获得与 Markdown 资源页
「添加笔记属性」同源的属性区（标签、日期、自定义属性），数据落在同一条笔记记录里，
不新增数据源，不改写旧笔记。

## 1. 持久化审计（改动前）

| 项目 | 现状（`b008046`） |
| --- | --- |
| 会话 | `src/core/noteDocumentSession.ts`：每个 `paperId + noteId` 一个会话，`update()` 记 dirty → 防抖自动保存 → `write()`；保存带 CAS 基线（`expected.title/content`），冲突时保留旧基线并进入 `proposalConflict`，界面显示「重试 / 导出 / 放弃」。 |
| 落盘 | `src/platform/library/noteDocuments.ts` → IPC `upsert_note`（`src-tauri/src/library_notes.rs` `upsert_note_in_database`），写入 SQLite `notes` 表的 `title` + `content`，`paper_id` 由现有 noteId 归属决定，前端不再传 paperId。 |
| 正文 | `content` 就是完整 Markdown 文本；标题由首行 `# ` 派生（`titleFromBody`），图片以 `a4note-image:` 链接留在正文里。 |
| 属性 | Markdown 资源页（`src/features/explorer/MarkdownResourceTab.tsx`）用 `src/core/markdownDocument.ts` 的 `splitFrontmatter / updateMarkdownProperties` 把属性放在 YAML frontmatter 中，同一文件、同一字符串；阅读器笔记此前不解析 frontmatter，`---` 会原样显示在编辑器和只读预览里。 |
| 备份/导出 | 均以 `content` 全文为单位（`notes` 表 / 导出 Markdown），frontmatter 随正文一起走，不需要额外迁移。 |

结论：笔记内容本身就是 Markdown 文档，frontmatter 是**唯一**可行且已被资源页采用的属性载体；
阅读器只需在同一条 `content` 上解析 / 序列化，无需新表、新字段、新 IPC。

## 2. 设计

- **单一数据源**：属性 = 当前笔记 `content` 的 YAML frontmatter。三种形态各自挂载面板，但都读写同一个
  `NoteDocumentSession` 快照（`ReaderMarkdown.tsx` 内 `noteProperties = splitFrontmatter(session content).properties`），
  所以没有三份副本；任一形态的改动经会话广播立即出现在另一形态。
- **旧笔记零改写**：没有 frontmatter 的笔记，`splitFrontmatter` 返回空属性和整段正文；正文编辑走
  `replaceMarkdownBody`，只替换 body 部分，**不会**为旧笔记补一个空 `---` 块；仅打开 / 切换形态 / 折叠面板都不触发
  `session.update`，因此不产生任何写入（浏览器与原生用例都断言「仅查看 0 次保存」）。
- **删空即复原**：移除最后一个属性时 `withoutEmptyFrontmatter` 去掉空块，旧笔记回到逐字节相同的内容
  （单测 + 原生用例 `identical: true`）。
- **同一保存路径**：属性改动 = `session.update(title, updateMarkdownProperties(content, next))`，沿用自动保存、
  CAS、冲突 / 只读 / 失败横幅，没有第二条 IPC；CRLF 笔记保持 CRLF。
- **同源组件**：把资源页的属性编辑器抽成 `src/features/explorer/MarkdownPropertiesPanel.tsx`
  （`MarkdownPropertiesPanel` + 只读 `MarkdownPropertySummary`），资源页与阅读器都用它——类型选择器、
  校验、键盘、拖拽排序、折叠、移除菜单完全一致；仓库里只剩一份属性编辑实现（单测断言）。
- **克制的呈现**：面板位于笔记编辑器上方，标题「笔记属性 + 数量徽章」可折叠；旧笔记 / 无属性时默认折叠
  （只有一行标题），有属性时默认展开；折叠记忆按 `paper:note` 存在 `localStorage`
  （`src/features/reader/noteProperties.ts`，只是 UI 状态，不是数据）。只读预览模式把属性渲染成 chips，不再显示原始 YAML。
- **只读边界**：总结笔记（其属性由总览字段体系管理）和白板文档不显示属性编辑器（`propertiesEditable`），
  避免与总览字段形成第二数据源。

## 3. 改动清单

| 文件 | 说明 |
| --- | --- |
| `src/features/explorer/MarkdownPropertiesPanel.tsx` | 新：共享属性面板（编辑 / 只读 chips），从 `MarkdownResourceTab.tsx` 抽出，行为不变。 |
| `src/features/explorer/MarkdownResourceTab.tsx` | 改用共享面板；删除内联实现。 |
| `src/features/reader/ReaderMarkdown.tsx` | 解析 frontmatter；正文编辑 body-only；`updateProperties`；面板 + chips；折叠记忆；`propertiesEditable`。 |
| `src/features/reader/noteProperties.ts` | 新：折叠状态记忆（paper+note）。 |
| `src/features/reader/reader-note-properties.css` | 新：面板在笔记列内的布局（`flex: 0 0 auto; max-height: min(42vh, 360px); overflow: auto`，悬浮形态 `min(36vh, 300px)`），长标签换行、窄列 / 高缩放不横向溢出，`:has(> .note-properties)` 让文档面板从三行 grid 变为 flex 列。 |
| `src/core/markdownDocument.ts` | `withoutEmptyFrontmatter`、`replaceMarkdownBody`、CRLF 保持、非法 YAML 抛错而非改写。 |
| `src/core/relations.ts`、`src/features/PaperNoteList.tsx`、`src/features/library/LibraryOverview.tsx` | 笔记摘录 / 关系文本跳过 YAML 块，避免列表和总览里出现 `---`。 |
| `scripts/verify-reader-note-properties.mjs` | 单测 15 项（旧笔记 / CRUD / CRLF / 外来 YAML / 非法 YAML / 单一实现）。 |
| `scripts/verify-reader-note-properties-browser.mjs` | 浏览器回归 24 项（见 §4）。 |
| `scripts/verify-reader-note-properties-native.mjs` | 原生 dev:live 证据脚本 `before|after`。 |
| `scripts/verify-reader-rendering.mjs`、`scripts/verify-reader-note-sidebar.mjs` | 既有断言同步新结构（只读预览改为渲染去掉 frontmatter 的正文，批注引用导航保持接线）。 |
| `package.json` | `test:reader-note-properties[-browser|-native]`。 |
| `docs/screenshots/reader-note-properties-arena-two/` | 截图与 `steps.json`。 |

## 4. 验证

- `npx tsc -p tsconfig.app.json --noEmit` 通过；`npm run build` 通过。
- `npm run test:reader-note-properties`：15 checks passed。
- `npm run test:reader-note-properties-browser`：24 checks passed —— 旧笔记折叠 0 计数且仅查看 0 次保存；
  添加标签 → 内容为 `---\ntags:\n  - …\n---\n` + 原正文逐字节；写入指向同一 noteId 并携带 CAS 基线；
  日期校验与插入顺序；拖拽排序后 YAML 顺序跟随；正文编辑保留 frontmatter 前缀且不重复；只读 chips；
  第二形态显示同样两条属性并共享会话；重挂载后属性 / 展开态 / 正文一致；写入失败进入错误横幅可重试；
  删除最后一个属性回到无 `---`；280px 窄列与 150% 缩放无横向溢出；深色主题；除既有保存路径外无额外 IPC；
  无 pageerror / console.error。截图 `browser-01…11.png`。
- `npm run test:reader-note-properties-native before|after`（独立实例 `arena-two-props`，1499/9329，
  DEV 条纹 `arena-two-props · 独立测试库（原生已核验`，never 触碰真实库）：
  - before（主干代码）：侧栏笔记无属性区，正文直接开始（`before-01/02`）。
  - after：`plain note` 新建普通笔记 → 仅查看时数据库内容不变 → 添加 标签 `native-tag` + 日期 `2026-09-28`
    → `list_papers` 中同一 noteId 的 `content` 以 `---\ntags:` 开头、以原正文结尾（`bodyIntact: true`）
    → 悬浮速记 / 专注写作 / 边读边记三形态计数均为 2 → `Page.reload` 后同一笔记仍为 2 条并展开
    → 1280×720@1.25（125% 缩放）布局正常 → 移除两条属性后内容与基线**逐字节相同**；全程 0 个 pageerror / console.error。
    截图 `after-01…10`，逐步记录 `after-steps.json`。
- `node scripts/verify-reader-rendering.mjs`、`npm run test:reader-note-sidebar`（16/16）、`node scripts/verify-markdown-toc-collapse-browser.mjs`（67，曾因资源页两个兄弟节点同用 `key={documentId}` 报重复 key，已改为 `properties-${documentId}`）通过；`npm run verify` 中除主干既有失败 `test:ui-state` 外全部通过（详见交付 JSON validation）。

## 5. 兼容 / 迁移

- 无需迁移：旧笔记原样读取；只有用户实际添加属性时，该笔记才获得 frontmatter；删空即复原。
- 已有 frontmatter 的笔记（例如从资源页或外部导入）直接显示其属性；嵌套 / 带注释的外来 YAML 在简单属性
  编辑后保留（单测），无法解析的 YAML 会以错误横幅拒绝写入，不会改写笔记。
- 备份 / 导出 / 搜索都基于 `content` 全文，属性随之保留。

## 6. 已知限制

- 正文以 `---` 开头的旧笔记会被当作 frontmatter 解析（与资源页行为一致）；若 YAML 无效，属性区为空且正文完整保留。
- 总结笔记与白板不显示属性编辑器（属性由总览字段 / 白板模型管理）。
- 属性建议下拉 `.markdown-property-suggestions` 在 `src/ui/styles/workbench.css` 中被隐藏（既有行为），阅读器沿用。
- 深色主题下阅读器抽屉背景由 `src/ui/styles/reader.css` 硬编码浅色 rgba，浏览器 harness 的截图偏灰属 harness 现象；
  原生 midnight 截图（`after-06`）显示正确。
- 与 `456497d8`（默认实时编辑）/ `f241fd40`（标题栏拖拽）无文件冲突；面板作为 `.note-workspace` 直接子节点挂载，
  不改变抽屉拖拽区域。
