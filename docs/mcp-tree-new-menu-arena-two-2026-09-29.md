# 笔记文件树：新建菜单合并 + 全类型右键（任务 1f8d8317）

- 任务：`1f8d8317-1ccf-4992-8351-7854c786df9c`（新建入口合并为「新建笔记/新建白板」可选菜单；右键菜单跟随鼠标；非 Markdown 文件右键无菜单）
- 分支：`board-tree-menu-arena-two`（worktree `.worktrees/board-tree-menu-arena-two`，基于 `main 471953f`）
- 日期：2026-09-29

## 1. 现状澄清（卡面 B 项）

卡面撰写时 `openFileContextMenu` 还在直接用 `clientX/clientY` 作 fixed 坐标。**该根因已由 ae61143f（a7d2023）修复**：菜单现在保存视口锚点，`usePointerAnchoredPosition` 统一做「视口 → 布局」换算 + 按实测尺寸钳位/翻转，硬编码 220/225/150 估算已移除；拖拽预览同修。本卡新增的浏览器回归把「118% 缩放下菜单左上角贴指针 ≤2px」「右下角不越界」固化为常绿契约（在旧代码上同样成立，属兼容项；本卡旧代码失败的断言是 A/C 两项）。

## 2. A：工具条新建菜单（FileTreePanel.tsx）

- 原并排的「新建笔记」「新建白板」两个图标按钮合并为**一个「新建」触发按钮**（`FilePlus`，`aria-haspopup=menu`），点击弹出菜单（复用排序菜单的 `file-tree-sort-menu` 表面 + `file-tree-create-menu` 修饰）：两项均为图标+文字（新建笔记 / 新建白板）。
- 键盘契约：Enter/Space 打开（原生 button）；`ArrowDown` 打开或聚焦首项，菜单内 ArrowUp/ArrowDown 循环移动；Esc 关闭并把焦点还到触发按钮；点击外部关闭（mousedown 捕获，同排序菜单模式）。
- 文件夹右键菜单的「新建子文件夹/新建笔记/新建白板」三项已在位（前序提交引入），回归固化为断言。

## 3. C：所有文件类型可右键（FileTreePanel.tsx）

- 守卫从 `!entry.is_directory && !isMarkdownFile(entry)` 收紧为仅 `folderDraft || renamingEntry` 时拦截——`.a4board`/`.html`/`.png`/`.pdf` 等全部条目都能打开右键菜单。
- 菜单项本就类型无关：**重命名 / 在资源管理器中打开 / 删除** 对所有文件可用。
- **删除确认**：App 侧 `deleteMarkdownFile` 对所有非目录条目统一弹确认对话框（`markdown-file-delete` 变体），白板与笔记一致。
- **白板重命名策略**：文件名改变（`renameTextFile`，同时重映射打开中的页签路径）；`.a4board` 内部 `title` 字段**有意不同步**——展示名 `boardDisplayName` 以文件名为准，`title` 仅作兜底；论文关联 `links[].paperId` 存在文件内部且与文件名无关，重命名/移动不受影响。**限制**：笔记中 `[[白板.a4board]]` 形式的 wiki 引用不会随重命名更新（与重命名 Markdown 的行为一致），需用户手动修正。

## 4. 验证

| 项 | 结果 |
| --- | --- |
| `tsc -p tsconfig.app.json --noEmit` | 0 错 |
| verify 矩阵（build / board / board-browser / tree-guides / **tree-new-menu（新）** / reader-popover-layout / pdf-eraser / library-context / architecture / core / viewport-to-layout / popover-zoom） | 12/12 全 0 |
| `npm run -s verify` | 仅已知旧失败 `test:ui-state`（基线同样失败） |
| 新浏览器回归 `verify-tree-new-menu-browser.mjs`（14 断言，真实 FileTreePanel + mock IPC） | 合并触发器唯一（旧的双按钮=0）、菜单两项文本精确、两项回调带根路径、Enter/ArrowDown/Esc 键盘契约、五种文件类型右键菜单含重命名/资源管理器/删除、文件夹菜单三项、118% 缩放锚点 ≤2px、右下边缘不越界、0 页面错误 |
| 坐标换算单测 | 复用既有 `test:viewport-to-layout`（zoom 1/1.18/1.5 的视口→布局换算与钳位，ae61143f 交付） |
| 旧代码对照 | checkout FileTreePanel.tsx 后首断言失败（OLD_EXIT=1），已还原 |

## 5. 原生（dev:live）证据

实例 `arena-two-tree`（隔离 dev:live，vite 1504 / CDP 9334，共享 debug cargo target），注入 vault 工程（论文.md + 白板.a4board），CDP 驱动真实窗口：

- **118% 界面缩放右键 白板.a4board 行**：菜单在指针处打开，`dx=0.04 / dy=0.03`（≤2px 契约），菜单项 重命名 / 在资源管理器中打开 / 删除 齐全（旧代码此处无菜单）。
- 工具条：合并后的「新建」触发按钮存在，旧的独立「新建白板」图标按钮已不存在；点击弹出新菜单，两项 新建笔记 / 新建白板。
- 点击「新建白板」→ 真实创建 `未命名白板.a4board` 并出现在树里（before 1 → after 2）。
- 全程 0 条 console.error / 页面异常。截图 3 张 + `native-result.json` 见 `docs/screenshots/tree-new-menu-arena-two/`。

## 6. 注意点

- 排序菜单的关闭 effect 只监听 Escape，不还焦点；新建菜单按卡面要求补了焦点归还（Esc → 触发按钮）。
- `file-tree-sort-wrap` 需要 `position: relative` 承载绝对定位菜单——排序按钮已在用同一容器类，直接复用。
