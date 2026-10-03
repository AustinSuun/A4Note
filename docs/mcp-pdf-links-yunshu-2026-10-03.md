# PDF 阅读器链接跳转（引用/图表/章节锚点）与外部 URL 打开 — 交付记录

- 任务卡：`e4c2fa22-5f19-4985-9fd2-eb8f19abea7e`（spec_revision 1，priority normal）
- 分支：`feat/pdf-links-yunshu`（独立 worktree `.worktrees/pdf-links-yunshu`），交付分支 `deliver/pdf-links-e4c2fa22` 指向交付提交
- 日期：2026-10-03
- 接管说明：本卡由 `云枢`（4df1e730）于 2026-09-29 实现并提交（功能提交）后离线，任务停在 `in_progress`。用户于 2026-10-03 明确要求接手；接管前核验离线状态、进程与工作区写入隔离。接手后完成：dev:live 实机取证脚本与 15 张实机截图（含脚本自身三个坑的定位与修正，见 §3.1）、旧代码失败对照复跑、回归套件复跑、文档与两份状态更新、交付提交。
- 提交结构：本卡交付 = 两笔提交（云枢的功能提交 + 本次交付提交），已 rebase 到当前本地 `main`（`fd49a05`）之上，`main` 可直接 fast-forward 到交付提交；交付分支 `deliver/pdf-links-e4c2fa22` 指向交付提交，具体 SHA 见任务卡 delivery JSON。

## 1. 实现总览

| 关注点 | 实现 |
| --- | --- |
| 链接层 | 每页 `PdfLinkLayer.tsx`，位于 `.pdf-render-layer` 内，与位图/文本层/标注层共用同一 CSS 盒；`canvas` < 文本层（z 1）< 链接层（z 2）< 标注层（z 2，DOM 在后，故标注命中优先） |
| 注解来源 | 页面进入渲染范围后懒加载 `page.getAnnotations({ intent: 'display' })` 中的 `subtype === 'Link'`；加载与页面渲染并行，不阻塞首屏；`data-link-state=idle/loading/ready` 可观测 |
| 几何 | 一律换算成**页面默认视口百分比**（`viewport.convertToViewportPoint` 两个角点，pdf.js 6 已移除 `convertToViewportRectangle`），缩放/`/Rotate`/裁剪框由共享盒天然处理，**不再乘 zoom/DPR** |
| 指针策略 | CSS 单点开关：仅 `.pdf-document.cursor-mode` 且非文本拖选（`data-text-selecting`）非空格平移时 `pointer-events:auto`；高亮/下划线/橡皮擦/形状/墨迹/文本/评论/手型等工具一律穿透 |
| 悬停提示 | 链接为 `<button>`，`aria-label` / `data-tip` 同为提示文案；`::after` 伪元素渲染（跟随主题、延迟 320ms、右列自动右对齐），内容为「参考文献 [12] · 跳转到第 3 页」或完整 URL |
| 内部跳转 | `resolveLinkTarget` 解析数组/命名目标 + `getPageIndex` + `getPage().getViewport({scale:1})` → `{pageNumber,xPercent,yPercent,zoom,precise}`；滚动到视口上部（`PDF_LINK_TARGET_TOP_MARGIN = 24px`），并播放一次 3.2% 页高的闪烁条（CSS 560ms / 减少动态 360ms，640ms 后卸载节点） |
| 命名动作 | `/Named` 的 `NextPage`/`PrevPage`/`FirstPage`/`LastPage` 映射为页目标；无法解析的 dest 显示 `linkTargetUnresolved` 轻提示（不静默） |
| 返回按钮 | `PdfLinkBackButton.tsx`：阅读区右侧 `right:18px; top:calc(50% + 88px); z-index:45`，避开笔记边缘把手（50%±48px）与页码/底部工具坞；文案「返回 第 N 页」+ 图标；键盘可达（`tabIndex` 随可见性），快捷键 `reader.linkBack`（默认 **Alt+←**，走既有快捷键系统，可改绑；Esc 不触发）；仅 transform/opacity 动画（进入 160ms，退出 180ms 后卸载） |
| 返回栈 | `pdfLinkHistory.ts` 纯函数：跳转前压入 `{page, scrollTop, anchor, zoom, time}`，上限 `PDF_LINK_HISTORY_LIMIT = 32`；点击返回弹一层；**手动回到原位自动消失**：同一可见页且距离 ≤ `PDF_LINK_RETURN_RATIO = 0.4` × 视口高，或原位滚动偏移落在当前视口内 → 逐层丢弃（`dismissReturnedOrigins`）；缩放变化后用 `anchor` 重算原位；切换文档/文件（`source.key` 变化）清空 |
| 外链安全 | `core/externalUrl.ts` 单一白名单 `inspectExternalUrl`：仅绝对 `http(s)`；`mailto:`/`file:`/`javascript:`/`data:`/自定义 scheme/相对串一律拒绝并给出带 scheme 的提示；唯一出口 `platform/externalUrl.ts::openExternalUrl` → IPC `open_external_url`（`{ request: { path } }`），摘要链接与 PDF 链接共用，未新增第二扇门 |
| 模式边界 | 链接层只在**原文 PDF** 模式渲染（`linksEnabled`），译文/对照视图不渲染；链接层不参与标注命中，也不改文本选择 |

## 2. 验收对照

| 验收项 | 结论 | 证据 |
| --- | --- | --- |
| 1. dev:live 隔离实例改前/改后截图（悬停提示、跳转+闪烁、右侧返回按钮、返回后原位、手动回位消失、外链、浅/深色，console 0） | 见 §3：**59 项断言通过 / 15 张实机截图 / pageerror 0 / console.error 0** | `.tmp/pdf-links-live/after/01…15-*.png`、`.tmp/pdf-links-live/after/result.json`、`links-live.log`；改前对照见 §4 |
| 2. 交互验证：多级跳转栈、工具激活不误触、跨链接选区、150% 缩放与 90° 旋转对齐 | 单测 + 浏览器用例 + 实机复检均通过 | `test:pdf-links` 141 项、`test:pdf-links-browser` 54 项、`.tmp/pdf-links/after/*.png`（7 张）+ `links.log`、live 脚本 §4–§6 |
| 3. 安全：`javascript:`/`file:`/`mailto:` 被拒绝并提示；IPC 只收到 http(s) | 通过 | `test:pdf-links`（白名单 9 组）+ live（实机点击 `javascript:`/`mailto:` 后 IPC 计数不增且提示含 scheme；https 点击记录到 `{request:{path:'https://arxiv.org/abs/2505.13447'}}`） |
| 4. 新增回归旧代码失败、新代码通过；`test:reader*`、橡皮擦/查找/缩放、`npm run build`、`npm run verify` | 通过（`npm run verify` 唯一失败为主干既有 `test:ui-state`，见 §5） | `.tmp/pdf-links/legacy/`、`$HOME/pdf-evidence/{01-unit.log,02-browser.log,03-legacy-browser.log}` |
| 5. 交付文档 + `AGENT_STATUS.md` + `PROJECT_STATUS.json`；独立 worktree、ff 合并 main、交付 JSON | 本文件 + 两份状态更新（随交付提交） | 本文件 |

## 3. dev:live 实机证据（隔离实例）

启动：`node scripts/dev-live.mjs --instance pdf-links-arena --port 1462 --cdp-port 9262`（DEV 条纹实例，数据根 `…app.aster.research.dev.pdf-links-arena.w026eb4c27a\AsterData`，与正式资料库完全隔离；脚本内断言 `paths.root` 命中该身份，否则直接失败退出）。

驱动：`scripts/verify-pdf-links-live.mjs`（本交付新增；`playwright-core` `connectOverCDP` 连真实 WebView2 窗口，全部真实鼠标事件；开始时经 CDP 把窗口放宽到 ≥2000×1300，让笔记工作区能停靠成左列，结束前恢复原窗口尺寸）。样本 PDF：

1. **真实 arXiv 论文** `arXiv:2505.13447`（Mean Flows for One-step Generative Modeling，16 页，第 1 页 21 个链接），脚本运行时下载到 `.tmp/pdf-links-live/inputs/`；
2. 仓库自带链接夹具 `scripts/fixtures/pdf-link-fixture.mjs`（5 页，内部 `/XYZ`、`/FitH`、命名目标、`javascript:`、`mailto:`、https 外链，含一页 `/Rotate 90`），用于安全与对齐项。

两份都通过 `import_pdf_to_library` IPC 导入该隔离库，再在文献库双击打开。最后一轮（2026-10-03T09:02–09:04Z）结果：`{"passed":59,"screenshots":15,"pageerrors":[],"consoleErrors":[]}`。

| 截图 | 内容 |
| --- | --- |
| `01-live-hover-citation` | 真实 arXiv 页悬停引用链接的完整提示（目标页码） |
| `02-live-jump-flash-and-back` | 点击后目标行闪烁 + 右侧「返回 第 1 页」按钮 |
| `03-live-back-with-note-drawer` | 笔记抽屉打开时按钮仍可见且贴抽屉左缘避让 |
| `04-live-after-return` | 点击返回后回到原位、按钮淡出 |
| `05-live-manual-return-fade` | 手动滚回原位后按钮自动淡出（未点击） |
| `06-live-two-hop-stack` | 两级跳转栈（「返回 第 2 页」） |
| `07-live-external-hover` / `08-live-javascript-blocked` | 外链 hover 显示完整 URL；`javascript:` 被拒绝并提示 |
| `09-live-tool-sees-through` / `10-live-selection-across-links` | 工具激活时点击链接不跳转；跨链接文本选择正常 |
| `11-live-150-flat` / `12-live-150-rotated` | 150% 缩放下平页与 `/Rotate 90` 页的链接框与文本层几何一致（≤2px，实测 `geoDiff=0.01`、覆盖率 0.87），字形落在框内 |
| `13-live-dark-hover` / `14-live-dark-back` / `15-live-light-restored` | 深色主题下的提示与返回按钮，随后恢复浅色 |

`pageerror` 与 `console.error` 全程为 0（脚本结束前硬断言；期间一次 `Selected source PDF is not bound to current paper` 由脚本自己的删除动作引起，已随该动作一并移除）。

外链打开方式的记录（如实）：`window.__TAURI_INTERNALS__` 上 `invoke`/`postMessage` 等属性都是 `writable:false, configurable:false`，页面里包裹 `invoke` 会**静默失效**（早期版本因此一直记录到空数组）；现在改为在传输层取证 —— 包裹 `window.fetch`（Tauri 自定义协议路径 `http://ipc.localhost/<cmd>`）与回退的 `window.chrome.webview.postMessage`，记录命令名与完整载荷，并对 `open_external_url` 就地应答（不真正发往 Rust），因此**不会在用户桌面弹出系统浏览器**。断言：https 点击记录到 `cmd=open_external_url` 且 `{request:{path:'https://arxiv.org/abs/2505.13447'}}` 逐字段一致、无拒绝提示；`javascript:`/`mailto:` 点击后 IPC 计数不增、提示包含 scheme 名。真实系统浏览器弹出是本轮唯一未实测的分支（为了不打扰用户桌面，刻意用它换取 IPC 参数的可核对证据）。

### 3.1 驱动脚本自身踩到并修正的三个坑（避免误判为产品缺陷）

1. **场景可见性判据**：`.library-paper-index` 在**非活动场景里也保持完整布局盒**（只是 `visibility:hidden`），原先用「行索引有非零 rect」判断「文献库已显示」，导致切场景被跳过、随后对文献库行的双击落在阅读器上——连跑 5 轮都表现为「双击夹具行打不开」，实际是脚本判据错。现在判据改为 `.library-scene` 的 `visibility` + 非零 rect，且每个场景自身都带 `scene active` 类，不能用作判据。
2. **视口外链接的矩形**：页 2（`/Rotate 90`）在第一跳落到第 3 页后位于视口上方（实测 `cy = -10660`），按该矩形点击等于点在窗口外。现在取点前先把目标链接居中进视口再测。
3. **IPC 取证层**：见 §3 说明（`invoke` 不可写 → 传输层取证）。另：`reader ready {pages:0}` 是假阳性，文档身份必须以 `.pdf-page` 数量 > 0 为准。

## 4. 旧代码失败对照

在 `main`（`fd49a05`）的独立 worktree `.tmp/arena-polish/wt-main` 中临时拷入本卡的测试脚本与夹具后运行：

- `verify-pdf-links.mjs`：旧代码下 `src/features/reader/pdf/pdfLinks.ts` / `pdfLinkHistory.ts` / `core/externalUrl.ts` 不存在，导入即失败（`ERR_MODULE_NOT_FOUND`，`$HOME/pdf-evidence/01-unit.log`）；
- `verify-pdf-links-browser.mjs`：旧代码下链接层不存在（`.pdf-link` 0 个），在「链接懒加载后进入 ready」断言即失败（`[IMPORT_IS_UNDEFINED] requestPdfLinkBack`，`$HOME/pdf-evidence/03-legacy-browser.log`）。

对照日志见 `.tmp/pdf-links/legacy/` 与 `$HOME/pdf-evidence/`；随后已删除拷入的文件，`main` 工作树保持干净。

## 5. 验证命令与结果（2026-10-03 复跑）

| 命令 | 结果 |
| --- | --- |
| `npm run test:pdf-links` | exit 0，**141 项通过**（dest 解析：数组/命名/XYZ/FitH/Fit/FitR/坏名字/`/Named NextPage`；返回栈：压栈上限、弹栈、阈值、缩放锚点重算；白名单） |
| `LINKS_TAG=after npm run test:pdf-links-browser` | exit 0，**54/54**（真实鼠标输入：悬停提示、跳转 + 闪烁 + 返回、手动回位消失、两级栈、Alt+←、外链 IPC、拒绝提示、150% 平/旋转对齐、工具穿透、跨链接选区），证据 `.tmp/pdf-links/after/` |
| `node scripts/verify-pdf-links-live.mjs`（隔离 dev:live） | **59 项通过 / 15 张截图 / pageerror 0 / console.error 0**（见 §3） |
| `npm run build`（`tsc -b && vite build`） | exit 0 |
| `npm run verify` | **exit 1，唯一失败步骤 `test:ui-state`（主干既有、与本卡无关）**：该脚本对 `src/features/reader/ReaderToolbar.tsx` 断言 `doesNotMatch /className="reader-toolbar-center"/`，而该文件含此串；`git diff --name-only` 中**没有任何 toolbar 文件**，即该断言与本次改动无关。远端 `origin/main` 上的 `cf28501 test(ui-state): align stale reader assertions with shared annotation tools and library return action` 正是修正这条陈旧断言的上游提交，进一步佐证其与本卡无关。其余全部步骤（含 reader、page-control、find、eraser/ink/shape、annotation-geometry、selection-preview、跨页选区、rotated-text、note、library、architecture、agent-status 等）通过；Rust 单测 249 passed / 0 failed / 7 ignored |

## 6. 未覆盖与后续建议

1. **真实系统浏览器弹出**未实测（见 §3 的说明），IPC 参数已逐字段核对。
2. **登录态/受控网络**下的外链未测；白名单与拒绝路径不依赖账号。
3. **可选增强：正文引用文本 → 参考文献条目**（验收第 5 条要求评估）。可行性：可行但需谨慎。pdf.js `getTextContent()` 能拿到带 `hasEOL` 的文本项与坐标，可在页内定位 `References`/`参考文献` 标题，再按 `[n]`（含 `[n,m]`、`[n–m]`）正则匹配行首标号，按「同页 + 垂直距离」排序给出候选。主要风险：① 编号在不同会议模板中复用（图表 `[n]`、公式号 `(n)`、页码混淆）；② 多栏与上下标会让行内顺序与视觉顺序不一致；③ 与文本选择/高亮/查找的命中区域冲突；④ 无法从文本判断引用是否真的可跳转，容易给出错误跳转。因此建议作为**独立任务**实现：默认仅悬停显示可点样式，点击前用「页码跳跃 + 闪烁」并给出「基于文本匹配，可能存在误判」的提示，并提供一次性撤销（复用现有返回栈）；先在 3–5 篇真实论文上标注误判率，再决定是否默认开启。
4. **`/FitR` 的矩形语义**只用了左上角作为落点（其余按观察到的 pdf.js 输出处理）；如需精确框选高亮再扩展。
5. **链接性能**未做专项压测：懒加载与页面渲染并行，实机 5 页夹具与 16 页 arXiv 论文均无首屏阻塞；长文档（>200 页）建议后续加一项耗时观测。

## 7. 交付

- 代码：`feat/pdf-links-yunshu` → 交付分支 `deliver/pdf-links-e4c2fa22`（提交见任务卡 delivery JSON：`sourceRef` 指向该分支，`paths` 等于该提交相对基线提交的完整 diff）
- 提交内容：① 功能提交（云枢，2026-09-29）：链接层/跳转/返回栈/外链白名单实现 + 单测、浏览器回归、夹具；② 交付提交（本次）：`scripts/verify-pdf-links-live.mjs`（dev:live 实机取证驱动）+ 本文件 + `docs/notes/AGENT_STATUS.md` + `plans/PROJECT_STATUS.json`
- 证据目录：`.tmp/pdf-links-live/after/`（dev:live 实机 15 图 + `result.json` + `links-live.log`）、`.tmp/pdf-links/after/`（浏览器回归 7 图 + 日志）、`.tmp/pdf-links/legacy/`（旧代码对照）、`$HOME/pdf-evidence/`（三份原始命令日志）
- 本卡边界：未安装、未打包、未发布、未重启任务服务（43319）、未触碰正式资料库
