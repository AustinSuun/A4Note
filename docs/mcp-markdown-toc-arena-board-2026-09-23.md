# Markdown 右侧目录修复与标题折叠（Arena-Board）

- 任务：`deb0ed49-2a5b-401e-9568-c4cc1d98650b`，需求版本 2。
- 分支：`fix/markdown-toc-arena-board`；独立工作树 `.worktrees/markdown-toc-arena-board`。
- 基线：`fc6be92`。本记录为开发交付证据，不代表用户或独立 Agent 验收。

## 目标与根因

用户截图中的右侧目录需要修正样式，并支持展开/收起标题树。原实现的箭头是 `aria-hidden` 装饰 span，整行只执行正文跳转；没有目录折叠状态。引导线使用 DOMRect（已受 CSS zoom 影响）的坐标直接设置 CSS 布局像素，缩放下产生二次缩放偏移；按数组索引标识的标题也不能直接用作可靠的折叠身份。

## 实现范围

- `src/features/explorer/useMarkdownTocCollapse.ts`：独立标题层级与折叠模型，按实际父子关系计算跳级标题深度；折叠键以父链、级别、文本和同父重复序号组成，正文编辑和无关标题插入尽量保留状态。状态隔离于文档会话，不写入 Markdown。
- `src/features/explorer/MarkdownResourceTab.tsx`：把行内目录折叠按钮与标题跳转按钮分开，不嵌套 button。父节点提供 aria-expanded、明确中文标签、原生 Enter/Space；叶节点保持等宽占位，不提供假箭头。折叠祖先后保留子节点折叠状态，测量只处理可见节点。
- 两个引导线坐标助手统一反算 CSS zoom；折叠后的高亮索引使用原始标题索引，避免隐藏项使高亮错位。
- `src/features/explorer/markdown-toc-tree.css`：仅作用于目录的细中性竖线、统一行内对齐与实际层级缩进、长标题省略及完整 title、鼠标与键盘反馈。未修改共享 workbench.css、tokens.css 或文件树样式。
- 正文、笔记保存、撤销、PDF 与阅读器笔记面板均未修改。标题文本仍执行原有导航；折叠按钮不滚动正文。

## 验证与证据

1. `npm run build`：通过。保留既有大 chunk / ineffective dynamic import 提示，非本任务错误。
2. `node scripts/verify-markdown-toc-collapse-browser.mjs`：真实完整 MarkdownResourceTab + 模拟文档会话，67 项通过，含 H1–H6、跳级、重复标题、无关标题插入、文档切换、父子折叠记忆、正文不变、鼠标/键盘、点击导航、reduced-motion、两主题 × 三缩放 × 两目录宽度；pageerror/console error 为空。不是原生保存 E2E。
3. 红测：在本 Agent 独立工作树临时恢复同一文件的 `fc6be92` 基线，运行相同脚本，退出 1，明确失败于 `real disclosure button exists`；随后恢复修复内容。没有修改主工作树。日志：`.worktrees/markdown-toc-arena-board/.tmp/toc-browser-baseline.log`。
4. 原生桌面：官方 `npm run dev:live -- --instance arena-toc --port 1483 --cdp-port 9283`；原生身份 `app.aster.research.dev.arena-toc.w6fc7509c34`。只使用工作树 `.tmp/toc-notes` 的合成笔记与隔离库，未复制真实用户数据。
5. 原生准备：启动器最初缺本工作树的依赖入口及 native-host 资源，复用已安装依赖 junction 和既有本地生成资源后成功；未安装依赖、未重新打包产品。通过实际平台 `describeProjectFolder`、工作台 store 注册合成项目/资源来准备夹具，再在真实应用中点击、键盘操作与截图；没有替换应用 React 视图或伪造 DEV 标识。
6. 最终原生基线 7 图、修复后 14 图：两主题 × 100/125/150% 的展开对照及收起、980×680 窄窗、实时编辑态折叠。1600×1000 / 980×680 为 CDP 模拟视口，截图物理像素受桌面 DPR 影响；125/150% 是受控 CSS zoom 与 --ui-zoom 同步的压力场景，不冒充设置界面支持范围。修复后 8 组断言通过，目录在视口内，原生 pageerror/console error 均为空。全部 21 图与两份 JSON 已上传任务卡，caption 为“最终取证V2”。首轮 1400px/150% 低于工作台已有 980 CSS px 最小宽度，截取不全，已明确由V2替代，不作为完整视口证据。
7. 原生证据：`.worktrees/markdown-toc-arena-board/.tmp/shots/toc-native/{before,after}`。浏览器夹具证据：`.worktrees/markdown-toc-arena-board/.tmp/shots/toc-collapse-browser`。
8. 完整 `npm run verify` 前两轮仅 `test:reader` 的旧源码契约失败：它要求箭头永远带 `open`、坐标不做缩放转换。已对齐 aria-expanded/toggle、反缩放坐标和实际生效的 scoped CSS 契约，保留无关断言；新增浏览器回归与 TOC follow 回归纳入 verify-all。最终全量退出0（231.8秒），`A4Note verification passed`；Rust 215 passed / 0 failed / 5 ignored。日志 `.tmp/toc-verify-green.log`、退出码 `.tmp/toc-verify-green-exit.txt`。
9. MCP diagnostics：本工作树 explorer 范围 0 错误/警告；test:agent-status 和 diff --check 通过。
10. `node scripts/verify-dev-live-runtime.mjs --cdp-port 9283 --expect-instance arena-toc --evidence .tmp/toc-runtime`：22通过/0失败，核验原生身份、隔离库位置、捕获禁用及DEV标识；未写 marker。取证后已停止本 Agent 的 dev:live，不干预其他开发实例。
11. 代码提交 `95940e5`。合并前 main 已前进到阅读器面板 `803a381`：在本任务分支整合为 `7cdbe38`，产品代码没有冲突；仅两个交接文档在头部插入处冲突，保留双方条目与范围后解决。整合版重新 build、test:reader、test:agent-status、note-workbench 66/66、TOC浏览器67/67、note-enter-motion-browser 68/68 全部通过。全量verify的通过记录对应目录代码提交前，最新整合版使用上述针对性复验，不冒充再次全量运行。
12. 本地 main 以普通 fast-forward 方式接收已验证的任务分支；最终交付/合并 SHA 由任务卡 delivery 记录。只在 main 工作树干净且仍为预期提交时执行，main 变化则停止重核；不改根目录滚动分支的工作内容。

## 并行协作与边界

- 未修改 `3932f561` 阅读器面板任务的文件；本任务不改 `src/features/reader/**`。
- 主工作树另有 `fix/markdown-fast-scroll-arena` 正在修改 MarkdownResourceTab 的滚动逻辑等文件。本 Agent 所有变更在独立工作树，未覆盖/暂存/提交其未提交内容；合并前需要核对最新 main，出现真实冲突不强行处理。
- 折叠状态是会话级，不承诺关闭应用后恢复；重复同名同级标题插入到既有重复项之前时身份属于尽力匹配，未引入写入源文档的永久 ID。
- 同文档改标题或改变父层级会形成新语义键，默认展开；这是避免把折叠状态错误转移到另一节的保守处理。
- 未打包、安装、推送、发布、改变生产资料；开发者提交只进入 review，用户负责验收归档。
