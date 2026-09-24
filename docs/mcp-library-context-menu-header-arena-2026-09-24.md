# 文献库论文右键菜单：移除顶部重复标题行（bab38e7e）— arena 交付记录

- 任务：`bab38e7e-7f8e-425f-947f-4ce84c0d1f2a`（spec 2）。用户截图中菜单第一行是被截断的论文标题，不是操作项。
- 分支：`fix/library-context-menu-header-arena`（worktree `.worktrees/library-polish-arena`），基线 main `1d099a9`；交付与合并 SHA 见任务卡。

## 改动

- `src/features/library/PaperContextMenu.tsx`：删除菜单顶部的 `.library-context-title` 展示行；`role="menu"` 上的 `aria-label="论文操作：<标题>"` 保留，屏幕阅读器仍能得到论文上下文。菜单项、顺序、禁用逻辑（无 PDF 时「打开 PDF 所在文件夹」禁用）、文件夹子菜单（首项「返回论文操作」）、定位算法（视口内钳制、下方不够时翻到上方）、键盘（↑↓ 环绕跳过禁用、Home/End、←返回主菜单、Escape/Tab 关闭并归还焦点）、点外/滚动/resize 关闭均未改。
- `src/ui/styles/library.css`：删除已无引用的 `.library-context-title` 规则。菜单变矮后仍由 `ResizeObserver` 重新定位。
- 论文标题数据、列表中的标题显示不受影响。

## 回归

- 新增 `scripts/verify-library-context-menu-browser.mjs` + `scripts/fixtures/library-context-menu-host.tsx`（`npm run test:library-context-menu-browser`，已入 `verify-all`）：真实 `PaperContextMenu` 挂在 body portal 上，22 项断言——无标题行、首个子元素即「阅读」、子元素只有 menuitem/separator、首尾无多余分隔、aria-label 含完整标题、十项操作顺序、首项焦点、锚点定位；文件夹子菜单首项「返回论文操作」、层级路径与当前文件夹禁用、← 返回；方向键跳过禁用项、Home/End、环绕、Escape 归还焦点；右下角锚点与 420×360 窄窗均留在视口内；操作回调与点外关闭；无 pageerror。三轮连续 22/22。
- 旧代码红测：把 main 的 `PaperContextMenu.tsx`/`library.css` 换回后同一脚本 14/20 失败项正是标题行、首子元素、子元素类型、首尾分隔与子菜单首项。
- `npx tsc --noEmit` 0、`npm run build`、`test:ui-state`（含对 PaperContextMenu 源码的既有契约）、`test:architecture`、`test:agent-status` 通过。

## dev:live 证据（`arena-library`，1469 / CDP 9369，含 DEV 状态条，pageerror/console 0）

`.tmp/shots/library-context-menu/{before,after}/`：`01-light-context-menu`、`02-light-folder-submenu`、`01-dark-context-menu`、`02-dark-folder-submenu`、`03-row-trigger-menu`（列表行末「…」触发）、`04-corner-anchor`（右下角锚点）+ `result.json`。before 的菜单首个子元素是 `.library-context-title「A4 Note 使用指南」`；after 首个子元素为 `menuitem「阅读」`，`titleRow: null`，aria-label 不变。

## 边界

未打包/推送/发布；未改论文数据与列表显示；dev:live 实例 `arena-library` 交付时仍在运行（后续同批文献库任务复用）。
