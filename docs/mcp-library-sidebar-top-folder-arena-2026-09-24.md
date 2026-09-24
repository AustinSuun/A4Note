# 文献库左侧导航栏：移除顶部重复的添加文件夹按钮（5e3bdbd4）— arena 交付记录

- 任务：`5e3bdbd4-0a07-4b5e-9b89-e640648716fd`（spec 2）。用户圈出的是 `.library-sidebar-heading` 右侧的 FolderPlus「新建文件夹」按钮；「文件类」分区标题旁的「＋ 新建文件类」是要保留的根级入口。
- 分支：`fix/library-sidebar-top-folder-arena`（worktree `.worktrees/library-polish-arena`），基线 main `bf29cca`；交付与合并 SHA 见任务卡。

## 改动

- `src/features/library/LibrarySceneSidebar.tsx`：删除标题行里的 `<button className="library-sidebar-icon-button" … aria-label="新建文件夹"><FolderPlus/></button>` 与 `FolderPlus` 导入。标题行剩下「文献库 / N 篇文献」文字容器，`justify-content: space-between` 下无占位元素、无失效热区；分割线（`border-bottom`）、最小高度不变。`.library-sidebar-icon-button` 样式仍被草稿行按钮使用，未删。
- 「文件类」旁的 `＋`（`aria-label="新建文件类"`，`startNewFolder('library')`）、折叠/展开、右键新建子文件夹、草稿行（名称/创建/取消/错误重试/焦点）与创建逻辑 `submitNewFolder` 全部保持；已有草稿状态不受影响。

## 回归

- 新增 `scripts/verify-library-sidebar-browser.mjs` + `scripts/fixtures/library-sidebar-host.tsx`（`npm run test:library-sidebar-browser`，已入 `verify-all`）：真实 `LibrarySceneSidebar`，13 项——标题行只剩文字容器且无按钮、标题与篇数仍显示、高度与分割线保持、DOM 无「新建文件夹」顶部按钮、Tab 序列无该按钮但保留「新建文件类」、点「新建文件类」后根级出现聚焦草稿行、输入 + Enter 调用 `onCreateFolder(name,'library')` 并关闭草稿、Esc 取消、创建失败时草稿保留并显示错误、重试再次调用、150% 缩放无按钮不溢出、无 pageerror。
- 旧代码红测：换回 main 的 `LibrarySceneSidebar.tsx` 后 9/13，失败项正是顶部按钮相关的 4 条。
- `npx tsc --noEmit` 0、`npm run build`、`test:architecture`、`test:agent-status` 通过。

## dev:live 证据（`arena-library`，1469 / CDP 9369，含 DEV 状态条，pageerror/console 0）

`.tmp/shots/library-sidebar/{before,after}/`：`01-light-sidebar-heading`、`01-dark-sidebar-heading`、`02-section-plus-draft-row`（点「＋ 新建文件类」后的根级草稿行）、`03-sidebar-150`、`04-sidebar-narrow-980` + `result.json`。before 标题行子元素 `DIV + BUTTON.library-sidebar-icon-button（新建文件夹）`；after 只有 `DIV`，`sectionPlus: true`，标题行矩形不变（289×43.6）。

## 边界

未打包/推送/发布；不改文件夹/论文数据与排序；dev:live 实例 `arena-library` 交付时仍在运行。
