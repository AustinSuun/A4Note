# 打开笔记不再露出首行源码 + 切换笔记首帧提速（2891f95a）交付记录 · arena-b · 2026-09-29

- 任务：`2891f95a` Part A 打开笔记时首行（一级标题）不应以源码形态出现；Part B 切换/打开笔记首帧耗时（先 profile 再优化）
- 执行：arena-b（worker `a4f50d11`），分支 `fix/md-open-reveal-arena-b`，worktree `.worktrees/md-open-reveal-arena-b`，基线本地 main `47c7025`，交付前 rebase 到 main `2ab5900`
- 提交与合入：见第 8 节

## 1. 问题与根因

**Part A（首行源码露出）。** 实时预览按「选区所在行」决定是否露出 Markdown 源码。打开笔记时 CodeMirror 的初始选区在文档开头（位置 0），于是首行标题一打开就被当成「正在编辑」，显示 `# 分支法思想：分+治+合`，编辑器此时甚至没有焦点。点击编辑器外部（标题输入框、侧栏空白）后 CodeMirror 失焦但选区仍在首行，源码也不会收起（改前 A4）。

**Part B（首帧慢）。** 改前 cold 首帧 p95 441ms、最长任务 281ms。profile（`.tmp/shots/2891f95a/perf/profile-before.cpuprofile` + trace）显示时间不在读文件，而在打开后的几轮重复工作：

1. **测量循环反复跑。** `mathLayoutStability` / `previewLayoutStability` 两个测量插件各自在 `requestMeasure` 里读几何，结果用各自的 `queueMicrotask` 分别 dispatch。第一个 dispatch 改变了 state，第二个插件的结果就因 `this.view.state !== result.state` 被丢弃并重新测量；同时插件在「已测量但尚未发布」的窗口里又把全部块当作新块再测一遍。一次打开会出现 3 轮完整测量 + 多轮装饰重建（112KB 长文每轮 `buildLiveDecorations` ≈20ms、`createMeasurementDecorations` ≈40ms/3 轮）。
2. **每次切换都重建全部隐藏标签。** 所有打开过的笔记标签都保活挂载（`TabHost` / 笔记场景），宿主（`src/features/markdown/contributions.tsx:42`、`MarkdownWorkspaceScene.tsx:180`）每次渲染都传新的内联回调，所以切到任一笔记时，每个隐藏的 `MarkdownResourceTab`（dock、属性、目录）都要重新 render。挂载的标签越多，cold 打开的内容匹配时间越长（80 → 123 → 126 → 129 → 171ms），warm 切换也带一个 ≈50ms 任务。
3. **重复排版公式。** 测量发布后尺寸变化会让 `LatexWidget.eq` 为假，CodeMirror 重新 `toDOM`，KaTeX 再排版一次；`imagePathCompartment` 在路径未变时也 reconfigure，触发整棵装饰重建。

**剖析数据（perf 全流程 CPU profile，`profile-before/after.cpuprofile`，dev 构建）**

主线程自耗时 Top（`switch-report-*.json` 的 `topSelf`）：

| 排名 | 改前 | 改后 |
|---|---|---|
| 1 | `getBoundingClientRect`（强制布局）557ms | `getBoundingClientRect` 213ms |
| 2 | React `jsxDEV` 203ms | React `jsxDEV` 155ms |
| 3 | CodeMirror `eq`（装饰/widget 比较）127ms | CodeMirror `eq` 147ms |
| 4 | `setAttribute` 98ms | `setAttribute` 98ms |
| 5 | `previewLayoutStability` `measure` 96ms（并列 React `createElement` 96ms） | `getClientRects` 70ms |

项目源码包含子调用的耗时（inclusive）：

| 函数 | 改前 | 改后 |
|---|---|---|
| `previewLayoutStability` `read`/`measure` | 474ms | 226ms |
| 编辑器挂载 effect（推断：`EditorState.create` + `new EditorView`，含首次装饰） | 261ms | 252ms |
| `mathLayoutStability` `read`/`measure` | 243ms | 未进前列（单次打开约 30–40ms） |
| `MarkdownAuthoringDock` render | 78ms | 46ms |
| `layoutMeasurePublish`（新增，合并发布） | — | 67ms |
| `TreeGuides` `measure` | 未进前列 | 54ms |

结论：热点是强制布局（测量插件）和重复的 React/装饰工作，不是读文件或 KaTeX 排版本身。

## 2. Part A 方案：reveal 需要「用户意图」

新模块 `src/features/explorer/liveRevealGate.ts`：

- `liveRevealArmed`（StateField，初始 `false`）。只有**带用户意图**的事务才让它变为 `true`：选区变化或文档变化，且没有 `externalDocumentSync` 注解；也可以用 `setLiveRevealArmed` effect 显式设置（显式优先）。
- `liveRevealGate` = 该字段 + 一个 `focusout` 插件：焦点离开编辑器（`relatedTarget` 不在 `view.dom` 内）时解除，源码随之收起。
- `buildLiveDecorations` 中 `revealArmed = measuring === 'number' || (field ?? true)`；未 armed 时按「无选区」渲染，标题等全部折叠。测量态（`measuring` 为数字）保持原行为；没有装载该字段的旧宿主默认 `true`，行为不变。
- `replaceEditorDocument`（外部同步替换内容）在编辑器无焦点时解除 armed。
- `externalDocumentSync` 注解从编辑器文件迁到 `liveRevealGate.ts`，编辑器从这里 import。

| 触发 | 改后是否露出源码 |
|---|---|
| 打开笔记 / 切回保活标签 / 外部同步替换内容 | 否 |
| 程序化 `focus()`（ref 调用：`MarkdownResourceTab.tsx:509`、`ReaderMarkdown.tsx:209`、`SummaryDocumentEditor.tsx:286`；标题栏 Enter 交接） | 否，直到用户移动光标或输入 |
| 点击某行 / 方向键 / 输入 | 是（该行） |
| 目录跳转、`scrollToHeading`、搜索定位、公式/图片等 widget 点击 | 是（它们都通过带选区的 dispatch） |
| 点击编辑器外部（标题输入框、侧栏、空白） | 收起 |

笔记编辑器、阅读器笔记侧栏和总览的摘要编辑器共用同一个编辑器扩展，所以三处同时生效。

**取舍说明。** 任务建议把揭示条件绑定到 `view.hasFocus`。只看焦点不够：标题栏按 Enter 交接、`focus()` ref 方法、切回标签恢复焦点都会让编辑器获得焦点，而光标仍停在第 1 行，首行会马上又被揭示。所以本实现要求「有焦点 + 用户意图」：程序化聚焦只放置光标，不露出源码，用户第一次点击、方向键或输入之后才按原规则揭示。失焦立即收起，这与任务描述中 Obsidian/Typora 的「没有交互 / 失焦时不显示源码」一致。代价是：程序化 `focus()` 之后直接看不到当前行源码，需要按一次方向键或开始输入；目录跳转、搜索定位这些「用户发起的定位」不受影响，仍会揭示目标行（A5）。

## 3. Part B 方案（逐项 profile 驱动，没有加 debounce）

| # | 改动 | 文件 | 依据 |
|---|---|---|---|
| B1 | 测量结果先保存为「未发布基线」，重复测量在基线上增量进行，不再把已测但未发布的块当新块 | `mathLayoutStability.ts`、`previewLayoutStability.ts` | 3 轮测量 → 1 轮 |
| B2 | 新模块 `layoutMeasurePublish.ts`：同一个测量周期内两个插件的结果合成**一个事务**发布；只有基于旧 state 读出的结果回调 `stale()` 重测，已销毁插件的结果丢弃 | `layoutMeasurePublish.ts` + 两个插件 | 消除相互作废的乒乓 |
| B3 | 所有测量宿主一次 `append` 后再读几何，一次布局 flush | `mathLayoutStability.ts` | 减少强制布局 |
| B4 | `imagePathCompartment` 路径未变时不 reconfigure | `MarkdownLivePreviewEditor.tsx` | 每次打开省一次整棵装饰重建（长文 ≈21ms） |
| B5 | KaTeX HTML LRU 缓存（500 条，按 `D|I + 表达式`） | `MarkdownLivePreviewEditor.tsx` | 同一公式不重复排版 |
| B6 | `LatexWidget.updateDOM`：源码与块/行内一致时原地更新 `min-height` 与 `data-math-*` 位置，不重建 KaTeX DOM；mousedown 通过 WeakMap 读取当前 owner，光标落点跟随最新位置 | `MarkdownLivePreviewEditor.tsx` | 发布尺寸后不再 `toDOM`（≈11ms）；在公式上方输入时同样受益 |
| B7 | `createMeasurementDecorations` 中表格空闲装饰改为惰性计算 | `MarkdownLivePreviewEditor.tsx` | 未用到时不构建 |
| B8 | `MarkdownResourceTab` 拆成外层包装 + `memo` 的 `MarkdownResourceTabView`；包装在 `useLayoutEffect` 中保存最新 props，向内传稳定的 `useCallback` 转发器（原回调缺省时传 `undefined`，保持「没有 `onOpenWikiLink` 时 wiki 链接为惰性文本」的语义） | `MarkdownResourceTab.tsx` | 切换时隐藏标签不再 render；warm 切换不再有长任务 |

内容、属性、目录、滚动恢复、保存与 dirty flush 路径没有改动；B8 只改变 props 的引用稳定性，path/name/active 变化与 context 变化照常触发 render，回调永远调用最新闭包。

### 采纳与放弃的优化

任务列出的可疑热点逐一对照 profile：

| 候选 | 结论 | 原因 |
|---|---|---|
| 测量逻辑合并、减少强制回流 | **采纳**（B1–B3、B6） | profile 第一热点；3 轮测量 → 1 轮，`getBoundingClientRect` 557 → 213ms |
| 隐藏标签 / 面板重复 render（属性面板、dock、目录） | **采纳**（B8） | 挂载标签越多 cold 越慢（80 → 171ms）；memo 后 warm 切换无长任务。没有改 `MarkdownPropertiesPanel` 本身，避开 3eabf1ac |
| KaTeX 同步渲染 | **部分采纳**：缓存 + 原地更新（B5、B6），**放弃分帧** | 重复排版才是成本，冷缓存下单次打开排版约 6ms。分帧渲染会先插入未排版的公式再变高，与 `mathLayoutStability` 的高度预留相冲突，造成跳动 |
| 复用 `EditorView`（`setState` 替换） | **放弃** | 挂载 effect 只在 5 次 cold 打开时运行，每次约 50ms，主要是新文档装饰字段的初始化；用 `setState` 复用 view 同样要做这部分，只省 view 自身的 DOM 创建。而复用要重写历史栈、dirty flush、滚动恢复的会话边界，正确性风险大于收益 |
| 装饰只对 `visibleRanges` 构建 | **放弃** | 块高度预留与滚动恢复依赖全文装饰。`buildLiveDecorations` 在 112KB 长文上约 20ms/次，重复构建已由 B1/B4 去掉 |
| 图片改 blob URL / LRU | **未做**（建议后续） | 04 样例有 6 张约 2.8MB 的 PNG，但图片按异步加载，首帧以文本内容为准；`btoa` / `fromCharCode` 不在自耗时 Top 7 中。超大图场景值得后续改为 blob URL |
| 目录 / 文件树 `TreeGuides` 重算 memo 化 | **未做**（建议后续） | 改后 `TreeGuides` `measure` 共 54ms，是剩余热点之一。文件树由 1f8d8317 在审，避免同文件冲突 |
| `useTextDocument` 读取与上一篇 flush 串行 | **未改** | profile 中没有相关热点，cold 打开小文件 01 的内容匹配为 72ms；没有做专门测量，未发现它成为瓶颈 |
| 防抖 | **放弃** | 任务明确不接受；last-click-wins 由状态本身保证 |

过期任务：测量结果如果基于已经过期的 state，会回调 `stale()` 重测，不会覆盖新 state；已销毁的插件（被切走的编辑器）结果直接丢弃；公式 widget 的点击读 WeakMap 中的当前 owner。连续 10 次快速切换后终态始终是最后一次点击的笔记（改前改后都通过，见 burst）。

## 4. 性能结果（dev:live，同一台机器，同一组样例，均无并发任务）

样例 `.tmp/arena-b/openmenu-notes/perf/`：01 分支法思想（含属性）、02 长文 ≥100KB、03 公式 ≥10 个 KaTeX、04 图片 ≥5 张本地图片、05 混合。流程：reload → 5 次 cold 打开 → 5 次 warm 切换 → 10 次快速连点（burst）。首帧 = 内容匹配后的下一帧 rAF。脚本 `.tmp/arena-b/perf-switch.mjs`，报告与 trace/cpuprofile 在 `.tmp/shots/2891f95a/perf/`。

| 指标 | 改前 | 改后 | 变化 |
|---|---|---|---|
| 全部 10 次切换首帧 p95 | 441ms | **206ms** | −53% |
| cold p50 / p95 | 232 / 441ms | 187 / 206ms | |
| warm p50 / p95 | 69 / 83ms | 50 / 57ms | −31%（p95） |
| 长任务总数 / >200ms | 16 / 1 | 9 / 0 | |
| 最长任务 | 281ms | 85ms | −70% |
| burst 最长任务 | 186ms | 66ms | |
| burst 最后一次点击生效 | 是 | 是 | |
| console / pageerror | 0 | 0 | |

cold 各篇首帧（01–05）：改前 123 / 230 / 441 / 232 / 265ms，改后 96 / 175 / 187 / 202 / 206ms。

中间版本（便于复核每一步的贡献）：Part A + 初版 Part B p95 306ms；B1–B3 后 237ms；加 B4/B5/B7 后 236ms；加 B8 后 225ms（warm 长任务归零）；加 B6 后 206ms。

## 5. 测试

| 测试 | 内容 | 改前代码 | 改后 |
|---|---|---|---|
| `npm run test:markdown-open-reveal`（新增） | `verify-markdown-open-reveal.mjs`：Vite `ssrLoadModule` 加载真实 `buildLiveDecorations` + gate，断言首行标题打开时折叠；点击/方向键/输入/跳转露出；失焦收起；外部替换内容不露出；测量态；旧宿主默认行为；源码连线断言（CRLF 安全）。同时串联原本没有注册的 `verify-math-layout-stability.mjs`、`verify-preview-layout-stability.mjs` | 失败 | 通过 |
| `npm run test:markdown-open-reveal-browser`（新增） | `verify-markdown-open-reveal-browser.mjs`：真实编辑器 + Chrome，导航后连续 30 帧采样首行标记；首行标题折叠、编辑器无焦点；点击露出、点其他行收起、点标题输入框收起、`view.focus()` 仍折叠、End/ArrowUp/输入露出、目录跳到「第二节」露出 `##`；console 0 | **失败**（前几帧首行即显示 `##`/`#`） | 通过 |
| `verify-math-layout-stability` / `verify-preview-layout-stability`（更新） | 加载 `layoutMeasurePublish.ts`；源码断言改指新模块；新增发布批处理行为断言：同 state 两个结果只 dispatch 一次，旧 state 结果回调 stale，已销毁插件跳过 | — | 通过 |
| `test:reader`（更新） | `externalDocumentSync` 断言改指 `liveRevealGate.ts`，并断言编辑器从该模块 import | — | 通过 |

| `npm run perf:markdown-switch`（新增，可选 / 本地，不进 verify） | `scripts/perf-markdown-switch.mjs --cdp-port <p>`：连接 dev:live 实例，5 次 cold + 5 次 warm + 10 次快速连点；报告（首帧分布、长任务、Top 函数、可选 trace/cpuprofile）写入 `.tmp/markdown-switch-perf`。耗时只报告不断言；最后一次点击没有生效（标题/内容/选中行/属性数）、某次切换一直没显示目标笔记、或出现 console/page error 时失败。样例由 `npm run perf:markdown-switch-notes -- <folder>/perf` 生成 | — | 见第 6 节 |

两个新回归测试已加入 `scripts/verify-all.mjs`。

回归：全部 `test:markdown*`、`test:reader*`（`-native` 两项需要安装版应用，未跑）与 `test:architecture` 通过：reader-page-control、reader、reader-helpers、reader-popover-layout、reader-note-sidebar(-browser)、reader-note-markdown、markdown-safety、markdown-scroll-browser、reader-note-properties(-browser)、markdown-open-reveal(-browser)。

`npm run verify`（PowerShell，rebase 到 main `2ab5900` 之后）：失败的只有 main 上本来就失败的 `test:ui-state`（383 行）、`test:reader`、`test:pdf-selection-preview`、`test:pdf-text-annotation`；两个新步骤都通过。后三项在干净的 main `2ab5900`（`.tmp/arena-polish/wt-main`）上同样失败：`2ab5900` 把批注工具抽到 `src/features/annotationTools`，而这几个测试仍按旧位置做源码断言（`test:reader` 第 94 行 `id: 'text'`、`if (color === 'yellow') return '#ffd54a';`、文字工具设置）。本任务对 `test:reader` 的改动（第 241 行 `externalDocumentSync`）在 rebase 前的回归中通过。

另有 main 上已有、未注册到任何 npm 脚本的失败（改前改后结果相同）：`verify-quote-source.mjs`（`isMeasuring is not defined`）、`verify-markdown-selection.mjs`（defaultSettings 断言）、`verify-table-cell-editing.mjs`（`previewBlockAttributes is not defined`）、`verify-image-layout.mjs`（找不到 `paperImageReference`）。

## 6. 真实应用（dev:live，`--instance arena-b --port 1451 --cdp-port 9251`）

截图在 `.tmp/shots/2891f95a/`。

| 步骤 | 改前 | 改后 |
|---|---|---|
| A1 打开笔记首帧 | `#` 露出，编辑器无焦点（bug） | 无源码标记 |
| A2 点击标题 | 露出 | 露出 |
| A3 点击其他行 | 收起 | 收起 |
| A4 点击编辑器外部 | 仍露出（bug） | 收起 |
| A5 目录跳转 | `## 递归的概念` 露出 | 同左 |

最终代码复核（`final/final-check.json`）：打开无标记且无焦点 → 点击标题露出 `#` → 点外部收起 → 切到其他笔记再切回仍折叠且内容正确 → 输入一个字符后自动保存写盘，删除后文件与原文**逐字节一致**，保存状态「已保存」→ console/pageerror 0。

**rebase 之后的可选性能用例。** verify 期间 dev:live 实例于 12:03 正常停止（`session.json` 中 `status: stopped`），第 4 节的数据和上面的截图都在此之前采集。rebase 到 `2ab5900` 后重启同一实例，跑了两次 `npm run perf:markdown-switch -- --cdp-port 9251 --no-trace`，两次都 **PASS**：最后一次点击生效，每次切换都显示了目标笔记，console/page error 0；报告在 `.tmp/markdown-switch-perf/switch-report-repo-check{,2}.json`。但这两次的耗时不能和第 4 节比较：当时机器上用户自己的 Harbor 浏览器会话（SwiftShader 软件渲染，与本项目无关，未触碰）占用约 46% CPU，连最轻的 warm 切换也整体慢了约 2 倍（05 从 43ms 到 102ms）。第二次 cold p95 619ms、warm p95 192ms，仅作为功能校验记录。

## 7. 共享文件与冲突提示

- 新增文件：`src/features/explorer/liveRevealGate.ts`、`layoutMeasurePublish.ts`，`scripts/verify-markdown-open-reveal{,-browser}.mjs`、`scripts/perf-markdown-switch{,-notes}.mjs`。
- 本任务修改的共享文件：`src/features/explorer/MarkdownLivePreviewEditor.tsx`、`MarkdownResourceTab.tsx`、`mathLayoutStability.ts`、`previewLayoutStability.ts`、`package.json`、`scripts/verify-all.mjs`、`scripts/verify-reader-rendering.mjs`。
- 没有碰高冲突文件（App.tsx、types.ts、lib.rs、tokens.css、workbench.css）。
- 任务 `d8505429`（board 布局）可能改 `MarkdownAuthoringDock`，本任务刻意没有改动它。
- `package.json` / `verify-all.mjs` 与 main `2ab5900`（annotation-tools 测试）只是相邻插入。

## 8. 提交与合入

见任务板交付记录（delivery JSON 中 `commit` / `baseCommit`）与 `docs/notes/AGENT_STATUS.md`。
