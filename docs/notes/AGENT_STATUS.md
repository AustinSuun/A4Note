# A4 Note Agent 状态
- shortcut-hint-size-xingxu：星序已领取63b530ee spec2，独立分支fix/shortcut-hint-size-xingxu/worktree .worktrees/hint-size-xingxu，基线main9714b06。范围仅共享快捷键提示字号/键帽、实际测量避让与鼠标侧键短标签及回归；不改图层入口/文本标注并行任务。先在隔离dev:live测量当前11px键帽和底部密集锚点，再增大并验证缩放/长组合键/侧键/弹窗。未修改产品、未打包安装发布。
- windows-package-arena：用户指示「代码合并了，直接打包一下」，Arena 对已合并 main 打包 Windows 0.1.28。按仓库约定（chore: release 0.1.26/0.1.27）把 0.1.27 递增到 0.1.28——已发布的 0.1.27 需要更高版本号才能通过 latest.json 收到更新，改动 package.json / src-tauri/Cargo.toml / Cargo.lock / tauri.conf.json 各 1 行，提交 76a6cb2（基线 38d9977）。npm run package:windows 退出 0、约 202 秒；产物 artifacts/windows/latest/a4note.exe（37687296 字节，SHA-256 20FB3F6DC851A27B65E680A3CC50E5F051F89E87E203A98EEC021AF18B567CF7）与 A4 Note_x64-setup.exe（22831212 字节，FA5A1EE17FBE24E9CEECC1D99826D01E7AF174D1D5300BF09752DA6F8381BB29），两者独立重算哈希与 build-info.json 一致，.sig 与 latest.json 签名一致；上一份 0.1.27 latest 归档至 artifacts/windows/archive/0.1.28-20260922-180501-20328。脚本自带核验通过（exe 内 5 项前端入口资源、浮动工具坞 CSS、签名非空）；另从打包提交重跑前端构建确认包内含 annotation-layer-delete / data-layer-confirm-move / annotation-layer-row 标记。首跑因父会话结束收到 STATUS_CONTROL_C_EXIT 已改独立进程重跑，784MB 半成品目录已清理。未运行完整 verify、未安装/实测、未推送/发布；sourceDirty 仅因既有未跟踪文件，已跟踪源码零改动。详见 docs/mcp-windows-package-arena-2026-09-22.md。
- eraser-alignment-xingxu：星序完成 fcd4d8d6 spec2。先在真实隔离 Windows/Tauri Mean Flows 蓝色笔迹上复现 UI80/PDF370 圆环偏移(-134.94,-164.11)px；根因是 viewport CSS 偏移被当作 local CSS 二次缩放，且预览直径与命中半径混用坐标空间。现中心用页百分比、半径用未缩放布局尺寸，无固定补偿/DPR叠乘，保留页外停止、乐观保存和失败反馈。四组原生前后对照中心误差≤0.0063px；追加原生118%/140%/fit-width/侧栏/窄窗、45项原生持久化/连续帧/图层/undo/redo/reopen通过。precision26、真实PdfReader浏览器217/24场景、PowerShell完整verify（Rust215/0/5 ignored）、diagnostics0通过；旧实现浏览器红测110.316px。正常场景console/pageerror0，锁定负测保留1条预期拒绝日志。原生配对实测DPR1.25，另模拟DPR1/1.25/1.5，不冒充物理多屏认证。交付/合并SHA与截图见任务记录，下一步用户验收；未打包/安装/推送/发布。详见 docs/mcp-pdf-eraser-alignment-xingxu-2026-09-22.md。
- annotation-layer-picker-native-arena：Arena 补做 f6b927bb 验收第 8 项（dev:live 隔离实例原生取证）。仓库既有隔离实例都带 owner.lock.json 且启动器 fail-closed，故用官方启动器新建隔离实例 arena-f6（app.aster.research.dev.arena-f6.w8cbe287824，1451/CDP 9261；冷编译 1m47s、增量 10s），在真实 Tauri 窗口打开内置指南 PDF 并逐级建到 1/5/12 层：状态条「DEV arena-f6 · 独立测试库（原生已核验 …/AsterData）」；入口固定 64px（1/1 → 12/12）、aria-label 带完整层名；弹窗内无单选圆点、每行有删除按钮；「新图层」78×30 未裁切；12 层时 popoverScrollW=clientW=280、列表内部滚动 446/264；重命名「超长图层名称 Long Layer Name 12345 🚀 emoji」后入口仍 64px。13 项断言 12 通过，唯一失败为 dev favicon.ico 404（同窗口 fetch 复核：favicon 404、vite.svg/manifest 200），无 pageerror、无应用 console error。证据 .tmp/shots/annotation-layer-picker-native/native-2026-09-22T08-51-04-047Z（result.json + 7 图）已上传任务卡；驱动脚本 .tmp/arena-mcp/native-shots.mjs 属 .tmp 临时工具未入库。该实例暖目标保留、锁按约定保留（ownerPid 已退出）。未打包/安装/推送/发布。
- annotation-layer-picker-arena：Arena 完成 f6b927bb（high）阅读器标注图层弹窗 UI 优化与底部图层入口解耦。去掉每行左侧单选圆点，活动图层改为整行 --accent-soft 底色 + 内描边 + 名称加粗（role=radio/aria-checked 语义保留）；“新图层”此前被通用 reader-tool-popover-heading button 的 26×26 方块规则裁切，改为内容驱动按钮（min-height 30px、文案完整）；每行新增垃圾桶删除按钮（唯一图层禁用，含标注/引用时 alertdialog 提供“移动并删除 / 连同标注删除 / 取消”，取消不改数据且焦点回到删除按钮，删除活动层按相邻顺序接管）；底部工具坞入口固定 64px，只显示叠层图标 + 可见/总数，与可编辑图层名彻底解耦，完整名称保留在 aria-label/title/弹窗内。新增 npm run test:annotation-layer-picker（隔离浏览器契约 43/43：无圆点、整行选中态与对比度 ≥4.5、删除保护与确认流、12 层滚动、460px@150%、深色主题、pageerror 0），首跑即捕获并修复 460px@150% 弹窗横向溢出（min-width 300→280）；test:annotation-layers 55 项、tsc 0、build 0、diagnostics 0。npm run verify（PowerShell）30 步中 28 通过：test:annotation-layers 因新按钮源码写法不匹配既有文本契约而失败，改用保留 “/> 新图层” 写法的兼容实现（不改他人脚本）后单跑 PASS 55；test:pdf-find-entry（他人卡脚本，与本轮文件无交集）为宿主高负载下 30s page.goto 超时，已如实记录、未改该脚本。未提供原生 dev:live 截图（无人值守无法经文件对话框打开 PDF，限制与已验收卡 23528921 一致）。未打包/安装/推送/发布，未触碰他人未提交改动。详见 docs/mcp-annotation-layer-picker-arena-2026-09-22.md。
- reader-selection-outline-xunzhou：巡舟完成 7ef5d0fd 阅读器“正在阅读”鼠标选中外框修复。Reader 行内原本广泛的 `button:active` inset shadow 同时命中标题按钮，现仅展开与移除按钮保留 active 反馈；整行 `li.active` 背景是唯一鼠标选中层，键盘 `:focus-visible` 轮廓保持。实现 `36d9e6a`，任务分支已合入最新本地 main `9bcc068`。旧 CSS 红测 25/26 且只失败预期断言，修复及合并后 26/26；`dev:live` 官方运行时 21/21、真实应用 raw-CDP 20/20，pageerror/console error 0；build、完整 verify（Rust 215/0/5 ignored）、diagnostics 0 全绿。鼠标/键盘截图和 JSON 已上传任务卡；未打包、安装、发布或写入生产资料库。详见 `docs/mcp-reader-selection-outline-xunzhou-2026-09-22.md`。

- reader-annotation-toast-drag-xunzhou：任务 20b183cd 完成；fa49614 统一移除高亮/下划线/画笔/橡皮擦/文本框/图形/箭头正常操作期间的 role=status 与“正在…”提示，同时以带 revision 的乐观几何稳定文本框移动/缩放，避免 pointerup 后被旧异步几何回写。Windows/Tauri DPR 1.25 在 100%/118%/140%/190%、滚动、侧栏、边缘、快慢拖动、pointerleave、undo/redo/reopen 与原生回读均通过；持久化拒绝仍保留重试/放弃反馈。实现已由 4c918db 合入本地 main。

- reader-find-trigger-arena-two：arena-two 完成 6a2240f7 移除阅读器常驻「查找」按钮，PDF 搜索仅由 reader.search 快捷键（默认 Ctrl+F，可改绑）与命令面板「搜索当前 PDF」触发。PdfFindBar 未打开时 return null（DOM 无 .pdf-find-trigger、无 display:none 隐藏），删除对应死 CSS 与按钮上的 useShortcutProps 锚点；打开/重选聚焦改为 focusRequest + useEffect（原 rAF 与 canvas 焦点竞争）；打开态行为未改，未新增任何入口。fix bb020ee（基线 c056588）。验证：tsc 0、build 过；新增 test:pdf-find-entry 35 断言（旧代码在「no .pdf-find-trigger control or style remains」失败）覆盖关闭态渲染为空、reader-find 事件打开、reader.search 注册且默认 Ctrl+F、再按重选、非 PDF 模式不打开且无错误、Ctrl 提示层 floating 提示；shortcuts/shortcuts-browser/reader/ui-state/architecture/verify-reader-priority-fixes 全过；npm run verify 全量通过。独立身份 app.aster.research.dev.arena-two-find.wcb085547e0 的 tauri debug 二进制真机取证 18/18（无按钮、Ctrl+F 开/聚焦/1/60/Enter/Shift+Enter/重选/Esc、命令面板、Ctrl 提示层 reader.search floating + zoomIn adjacent、pageerror 0；非 PDF 分支合成夹具无译文记 NOTE，由浏览器回归覆盖）。详见 docs/mcp-reader-find-trigger-arena-two-2026-09-22.md。

- reader-text-layer-offset-arena-two：arena-two 完成 9222954f 高缩放+侧栏下鼠标位置与标注预览/选中效果左偏修复。根因不是容器/侧栏偏移，而是透明文本层以替代字体自然宽度（0.86–0.89×）渲染、选区却按 PDF run 宽度线性切片，误差 ∝ 缩放×字符序号（原生窗口实测 100% 行尾 −33px、150% −57px、370% −120px，侧栏横滚时整条标注可被推出可视区）。修复：PdfTextLayer 按 pdf.js 方式量测每个 run 并用 --pdf-run-scale 拟合到 PDF 盒（0/90/180/270，fonts.ready+ResizeObserver 复测、不叠乘）；新增 textSelectionRectsFromLayer 从真实字形 Range 取起止，预览/最终标注/命中共用一条几何，比例切片仅作回退；无按工具或 370% 的硬编码补偿，自由笔/图形/箭头管线未改。fix 2aba6ba，合并 main 4c918db 得 4d50ded。验证：tsc 0、build 过；新增 test:pdf-text-layer-offset 55 断言（旧代码失败）与浏览器回归 113/113（旧 48/106）；reader/selection 37/rotated 151/crosspage 31/layers 55/ui-state 全过；合并后 npm run verify 全量通过（Rust 215/0/5 ignored）。独立身份 app.aster.research.dev.arena-two.w15eca3720d 的 tauri debug 二进制 before/after 真机取证（CDP 真实鼠标、合成 PDF、独立 profile、DEV 状态条）：修复前 33/61 通过，修复后 62/62；370%+侧栏起止 Δ 由 −8.4/−120.5px 变为 ≤0.02px，resize 与 reload 后仍对齐，pageerror/console error 0。证据 .tmp/native/evidence/{before,after}。详见 docs/mcp-reader-text-layer-offset-arena-two-2026-09-22.md。
- reader-eraser-pointer-xunzhou：巡舟完成 ecbf83de PDF 橡皮擦再回归；新增单一 raw client→pdf-render-layer 坐标采样，预览与命中共享 pixel/percent/inside，中心一离页即在接触 ink 前停止，未改精确线段裁剪、指针捕获与累计保存。修复前 Windows/Tauri 118%/DPR1.25 稳定复现“环隐藏但页外 5px 仍擦除”；所报右下偏移在该隔离实例未复现，未虚构，修复后 100%/120%/滚动120% 命中中心误差均小于 0.00008px。真实 WebView 页外/回入、仅接触段、undo/redo、重载持久化、跨页、可写/隐藏/锁定层均通过；22 项 eraser、Reader/helpers、图层 55 项、完整 verify（Rust 215/0/5 ignored）、diagnostics 0、diff check 全绿。仅记录 dev favicon.ico 404，无 pageerror/应用逻辑 console error。详见 docs/mcp-pdf-reader-eraser-pointer-xunzhou-2026-09-22.md。
annotation-popover-swatch-chengchuan：澄川完成 23528921 标注工具弹窗色板裁切与文本框色板对齐修复。ToolColorPalette 重构为「标题行（label + 无背景开关）+ 色块行（自定义色 + 预设网格）」两行结构，「无背景」不再占色板列、开/关不跳位；.tool-option-color-group 改纵向 flex 并新增 heading/row 契约；弹窗宽度内容驱动（色板工具 ≈396px、无色板 300px），≤480px 预设 5 列换行；不缩色块、不删颜色、不用 overflow:hidden 掩盖、未 reintroduce 关闭 ×。修复提交 9a180c4 已合并本地 main 29341cc（基线 59ca336）。验证：build 通过；新增布局回归 verify-reader-popover-layout-browser 166/166（6 工具 × {1280×800@100/125/150%、800×600、460×700}：无横向溢出、20 预设+选中描边完整、三组文本色板左缘差 ≤1px、无背景无跳位）；焦点回归合并前 367/367，合并后放宽数量假设至 >=9 复跑 367 过、4 项失败均为快捷键卡片新增「阅读器快捷键设置」按钮的脚本预期（该卡入 main 后的既有待同步项，本卡不代改）；诊断 0；上游 bd77244 对齐 ui-state 断言后 main 全量 verify 全绿（Rust 215/0/5 ignored）。dev:live 隔离实例 chengchuan（app.aster.research.dev.chengchuan.w8cbe287824，5210/CDP 9231）verify-dev-live-runtime 21/21，badge「DEV chengchuan · 独立测试库（原生已核验 …）」、mode isolated，证据 .tmp/live-evidence/chengchuan-1790045515076；无人值守受系统文件对话框所限未开 PDF，弹窗几何由隔离 Chrome 回归（真实组件+应用 CSS）覆盖。详见 docs/mcp-annotation-popover-swatch-chengchuan-2026-09-22.md。



## 当前工作：上下文快捷键任务接手（星序）

- context-shortcuts-xingxu：星序完成9230f8ce spec4实现及验证：按钮旁省略已按住的Ctrl，保留必要Alt/Shift/Meta；浮动行完整键位+功能名，紧凑/完整两套测量，整体避让弹窗。实现98bb238，最终整合main ae5896c得7a09d09，保留最新设置UI/行内录制及查找按钮移除。最终verify退出0/136.066秒，core52/dispatcher50/layout33/settings22/browser110、原生40+布局49+弹窗14+重启4+显隐4通过，diagnostics0。main最终整合与提交SHA见任务卡交付记录，下一步用户验收；按授权备份并保留并行修改，不代提交其他任务。未打包/安装/推送/发布。详见docs/mcp-shortcut-hints-spec4-xingxu-2026-09-22.md。
- reader-highlight-underline-baseline-xunzhou：巡舟完成 a35a4c83 阅读器高亮/下划线基线定位修复；按 PDF.js 基线语义对 0°/90°/180°/270° 高亮仅在降部侧扩展 20%，下划线移到基线外并保留 0.04×字形轴间隙，拖选预览与持久标注共用几何。旧标注数据、颜色/混合、重叠交互、文本框/形状/箭头/橡皮保持兼容。实现提交 983f3f7，最新 main d726c5d 已合入任务分支 ae13047；helpers、reader、selection 37、highlight 57、rotate 100/150/200% 各 151、完整 verify 全绿，diagnostics 0。详见 docs/mcp-reader-highlight-underline-baseline-xunzhou-2026-09-22.md。

- windows-package-xingxu：用户授权本地EXE打包完成；0.1.27 windows-x64，main 4b40788，builtAt 2026-09-22T00:37:26.577Z（08:37）。package:windows 退出0/308.491秒，EXE与安装包SHA256独立核验一致，更新签名非空且与latest.json一致，5项前端入口嵌入与浮动工具坞CSS验证通过。Cargo.toml仅打包换行变化，按构建前SHA256逐字节恢复，业务源码哈希无变化。旧latest已归档。未包含23528921色板任务、e5e73f0f未交付图层精简或9230f8ce未完成快捷键；未完整verify、桌面测试、安装、推送、发布。详见 docs/mcp-windows-package-xingxu-2026-09-22.md。

- reader-selection-band-arena：Arena 接管 35496a06 高亮色带任务，保留 b79ba58/6b507e8。拖选期间保留真实 Range，但把浏览器原生色带透明化并通过与持久高亮相同的 textSelectionDraft→方向感知 segments→highlightPositionStyle 管线绘制；forced-colors 恢复系统选区。黄/绿/蓝/紫改为 #ffd54a/#8fd9a3/#8fb9f2/#bf9cf0，未保存配置默认 opacity 22→40、范围 10–60，既有明确保存值不迁移；单 SVG 合成避免重叠 alpha 累积。selection preview 37、highlight 57、reader、rotate 142、crosspage 31、完整 verify（Rust 209/0/5 ignored）全绿，diagnostics 0。指定 2505.13447v1.pdf 当前损坏、译文 PDF 缺失，未冒充样本验证；隔离原生改用有效内置指南与旋转 fixture 复核。详见 docs/mcp-reader-selection-band-highlight-arena-2026-09-21.md。



- reader-note-workbench-arena：Arena 执行 24ea34e5（high）完成阅读器笔记工作台重设计：新增四态状态机与按论文偏好（noteWorkbench.ts / useNoteWorkbench.ts，键 a4note.reader.noteWorkbench.<paperId>，含 mode/previousMode/wideMode/splitRatio/floating/activeNoteId 与损坏回退），阅读顶栏收敛为唯一入口 ReaderNoteWorkbenchMenu（主按钮恢复上次模式 + 四模式/新建/历史菜单，含 kbd 与 aria-keyshortcuts），移除旧纵向「继续笔记」耳朵与笔记面板「全宽写作」按钮；分屏宽度改由比例驱动（默认 37%、26%-62% 夹取、PDF>=520px）并可拖动/键盘调整后按论文持久化；悬浮速记卡按容器比例记录位置尺寸且不可越界；专注写作占满内容区而正文列保持共享宽度 token --authoring-content-max-width（tokens.css，独立 Markdown 同步改用，消除第二套 760px 常量）；开合过渡 200ms 且 prefers-reduced-motion 取消；命令清单 reader.notes.toggle/quickCapture/mode.split/mode.focus/mode.floating 与 reader.pdf.focus 通过 NOTE_WORKBENCH_COMMAND_LIST 暴露给快捷键分支的 scoped resolver，useReaderWritingShortcuts 收敛为单一监听器；新增 scripts/verify-note-workbench.mjs（51/51）与 scripts/verify-note-workbench-browser.mjs（隔离 headless Chrome 42/42、9 场景截图存 .tmp/shots/note-workbench/）；未安装、未打包、未发布。

- reader-overlap-selection-arena：Arena 执行 3128932d 第二轮反馈修复：跨行高亮/下划线改用 PDF 文字层运行几何（`textSelectionRectsFromOffsets` 优先、浏览器实时矩形仅兜底），端点跟随可见文字、同字号行高一致；新增 `underlineThicknessForSegments` 以段高中位数统一整条下划线线宽，`AnnotationMark` 渲染传入统一线宽。`test:reader-helpers` 新增断言、`test:reader` 源码契约同步；合成重叠回归 9/9；英文 arXiv 2505.13447v1 与中文文字层 fixture 正文回归各 20/20（含跨行厚度一致、末端跟随文字审计）、pageErrors 0；npm run verify 全绿。详见 `docs/mcp-reader-overlap-selection-arena-2026-09-21.md`「跨行标注几何修复」。

- settings-ui-refactor-arena：Arena 执行 05795e28（low）完成 Settings UI 重构：单体 index.tsx 拆为 types/catalog/primitives/useAsyncStatus/updateModel/updateViews 与 7 个分类 section；新增 settings.css 作为布局唯一权威（1180/1040 断点，去 nth-child，清理 components/workbench 双列冲突与零引用的 settings-typography.css）；分类导航键盘/aria-current/焦点归属、全局搜索 combobox、label 与 ≥32px 点击目标、live-region 不堆叠、Capture 100 条分页、UpdateSettings 与 BrandUpdateMenu 共享 updateModel、initialSection 受控同步；新增渲染级套件 scripts/verify-settings-ui.mjs 115/115（真实 DOM+CDP，截图 .tmp/shots/settings-ui），build、test:ui-state、verify-brand-update、架构与完整 verify 全绿。未打包未发布。
- reader-eraser-precision-qingyan：qingyan 8dba61be 退回后续（用户追加橡皮擦诉求）完成，分支 fix/eraser-precision-qingyan，基线 main 78dbc43，提交 74bda28。根因与画笔设计相关：画笔按 0.16% 位移稀疏采样，旧 eraseInkPosition 只要橡皮蹭到一条长边就整段丢弃，导致未接触的字迹被整块擦掉（两点笔迹中部单击直接返回 null 整条删除）；改为按 eraserSpanOnSegment 求进出参数区间裁剪并插回边界点。另修两处漂移：eraseInkAtPointer 原用会 clamp 的 pointFromEvent，指针移出页面后沿页边继续擦除，现用未钳制坐标并在超出「页面+橡皮半径」时提前返回；updateEraserCursor 去掉 clamp，预览环不再贴页边滑动。新增 test:pdf-eraser-precision（16 项）接入 verify-all，并用 main 旧代码反向验证测试确实会失败。隔离实例 qingyan/1433/9243 真实鼠标：画 41 点长笔迹→中部单击→polyline 变 [21,21] 两段保留、缺口等于光标大小，预览环漂移 0px，按住拖出页外 polyline 不变，隔离 SQLite ink 行 runs=[21,21]/42 点一致，无 pageerror。tsc 0、npm run verify 全绿。实例已退出、锁已清。详见 docs/mcp-reader-eraser-precision-qingyan-2026-09-21.md。

- annotation-layers-arena：Arena执行 fb5e3f2f（high）第一阶段完成：annotation_layers + 按 owner 视图表、annotations/resource_annotations 加 layer_id 与复合索引、启动事务内幂等回填默认层；图层 CRUD/排序/锁定/归档/移动/删除预览与删除命令，锁定/归档层拒绝写入，启动载荷只含可见层并按层懒加载；Reader 工具坞图层入口 + 快速选择器（唯一活动层、显示/锁定、新建空白/学习记录/管理）、标注列表按层分组筛选与移动、完整管理页与两步删除；undo/redo 快照带 layer_id 并新增可撤销 move。Rust 214 项（含 20 层×10,000 条夹具：可见层读 3ms/全量 21ms/计数 0.8ms，走 annotations_by_layer_created 索引）、前端 51 断言、verify 全绿；隔离实例 arena-f4 真实窗口 56/56。分支 feat/annotation-layers-arena，详见 docs/mcp-annotation-layers-arena-2026-09-21.md。

- reader-overlap-selection-arena：Arena 执行 3128932d 本轮补强：`AnnotationMark` 在高亮/下划线文字选择模式下对范围标注跳过 `preventDefault`/`stopPropagation`，`AnnotationOverlay` 传入选择模式；光标模式交互保持。合成重叠回归 9/9；使用真实英文 arXiv 2505.13447v1 第 1 页摘要正文和独立中文文字层 PDF fixture 做正文区域（页面高度 30% 之后）高亮/下划线回归，各 14/14、pageErrors 0；截图与 `real-body-evidence.json` 已附任务卡。当前 worktree 未找到任务描述列出的 `2505.13447v1-仅译文.pdf`，未冒充该文件已验证；原生隔离 WebView/SQLite 证据沿用任务卡既有 result 附件。详见 `docs/mcp-reader-overlap-selection-arena-2026-09-21.md`。

- reader-crosspage-selection-arena：Arena执行 8dba61be（审计F3，high）完成：跨页拖选按页裁剪 Range 逐页生成高亮/下划线（不再因公共祖先不在单页而静默丢弃），quote 只取文字层运行；文本框/便签正文非编辑态 user-select:none；新增 test:pdf-crosspage-selection（31 断言）接入 verify-all；隔离实例 arena-f3 真实窗口 22/22（60% 两页同屏跨页 2 条记录、跨页下划线、单页回归、文本框不可选、reload）；npm run verify 全绿。分支 fix/reader-crosspage-selection-arena，详见 docs/mcp-reader-crosspage-selection-fix-arena-2026-09-21.md。


- reader-scan-text-tools-arena：Arena 执行 259f7b91（审计 F6，high）完成：无文字层页面（扫描页）使用高亮/下划线不再静默失败——按当前页 textItems 为空判定，页容器加 text-tools-unavailable（光标 not-allowed）并显示 zh.reader.textLayerUnavailable 非阻断提示（role=status、aria-live=polite、pointer-events:none、约 5.2s 自动消失）；矩形/箭头/自由画笔/文本框不受影响。新增 scripts/verify-reader-text-tool-scan-notice.mjs（合成两页 PDF，23/23）；隔离原生实例 scantools 真实窗口 33 项通过、SQLite 终态 rect/ink/text/highlight 各 1 且扫描页零高亮记录、pageerror 与 console error 为 0；合并后 main `npm run verify` 全绿（exit 0）。已合并本地 main 61720e9，详见 docs/mcp-reader-scan-text-tools-arena-2026-09-21.md。

- reader-overlap-highlight-qingyan：青砚完成 3128932d 阅读器重叠高亮选区修复；仅在高亮/下划线文字选择模式让已有范围标注穿透指针，光标模式的选择/改色/删除以及文本框/图形交互保持不变。reader 契约与真实 PdfReader 合成 PDF 浏览器回归 9/9 通过，隔离原生 WebView 使用真实 PDF 完成跨旧标注选区、创建重叠高亮、独立聚焦/改色/删除及 SQLite 终态复核。详见 docs/mcp-reader-overlap-highlight-qingyan-2026-09-21.md。

- reader-rotated-text-layer-arena：Arena执行 e8106251（审计F1，high）完成：/Rotate 页文字层按运行/上升向量取框并记录 orientation，PdfTextLayer 用 vertical-rl/sideways-lr/rtl 布局，选区切片、分行、拖选、搜索与高亮/下划线几何沿字形轴；新增 test:pdf-rotated-text（142 断言，位图墨迹对齐）接入 verify-all；隔离实例 arena-f1 真实窗口 63 项通过（四方向高亮/下划线 SQLite 记录、缩放、重载）；已并入 main e394cfe 重新验证。分支 fix/reader-rotated-text-layer-arena，详见 docs/mcp-reader-rotated-text-layer-fix-arena-2026-09-21.md。

- reader-pdf-annotation-qingyan：青砚完成 b6c1a566 PDF 标注修复：高亮/下划线按文字高度自适应，文本默认 24、2–64 步进 2、自定义下拉与单行初始框，工具设置持久化及旧 13→24 迁移，跨页间隙橡皮预览与分段擦除，色点/行内控件放大。定向 42+25+28+86+6 项、build、完整 npm run verify、隔离原生运行 21/21 通过；两份 PDF 在 100/150/200% 生成 9 张验收截图。详见 docs/mcp-reader-pdf-annotation-qingyan-2026-09-21.md。

- reader-escape-qingsui：青穗完成 009cede5 图形/箭头 Escape 取消草稿。独立 fix/reader-escape-qingsui 基于 main 18f3ea9，新增 usePdfShapeDraft（同步 ref、takeDraft、Escape/blur、文档/工具切换、卸载失效、输入框豁免），修改 PdfReader finish 入口为原子取出，新增 verify-reader-shape-cancel 25项回归全过，build/diagnostics 通过，已合并本地 main 待验收。详见 docs/mcp-reader-escape-qingsui-2026-09-21.md。

- reader-annotation-list-entry-qingyan：qingyan 0bd39f48，独立 worktree 分支 fix/annotation-list-entry-qingyan，基线 main 18f3ea9。定位到三处缺陷而非一处：ReaderSideDrawer 的 workspacePanelTabs 白名单漏掉 annotations（「+」菜单无入口）、AnnotationListPanel 从未渲染 annotation.quote（annotation-quote 实为「引用到笔记」按钮）、列表行点击绑定只选中不跳页的 onFocusAnnotation 而非 onNavigateAnnotation。提交 8e917a2、2299fb0。用 dev:live 隔离实例（qingyan/1433/9243）自动化验收：+ 菜单出现「标注」、三行显示页码/类型/颜色/引文、点第 1/2 行分别跳到第 1/2 页并选中、列表 3 项与隔离 SQLite 3 行及文献库「注 3」一致，pageerror/console error 为空。npm run build 通过；npm run verify 中 test:reader、test:pdf-text-annotation、test:ui-state 失败，已用 git stash 干净基线复现同一断言，确认为既有失败且日志零引用本次改动文件。未碰真实资料库，未终止他人进程。详见 docs/mcp-reader-annotation-list-entry-qingyan-2026-09-21.md。

- agent-owned-merge：青帆已将新流程合入main c727762，完成独立Windows0.1.25包；完整verify/Rust201过5忽略，服务86过1跳过，包内7回归及18资源哈希通过。指定他人报告哈希不变；不安装、不重启、不发布。源码/打包资源释放，详见docs/mcp-task-workflow-windows-0.1.25-2026-09-21.md。

- reader-list-qingfan：青帆 ebe8db12，独立分支基于 main 4b4f57a；阅读列表按钮34px与资源类型标签完成，浏览器22项、完整verify及最终build/状态/架构检查通过。按用户授权合并本地main，提交review由用户验收；无真实窗口、资料库、安装发布占用。详见 docs/mcp-reader-list-qingfan-2026-09-20.md。

> 机器可读状态见 [`plans/PROJECT_STATUS.json`](../../plans/PROJECT_STATUS.json)。每个 Agent 开始、完成或阻塞任务时更新本文件和 JSON。

更新时间：2026-09-22T18:47:15+08:00

- MCP 重连接准备（arena-one，无任务卡）：新隧道 `shuncode-bridge` 0.7.4 / 15 工具连通，实测并修正同会话并发必须使用唯一 JSON-RPC id（否则 -32009/409）、run_command 为原生 Bash PTY 需 here-doc 避免引号挂起、Node 不认 `/tmp` 需 `cygpath -w`。只读核对 AGENTS/开发手册/双状态/git 与任务服务：main `e74b5bd` 工作树仅 `?? .worktrees/`、`?? docs/screenshots/`；任务服务 4319 可用，50 卡（39 archived / 7 queued / 3 in_progress / 1 review）。未 claim 任何卡、未接管他人 in_progress 工作、未改生产源码、未 build/verify/打包/安装/发布、未重启 4319、未写真实资料库。详见 docs/mcp-reconnect-readiness-arena-2026-09-21.md。

- task-service-exit-lifecycle-arena：Arena状态核查 5f8ce0ee 任务服务退出生命周期（已归档）按 be3b361d 从脏树抢救为独立分支 rescue/5f8ce0ee-gateway-exit-lifecycle：网关 v4（health 身份/pid、hub-only status+shutdown、优雅退出）、gateway-lifecycle.mjs（记录/health/pid 三重一致才停止）、Tauri 关闭拦截+10s 放行阀+Exit 兜底、前端退出流程/服务栏/保留策略；分支上 build(tsc -b)、test:project-tasks 90 项、cargo check/test 通过；未重启 4319、未打包安装。详见 docs/mcp-task-service-exit-lifecycle-arena-2026-09-20.md。

- 用户明确选择发布GitHub 0.1.7，允许本次发布必需CI；本agent开始发布整理，请并行agent暂缓生产源码修改。通过受保护PR/Verify后才生成tag和签名Release，不绕过检查，不安装/关闭软件/修改真实资料。

- 最新UI Windows包完成，解除打包占用：0.1.6，builtAt2026-09-17T04:48:53.892Z；package:windows cmd_34de00340b6aea0a505248384419ea487bd2a85167980b32 exit0，独立哈希核验cmd_537383d193e211036e6aed74f26798475070bda1e9f3c1c2 exit0，EXE/安装包SHA256与build-info一致、更新签名非空。包含阅读顶栏三轨、文献库顶栏切换及图标、笔记同款PDF滑块、实时源码居左、设置字号、当前已合入工作区配置/文案等生产源码。产物artifacts/windows/latest/a4note.exe与A4 Note_x64-setup.exe；旧包归档0.1.6-20260917-123917-31020。未测试/安装/关闭软件/发布/操作真实资料。详见docs/mcp-latest-ui-windows-package-2026-09-17.md。

- 样式测试笔记图片已修正并补下划线：只读定位确认实际content/Markdown 样式测试.md引用src-tauri/icons/128x128.png但目标不存在。用户明确同意actual后备份该测试文件，复制同目录markdown-style-test-image.png并改相对引用，加入中文/英文/混排下划线示例；仓库样例与图片同步。没有更改图片安全规则或生产渲染代码。新verify-markdown-style-sample对仓库及实际测试文件的真实PNG字节通过共用resolver/loader验证，128x128/22893字节一致，React underline及代码字面量正确；verify-image-layout与定向diff通过，cmd_61bcbaeb4b29eabbc35f755944979ebf5a07c1993f0337eb exit0。额外旧verify-note-toolbar因App Provider已支持更多场景的固定断言失败，未改并行逻辑。未原生桌面验收/打包安装；除用户指定测试笔记及配套图片/备份外未改其他真实资料。详见docs/mcp-style-sample-local-image-2026-09-17.md。

- 按两张设置页截图调整过大文字：新增settings-typography.css并由设置入口导入，只作用settings-layout。普通说明/状态/表单标签与按钮采用ui-control-font-size（默认13px），辅助说明保留caption（默认11px），面板小标题13px加粗，页面/分类标题和导航原层级保留。设置按钮补30px最小高度/内边距，操作行允许换行，说明文字1.6行高。根因原说明与Button继承大基础字号而未用UI token。不改用户字号设置、全局tokens、PDF/笔记正文或更新/采集操作逻辑。build/diff cmd_56c24171dec3a790aadc49d06f3a8ee9f164f846d3cef649 exit0、settings诊断0错误；未测试/桌面验收/打包安装/真实数据操作。详见docs/mcp-settings-typography-2026-09-17.md。

- 按用户修正统一PDF原文/译文/对照滑块为笔记编辑/阅读同款：surface底面、6px滑块圆角、轻阴影、180ms相同缓动，撤销额外绿色描边/加重底色。用户澄清居左的是编辑区实时/源码，故MarkdownAuthoringDock将该切换按钮移到工具条DOM首位（样式按钮之前），保留原sourceMode/onToggleSource与分隔线、补充切换目标title。不移动顶栏编辑/阅读、不动PDF三轨布局/处理器。build/diff cmd_20db261d553c53356cc75bb50d37dd488323b6ca8acd5718 exit0、src诊断0。未测试/桌面验收/打包安装。详见docs/mcp-slider-match-live-source-left-2026-09-17.md。

- 文献库视图切换对齐笔记模式按钮：用户确认列表/综览/笔记参考编辑/阅读；当前并行源码已具备三档180ms滑动背景、active portal及reduced-motion，本轮保留该实现，仅为三档补List/Table2/NotebookPen 14px图标和文字span，使图标/间距与编辑阅读一致。不修改onChange/场景选择。build/diff cmd_631655aace6d9601028afc01a8483d70151ac9861b5807cd exit0，library诊断0；未浏览器/桌面视觉验收、未打包安装。见docs/mcp-library-switch-icons-2026-09-17.md。

- 侧栏工作区用途标识完成：标题与aria-label改为笔记工作区，标题下增加浅绿色“独立笔记”标签及弱化“非文献库目录”提示，避免与文献库资料目录混淆；仅文案/CSS，不改变场景范围、内部工作区状态或数据隔离逻辑。build/diff cmd_d61360072ca6c1def43cb41c76a78c8b23f8128819c58caa exit0，markdown诊断0；未桌面验收/打包安装/真实数据操作。见docs/mcp-note-workspace-scope-label-2026-09-17.md。

- 原文/译文/对照增强选中辨识与滑块：新增reader-file-switch.css，三等宽段共享单个伪元素，fileMode驱动200ms平滑移动；主题色底面/描边/轻阴影、选中文字加深加粗，选中hover不盖滑块。ReaderToolbar仅导入CSS、data-file-mode/role及aria-pressed。沿用真实fileMode和禁用条件，无第二份选中状态，不改切换处理器和最新顶栏三轨位置。支持prefers-reduced-motion和键盘焦点。build/diff cmd_d7770a8b952b29d72c63971542bed1c4bfd8937f0963c5ce exit0、reader诊断0错误。未测试/桌面验收/打包安装。详见docs/mcp-reader-file-mode-slider-2026-09-17.md。

- 修复用户桌面截图阅读顶栏左大留白/工具遮挡：原空breadcrumb仍受通用高优先级flex:1规则影响，改阅读专用更高优先级并隐藏空节点。阅读工具行改三轨，左原文/译文/对照，中标注，右缩放/页码/笔记入口；导航从center移至end，各轨以内容最小宽度避免挤压，剩余空间两侧平分尽量居中。极窄窗口整个工具行保留可见细横滚条及键盘焦点，不隐藏工具；笔记入口缩为30px适配36px顶栏，保留body弹层。仅ReaderToolbar和reader-titlebar.css；不改PDF/笔记保存/工作区配置。最终build/diff cmd_63352d211a952dddeebc8e8590d4257257181c7ecc723702 exit0，src诊断0。未测试/桌面视觉验收/重新打包安装。详见docs/mcp-reader-titlebar-alignment-2026-09-17.md。

- 按截图将文献库列表/综览/笔记三切换按钮上移窗口顶栏左侧。LibraryViewSwitch复用DocumentToolbar宿主及笔记编辑/阅读基础样式，三段滑动选中底面、键盘焦点和减少动画支持；仅活动标签贡献控件，场景仍拥有view状态，不搬移搜索/列设置/导入/阅读按钮或资料库行。App仅扩大toolbar enabled到library；无工作区hook/配置改动。build/diff cmd_a4c3aa578d4e992ef86ca0a21162ca30bbd8d93a89f928b5 exit0，src诊断0错误。未测试/桌面验收/打包安装。详见docs/mcp-library-view-switch-titlebar-2026-09-17.md。

- 侧栏空工作区信息层级优化完成：长段落改为尚未打开工作区标题+短引导，两个带图标/箭头的操作卡片（打开文件夹浅绿底、新建笔记库中性底），底部.md/本地保存轻提示；键盘焦点背景阴影、pending禁用及减弱动画支持。新增NoteWorkspaceEmpty及局部CSS；hook接线，NoteLibraryDialog增加可选initialMode让新建卡片直达新建表单，默认入口仍为选择页。不改变配置v2、场景范围/文件操作逻辑。build/diff exit0、markdown诊断0；未浏览器/桌面交互测试、未打包安装/真实数据操作。详见docs/mcp-workspace-empty-actions-2026-09-17.md。

- 阅读顶栏最新Windows包完成：0.1.6，builtAt2026-09-17T04:08:49.070Z；package:windows cmd_35545f8aeda02d8f89e04fb0f91dd4e5bd7a56c142fda3b2 exit0/442922ms。独立SHA256核验cmd_2cf8b8cfb6be690a6ff64eb6878aca946dddc3b9dedaa98f exit0，两个文件与build-info一致、签名非空。latest/a4note.exe 36896768字节，latest/A4 Note_x64-setup.exe 22570475字节；包含阅读工具栏上移、紧凑笔记侧栏、总览标签及打包前已落地的工作区显示调整。旧包归档0.1.6-20260917-120129-3924。不测试/安装/关闭软件/真实资料操作/发布。打包过程中另一agent交接了独立工作区配置v2，未单独核实该新增修改的完整纳入时间，不承诺该额外任务全部包含。详见docs/mcp-reader-titlebar-windows-package-2026-09-17.md。

- 用户选择stop-reading：新版工作区独立配置完成，不清理真实旧配置。桌面load/save切至独立folder_workbench_snapshot_v2表；浏览器默认key改a4note.folderWorkbench.v2，偏好改a4note.notes.folderWorkspaces.v2；移除aster.workbench迁移读取，SQLite失败只回退新版key。旧表/key留原位，不删除/迁移。首次使用新版本不恢复旧工作区列表、tabs/布局/session元数据，需要重新打开文件夹；笔记/论文/历史消息内容存储不改。build exit0，JS模拟存储专项与Rust内存SQLite隔离/往返/无效写入保护测试通过，src诊断0。未打包安装/真实资料操作；详见docs/mcp-folder-config-v2-2026-09-17.md。

- 本agent阅读顶栏最新Windows打包进行中：先确认无其他打包进程，使用package:windows包含阅读顶栏/紧凑笔记/总览色标及现有并行工作区修改；不测试/安装/关闭软件/真实资料操作/发布。

- 阅读顶栏/侧栏紧凑化源码完成：ReaderToolbar通过现有DocumentToolbar controlsHost上移窗口顶栏，原文/译文/对照、标注、缩放/页码与开合面板保留；隐藏标签与全宽覆盖时不贡献工具栏，原PDF区域去掉空工具行。ReaderToolPopover独立body portal避开顶栏/横滚裁切，定位/外点/Esc及卸载清理。右侧面板标签与全宽/收起单行，窄侧栏标题与笔记操作单行，状态按需换行，正文弹性填充；保留总览标签、保存/错误/编辑器状态与拖宽。App仅改DocumentToolbarProvider一行，不改另一agent的content工作区显示hook。最终build/diff cmd_b47c295e6fcd81746f046fc1ba3de323a893d70d6c50388d exit0，src诊断0错误。未测试/桌面验收/打包安装/真实资料操作。详见docs/mcp-reader-titlebar-compact-notes-2026-09-17.md。

- 按最新截图修正：仅顶部NoteWorkspacePicker限定activeScene===markdown，阅读/文献库/总览/AI等不显示；侧栏文件夹工作区及打开入口保留。返回非null Fragment抑制WorkbenchTopBar旧breadcrumb回退，NoteLibraryDialog独立于picker条件保留其他场景侧栏打开功能。仅改useNoteFolderWorkspaces.tsx，build/diff exit0，markdown诊断0；未桌面测试/打包安装/真实资料操作。详见docs/mcp-topbar-workspace-md-only-2026-09-17.md。

- 按用户要求移除旧工作区UI：删除SavedWorkspaceAccess组件与引用、selectSavedWorkspace回调及专用CSS，侧栏不再显示“已保存的工作区/切换到保留的工作区”；新的文件夹列表和顶部选择器保留，旧配置与笔记文件不删不迁移。保留当前并行源码的场景范围，不重放旧hook。build/diff exit0、markdown诊断0、src旧组件引用0；未打包安装/真实资料操作。详见docs/mcp-remove-legacy-workspace-entry-2026-09-17.md。

- 总览笔记专属标签源码完成：ReaderMarkdown的论文笔记切换列表与当前笔记信息栏新增OverviewNoteBadge，主题强调色浅底/边框、书签书本图标和固定“总览笔记”文字。依据实际summaryNoteId绑定而非标题判断，普通新建笔记无此标签；长标题省略仍保留标签。打开/新建按钮统一用户可见术语“总览笔记”，不改已有标题、正文、DB关系或字段协议。最终build/diff cmd_0f756c9c35438e50bcfccc3a4d54cc6388da62f10d37ddcb exit0，reader诊断0错误。未测试/真实资料操作/打包安装；双链尚未实现，之前被用户中止的空态入口补充也未实施。详见docs/mcp-overview-note-badge-2026-09-17.md。

- 最新UI打包完成：package:windows cmd_56bec4f75be96d3cede73e7a6f3480b70bcc94bf03d5d2ff exit0，0.1.6 windows-x64，builtAt2026-09-17T03:49:09.216Z，sourceDirty=true；包含笔记专属顶部自定义下拉/背景阴影、笔记库弹窗优化、编辑阅读滑动及当前并行源码。a4note.exe 37046784字节 SHA256 6909E032CB23FC34BC0330959E89EEE71A2988410FA8FCEA7C4821F5A76CDD97；安装包22603403字节 SHA256 0E309A72CAA867FCB21937072B5FC0BFE1B9793A849E63AF8B49E4E996045E65，位于artifacts/windows/latest。cmd_c082cbcc19f449caf8439c46c5e1da217f6e612cae87cb23 exit0独立核验哈希与build-info一致、更新签名非空。旧版归档0.1.6-20260917-114144-28152。未安装、关闭软件、真实资料操作或发布，既有架构限制不宣称通过。详见docs/mcp-windows-package-ui-2026-09-17.md。

- 论文关联笔记+总览映射+阅读写作布局进度复核：当前ReaderMarkdown入口、SummaryNoteSession共享会话、总览SummaryEditableCell、Rust绑定读写及lib命令注册、ReaderSideDrawer保活/布局接线均存在。限定designated/new_only/drawer范围源码已实现并于后续Windows构建打包，但未做本任务桌面功能验收，不能标为完整交付验收完成。普通笔记不自动映射；需要侧栏显式新建总结笔记且保留a4-summary字段标记；无笔记主区空态仅普通创建，入口不明显。已有笔记指定/旧总结迁移/重新绑定及删除修复/跨设备关系同步未实现，其中多项原本明确不在授权范围。当前src诊断0错误。本轮只读审查与文档校正，不测试/新建真实论文笔记/修改数据库/重复构建打包；并行打包任务保留。详见docs/mcp-summary-reader-progress-review-2026-09-17.md。

- 用户要求重新打包当前完整工作树：最新笔记专属下拉/柔和焦点、笔记库弹窗和编辑阅读滑动等源码进入标准package:windows；命令cmd_56bec4f75be96d3cede73e7a6f3480b70bcc94bf03d5d2ff已启动。只打包和核验，不安装、关闭软件、操作真实资料或发布。

- 并行工作区整合源码完成（用户确认跨场景统一）：新版文件夹navigation/breadcrumb在所有场景提供，替代原仅markdown条件，阅读不再回退旧项目树。保留最新NoteWorkspacePicker自定义下拉、弹窗美化、模式滑块及其他并行源码；不是重放旧补丁或声称合并未知分支。单击保持当前场景/侧栏，双击进入笔记；旧工作区不删除，折叠SavedWorkspaceAccess保留默认工作区/工作区2及原标签访问，选择时记住所属文件夹工作区。build/diff cmd_c88507cadec60d92f0268ef295b5b161e3c5b8e36965aa16 exit0/16367ms，src诊断0错误；本agent未测试/运行时验收/打包安装/真实数据操作。此范围更新取代此前仅笔记导航及非笔记顶部隐藏的整合约定；不要按旧交接回写hook。详见docs/mcp-workspace-integration-2026-09-17.md。

- 用户明确选择恢复下拉：新增NoteWorkspacePicker自定义主题菜单，保留小字号、长名省略/完整路径title、当前项勾选/滚动和菜单内打开文件夹；无独立加号，无绿色触发框，hover/open/focus用背景阴影。Portal避开顶部overflow裁切，视口定位、方向键/Home/End/Enter/Esc/Tab和外点关闭。hook在非markdown返回false抑制TopBar旧工作区fallback，其他场景顶部区域不显示；侧栏/旧配置及数据不变。不改共享TopBar/App业务。build/diff exit0，markdown诊断0；实际hook/picker/TopBar的Chromium模拟80目录、320px、键盘/切换/弹窗入口/非笔记隐藏通过，非原生E2E。未打包安装/真实数据操作，详见docs/mcp-notes-workspace-dropdown-2026-09-17.md。

- 并行整合进行中（本agent）：当前同一工作树已有各agent修改，不做覆盖式拷贝或重放旧补丁。本轮统一useNoteFolderWorkspaces各场景入口，保留NoteWorkspacePicker和弹窗美化/模式滑块；旧工作区及标签保留可达。不测试/打包安装。请其他agent避免同时重写该hook，独立组件继续保留。

- 笔记库弹窗轻量体验优化完成：书本标题图标、文件夹/新建图标卡片及箭头，精简说明，关闭改X且保留可访问名称，底部合并不复制不迁移提示；主题变量、悬停/处理中动画与reduced-motion、窄屏样式保留。仅改NoteLibraryDialog.tsx及note-library-dialog.css呈现，不改原打开/创建/防覆盖逻辑。build/diff exit0，markdown诊断0；实际组件Chromium+模拟FS覆盖320/480/960px、打开取消/成功、创建、Esc及焦点恢复通过，非原生E2E。未打包安装或真实资料操作。详见docs/mcp-note-library-dialog-polish-2026-09-17.md。

- 截图指定顶部工作区/模式切换修正完成：顶部工作区名改小字号纯文本，保留路径title与长名省略，移除顶部select/加号，侧栏打开/切换及新笔记库弹窗保留；编辑阅读选中背景180ms横滑、等宽按钮，aria-pressed与键盘焦点保留，prefers-reduced-motion禁用动效。不改正文/保存/撤销流程、不改侧栏字号。build、verify-note-toolbar及定向diff exit0，src诊断0；实际hook与提取模式JSX的Chromium隔离测试通过名称/控件移除/保留入口/滑块位置/键盘/减弱动效，非原生桌面E2E。未打包安装或真实资料操作，详见docs/mcp-note-topbar-motion-2026-09-17.md。

- 笔记库交互及排版Windows打包完成：0.1.6，builtAt2026-09-17T03:13:41.055Z。package:windows cmd_29aa1eb20e459f03fa357a98cab1dc36e5c47c21de44da90 exit0/422625ms；哈希核验cmd_cb3e6c9f83c81b5eb1c51e6ff8ee37b34281609cb3277e1b exit0/10215ms，两个文件与build-info完全一致、签名非空。latest/a4note.exe 37046784字节，latest/A4 Note_x64-setup.exe 22602566字节。包括单击切换/双击进入、打开已有与新建笔记库弹窗、字号/引导/footer排版。旧包归档0.1.6-20260917-110641-21736。本agent未测试/安装/关闭软件/真实资料操作/发布；不声称运行时验收。详见docs/mcp-note-library-windows-package-2026-09-17.md。

- 笔记工作区排版复核完成：用户选择check而非打包；以当前含NoteLibraryDialog的源码为准，未重放旧hook补丁。实际ProjectSidebar/hook/model/CSS在助手Chromium隔离夹具72组检查通过（300/360/480px侧栏、18/28px UI字号、560/600px高度、0/1/100目录、导航/工作区模式）；字号一致、长名省略/列表独立滚动/导航footer贴底，工作区模式按原设计隐藏footer。应用最小侧栏300px，180/220px压力测试不属于支持范围。build及定向diff cmd_4bace603ea5188608cf40c8cd466186ad7b439afbdbac15e exit0，markdown诊断0错误。未发现支持范围内需改的问题，业务源码零修改，未打包安装或真实资料操作；非原生桌面验收。详见docs/mcp-note-workspace-layout-review-2026-09-17.md。

- 笔记库交互Windows打包进行中：用户要求exe打包，执行标准package:windows及产物哈希核验；已确认无其他打包进程。不测试、不安装、不关闭软件、不操作真实资料、不发布。

- 笔记库交互源码完成：文件夹单击/顶部选择只切换工作区并保持场景及侧栏状态，双击/Enter或点击笔记按钮进入笔记工作区；打开入口统一弹窗分流已有目录与新建笔记库。新建选择父目录、输入名称，复用createDirectory非递归且同名失败的后端，不覆盖/复制/迁移；创建后打开失败记录路径可重试打开。原生dialog通过portal挂载，焦点隔离、取消/错误显示、请求锁、上下文变化卸载使旧结果失效。最终build/diff cmd_3945a4b2e6c16c0e07b9e536b666dce28a04b9b1b3d77eaa exit0，markdown诊断0错误；本轮未测试/真实目录操作/打包安装/发布。详见docs/mcp-note-library-flow-2026-09-17.md。

- MCP新地址重连接准备完成（financing-desktop-pdt-his，2026-09-17）：Bridge0.7.4/15工具已核对，initialize/tools/list/read_files/run_command成功；工作区D:/WorkSpace/Aster，AGENTS/开发手册与最新双状态已复核，状态和git只读探测cmd_89beabb3f9a23a124fa40b2853c0c84a7ff201000f48c502 exit0。本轮只同步准备文档，不改业务源码、不重新打包安装或操作真实资料；之前打包已完成，最新并行笔记排版源码另记为未打包，不混淆两者。等待用户下一项任务。

- 笔记工作区排版修正源码完成：顶部/侧栏文件夹名统一ui-scene-font-size；删除已打开列表下的常驻说明，无文件夹时引导打开存放Markdown（.md）笔记的文件夹。列表flex填充剩余高度、列表独立滚动；全局侧栏footer不收缩并margin-top:auto贴底。只改useNoteFolderWorkspaces.tsx、note-folder-workspaces.css及workbench.css的footer规则；保留已有工作区及异步选择保护。build/diff cmd_c38974581f33c67a4807991b76908bb3a5b3542a916af011 exit0，markdown目录诊断0错误；未测试/桌面视觉验收/打包安装/真实资料操作。详见docs/mcp-note-workspace-layout-2026-09-17.md。

- 本agent Windows打包完成：package:windows cmd_3e78a24d423464ae297f17f9c7bacb10a3c6f58bc3fbf3d0 exit0/401087ms；0.1.6 windows-x64，builtAt2026-09-17T02:46:27.812Z，sourceDirty=true。latest/a4note.exe 37046784字节 SHA256 628447E2AF81BB040E4C1654A85E796C56F84AA19F406B895207CE521B6EDCF6；latest/A4 Note_x64-setup.exe 22600570字节 SHA256 C229C45A8A44532A43916D3B59D08D03E5FC41A5E299FFE7493344FF1855C9FF。cmd_8a200b023e62b21ce1856d90a6a2454fb20d2ff46af5a410 exit0核验两文件与build-info哈希一致及更新签名非空。旧latest归档artifacts/windows/archive/0.1.6-20260917-103949-11288。包含当前笔记边界修复及既有并行源码；未安装、关闭软件、操作真实资料或发布，未宣称全仓architecture通过。详见docs/mcp-windows-package-2026-09-17-notes.md；下一步用户桌面验收。

- 用户要求打包（2026-09-17）：本agent执行当前完整工作树的标准package:windows，包含独立笔记边界修复和已有并行修改；核验EXE/安装包哈希，不安装、不关闭软件、不操作真实资料、不发布，保留既有架构检查失败记录。

- 笔记边界续修完成（2026-09-17）：文件夹选择请求随场景/工作区变更及卸载失效，A→B→A旧结果/异常不再生效，等待时禁用目录切换；图片解析明确拒绝UNC笔记基路径和控制字符，不误算本地路径。3文件补丁已确认应用，build及6项专项回归、定向diff通过，src错误0；实际hook/model的Chromium模拟FS/store覆盖延迟select/describe成功/错误、跨场景/工作区失效与后续恢复通过，非原生桌面E2E。断线后已取回cmd_72436a7230bf8e010a892961e49e2145284552e92e325e99 exit0。旧lib.rs架构约束失败未改动/未重跑；未打包安装或真实笔记操作。详见docs/mcp-note-edge-fixes-2026-09-17.md；下一步桌面实际图片和文件夹恢复验收。

- 2026-09-17 MCP重连接准备完成：新隧道initialize/tools/list/read_files/run_command成功，Bridge0.7.4、15工具，工作区D:/WorkSpace/Aster；已核对AGENTS、开发手册、双状态与npm run status/git status。仅连接准备与文档同步，未应用旧边界补丁、未构建/打包/安装/操作真实资料；保留其他agent任务。旧文件夹选择A→B→A与UNC笔记基路径问题待下次核对源码后续修，不能按已修复交接。详见docs/mcp-reconnect-readiness-2026-09-17.md。

- 独立笔记两项源码完成（本agent，未打包）：相对路径图片实时/阅读共用noteImageSource/Loader，笔记路径Facet更新、路径白名单/中文空格父目录、异步销毁保护/错误提示，原始Markdown地址不变；笔记场景单层文件夹工作区使用noteFolderModel/useNoteFolderWorkspaces，顶部与侧栏通用插槽，文件夹去重/打开/取消/空状态，只投影folder项目，旧配置不删除、不搬迁文件、不包含论文关联笔记，其他场景原逻辑保留。最终build、6项专项回归、定向diff检查通过，src错误0；本地Chromium实际hook+模拟FS/store的打开/重复/取消/切换/其他场景恢复通过，非原生E2E。整体architecture在本任务未改的src-tauri/src/lib.rs模块体约束失败，保留并行授权改动待协调。详见docs/mcp-note-folders-relative-images-2026-09-16.md。下一步桌面实际图片/工作区恢复验收，用户要求时再打包。

- 浏览器授权弹窗源码完成：Windows系统MessageBox替换为A4 Note应用内dialog，复用浅色/纸张/深色token、共享Button和独立样式；权限分项、主次按钮、可关闭/键盘操作。新增main窗口限定的一次性120秒Broker，旧ID/重复答复/超时/退出不能授权；仍由NativeState保存授权并处理撤销代际。仅改capture模块/platform出口及main.tsx两行挂载，未改App/笔记/阅读器、未重新打包或安装。
- 授权弹窗最终build cmd_b922297213cb9ad0070d04f924aca8c727aaf7730b832945 exit0；cargo check --lib cmd_4c9a8e7c3a1c785551a358427c5180a634be06fa27d91c69 exit0；专用Rust native_consent两项cmd_d1512eb9b019d7aea61b48cc41f661b5a9cfce6f4d8e00c6通过；src诊断0错误。真实React/Chromium隔离检查通过浅/深/纸张、焦点、Esc/关闭拒绝、显式允许、IPC失败保留、超时移除及窄窗；IPC为mock，不是Windows安装后验收。
- test:architecture在现有lib.rs模块清单边界断言失败（cmd_6bafa74995260f46c5bc6d253804ba8a3eebd3b4c5b5b597）；本次未修改lib.rs，也未放宽断言。未声称全量verify通过。保留并行工作，未关闭应用/操作真实资料/打包安装。

- MCP重连接准备完成：Bridge0.7.4，15工具，当前workspace为D:/WorkSpace/Aster；已读AGENTS/开发手册/最新状态，npm run status与git status只读探测通过。run_command已改为原生Bash，不再接受旧execution=direct或PowerShell语法。后续用户确认两项任务均做：相对路径图片实时预览修复；仅笔记场景一文件夹一工作区，保留旧配置、不移动/删除文件、不修改论文库/阅读/AI对话，论文关联笔记不纳入。尚未开始业务源码修改，不应沿用旧交接中范围未确认的结论。详见docs/mcp-reconnect-readiness-2026-09-16.md。

- 三视图状态徽标源码完成：共享PaperSignals及paper-signals.css，复用列表原有小徽标基准尺寸/间距/颜色，统一PDF/缺PDF、译N、注N、笔记N含0、待补全。笔记卡片的右侧数量移至标题下；综览同样新增标题下徽标并保留年份/期刊，自动紧凑行高下限84，不覆盖手动行高。cmd220 TypeScript及diff检查exit0；未测试/视觉验收/打包安装/真实文献变更。状态文件并发变化后重新读取追加，不更改其他任务状态。

## 当前工作：总结笔记与阅读布局Windows打包进行中

- 用户要求打包exe，执行标准package:windows生成当前整体源码的EXE/安装包并核验哈希；不测试、不安装、不关闭软件、不操作真实资料、不发布。保留并行改动及既有architecture检查未通过记录，不声称全量verify通过。

- 阅读写作布局续改源码完成：收起或同论文内切到其他面板保留笔记编辑器实例/模式/选择/撤销历史，恢复时还原可用滚动与焦点；ReaderNoteActivity与ReaderNoteRequests分离可见性和请求归属，隐藏侧栏不消费openNote/append，主区仍可正常自动保存，收起排空非错误会话、不暗中重试错误。全宽改绝对叠放、不把PDF压成零宽；useReaderLayoutPosition按页码/页内进度保存布局切换锚点，显式跳页/标注/缩放/源变化不回拉。阅读容器<720px自动叠放，放大恢复分栏，窄侧栏工具行换行；宽度保存200ms防抖。右侧继续笔记入口，Ctrl+Alt+N开合、Ctrl+Alt+Enter全宽、Esc先关闭面板菜单再返回分栏，IMEs/AltGraph/模态对话框不拦截。最终npm run build及git --no-pager diff --check cmd_0c6bb5f0303d32edd19175df260bdf08bd4f1bfd16dc341c exit0/10729ms，阅读目录诊断0错误。本agent未测试/运行时视觉验收/真实資料操作/打包安装/发布。本轮不改总结绑定迁移或后端；并行独立笔记/授权工作及已报告共享architecture阻塞保留。详见docs/mcp-reader-layout-continuation-2026-09-16.md。

- 本agent仅完善阅读侧栏保活/隐藏请求隔离、PDF位置保护、窄窗叠放和快捷操作；不扩大映射/迁移范围，不测试/真实资料操作/打包安装。并行浏览器授权弹窗及独立笔记任务保留。

- 论文总结笔记与阅读写作布局源码完成（designated/new_only/drawer）：每篇显式新建唯一总结笔记，SQLite事务内保存note/唯一绑定/sync_outbox，普通笔记及旧总结.md不迁移；总结内容仍是现有notes表的Markdown。总览按a4-summary稳定字段ID映射，SummaryNoteSession为同一NoteDocumentSession的视图而非第二保存队列，保留expected冲突校验/恢复草稿；旧来源单元格草稿加path隔离，旧读取不能覆盖新来源缓存，失效绑定报错不自动回退重建。阅读笔记增加新建/打开总结及标识；可见拖柄、宽度记忆、指针捕获/rAF/Esc/键盘调整、全宽写作与返回分栏，关闭复用现有保存机制并记住本次会话选中笔记。最终npm run build及git diff --check cmd_83f8630ab67c7c3749258923bcc3e5ead3767b5177422c53 exit0/10983ms；Rust cargo check --lib cmd_58e7d1a267e1d670311b88ecca68f2b98cc68373cd8cec85 exit0/4565ms；src诊断0错误。未测试/视觉验收/真实资料操作/打包安装/发布。指定关系仅本地DB，云同步关系、指定已有笔记、旧MD迁移和删除后重新绑定未实现；详见docs/mcp-summary-note-writing-2026-09-16.md。并行独立笔记文件夹工作区/图片任务未由本agent实施。

- 本agent范围：用户选择designated/new_only/drawer，仅新建总结笔记参与总览映射，不迁移旧MD/普通笔记；新增可拖宽收起全宽的阅读布局。复用现有编辑器与会话，本轮不测试/真实资料操作/打包安装/发布。并行agent的独立笔记文件夹工作区与图片工作保留，不在本轮范围。

- PDF兼容构建与MD下划线修复已打包：npm run package:windows cmd_251bc83092123171fb1f16b0c9c4165e3efd294c1ff33893 exit0，430.354秒。0.1.6 windows-x64，builtAt2026-09-16T14:22:03.764Z，sourceDirty=true。latest/a4note.exe 37034496字节 SHA256 31DA29B9DB741455757AE779FD0CB641CC29C74C3C3B570518B8A166E136109A；latest/A4 Note_x64-setup.exe 22586615字节 SHA256 AE5489EBDFE3319AB070B5FA2E67CB96758CAF4A7CF36FBFCA378C57DFC0AD3A。cmd_869cca4ba2b80683b4df3c434f530537667620216dc47724 exit0，两文件哈希与build-info一致，更新签名文件非空。旧latest归档artifacts/windows/archive/0.1.6-20260916-221511-8552。未测试、未安装、未关闭软件、未真实文献操作、未发布。PDF对方现场是否解决仍待反馈；同版本重打包，不保证内置更新器提示更新。

- 用户明确同意生成EXE与安装包；标准package:windows，仅构建/签名/归档旧latest，不测试、不安装、不关闭软件、不发布。

- 2026-09-16 PDF兼容性与MD下划线源码完成，尚未打包/现场验收。PDF.js6标准构建直接使用Promise.try等新API，改为legacy主线程及匹配worker，并统一PdfPageView/pdfGeometry运行时入口；这属于兼容性修复，未取得对方错误原文，不能确认现场根因。新增pdfLoadErrorMessage区分读取/解析/页面准备，并显示有界错误信息及密码/损坏/组件提示，不修改真实文件或数据库。remarkAsterInline改为白名单HTML兄弟节点栈配对，保留已解析Markdown子节点，忽略危险属性、不启用raw HTML，代码/数学/转义文本保持原样；综览复用插件，实时编辑显示标签时仍保留内文格式。最终npm run build及git diff --check cmd_4cb7ca00e7973fc727a69f1abff5363b62b3345f6ec5d0f4 exit0；独立无分页diff cmd_adedcede7874f658e0337f642acf2724d298a84a4faae903 exit0；src诊断0错误。未运行测试/安装/关闭软件/发布。详见docs/mcp-pdf-underline-2026-09-16.md。

- 用户确认使用安装包，MD下划线为<u>文字</u>。接通Bridge0.7.4；遵守先读后改及版本保护，不测试/安装/关闭软件/真实文献操作/发布。PDF现场报错尚未提供，不能宣称根因已证实。

## 上次打包：15:48 综览原位编辑EXE与安装包已生成，未安装

- 综览原位编辑Windows打包完成：cmd232 npm run package:windows exit0，219.747秒；0.1.6 windows-x64，builtAt2026-09-13T07:48:39.896Z（15:48），sourceDirty=true/基线c08eda31。包含现有总览MD原位单元格编辑、表头列宽拖动参考线、首列行高拖动及当前源码；普通关联笔记迁移未实施。artifacts/windows/latest/a4note.exe SHA256 9D262AAE6FCC5691368B04DCEA6C72B8B80B7ACA8F0AF3132D07E99AE81975AF；A4 Note_x64-setup.exe SHA256 58D4A83AA2F6C59C2816E90A4C75DFE0622BA33D9652FCF8E9E6F473F754587E，更新签名已生成。旧latest归档0.1.6-20260913-154501-63084，隔离构建目录已清理；未运行测试/安装/关闭软件/操作真实文献/公开发布。

- 按用户要求使用标准package:windows生成当前EXE与安装包，归档旧latest；不测试、不安装、不关闭软件、不操作真实文献或公开发布。

- 综览拖动及原位MD编辑源码完成：用户确认列宽仅表头行边界、行高仅第一列底边。列拖动rAF合并/停止缩放/整列绿色参考线，保留双击内容适应与键盘调整，去掉长原生tooltip；行高handle移入第一列，非全行触发。新增SummaryEditableCell，移除＋填写，双击/Enter就地textarea，Enter/Ctrl+S/失焦保存、Shift+Enter换行、Esc取消未提交输入；中文组合输入不提前提交。复用editSummary/TextDocumentSession/updateSummaryField，字段ID映射到现有总览MD，提交时合并其他字段、检测同字段变化，磁盘expectedContent保护；MD编辑继续通过现有完整总结入口同步预览。虚拟行卸载草稿保留于内存/本地恢复记录，失败可重试/导出/打开完整MD，旧异步保存不清除新恢复编辑，未覆盖冲突内容。元数据来源列期刊仍只读并提示在论文详情修改；普通关联笔记未迁移。cmd230/231 TypeScript及diff检查exit0，未运行测试/视觉交互验收/实际文献操作/打包安装；最新EXE不含本轮修改。

- 用户两次确认：列宽仅第一行表头边界，行高仅第一列底边；内容单元格均可原位编辑，同步现有总览MD，不迁移普通笔记。不测试、不真实资料操作、不安装。

- Windows最新包已完成：cmd227 exit0（241.639秒），0.1.6 windows-x64，builtAt2026-09-13T07:35:06.778Z（15:35），包含最新侧栏样式和此前源码。cmd228校验SHA256与build-info一致：artifacts/windows/latest/a4note.exe 36985344字节，127D19ED1956188FA30B9733F8EFC2B0D48E7827A78F9AE8034824A4D2471E80；A4 Note_x64-setup.exe 22532828字节，991AE444D07BBDCBF6D6C8348D41FCA70691ED96486C4F7A212F6A24E9FBC9F1。updaterSigned=true，旧包归档0.1.6-20260913-153106-59076。未安装/启动产物/关闭现有软件/公开发布。
- 下一位agent先读 [专项交接](HANDOFF_MARKDOWN_2026-09-13.md)。一文件夹一工作区结构迁移尚未实施，范围/旧配置兼容待确认；相对路径图片实时预览仍未修复；原生桌面验收仍待完成。以下历史未打包/旧哈希不代表当前包。

- 接手优先阅读 [Markdown专项交接](HANDOFF_MARKDOWN_2026-09-13.md)：源码完成清单、51模板、顶部portal及隐藏笔记隔离、验证边界、相对路径图片限制、一文件夹一工作区未实施/待确认。保留其他agent任务。cmd227执行标准Windows打包，完成后核验哈希；不安装/关闭软件/发布。

- 侧栏标题样式源码完成：按最新截图仅作视觉调整，工作区标题与全部场景共用32px高度、6px圆角、surface-soft底色、字号字重和内边距，保留绑定文件夹；移除全部场景右侧ListFilter按钮与空白列/无用CSS，点击全部场景标题仍可选场景。修改ProjectSidebar.tsx与workbench.css；build、architecture、定向diff通过，未桌面视觉验收/打包/安装。不改变现有工作区结构或数据；此前一文件夹一工作区的范围/迁移问题用户跳过，尚未实施，后续需明确范围。15:08 EXE不含本次侧栏修改。

- 最新Windows包完成：cmd221 exit0（269.527秒），builtAt2026-09-13T07:08:45.150Z（15:08），0.1.6 windows-x64。包含最新代码/表格配色及Grid、脚注当前行触发、51模板与笔记顶部布局。cmd222校验SHA256与build-info一致：artifacts/windows/latest/a4note.exe 36985344字节 E34FFE18FAB30ED5C9668B300827F6D70D10577B514F0BBBFE631752A00EC326；A4 Note_x64-setup.exe 22534029字节 2C667B794D602A2A874141A2FF3EFA73DD767B1485575847E65F155A49C2FA01。updaterSigned=true，旧包归档0.1.6-20260913-150416-28632。未安装/启动产物/关闭软件/公开发布，桌面交互待验收；保留并发三视图徽标任务记录。

- npm run package:windows已启动，含最新代码/表格对比度及Grid衔接、脚注当前行触发、51模板与顶部布局；不安装、不关闭软件，完成后校验EXE/安装包哈希。

- 脚注/模板/顶部布局源码完成，未打包：脚注定义前缀与正文脚注引用改用isActiveLine触发源码，其他语法规则未变。模板补正文段落和br换行为51项，悬浮栏入口更名＋样式，右键一级新增全部样式模板；右键脚注/表格/标注/分隔线/代码/数学快捷项复用同一模板插入，脚注不再固定编号，移除模板过时手改编号提示。新增workbench/DocumentToolbar.tsx上下文portal目标，App仅markdown且非设置场景启用，TopBar编辑/阅读/目录在打开前，保存状态在打开后；Resource保留状态/handler所有权及非场景fallback，TabHost提供active context，嵌套MarkdownWorkspaceScene传active防隐藏笔记抢占。移除全局文件树按钮（不移除树本身），过滤所有场景的正常已加载N篇本地文献提示，保留错误/操作反馈。build、architecture、authoring、quote、image、新增verify-note-toolbar与diff检查通过，src错误诊断0。本地Chromium加载实际DocumentToolbar/TopBar/TabHost+编辑器替身，测标签切换状态保持、单活动控件、场景清理/恢复、保存位置及700/580/480px宽度通过；非完整桌面E2E。未打包/安装，14:42 EXE不含本次和前次对比度Grid修正。

- 代码/表格对比度及控件衔接源码完成：markdown.css代码底色统一ink11%混合surface（含midnight覆写），表格新增共享body/stripe/head/line/hover色变量，加深表头与网格；阅读/实时共享，保留代码无外框与复制功能。markdown-authoring.css实时表格与4按钮改为同一3列3行Grid，统一8px外圆角与外边框、移除内部table圆角/绝对定位偏移，36px控制条，26px粗体纯+/−符号，保留title/aria-label、禁用与焦点。长内容overflow-wrap:anywhere防止窄表格撑入控件。build、architecture、authoring、table-cell、image-layout回归和diff检查通过；本地Playwright Chromium以真实两份CSS+代表性DOM测900/420/240px×0/1/4数据行，验证贴合误差<1px、36px控制条、26px符号，截图已检查。非完整CodeMirror/桌面E2E，尚需实际滚动/编辑验收。本次未打包；当前14:42 EXE不含本次颜色与Grid修正。

- 第一步论文关联笔记Windows包完成：cmd213 npm run package:windows exit0，277.628秒；0.1.6 windows-x64，builtAt2026-09-13T06:56:36.115Z（14:56），sourceDirty=true，基线c08eda31。包含文献库笔记视图、阅读器左侧笔记展开/数量/新建/打开及当前已实现源码；不包含第二步抽屉重设计或第三步总览模板同步。artifacts/windows/latest/a4note.exe SHA256 38F85B3C3ED42CF0D4301058A3AB761AC2D75C3D30C56A40B48CFBFA429C1CA8；A4 Note_x64-setup.exe SHA256 C784D65994BE0E8CE7047123A8D073F04667192A33DF22844BC5475BE0DAFE82；更新签名已生成，旧latest归档0.1.6-20260913-145200-75632，隔离构建目录已清理。未测试、安装、关闭应用、实际文献操作或公开发布。

- 用户要求打包EXE。包含笔记视图、阅读器左侧笔记列表及当前源码，不包含后续新抽屉或总览模板迁移；不测试、不安装、不关闭软件、不公开发布。

- 用户选定phase1源码完成：文献库列表/综览旁新增笔记视图，沿用同一筛选论文列表，按论文展开笔记卡片，展示数量/标题/内容预览/已有更新时间，支持阅读/新建/打开；列表信号明确笔记N含0。ReaderSceneSidebar阅读论文条目独立展开箭头、数量和笔记/空状态/新建入口，泛PDF未绑定论文不虚构关联。新增共享PaperNoteList及LibraryNotesView。App通过paperId+noteId验证后导航并发NoteDraftPatch.openNote请求，复用MarkdownNotePanel及现有NoteDocumentSession/native保存；当前论文打开笔记不重置PDF阅读模式，已有主笔记编辑器时不重复展开旁编辑器。请求WeakSet单次领取防StrictMode/双面板重复创建，消费仅清除对应请求、保留较新请求；切换笔记/创建先flush，失败保留草稿，Markdown主面板按paperId加key防会话串论文。笔记列表入口改为论文笔记/Files图标和可见数量。只统计现有paper.notes，不迁移总览文件/模板、不实现新抽屉/浮动工具栏/脑图画板。cmd211/212 TypeScript及diff检查exit0。未运行测试、真实文献操作、打包安装或发布；当前EXE不含本轮修改。

- 用户明确选择phase1：文献库第三个笔记视图、阅读器左侧展开论文笔记、数量及空状态，复用现有编辑器和保存会话。后续抽屉/悬浮工具栏/总览模板不在本轮范围；不测试、不修改真实资料或安装。

- 当前源码Windows打包完成：cmd208 npm run package:windows exit0，263.747秒，0.1.6 windows-x64 builtAt2026-09-13T06:42:57.326Z（14:42），包含空白表格、贴边增减按钮、空行高度、图片悬浮缩放/对齐与此前源码。cmd209核验artifacts/windows/latest/a4note.exe 36981248字节 SHA256 605A1F0C7E7B7957151FC59A60EB4DD28936E8EC476746F6F735397D5575431A；A4 Note_x64-setup.exe 22532527字节 SHA256 6D0E0884A1BA496748B62D680098C0CC87B8ADC05D859B25AE1C5ECB0F653DC9，与build-info一致，updaterSigned=true。前版归档artifacts/windows/archive/0.1.6-20260913-143834-1248。未安装、未启动新EXE、未关闭用户软件、未公开发布；桌面实际交互仍待用户验收。

- cmd208运行npm run package:windows，包含空白表格、贴边增减条、图片缩放/对齐与此前源码。仅生成EXE/安装包，不安装、不关闭现有软件；完成后核验产物与哈希。

- 空白表格与图片样式源码完成（未重新打包）：模板与右键表格入口统一3列空白表头+2个空白数据行，不再预填文字。实时编辑ImageWidget增加右上角悬浮/键盘可见调整入口，支持按正文宽度10–100%缩放、居左/居中/居右、重置；面板在重建后保持打开/焦点，Esc关闭，狭小图片面板横向限制于编辑区域。通过标准图片title尾部[a4note-image:百分比:对齐]保存设置，保留URL/alt/原caption；共享imageLayout.ts解析/改写，MarkdownFigure阅读应用相同比例与对齐且隐藏元信息，HTML图片阅读归一化保留title。只对已能渲染的http(s)/data图片提供实时控件，之前相对路径实时预览限制未改变。每次修改独立undo、只读禁用与原源码片段一致性检查；阅读不提供修改按钮，保留点击放大灯箱。新增scripts/verify-image-layout.mjs覆盖空白GFM表解析、元信息/caption往返、HTML归一化、React SSR阅读渲染、实际Widget配合真实CM state/history及mock DOM的按钮/保持打开/撤销重做/过期与只读保护。build、architecture、authoring、table-cell、image-layout与定向diff检查通过，src错误诊断0；未做桌面几何/鼠标焦点/重开文件端到端验证，当前14:20 EXE不含本次及贴边按钮修复。

- 表格外沿控件与空行高度源码修复：底部32px贴边横条左右＋行/−行，右侧32px贴边竖条上下＋/−列，低对比同主题背景并保留焦点/禁用状态；增删逻辑和有内容删除确认不变。th/td增加1.9em最小行高（table-cell height语义）与空单元格/编辑占位零宽伪元素，避免新增空行坍缩；不写入零宽字符到Markdown。修改markdown-authoring.css、markdown.css与MarkdownLivePreviewEditor.tsx按钮文案。build、authoring及table-cell模拟DOM回归、定向diff检查通过；尚未桌面几何/视觉验收，未重新打包，14:20包不含本次修改。下一步核对空行增删/进入编辑及宽窄表边条贴合。

- 用户要求当前源码EXE打包完成：cmd200 npm run package:windows exit0，297.988秒；Windows x64/0.1.6，builtAt2026-09-13T06:20:53.123Z（14:20），sourceDirty=true/基线c08eda31。包含已实现行高拖动与持久化、标题默认不固定及Pin开关、缩放遮挡修正及打包时现有编辑器源码；多笔记/总览模板/阅读写作布局整合仅方案，未实施不包含。artifacts/windows/latest/a4note.exe SHA256 FC13E9DC31C96087028C2E03604E03EEC4C428F7C4F0EC70CA3A127EFD64B9F8；A4 Note_x64-setup.exe SHA256 C005496C6EED1B1E074B9AB0B5770B24965886B5F42C7431615D5769BC63C8C7，更新签名已生成。旧latest归档0.1.6-20260913-141556-76012；隔离构建目录由标准脚本清理。未运行测试/安装/关闭软件/操作真实文献/公开发布。

- 用户再次要求打包：包含已实现行高调整、标题可选固定、缩放遮挡修正及当前编辑器源码；笔记整合仅方案，未实施不包含。标准package:windows，仅打包不测试/安装/关闭软件/发布。

- 引用/标注源码触发与阅读容器源码完成：仅quote/callout前缀改为isActiveLine判定，行尾及正文点击均显示当前行标记，其他语法cursorNear不变；阅读article取消外边框/圆角/固定高度/独立overflow，内距缩至8px，与实时共用外层滚动区域与背景，保留窄版/自适应设置。修改MarkdownLivePreviewEditor.tsx、workbench.css，新增verify-quote-source.mjs。build、architecture、authoring回归、引用/标注当前行及阅读容器回归、定向diff检查通过；尚未桌面视觉/滚动条/长文模式切换验收，未重新打包。下一步验收行首/中/尾、相邻行不展开、正文外层最右滚动条、目录开启与窄版；当前EXE不含本次修改。

- 综览逐论文行高调整源码完成：新增SummaryRowResizer行底6px拖动区，pointer capture与rAF预览、缩放比例补偿、松手保存，Esc/取消捕获撤销预览；双击或Enter恢复自动，上下键微调。手动行高44–2000逻辑像素，按paperId写入既有summary布局rowHeights并与列配置共存，读入校验，不修改总结内容；手动行关闭自动测量，overflow:clip避免裁切创建新滚动容器破坏可选固定标题。加载未就绪禁用调整；恢复自动删除该行覆盖值，保留其他行。cmd196 TypeScript与diff检查exit0，随后静态修正overflow:clip。未运行测试/真实资料操作/视觉验收/打包安装。

- 综览标题可选固定源码完成：默认不固定，标题与其他列一起横向滚动；论文名称表头右侧新增Pin图标，可切换固定/取消，aria-pressed与提示、高亮实心状态明确，保留列宽拖动区。localStorage独立键aster.overviewTitlePinned持久化，存储不可用时仍可操作。只改LibraryOverview.tsx/summary.css，取消固定同时作用表头标题格和正文标题格，表头纵向固定保留；此前缩放锚点修正保留。cmd195 TypeScript编译与git diff --check exit0，未测试/桌面验收/真实资料操作，尚未打包安装。

- 综览固定标题与缩放遮列修正源码完成：原横向鼠标/中心锚点公式会在scrollLeft=0放大时主动产生正滚动，导致相邻列滑到sticky标题下；改为保存logicalLeft=scrollLeft/旧倍率，每帧scrollLeft=logicalLeft*新倍率，保持右侧区域逻辑起点。继续固定标题、同比缩放列宽，保留手动横向滚动、纵向鼠标/中心锚点和平滑动画。只改LibraryOverview.tsx，cmd194 TypeScript编译及git diff --check exit0。未运行测试/桌面交互验收/修改真实文献，尚未打包安装，不宣称已验证用户截图问题消失。

- 用户截图指出放大时右侧列被固定标题挡住。横向改为保留逻辑滚动起点，纵向继续鼠标锚点；不取消固定列，不运行测试/真实文献操作/安装。

- 笔记创作入口源码完成（用户选择三项一起、编辑时常驻）：表格外沿右侧+列/底部+行，按焦点单元格插入；−行/−列删除，含内容确认、表头及最后一列保护、先提交未保存单元格、独立可撤销事务；单列表格解析已补齐。新增49个可搜索模板（标题/格式/列表/表格/代码/公式/图片/脚注/双链/HTML白名单/16种标注），右键插入→全部模板与底部常驻悬浮栏共用，块模板补空行、选首个占位文字、脚注编号避重。顶部格式按钮已移除，保留模式/目录/保存，阅读模式隐藏底部栏，预留76px不遮挡。修改MarkdownLivePreviewEditor.tsx、MarkdownResourceTab.tsx；新增tableStructure.ts、markdownTemplates.ts、MarkdownAuthoringDock.tsx、markdown-authoring.css、scripts/verify-markdown-authoring.mjs。build、architecture、表格模拟DOM回归、行列/单列解析/撤销/49模板与接线测试、diff检查通过，explorer诊断0。未真实桌面视觉/键盘/尺寸/保存重开验收，未打包安装；13:48 EXE不含本轮及复制反馈。下一步桌面核对表格按钮/确认取消/撤销、窄窗口底部栏和右键模板、输入法与模式切换；本地相对路径图片实时解析仍未实现。

- 实时模式代码复制反馈源码完成：按钮旁显示复制中/已复制/复制失败；等待clipboard.writeText成功后才报成功，API缺失/权限拒绝给出失败并允许重试，复制期间防重复点击，2.6秒恢复，Widget销毁清理定时器，异步结束检查DOM存活。修改MarkdownLivePreviewEditor.tsx与workbench.css；build、architecture、定向diff检查通过，编辑器诊断0。未真实剪贴板成功/拒绝交互验收，未重新打包，13:48包不含本轮反馈。下一步桌面点击复制并粘贴核对内容与提示，检查权限拒绝分支。

- 最新编辑器修复已打包：cmd182 npm run package:windows exit0（265.5秒），builtAt2026-09-13T05:48:32.112Z，Windows x64/0.1.6。包含代码框无描边、表格覆盖式编辑防跳动及任务框勾选基线修复。latest/a4note.exe（36977152字节）SHA256 2EA013C4E30128E288CA53C4F410D706BF357CD013065B1A9843C4EA6E595869；latest/A4 Note_x64-setup.exe（22528789字节）SHA256 39F45C444E1587770CA05894BCBE47E5892BC294A213946C12BA6AA7B8266230，cmd185均匹配build-info，更新签名已生成。旧包归档0.1.6-20260913-134408-77904。未安装/关闭软件/真实资料操作/公开发布；下一步用户使用13:48新版视觉验收。

- 代码框与表格编辑形变修复源码完成：阅读/实时代码框取消外描边和左粗线，保留浅灰绿底与圆角；表格编辑保留隐藏原内容占位，input绝对定位覆盖，不再参与自动列宽/行高计算，焦点线减为1px。修改MarkdownLivePreviewEditor.tsx、markdown.css、workbench.css及verify-table-cell-editing.mjs。build、模拟DOM单元格回归、architecture、定向diff检查通过；未桌面几何/视觉验收，未重新打包安装。下一步验收长短内容、连续点击/取消与输入时尺寸稳定；提交新长文本后正常重排不属于进入编辑跳动。

- 任务框勾选后基线偏移修复：markdown.css 将共享checkbox从inline-grid改为固定尺寸inline-block，勾号改absolute定位，不再参与行基线计算；已完成/未完成共享-.12em垂直对齐。上一轮仅调整偏移量没有消除状态间基线差异。build与定向diff检查通过；尚未桌面视觉验收/重新打包，13:34包不含本次修复。下一步切换任务勾选状态核对框位置及多字号/阅读实时模式。

- 按用户要求Windows EXE打包完成：cmd177 npm run package:windows exit0，269.5秒；build-info builtAt2026-09-13T05:34:27.263Z（13:34），Windows x64/0.1.6，sourceDirty=true、基线c08eda31，本地构建非公开发布。包含打包时当前综览连续缩放、列设置、按钮/整行精简和已存在编辑器源码修改；未运行测试或真实桌面验收。artifacts/windows/latest/a4note.exe SHA256 754BDACFA022D92939EC0B18F3F528AFCA425AE809C7D658096D5230F2AA1161；A4 Note_x64-setup.exe SHA256 2FAEADD09384A7A72D77ADE4BF2A8EBF19D3244154FF48CD44667209E572A95C，更新签名已生成。旧latest归档0.1.6-20260913-132959-47856，标准脚本清理本次隔离构建目录。未安装/关闭软件/操作真实文献/发布；插件源码未改变，记录配对0.6.5。

- 包含当前综览缩放/文献库精简及现有编辑器源码成果，标准package:windows产出EXE与安装包并归档旧latest。仅打包，不测试、不安装、不关闭软件、不发布。

- 表格编辑源码完成：光标位于表格上一行/下一行或源码内部时展开Markdown；渲染单元格点击不移动CodeMirror源码光标，使用内嵌输入框编辑，失焦/Enter提交单次事务、Esc取消、Tab切格，输入法组合期间Enter不提前提交。安全DOM渲染行内代码，分列识别转义竖线，写回转义新竖线并保护原文档版本。修改MarkdownLivePreviewEditor.tsx、markdown.css，新增scripts/verify-table-cell-editing.mjs；build、architecture、定向diff检查及模拟DOM回归通过，编辑器诊断0。未真实桌面交互验收/重新打包；长表、连续鼠标跨格、撤销、切笔记及失焦保存仍需桌面验收。13:21 EXE不含本次修改。

- 按截图精简LibraryScene源码完成：移除公共工具栏导出结果图标及其Markdown/CSV入口；列表筛选行仅保留分类/标签/搜索信息与阅读，去掉详情/关系/顶部更多/清除筛选；综览完全不渲染该筛选操作行，无空白占位。未移除截图未圈出的顶部详情面板图标，保留列设置、导入、右键/行尾菜单、批量操作、无结果时清除筛选及此前综览缩放。cmd173 npx tsc -b及git diff --check exit0；未测试、运行时视觉验收、打包安装或真实资料操作，插件未改。

- 列表保留阅读与分类信息，移除红圈的详情/关系/更多/清除筛选和导出图标；综览不渲染整条筛选/操作行。保留论文右键菜单、列设置、批量操作及缩放成果。仅源码/编译，无测试/安装/真实文献操作。

- 代码块样式源码更新：语言标识由.72em放大至.9em；编辑围栏源码时不生成data-language，避免渲染标签与源码重叠。阅读/实时共用主题浅灰绿底、深色语法配色、细边框和复制控件，午夜主题独立高亮；代码行字号统一在行级，行距跟随document-line-height，收紧上下留白。修改MarkdownLivePreviewEditor.tsx、markdown.css、workbench.css。build、test:architecture、定向diff检查通过，编辑器诊断0；未桌面视觉验收、未重新打包安装。13:21包不含本次修改；下一步验收围栏编辑/离开、复制、字号与主题切换。

- 综览连续缩放源码完成：100%基准、40–180%原生CSS zoom，文字/行高/列宽同步；rAF合并输入与时间插值，减弱动画偏好直接定位；鼠标双轴/按钮中心锚点，普通滚动或表格交互取消未完成缩放。缩放不再改变内容档位，完整总结通过展开内容或比较/聚焦显示。逻辑坐标二分虚拟窗口、滚动rAF、memo行与Markdown，测量用未缩放offsetHeight且不随倍率清空缓存，列宽拖拽补偿比例。LibraryOverview.tsx/summary.css已应用，cmd166/168 TypeScript及diff检查exit0。未测试/真实性能或视觉验收/文献操作/打包安装；不保证实测帧率。保留并行任务cmd164打包记录，未确认该包包含本轮最终缩放源码，应用本轮修改需重新打包。

- 列表左移/任务框对齐 Windows 打包完成：cmd164 npm run package:windows exit0，0.1.6 x64，builtAt 2026-09-13T05:21:48.731Z。产物 artifacts/windows/latest/a4note.exe 与 A4 Note_x64-setup.exe，EXE SHA256 9143CCA828423E5A0873433BDCB61B1BA9F5077CEDE32F35F1689766A757CCDA；旧包归档0.1.6-20260913-131710-54872。未安装/关闭软件/操作真实资料；待用户视觉验收。另有综览连续缩放并行任务进行中，本记录不改变其状态，也不宣称本包包含该任务后续修改。

- 用户要求类似Excel的平滑放大。将连续几何缩放与内容展开分离，减少重复渲染并保留浏览锚点。不测试/不修改真实文献/不安装；保留此前其他源码调整。

- 列表/任务对齐源码调整：workbench.css 实时模式有序与无序列表所有层级左移1em，保留1.45em嵌套间距与任务水平位置；markdown.css 任务框继承正文字号、统一margin和line-height，vertical-align由-.2em调至-.1em。cmd162 build、test:architecture、定向diff检查通过；尚未桌面视觉验收或重新打包，13:00的EXE不含本次样式修改。下一步核对列表缩进及勾选/未勾选框与文字对齐。

- 本轮链接边界修复已完成 Windows x64 本地打包：npm run package:windows cmd157 exit0，builtAt 2026-09-13T05:00:51.462Z，版本0.1.6；artifacts/windows/latest/a4note.exe 与 A4 Note_x64-setup.exe 已更新，含当前工作区列表/综览等未提交源码。EXE SHA256 7C753EB59C289C02E14E954A99270EEA50E33919C220D195178235C8608B8014，旧latest归档0.1.6-20260913-125522-51424。未安装、关闭软件、修改真实资料或公开发布；下一步用户使用新版验收链接左右边界编辑与正文打开。

- 实时模式链接边界误打开修复：MarkdownLivePreviewEditor 的外链文本点击回退增加模式/修饰键守卫，普通边界点击展开源码并保持编辑，渲染链接正文打开及 Ctrl/Cmd 点击源码打开保留，全局源码模式行为不变。npm run build、test:architecture、git diff --check 通过，文件诊断0；未做桌面鼠标交互验收、打包安装或真实笔记修改。下一步用隔离笔记验收左右边界与链接正文点击；已安装0.1.6不含本次源码修复。

- 列表/综览简化列设置源码完成：共用ColumnSettings文字按钮和body浮层，只有列名/复选框，标题固定；列表可切换作者/年份/来源/标签，延续localStorage；综览按现有列含自定义列切换hidden，延续原布局文件保存，不删除内容/重置宽度顺序。移除综览设置里的列名编辑/宽度输入/上下移/新增类型/恢复布局，保留表格既有缩放及拖拽交互。浮层限位、长列表滚动、外部点击/滚动/窗口变化关闭与Escape返回，加载不可写时禁用勾选。cmd149 npx tsc -b和git diff --check exit0；未测试、真实文献变更、打包安装、关闭软件或发布。与上一轮文献库列表及右键修改一起仍待桌面打包升级，当前安装0.1.6不含这些源码调整。

- 用户要求明确列设置按钮，仅勾选展示列；综览移除设置里的改名/宽度输入/上下排序/新增类型/恢复布局复杂项，已有列与内容保留。只源码和编译，不测试、安装或修改真实资料。

- 桌面文献库布局源码完成：LibraryScene移除独立单选操作/未选中占位行，阅读/详情/关系与更多按钮上移到筛选行；保留条件出现的批量操作。library.css令表格滚动区flex填满工作区、固定表头、工具栏不压缩。新增PaperContextMenu body级fixed portal，论文右键/行省略号/顶部更多/Shift+F10共用；边缘翻转限位、视口内滚动、外部点击/表格滚动/窗口变化关闭、键盘导航与Escape返回。菜单先选中目标论文，包含阅读/详情/关系/编辑/标签/译文/BibTeX/既有删除确认；设置文件类在同一浮层切换目录页，展示完整父级路径/当前分类，复用既有移动及错误处理，不新增真实资料变更。cmd148 npx tsc -b与git diff --check exit0；未运行测试或真实UI验收，未打包安装/关闭桌面/发布，已安装0.1.6尚无本轮界面修改。

- 用户指出表格未铺满高度且行菜单被裁切；要求阅读/详情/关系上移到筛选行，移除原独立选择栏，并通过论文右键提供这些操作和文件类设置。仅源码修改和编译检查，不测试、不操作真实文献、不关闭或重装桌面。

- 插件0.6.5源码/本地包完成：桌面接受下载或重试后立即展示已知文件的checking状态（重复提交也不冒充重新排队），双rAF布局后仅滚动一次到进度；尊重减少动画，重扫/pagehide撤销待定位，帮助中重试返回主进度，正常主界面不抢键盘焦点；轮询不定位并保留同任务附件列表scrollTop。统一400px宽度、卡片/留白/字号、固定顶部工具栏与底部下载按钮、进度标题和蓝/绿/暖色状态，保留连接/论文信息/链接，取消重复徽章。cmd145/146三个JS语法检查、标准插件打包、git diff --check exit0，最终ZIP SHA256 35cbc2a0e799a765f56d732b82c252d6178bee0feb8947acdba1dbdaa232a896；原Chrome unpacked目录已更新，用户需重新加载核对0.6.5。桌面0.1.6不变，未测试/真实下载/重新安装/公开发布。用户截图确认上一版已显示正文入库；不冒充本轮真实浏览器验收。

- 用户截图确认正文已入库，要求开始时自动下滑到进度，并优化整体使用体验。仅明确下载/重试动作触发一次定位，轮询不抢滚动；保留连接/论文信息/链接，统一布局与状态色。不测试、不重试真实任务、不重装桌面。

- 插件0.6.4按用户纠正恢复主界面桌面连接/重连及状态、论文标题/作者/标识符、可展开元数据与可滚动摘要；增加原文和正文PDF可点击链接，区分已发现/排队/连接/下载/校验/入库/失败/取消，按当前captureId守卫避免重扫串状态。详细帮助、元数据解释、更新及错误明细仍在齿轮面板；不改已安装桌面0.1.6。cmd143/144 JS语法检查、标准插件打包、git diff --check exit0；最终ZIP SHA256 43bd94ce89008001ed01c7fe2da62993c5130324012ea8442b9572778159d169，原Chrome unpacked目录已更新，用户需手动重新加载并核对0.6.4。未运行测试、重新安装、真实下载重试、入库或公开发布；未确认截图中连接失败的具体原因，本轮恢复其可见状态。

- 用户纠正精简过度：主界面保留桌面连接/重连与状态、标题/作者/标识符、可展开论文信息、原文/PDF链接及状态；帮助面板只承载详细说明/错误/设置。只改插件，不重新安装桌面，不重试真实任务，不运行测试。

- 本轮用户明确选择已保存并授权打包升级，实际升级已完成。cmd132标准Windows签名打包和扩展打包exit0（456.8秒），桌面0.1.6/host0.6.1/插件0.6.3；artifacts/windows/latest现为0.1.6，不再是旧0.1.3，旧latest归档archive/0.1.6-20260913-103439-40088。cmd139用既有公钥验证安装器及全局签名、哈希/版本一致性通过：安装器22523729字节，SHA256 49B7D9AB7DF2CB298265BF96985AD2DB1FE500020EB82E31295379D1744E6D45；EXE 48ACAC143C42AEF421137C9131ECD85EBBF00FA6324D90F21C88B9A8C69D827C；host EA9969157217A0E1B691FD64BD34BA456039A0FCBBA754BA3099F61FDB4C09CB。cmd140安装前无旧app/host运行，无强制结束；完整安装器/S /D=D:/A4 Note exit0，文件与卸载记录均0.1.6。cmd141安装EXE与构建仅3字节UNK到NSS打包标记变化，安装EXE SHA256 d5f8e05b5e0aee18ca407fc73a6155695eab4f7cacc88bf2a1a04b600bb02a74；Chrome/Edge注册及host哈希一致，启动PID40376。cmd142只读hello exit0，authorized=true，desktop folderSelection/captureProgress/captureRetry/sourcePdfRequired/supplementFiles均true，host0.6.1且captureRetry=true。未提交/重试/删除文献，未运行测试或CI；未公开发布。
- 插件ZIP最终SHA256 49834df1d5c059174629a4d42af8968153b394299f5cbc201067bd64872cba95。只读核对Chrome Default指定扩展配置，当前加载目录为D:/WorkSpace/Aster/artifacts/browser-extension/unpacked；已由标准打包更新为0.6.3，保留固定身份和原目录。未操作浏览器扩展重新加载，须用户到chrome://extensions点击重新加载后核对0.6.3。无须再次覆盖目录。源码未提交，build-info sourceCommit仍为基线c08eda31且sourceDirty=true，不冒充正式发布提交；公开更新通道仍0.1.5。多网站是通用规则增强，不宣称每个平台已验证。

- 本轮ask_user选择“已保存，可以打包并升级”；允许正常退出旧版、完整安装器升级、重新启动；禁止强制结束旧进程，不自动重试/新增文献。不运行测试/CI、不发布GitHub。版本递增桌面0.1.6/host0.6.1，插件0.6.3；标准打包保留签名、归档旧latest，build-info增加sourceDirty标记，明确未提交本地源码并非正式发布提交。

- 正文/补充材料及精简进度源码已接通：支持白名单非PDF格式，响应文件名/URL/MIME推定扩展，部分格式头+大小+SHA256，不执行/解压，拒绝HTML和明显可执行内容；附件实际关联纸条目并使用来源标签显示，非PDF按钮只打开所在目录。下载器250ms节流发布真实字节/总量/校验状态，独立队列持久化进度；列表768KiB限额及按ID查询。Native RetryCapture带index支持同captureId单文件重试，已缓存文件复验不联网，保留重试范围跨崩溃；双端能力检查阻止旧桌面/host静默降级。插件0.6.3新增独立帮助面板，主界面总体校验完成数+逐文件字节条、未知总量不确定条、失败重试；1秒轮询15分钟后可继续刷新，元数据/连接/更新/详细错误不在主界面堆叠。通用识别增强citation/DC/DCTERMS/PRISM/eprints、明确PDF按钮、唯一PDF链接及补充材料区域；不宣称各出版社已适配实测。cmd128模块路径编译错误已修复；cmd129因未应用补丁缺文件，原因popup.css单行工具截断，未写入截断内容，改独立compact-view.css后成功。cmd130前端构建、JS检查、桌面及host cargo check exit0；cmd131最终构建/JS检查/桌面cargo check/扩展标准打包/git diff --check exit0。插件ZIP SHA256 b47be4cdd96620f6ccab6c65da2537415845bb8ef1668a9693085c9192cce080，仅本地；尚未交付安装，不可与已安装旧0.1.5单独使用。桌面/host源码版本号仍0.1.5/0.6.0，完整打包前需要递增版本，不可覆盖正式版本。未运行测试、真实站点下载/入库、安装/重启或CI；未提交推送。
- 多网站方向是通用识别与逐站补强，不是新增标识符查询。当前不把Springer/Wiley/Elsevier/IEEE等写成已验证全支持；动态按钮、机构权限、二级附件页仍有覆盖边界。未启用任意站点代理，保留arXiv限定系统代理规则。

- 继续用户确认的正文PDF+补充材料范围；主界面只保留识别/保存/下载与进度条，说明和详细错误移到二级面板。编号输入查询不是现有功能：DOI页面识别/Crossref、arXiv与PMC专门规则；PMID仅citation_pmid读取，ISBN/ADS无专门适配。不扩大为全站点下载承诺。

- 父目录聚合与正文失败不入库源码已完成：selectLibraryView按侧栏同一规范化森林汇总自身和全部后代；App传入libraryFolders并加入memo依赖；侧栏计数按树自底向上汇总，与列表/综览/导出同源，不移动分类。采集worker在调用ingest前要求有已校验fulltext，没有则source_pdf_required且不打开文献入库事务；独立失败任务保留用于显式重试，不删除旧文献。cmd127 exit0：npm run build（tsc+Vite）、cargo check --lib --offline、git diff --check；未运行测试或真实入库，未安装/发布。原TLS/响应长度修复及0.6.2目录树改动均保留。非PDF补充材料、总体/逐文件进度条、帮助二级界面和插件重试入口仍未完成，尚未打包升级。

- 用户确认只需要正文PDF及补充材料，继续解决现存问题。本轮先落实目录查询/计数一致汇总及正文校验成功才调用入库；非PDF补充材料及精简进度条界面随后处理，不宣称全部完成。不运行测试、真实采集、安装或删除旧记录。

- 下载网络修复源码完成：Windows启用本地静态代理而旧下载器强制直连，cmd116同一arXiv地址直连reset/exit35、代理HTTP200；限定arxiv.org使用系统回环HTTP代理，其他域名保持直连公开IP校验/DNS固定，每跳重判且不关闭证书校验。cmd120实际Rust下载进一步发现旧content_length在读完后取动态size_hint导致incomplete_download；已改读取前快照并保留字节完整性比对。cmd124重新编译并用同一生产下载模块临时下载成功，verified/533463字节/SHA256 8e5dba613dd6ef679fbd4c0344fbfe2eaf95cffb0137cbfd1165e10d9d6cf193；无入库。cmd117 cargo check及cmd124 git diff --check exit0。未运行测试套件/CI、未安装/重启、未提交生产采集或删除旧文献；修复尚未打包/发布，已安装0.1.5不变。父目录聚合、细分进度和失败入库策略仍待实现。
- 诊断依据及安全边界见 `CAPTURE_NETWORK_DIAGNOSIS.md`；独立命令复用生产下载器，仅显式网址、唯一临时目录，不启动Tauri或打开数据库。

- 用户要求调查TLS并尝试修复；cmd114发现Windows静态代理已启用；cmd115只读查询指定任务URL https://arxiv.org/pdf/2503.02684；cmd116同URL HEAD直连Connection reset/exit35，既有本地代理HTTP200/application-pdf/533463字节，均保持证书验证。不是已证实的证书错误。
- 针对可信arXiv主机读取已启用的Windows本地HTTP代理；其他主机保持公开IP校验/直连DNS固定；每跳重新判断，禁止泛化任意代理目标。不安装/重启、不重试生产采集、不删除旧文献，不运行测试套件。
- 父目录聚合与逐文件进度仍待后续；不把本轮网络修复宣称为这些功能完成。

- 插件0.6.2文件夹树已完成并本地打包：替换下拉菜单，行点击选择/箭头折叠、全部展开收起、桌面六色祖先引导线、完整目标提示与定位、键盘导航。用户明确选择同时记住目标ID及展开状态，新增storage权限仅保存本浏览器本地ID；授权分类列表读取后验证记忆，删除/异常目标清空，不自动回退/提交；采集冻结期间禁止改目标。桌面继续0.1.5/host0.6.0，无需重新安装。
- cmd_1789263609851_110 exit0：三个JS文件node --check、扩展标准打包和git diff --check通过。0.6.2 ZIP共21文件、106545 bytes，SHA256 1e5c1ee4f0a66a5e65bff11f44ac35976752ff38f826ff3b6f708677838cc405；MCP传输后哈希一致，包含三个树模块/样式。提供独立可交互HTML预览（示例目录，记忆仅当前页面），不当作真实浏览器验收。本轮未运行任何测试/CI或真实论文入库，未启动/安装/重启桌面。
- 本轮交付artifacts/browser-extension/A4-Note-Capture-0.6.2.zip和unpacked。用户等待采集结束，覆盖原插件目录后在扩展管理页重新加载并核对0.6.2（新增本地storage权限需重载才能生效），保留固定key及原目录。桌面0.1.5不动。当前feat/capture-folder-tree-0.6.2源码/状态未提交、未推送或发布在线通道；未来发布再按用户授权走必要PR/CI，不覆盖既有正式资产。

- 用户选择同时记住上次选择和展开状态。仅改插件0.6.2，兼容已安装桌面0.1.5/host0.6.0；复用桌面彩虹层级线配色与30px行节奏，真实分类读取后验证记忆ID，删除/异常目录不回退误选，不自动导入。
- 遵守本轮不运行测试要求：只做必要静态检查和插件打包，不运行桌面、安装器、真实导入或更改文献数据；此前实际升级授权已完成，不扩展为新一轮安装授权。

- 用户明确授权实际升级，并确认已保存、允许正常退出和启动新版。本轮核实原运行/注册目录D:/A4 Note仍为0.1.3；D:/A4Note另有0.1.1旧安装。cmd105使用已核验0.1.5完整安装器/S及原目录安装exit0，无强制结束旧应用；安装记录/文件版本均0.1.5，host SHA256 C6A8C55F2CEF74D90FFB8A6717E13A923683124866AD7E03C408BF3515C116C1。已启动D:/A4 Note/a4note.exe（PID76680）；cmd108只读hello成功，desktop与host folderSelection均true、host0.6.0、authorized=true，原授权有效无需重复弹窗。未主动读取论文正文、查询分类或提交采集。
- 安装器SHA256 2165C5414229C7FCD948C1A4DB451EBDAE1CA466401AD7B5D1273C4A9E53612A再次核对。安装后的EXE SHA256 31FA3342AF7E4BEB2C14F56F70DC46CFFD210010CC23AF1A26391525A5648B28，与CI裸EXE同长36732928字节且仅三字节UNK→NSS的NSIS包类型标记不同（offset32584226），不是内容版本不一致。Chrome/Edge注册均指向D:/A4 Note/native-host。未执行测试套件或浏览器真实导入验收。
- 现在应关闭旧插件弹窗再打开；已有授权有效，不一定再次弹窗。下方未安装/等待升级的条目为历史。本轮仅追加配对交接状态，不更改业务源码或新发版本。

- 全部本轮交付完成：PR7/8正常合并，main/origin-main c08eda31bce69b871162a60cf13ebe0fb6b3722a；桌面0.1.5、扩展0.6.1、host0.6.0。精简采集/应用图标、双端分类能力与断连状态、元数据显示、插件按需检查/下载及人工重新加载指引、设置独立软件更新入口均已发布。签名Release34700856642成功，2026-09-12T15:10:05Z公开。0.1.4仅保留未公开草稿，不改写0.1.3正式资产。
- 必要Verify34699316735及34700616438通过；最终签名Release34700856642通过。已从公开Release下载核对安装包22437667 bytes，SHA256 2165C5414229C7FCD948C1A4DB451EBDAE1CA466401AD7B5D1273C4A9E53612A；Tauri安装包及全局Ed25519签名独立验证通过。插件97610 bytes，SHA256 ff1638656967e57135bac3e2cf671b51f1583c9f442a07f9cad103d17a7541dd，18文件与软件图标一致。官方latest.json HTTP200/908bytes/0.1.5/正确正式安装器URL。cmd97下载正式CI产物、cmd98核对安装器/EXE/插件哈希成功；未安装、启动或访问真实文献库。
- 用户保存并备份后使用artifacts/ci-release/0.1.5/windows/latest/A4 Note_x64-setup.exe完整安装器，插件使用同版本交付目录browser-extension/A4-Note-Capture-0.6.1.zip，覆盖原目录后在Chrome/Edge重新加载。正式产物已同步到该版本目录，旧artifacts/windows/latest未替换，勿误用旧包。后续设置→软件更新；插件底部→插件设置与更新。仅收尾配对交接记录留在本地工作区，业务源码已同步main。
- 0.1.5签名发布与必要CI已完成，但没有真实Windows GUI/论文站点/用户库端到端验收。解压插件不能自动替换自身，仅提供官方检查与下载；下载受理不等于已安装。PDF候选不等于已验证文件，缺失元数据不编造。Tauri签名不是Authenticode。

- 更新中心源码完成：设置独立软件更新分类及关于页快捷入口；插件0.6.1按需授权固定GitHub API、比较版本、下载官方ZIP、明确手动重新加载。cmd88生产构建/扩展打包exit0。v0.1.4 Release34699938047构建签名成功但草稿URL为untagged临时路径，发布前正式URL校验失败；草稿仍保留未公开。已改为发布前文件名/大小/哈希、发布后正式URL校验，补必要CI夹具，准备0.1.5一次发布。

- 用户要求继续全部任务，新增插件检查更新和软件设置入口。branch feat/update-center-0.1.5；桌面0.1.5、插件0.6.1、兼容host0.6.0。点击时只授权固定GitHub API源，下载ZIP后提示覆盖原目录并重新加载；不自动安装或打断采集。
- PR7/Verify34699316735已通过且main8912fdc同步；v0.1.4签名Release34699938047仍在构建。新版本继续必要PR/CI后单次发布，不改写旧资产，不安装/启动真实软件或访问用户库。

- PR7首轮Verify34699130227在既有传输检查中发现：授权拒绝后不应断开仍存活的host，否则复用连接契约失效。已将权限不可用通知与真实断连分开，保留原断连/重连断言并增加通知/监听器清理检查；不删测试、不降低保护。重新提交同一PR等待必要CI。

- 采集0.6.0/桌面0.1.4源码完成：复用桌面图标并重设精简主流程；host独立能力+桌面双校验，未知操作明确报错且不终止host，任何断连/授权失效取消绿色就绪；任务完成区分PDF与信息。桌面展示作者/机构/标识/出版物/日期/摘要和来源快照，异步附件响应按文献隔离。Release增加已发布版本只读跳过及全局串行发布，仍禁止覆盖正式资产。
- cmd_1789222838605_76 exit0：tsc/Vite生产构建、JS语法检查及0.6.0扩展打包成功；SHA256 a9be65ce7a6503bfe059caa252bff16bf6b80058098876462924aa3d2874c39d。未运行本地测试/启动应用/安装/访问真实文献。必要GitHub Verify和签名Release待执行，不把源码与构建当成端到端验收。
- 当前：受保护PR执行用户允许的必要Verify后正常合并，只有一个Actions工作流发布v0.1.4/扩展0.6.0；不重复本地发布、不改写v0.1.3、不绕过分支保护。下方旧轮次指引为历史。
- 本轮只做静态构建与随后必要CI；未安装到真实Chrome/Edge、未启动桌面或操作真实库。需完整安装器更新已注册native-host并单独更新0.6.0插件；PDF候选链接不等于下载/验证成功，缺失元数据不编造；Windows GUI最终使用由用户确认。

- 用户反馈已连接但分类失败，要求简洁主流程、软件图标、插件与桌面明确保留元数据，并完成失败工作流。注册路径D:/A4 Note/native-host下已安装host静态检查不含list_folders，不能将旧桌面hello当作通信组件支持新操作；不启动/安装真实应用或读取文献内容。
- Release失败已定位为重复发布0.1.3被不可覆盖保护拒绝；CI不是失败原因。将修复双端能力握手和连接状态、完善元数据展示、改进发布幂等性；0.1.4/扩展0.6.0走受保护PR及必要CI后单一工作流发布。

## 当前工作：源码已合并，签名发布准备（2026-09-12T21:48:53+08:00）

- PR #4及完整Verify已成功，main merge=fbc91a71b5239a21a00addfc72ec35caeb74b732。签名首次构建因DPAPI密码文件尾换行在实际编译前安全停止；现已Trim并使用EncodedCommand，签名环境检查仅输出ready布尔值且通过。小修复继续正常PR/CI流程，不修改或绕过分支保护；v0.1.3尚未发布，旧latest未覆盖。

- main有PR/Verify保护，直接push被拒绝，未强推或绕过。用户在本轮明确允许必要CI作为“不测试”要求的一次例外；完整Verify移到受支持的Windows runner，不删除/放松测试。后续通过PR合并后再签名发布；未开始安装或真实资料操作。

- 已完成：签名更新源码完成：设置→关于可检查GitHub更新、显示纯文本说明、下载并验证签名，用户确认后flushPendingSaves并安装；不后台下载/强制更新。桌面版本递增0.1.3，加入updater插件/精简权限、公钥及固定HTTPS端点。私钥位于用户仓库外.tauri目录（实际路径见APP_UPDATES.md），密码DPAPI保护，两个GitHub Actions Secrets已配置，未输出/提交私钥。标准打包增加签名/latest.json/sourceCommit；发布脚本验证产物一致性并草稿完整上传后公开，禁止覆盖已发布版本。
- 构建：构建cmd_1789220036918_42 exit0（37.984s）：npm锁文件同步、tsc/Vite、两个发布脚本node --check、cargo check通过；设置诊断0。原未提交源码及发布候选475文件扫描未见高置信令牌/私钥/MCP控制地址或超过20MiB文件。初次apply因新updater父目录不存在整体拒绝，cmd40随后的缺文件检查失败；创建目录后 guarded补丁与cmd42完成。未运行任何测试/verify。
- 修改：Settings/平台updater、Tauri插件/权限/公钥/版本、标准打包及签名环境/发布脚本、Windows Release工作流、APP_UPDATES指南与忽略规则。此次不推送无关根目录演示HTML/Markdown，产物只进Release，不进源码Git。
- 待完成：提交推送main、签名构建与v0.1.3发布；密钥需由用户按文档安全备份。完整Windows升级路径未运行实测。

- 用户确认推送现有公开仓库AustinSuun/A4Note并实现签名更新，允许生成专用密钥、私钥保存在仓库外并配置GitHub Actions Secret。仅公钥入库；保留历史未提交源码，排除产物/缓存/资料/密钥；不运行测试或启动安装器。main本地领先origin/main两提交，无远端分叉。

## 0.5.0配套打包（已发布，2026-09-12T21:06:36+08:00）

- 已完成：0.5.0配套包已发布：标准package:windows及扩展打包cmd_1789218049589_32 exit0（308.023s）；Windows latest builtAt2026-09-12T13:05:56.636Z（21:05:56+08），桌面0.1.2、captureExtensionVersion0.5.0、Native host0.5.0，包含自动识别/分类选择/下载入库。旧latest已归档archive/0.1.2-20260912-210050-17112，标准脚本清理本轮隔离构建目录。
- 验证：产物校验cmd_1789218369606_33 exit0：EXE35286528字节，SHA256 F49ED6C3418E56A9FE34A8DC8EA0E62C38787C6CD87D1F6280CFEC203B15D9F8；安装器22176010字节，SHA256 C4D22528397F6BE3FE7D5B0245393C0B4AFC3317C5DA8A19AF565BBFFAB4B933，均与build-info一致。扩展ZIP50354字节/12文件，远程及Arena副本SHA256 26fbfd5edcd188a65c4f8dd64f8dddd397b66d5680c4b1c0e72c031ba3c400ba，manifest0.5.0。仅生产构建、哈希与包清单检查；未运行任何测试或安装启动应用。
- 修改范围：产物及本配对状态，未新增业务源码修改；保留全部已有未提交改动。
- 下一步：使用21:05:56新配套安装器和A4-Note-Capture-0.5.0.zip；两端一起更新，不能只替换插件。先备份资料并由用户退出旧桌面，安装后加载/重新加载扩展，打开论文详情页→插件自动识别→选择文件夹→下载并导入。下方未打包及0.4.0安装指引为历史，无需再重复打包。
- 边界：0.5.0包已生成但未在真实Windows浏览器/用户文献库验收。本轮无测试、无Git提交、无安装和真实资料操作；保留Vite大分块及Rust未使用符号告警，不把构建成功等同功能实测通过。Native注册必须使用安装器，裸EXE不足；保持既有未签名发布和PDF/网络访问限制。

## 自动识别与分类导入0.5.0（源码完成，待配套打包，2026-09-12T20:57:47+08:00）

- 目标/已完成：采集0.5.0源码已完成：打开弹窗自动识别可信论文信息；已授权后展示真实分类完整路径（含子目录），显式选择后下载并入库。新增list_folders/targetFolderId、提交及入库事务分类校验、已有文献原分类保护、实际分类/PDF状态显示、最多2分钟进度刷新、冻结任务幂等重试与原任务辅助上传。发送前再次校验folderSelection能力，防止旧桌面静默忽略分类。
- 修改文件：本轮修改apps/browser-extension的popup/bridge/README/manifest，src-tauri/src/capture/{folders,model,mod,ingest,native_state,store}.rs、native_messaging/protocol.rs、src/core/capture/index.ts、apps/native-host/Cargo.toml及Cargo.lock、scripts/package-windows-release.mjs及配对状态。未改固定扩展身份、权限或真实资料；分类已删除时既有相同任务仍可幂等确认，不改变原分类或任务。
- 验证结果：0.5.0仅构建/静态检查：cmd_1789217725260_28 exit0（67.936s），5个JS/MJS node --check、npm.cmd run build（tsc+Vite）、桌面与native-host cargo check --offline通过；安全补丁后cmd_1789217814131_29 exit0（1.691s），bridge语法、桌面cargo check与改动范围git diff --check通过。扩展与capture编辑器诊断均0；Vite大分块及Rust未使用符号警告保留（包括兼容Store::submit入口）。严格遵守用户不测试：未运行test/verify、浏览器交互、安装或真实入库验证。
- 风险/未完成：0.5.0仅源码完成，未重新打包、安装或启动；现有19:55:51的Windows latest及扩展0.4.0不含自动识别选分类流程，不要混用。旧客户端/历史任务未带targetFolderId仍默认library；新扩展要求明确分类与能力协商。选择分类上限2000；识别仅普通详情页，下载/登录态/DRM及PDF安全隔离边界保持；真实端到端未验收，历史测试不代表本轮通过。
- 下一步：用户需要交付包时，重新执行标准package:windows与package-capture-extension，生成配套native-host/桌面/0.5.0扩展（不要只更新插件）；build-info须为captureExtensionVersion 0.5.0。之后由用户在资料副本中验收打开即识别、父子分类、选后下载、重复论文保持分类、分类删除与PDF失败提示；本轮不自动测试或安装。



## 历史发布：Native Messaging 0.4.0试用（不含上方0.5.0修改）

- Native Messaging试用交付已生成：Windows标准package:windows cmd_1789213888282_21 exit0（264.011s），latest builtAt2026-09-12T11:55:51.168Z（19:55:51+08），captureTransport=native_messaging/扩展0.4.0；含独立host与NSIS注册。旧latest已归档archive/0.1.2-20260912-195128-67120，隔离构建目录已清理。扩展ZIP39956字节/12文件，Arena与远程SHA256 d060bed29de14ae5a7b1648c307fb00828f3e088c876867d32a8bbe71370a72f一致。
- 交付复核cmd25 exit0：独立Get-FileHash与build-info两项一致，EXE817E00F7E3523944DA1FEFDDAE7FC09AE571BE34831895FC4F240E7058C464A4；安装器D8228C25B0510FDD716CB5FD447BD4A73B8470B367799E65F90871D1C73545BF。release host不含测试管道覆盖，原生注册宏隔离回归再次通过；安装器NotSigned。未执行正式安装器或启动真实资料库。
- 完整verify cmd_1789213811014_20 exit0（55.787s）：Rust183通过/0失败/5默认忽略；专用真实stdio子进程回归独立通过，NSIS实际宏在唯一临时HKCU命名空间验证注册/修复/所有权安全卸载通过。诊断0，修改范围diff --check通过（只有LF/CRLF提示）。
- 真实Chromium145加载0.4.0扩展并通过Native Messaging启动Linux stdio夹具：固定ID、未安装反馈、零连接输入框、显式授权、任务安全渲染、PDF两块、关闭重开恢复、撤销/拒绝、真实origin参数和无重复提示均通过，无页面异常。桌面授权决策为夹具，不代表Windows已安装桌面GUI验收。Arena证据native-ui-check/results.log；首次环境缺少libnspr4，安装浏览器依赖后重跑通过。
- 下一步使用本轮19:55:51新安装器及0.4.0扩展，按README完成人工Windows Chrome/Edge工具栏→首次桌面授权→真实论文/PDF入库→重启恢复→撤销验收。先备份资料，不要运行旧HTTP安装包；本轮自动化和Linux夹具不是此项验收的替代。
- 本轮Native试用包已发布但未安装到真实用户环境。桌面仍显示0.1.2，务必核对build-info的captureTransport和builtAt。裸EXE不能代替安装器注册；安装器未签名，需用户核对来源后决定安装。保留PDF进程未隔离、队列单独备份、arXiv网络10054和PMC实际浏览器未通过等既有边界。

## 历史：论文采集0.3.0试用交付（待桌面人工验收）

- 采集0.3.0试用版已交付：浏览器/本地PDF统一入库，paper_capture_records保留完整来源快照及文件映射；DOI/哈希/基础arXiv关联、元数据-only记录和后续补充、用户编辑/主PDF/标注保护。Crossref/Europe PMC精确ID补全，ScholarlyArticle JSON-LD/摘要DOM、arXiv日期与版本、公开PDF附件及显式站点授权的浏览器辅助上传已接通。
- 最终全量verify cmd_1789135670935_44 exit0，Rust176通过/0失败/3忽略；capture_12通过/2显式联网忽略。原生真实回环HTTP覆盖上传/假PDF拒绝/禁止覆盖/同任务补全/取消。Crossref与Europe PMC联网通过；Chromium真实arXiv DOM、实际扩展配对/session/提交及2,215,244字节PDF辅助下载上传通过，上传接收端为协议fixture、站点权限由测试管理API授予。PMC浏览器本轮未取得论文元标签；原生arXiv网络10054重置，未算通过。
- Windows release/NSIS已构建，builtAt2026-09-11T14:03:07.589Z（22:03:07+08）。cmd40发布旧latest时EBUSY；未杀进程，cmd43校验后另发artifacts/windows/capture-0.3.0-20260911，清理本次隔离staging。旧latest仍旧版。EXE SHA256 3CC7D0F36777488A5735B9CF29C174B92ED683B354795FC2083623169985A8E2；安装器6AC1EDAC31585A5B4B5260C8FB5511DCD5B779F2164E38F87750ACEE8853BBF1。扩展ZIP在artifacts/browser-extension，node scripts/package-capture-extension.mjs可重建。
- 使用资料副本安装capture-0.3.0-20260911中的新桌面包并加载扩展，完成人工Windows Chrome/Edge工具栏→桌面→文献表→阅读与重开验收；不以分段测试冒充完整GUI端到端。无需因旧latest占用重新编译或关闭用户进程。
- 未操作真实资料、安装/启动应用或提交Git。两次初始native测试0xc0000139已由Service改动态通知回调修复；原Reader实现未动，仅将既有过时测试断言对齐documentId。
- 操作说明与实际支持边界：apps/browser-extension/README.md。后续完整Inbox/批量/清理/Range/元数据冲突UI/PDF隔离尚未完成。

## 以下为历史交接记录

## 论文采集第一批B（源码及原生回归完成，整体开发中）

- 第一批B源码已实现：Rust回环配对/鉴权、独立SQLite幂等队列与进程排他租约、公开HTTPS正文流式下载、地址及重定向检查、PDF结构/哈希校验；设置提供启用/撤销/任务刷新/取消/重试，扩展0.2.0接入session凭据。未改文献表或旧PDF导入，未自动入库。
- 第一批B：cmd_1789133285096_20 capture_ 7/7通过；cmd_1789133465831_24 cargo test --offline全量171通过/1忽略/0失败；cmd_1789133157870_13主项目build与architecture通过。cmd_1789133421844_22 npm verify在未修改的test:reader源码断言失败（期望依赖[path]），不是全量通过。未做真实Windows扩展到桌面/出版社E2E，未启动真实应用、未操作用户资料或打包EXE。
- 继续第一批C：统一LibraryIngest，浏览器采集和本地PDF入库，完整元数据扩展表/文件关联/幂等冲突保护及收件箱。B已源码完成，保留未覆盖登录态/补全/附件下载/Range续传/正文对应核对；实际浏览器配对与公开站点下载待验收。不得为了通过全量verify擅改无关Reader。
- 新增/修改：src-tauri/src/capture/*、Cargo.toml/Cargo.lock、lib.rs接线，src/platform/capture、settings/CaptureSettings与入口，扩展bridge/界面/manifest、test:capture及verify集成、说明文档与配对状态。保留全部既有修改，不提交Git。
- 安全与限制：回环随机端口、一次性5分钟配对码/12小时内存令牌、扩展ID绑定、停用立即撤销并请求取消；停用时拒绝请求的监听保留至退出。单文件50MiB/目录约1GiB/1000任务；独立A4CaptureData不含在旧备份中。非正文附件暂为待处理；元信息完整性/正文对应未核对。使用新版源码，旧Windows latest不含此功能。
- Cargo首次索引更新等待较长，仅终止本轮两条重复的测试命令后重试成功；无全局Cargo配置修改。恢复了离线解析临时降低的toml_edit到原0.25.12版本。

## 论文采集第一批A（源码完成，整体开发中）

- 用户已确认浏览器采集与本地PDF最终进入同一文献表，基础样本arXiv、PMC和标准元标签页；完整元数据/附件不能受旧表限制。
- 新增 apps/browser-extension、src/core/capture/index.ts、scripts/verify-capture.mjs、docs/notes/PAPER_CAPTURE_PLAN.md。当前可解析/导出记录和发起浏览器下载；没有假连接按钮。
- 第一批A合成样本、主项目build、architecture通过（cmd_1789132681783_8 exit0）；core/capture诊断0，保留既有Vite大分块告警。未做真实浏览器/站点端到端验收，未运行全量verify或Rust测试（未改Rust）。
- 下一步第一批B安全配对/本地服务/持久下载，第一批C收件箱与双入口入库。双入口适配已前置，不等第三批才考虑。当前未自动入库、未运行应用、未操作真实资料、未提交或生成EXE；保留全部历史修改。

## 最新Windows交付（已发布，2026-09-11T18:54:52+08:00）

- Windows包已重新构建并发布，包含Markdown标题改名闪烁源码修复及此前所有已交付功能：npm.cmd run package:windows cmd_1789123675222_3 exit0（371.328s），0.1.2/windows-x64，builtAt2026-09-11T10:54:05.309Z（18:54:05+08）。latest EXE31797760 bytes，安装器20882041 bytes；旧版归档archive/0.1.2-20260911-184756-71616，标准脚本已清理本次隔离构建目录。
- 独立Get-FileHash cmd_1789124068241_4 exit0，两份文件与build-info一致：EXE 55428CE85DC17FCBE84565612078DFF47B146F6277CC39DC7AB0B31F77414FEB；安装器84DE57290FF07B3D17E1AA615E0319EEE600D6B923C0E42A8D67B229A9693703。仅打包和校验产物、更新配对状态；未追加业务修改、运行功能测试或启动应用/安装包，不宣称桌面已验证完全无闪烁。
- 下一步：用资料副本验收标题改名后的滚动、光标、撤销与文档切换，以及原有目录树与列宽；未执行真实Windows WebView2人工验收。下方未打包记录均为历史状态，当前latest已含上述修改。

## Markdown标题改名闪烁（源码完成，2026-09-11T17:46:52+08:00）

- 已完成：Markdown标题改名闪烁源码修复：useTextDocument仅在现有会话已迁移到目标路径时原位复用，渲染阶段保留snapshot、不插入loading帧；新文件仍acquire并执行原磁盘核对。新增本视图documentId供CodeMirror和标题输入框身份使用，改名不再按path销毁编辑器；模式/真实文档切换仍失效旧回调。独立MarkdownWorkspace标签增加稳定UUID，文件改名/移动保留ID。未改标题/文件名同步、原子CAS保存、冲突及草稿保护。
- 修改：src/features/explorer/useTextDocument.ts、MarkdownResourceTab.tsx、src/features/markdown/MarkdownWorkspaceScene.tsx及配对状态。
- 验证：标题闪烁修复：npm.cmd run build cmd_1789119951978_102 exit0（8.731s，tsc+Vite）；src/features编辑器诊断0错误/0警告；既有>500kB分块告警。遵守用户要求未运行任何测试、verify或浏览器交互验证。
- 边界：本次标题闪烁修复仅完成源码与构建，不宣称已实测完全无闪烁；未操作真实资料、提交Git、启动应用或打包。文件树刷新与相对图片资源重新解析未重构。
- 下一步：标题闪烁修复待用户桌面验收：长笔记滚动后改标题、光标/折叠/撤销保留、连续改名、同名失败、真实切文档及源码模式切换。未重新打包，17:40:42的Windows latest不包含本次闪烁修复；需要EXE时标准package:windows。

## 最新Windows交付（已发布，2026-09-11T17:41:32+08:00）

- 最新Windows包已成功发布：npm.cmd run package:windows cmd_1789119331369_98 exit0（311.686s），0.1.2/windows-x64，builtAt2026-09-11T09:40:42.008Z（17:40:42+08）。包含MD文件夹菜单/空目录删除/共享新建确认，以及文件类一体行、综览列宽自适应/拖拽和Markdown预览改进。latest为EXE31797248 bytes、安装器20881340 bytes；旧版归档archive/0.1.2-20260911-173532-10236，隔离构建目录已由标准脚本清理。
- 独立Get-FileHash校验cmd_1789119660634_99 exit0，两份文件均与build-info一致：EXE SHA256 07E5FB29B703F1879A008342ED42F6EDAD3AA9CC34156E5B3E7BB050373CCF1A；安装器5DA328536D7D5AC73DEDC87F0B56AF3F9017E6942D25E646325938D54F7D9FED。本轮只有标准打包与配对状态更新，没有新增业务修改、启动/安装应用或操作真实资料。
- 下一步：用资料副本验收新建/重命名/删除保护、列宽和预览；未执行真实Windows WebView2人工验收。下方未打包记录均为历史状态，当前latest已含上述修改。

## MD文件夹菜单与共享新建确认（源码完成，2026-09-11T17:28:55+08:00）

- 用户明确选择MD只删除空文件夹。MD目录/空白区根菜单补新建子文件夹、新建笔记、重命名、打开所在位置、删除空文件夹；根禁止改名/删除。文献库与MD复用shared/tree/FolderDraftRow，创建/取消为64px宽30px高图标+文字按钮，置于输入下方适配窄侧栏；只有确认才调用createDirectory，Enter/Esc/IME、失败保留/重试、祖先防折叠与保存期间防重复均保留。MD改名不再失焦自动提交，显式保存/取消，失败保留输入，目录点号不当扩展名裁切。
- 新增rename_directory/delete_empty_directory原生命令+platform出口，复用library_access闸门/text_file_io锁及mutateTextDocumentPath子树会话保存/迁移；限制声明工作区内真实子目录，拒绝根/外部/符号链接或Windows联接，拒绝同名覆盖。删除只调用非递归fs::remove_dir，目录非空即失败，绝不降级remove_dir_all。App及MarkdownWorkspaceScene两个入口接真实Promise，目录改名重映射子树已打开tab/resource路径；新建不提前重挂载树。
- 修改：FileTreePanel、LibrarySceneSidebar、共享FolderDraftRow/index、workbench.css、App/MarkdownWorkspaceScene、projectApi/index、原生workspace_fs/project_commands/lib、verify-library-behavior及配对状态。
- 最终npm.cmd run verify cmd_1789118802028_95 exit0（58.024s，Rust164通过/0失败/1忽略，新增3项临时目录测试：改名保留内容/冲突/非法名，非空保护与空目录成功，根及外部目录拒绝）。首轮cmd94仅因nullable根路径类型检查失败，已修正缺失根传空串交由native拒绝。Chromium真实React+全局CSS通过MD目录/根菜单、新建输入/IME/Esc/失败重试、点号改名与失败保留、删除回调、两边按钮可见尺寸和全部原树回归/草稿后引导线重测。native IO mock，不替代Windows桌面验收。
- 夹具：Arena共享工作区library-tree-fix/ui-check/actions.cjs，日志/截图tree-actions-fix/。未操作真实用户目录、启动应用、提交Git或重新打包。
- 下一步：使用隔离资料桌面验收；latest15:25包仍不含本轮与之后改动，需要新EXE时标准打包。

## Markdown 预览交互（源码完成，2026-09-11T17:20:08+08:00）

- 已完成：Markdown共享预览首批改进：代码复制增加进行中/成功/失败反馈、重复请求保护及卸载/内容切换失效处理；高亮失败保留纯文本，旧高亮不串到新内容。代码块/宽表格可键盘聚焦滚动；长公式用auto margin居中，溢出时保留可达左端；图片放大限制Tab/焦点并支持Esc及关闭后恢复焦点。仅修改MarkdownCodeBlock.tsx、MarkdownFigure.tsx、markdown.css和配对状态。
- 验证：Markdown预览：npm.cmd run build cmd_1789118332141_91 exit0（11.309s，TypeScript和Vite）；get_diagnostics shared/markdown为0错误/0警告。构建有>500kB分块告警。本轮遵守用户要求未运行任何测试或verify脚本；其他记录中的测试结果不代表本轮验证。
- 已知边界：Markdown预览仅构建和静态检查，未浏览器或WebView2运行验收，未写用户笔记、启动应用、提交Git或打包；实时编辑器的CodeMirror复制/图片widget不在本轮范围。
- 下一步：Markdown预览源码待用户验收：复制权限拒绝/成功、窄窗口长代码和宽表格键盘横滚、长公式首尾可见、图片Tab/Esc与焦点恢复。尚未重打包，现有Windows latest不含本轮；如需EXE按标准package:windows流程。

## 综览列宽与双模式自适应（源码完成，2026-09-11T17:18:22+08:00）

- 用户选择两种列自适应：综览新增适应窗口模式（ResizeObserver随宽度变化、按权重分配、最小宽度不足保留横滚），所有列含论文名称可拖拽表头边界、双击按标题和当前渲染内容样本自适应（最大640px，不扫描全库总结），方向键/Shift微调、Home/End边界、Enter内容适配；拖动有pointer capture、Esc/cancel不保存。手动调宽转manual，保持其余当前可见列宽；窗口模式与标题宽写入原.summary-view.json的sizing，数据列仍用columns.width，经共享session防抖/CAS保存，旧布局兼容，不写总结正文。列宽现在独立于综览缩放，缩放仍改变字体密度/行高。
- 修改LibraryOverview.tsx、summary.css、core/librarySummary.ts、verify-library-summary.mjs和两份状态。
- 完整npm.cmd run verify cmd_1789118134109_87 exit0（39.997s，Rust161通过/0失败/1忽略）；新增2项core列宽回归，共23项。Chromium真实React+全局CSS通过窗口跟随/窄窗横滚、标题与数据列拖动、取消不写、键盘、双击、表头行对齐和保存布局重挂载，旧字号/标题元数据/比较/选择回归通过；native IPC/editor mocked，未Windows WebView2验收。
- 夹具：Arena共享工作区library-ui-fix/ui-check/columns-check.cjs，日志/截图summary-column-fix/。
- 边界/下一步：只改布局，不操作真实资料。未打包，latest15:25包不含列宽改动和上一轮一体文件夹行；隔离资料桌面验收后按需标准打包。

## 文献库一体化文件夹行（源码完成，2026-09-11T16:39:13+08:00）

- 按用户截图修正文献库箭头独立按钮：箭头改为行按钮内部span，文件夹图标/名称/计数和箭头共享整个行的hover/active背景，层级缩进移入行按钮，与Markdown一致；点击任意位置统一选择并展开/收起，保留编辑祖先保护、方向键、拖入、彩虹线。仅改LibrarySceneSidebar.tsx和library.css。
- npm.cmd run verify cmd_1789115863325_84 exit0（19.359s，Rust161/0失败/1忽略）；Chromium真实React+全局CSS回归通过，确认无独立caret按钮、箭头属于行按钮、层级引导线对齐、单层/批量切换及编辑保护。夹具library-tree-fix/ui-check/integrated.cjs，截图与日志library-integrated-tree/；原生IO mock。
- 未操作真实资料或重新打包，当前latest15:25包不含本次一体行修正；下一步隔离资料桌面验收，需要时重新打包。

## 文件树与字号Windows打包（已发布，2026-09-11T16:27:51+08:00）

- 文件树+综览字号Windows包已发布：0.1.2/windows-x64，builtAt2026-09-11T07:25:16.335Z（15:25:16+08）。cmd79编译完成后EBUSY，用户保存退出后cmd_1789115247740_81复用staging续发布exit0；发布前后两份SHA256与build-info一致。EXE31787008 bytes，安装器20877510 bytes。latest现已包含彩虹目录线/折叠与综览字号加大，旧包归档archive/0.1.2-20260911-152119-52304，临时构建目录已清理。未启动或安装应用、未操作真实资料。EXE SHA256 864BCABFF35340AA79259C03D254C7CD17BA09519A2FC66C7D2AD014D1C60906；安装器9A2100C07BA4C81CEBF5F520B17456223DFF76E4C4DE399B79CE20203E97BC7A。


## 文件树与字号Windows打包（发布被占用阻塞，2026-09-11T15:25:56+08:00）

- 本轮文件树+综览字号Windows打包：cmd_1789111279068_79完成前端、Rust release及NSIS，最后归档旧latest时EBUSY，exit1（237.432s）。新包保留于.build/tauri-packaging/20260911-152119-52304下staging；旧latest未替换。等待用户保存退出占用程序后校验SHA256并续发布，无需重新编译；未强杀进程或操作真实资料。


## 文献库复用Markdown目录树（源码完成，2026-09-11T15:15:25+08:00）

- 已完成：文献库文件类与Markdown文件树复用shared/tree/TreeGuides及core/treeExpansion：DOM实测连续六色祖先线、共同箭头/高亮；文献库补全部展开/折叠、方向键导航，关闭父层保留子层展开选择。箭头只切展开，名称选择筛选并切该层级。新建/重命名保护祖先、全部切换禁用，保留计数/右键操作/拖入文献。分类仍为folderId元数据，未引入磁盘操作。
- 修改：两个树组件、shared/tree三文件、core/treeExpansion.ts、library.css、verify-library-behavior.mjs及两份状态；不改App/native/真实资料。
- 验证：最终npm.cmd run verify cmd_1789110875966_76 exit0（19.760s，Rust161通过/0失败/1忽略）；真实React+全局CSS的Chromium回归通过：嵌套/展开记忆/批量切换/方向键/创建重命名保护/失败保留输入/拖入路由，Markdown按需加载与批量展开，以及缩窄滚动后引导线坐标与共享配色。原生IO mock；首次浏览器发现挂载ref时机导致初始无线，已改useEffect测量并复验通过。
- 夹具：Arena工作区`library-tree-fix/ui-check/check.cjs`，截图`trees.png`、`results.log`，完整验证`library-tree-fix/verify-final.log`。
- 边界：未启动真实资料库、未Windows/WebView2人工验收、未提交Git或重新打包。latest仍为2026-09-11 12:24:50包，不含后续综览字号加大及本次文件树改动。
- 下一步：用隔离资料桌面验收文件类多层彩虹线、鼠标/键盘折叠、新建与重命名、拖入；需要EXE时执行标准package:windows，勿将现有latest误称包含本轮。

## 综览/对比文字可读性（源码完成，2026-09-11T13:23:31+08:00）

- 综览/比较表格字体加大：标题与单元格14px，表头与总结工具栏13px，年份/期刊标签12px；比较/展开标题16px。40%紧凑保底13px标题/11px标签；默认行高56→68px，极紧凑32→44px，避免裁切。侧栏及列表/综览切换按钮不变，不改元数据或总结内容。
- 修改：`src/features/library/summary.css`、`src/core/librarySummary.ts`、`scripts/verify-library-summary.mjs`及两份状态。
- 验证：完整verify cmd_1789104140359_70 exit0（20.431s，Rust161通过/0失败/1忽略，总结core21项）；Chromium真实综览加全局CSS验证默认/比较字体数值、行内标签不裁切及原交互通过，原生IPC/editor mock。未重新打包或启动真实资料库。
- 浏览器夹具：Arena共享工作区`library-ui-fix/ui-check/type-check.cjs`，结果/截图`library-type-fix/`。
- 下一步：使用隔离资料确认字号与密度；需要EXE时重新打包，当前latest仍为12:24综览修复包，不含本轮字体加大。

## 文献库综览修复 Windows 交付（已发布，2026-09-11T12:29:35+08:00）

- 文献库综览修复Windows包已发布：0.1.2/x64，构建时间2026-09-11 12:24:50+08:00。package:windows cmd67完成编译/NSIS后因旧latest占用EBUSY退出1；用户保存退出后，cmd68复用已生成staging，先后校验两份SHA256、归档旧latest并发布到artifacts/windows/latest，exit0，无需重编译。EXE 31785984 bytes；安装器20876129 bytes。旧包archive/0.1.2-20260911-122112-71792；本次临时构建目录已清理。
- SHA256：EXE `B33F3230D88C440F00418C07BCBB11DAAC51BFFF46836C3A618674E78067A7A6`；安装器 `17FBC724D3166138C62B83286D3D05DE7A2D87A0C0CFDF97C48D30966FC7AC2B`，发布前后均与build-info一致。
- 验证：源码此前verify cmd65 exit0；本轮发布cmd68 exit0。没有强杀用户进程、修改业务代码或操作真实资料。
- 下一步：用隔离资料手验综览标题/年份/期刊显示、点击打开及字体和控件布局；未启动/安装应用代替用户验收。下方“未打包”是历史记录，当前latest已包含综览与标题修复。

## 文献库综览可用性与字号修复（源码完成，待桌面验收，2026-09-11T12:16:15+08:00）

- 已完成：文献库截图问题已修：综览复选框受全局input宽100%/高34px影响挤没标题，现限定14px；固定文献列280px。标题单击打开已有文献，元数据直接取PaperDocument标题/出版年份/期刊会议，即使无总结或总结读取失败仍显示。缺失年份/期刊提示待补充，不猜online日期，不写入或覆盖用户总结。列表/综览与导入按钮使用UI字号，文件夹字号与快速访问一致；工具栏改flex避免新增切换按钮后列数不匹配造成导入按钮换行拉满。
- 修改：`LibraryOverview.tsx`、`summary.css`、`src/ui/styles/library.css`、`src/core/librarySummary.ts`、`scripts/verify-library-summary.mjs`及两份状态；保留筛选/比较/缩放/用户总结。
- 验证：npm run verify cmd_1789100103575_65 exit0，42.758s；总结core20项通过，Rust161 passed/0 failed/1 ignored；diagnostics0。隔离Chromium真实React综览+全局tokens/base/components/library/workbench/summary CSS验证通过（原生IPC和编辑器mock），检查尺寸/文字可见/元数据与打开/选择/缺失和错误/刷新/响应式；未实际Windows WebView2验收。
- 夹具/截图：Arena共享工作区`library-ui-fix/ui-check/check.cjs`、`results.log`、`overview-fixed.png`。必须带全局CSS回归，不能只测隔离组件CSS；原文献标题早已通过props接入，此次主要修正被复选框挤没的展示，不应误称重建了资料库关联。
- 边界：元数据有值直接显示，缺失不猜填；不联网补齐、不把年份当online、不改资料文件。未启动用户软件、操作真实库、提交Git或重新打包。
- 下一步：隔离资料桌面验收标题与元数据、单击打开、手写总结/勾选/窄窗；需要新EXE时标准打包。当前latest仍为11:18标题修复包，不含这轮文献库修复。

## 标题修复 Windows 交付（已打包，2026-09-11T11:19:21+08:00）

- 标题修复Windows包已生成：npm run package:windows cmd_1789096481912_62 exit0（248.025s）；0.1.2/windows-x64，2026-09-11 11:18:49+08:00。artifacts/windows/latest/a4note.exe与A4 Note_x64-setup.exe；独立Get-FileHash均与build-info一致，旧latest归档至archive/0.1.2-20260911-111442-34060。未启动或安装应用，未操作真实文献库；需手验空标题回退及改名同步。
- 产物：EXE 31,785,472 bytes；安装器20,874,647 bytes。build-info内含SHA256；EXE `621CCE76A9D1CCD7B570201B0CB996C3A29DBC421A02454E0B5F6C61764AAA42`，安装器 `9549DA1167EEF0BA6BE193D6E05F904B0567CD4F48FA4D615E705AFCE124FD8E`。
- 验证：打包包含前端生产构建与Rust发布构建；此前最终verify cmd60 exit0。产物核对cmd63 exit0。仅打包和更新配对状态，没有追加业务代码修改。
- 下一步：用隔离资料验收删空后失焦/Enter恢复原名、中文标题提交、左侧文件树与磁盘改名、同名冲突及重开；本轮不替代Windows WebView2人工验收。下方“尚未打包”为历史记录，当前latest已包含标题修复。

## Markdown标题编辑与文件名同步（源码修复，待桌面验收，2026-09-11T11:06:50+08:00）

- 目标/行为：Markdown标题提交修复：编辑可删空；空白失焦/Enter恢复原标题与文件名，Esc取消，IME选词Enter不提交。有效提交复用共享会话与已有rename命令，同步Markdown标题、磁盘文件名、tab/resource路径并刷新文件树；同名/非法名不写标题、不覆盖文件。托管总结无rename回调仍保留固定路径。
- 修改文件：`src/core/markdownTitleEdit.ts`、`src/features/explorer/MarkdownDocumentTitle.tsx`、`MarkdownResourceTab.tsx`、`src/ui/App.tsx`（仅改名回调加文件树刷新）、`scripts/verify-markdown-safety.mjs`及两份状态。
- 验证：首次完整verify cmd59 exit0（44.552s，Rust161通过/0失败/1忽略）；补文件树回调后最终verify cmd60 exit0（20.252s，Rust161通过/0失败/1忽略）。React/jsdom真实输入组件6组交互通过（IPC/提交协调mock），覆盖删空/空白恢复、Enter提交/改名通知、IME保护、Esc、冲突提示；core/session测试另入完整verify。夹具在Arena共享工作区`a4note-title/ui-check/`。
- 已知边界：改名和内容CAS保存不是一个原子事务；改名后保存失败不回退覆盖文件，保留新路径及未保存正文，显示错误可重试。只改可视标题提交；源码H1及入链批量重命名未实现。未操作真实资料、启动软件、提交Git或重新打包；现有latest不含此修复。
- 下一步：完成状态格式检查后，用隔离资料手验空标题、中文改名、文件树新名、同名冲突及重开。需要EXE时运行标准package:windows。

## 正式总结首批与标题标签（已打试用包，2026-09-10T21:14:16+08:00）

- 已接真实LibraryScene综览，仍默认列表；时间/期刊标签放标题下，独立列默认隐藏，v1→v2只迁移布局不删内容。online手填总结、不猜出版年；期刊读文献元信息。
- 每篇`files/papers/<paperId>/总结.md`＋相对`summary-assets`，布局`.summary-view.json`同属papers根；保留旧笔记。共用文件会话/CAS/草稿/关闭保护；备份维护闸门、删除拒写与托管路径限制已接。
- 性能/范围：可视行、4并发、128条/8MiB缓存；缩小省略，放大全文变高。SQLite索引/全局总结搜索、真实库测速、缩略图和拖拽列交互尚待完善，不称全部完成。
- 验证：最终verify cmd52 exit0（Rust161通过/0失败/1忽略，新增原生7项；总结core17项）；实际组件隔离IPC浏览器18项通过，修改路径diff检查通过。未读写真实资料/运行软件/提交Git。
- 交付：cmd53 package:windows exit0，0.1.2/x64，21:12:45新包在`artifacts/windows/latest`，EXE＋安装器及build-info；旧latest已归档。先用资料副本做Windows手动验收。
- 交接：连接530已恢复，第二次构建cmd48及最终verify均通过；本地标签/UUID fallback/防未闭合代码块修正均已写回并进入本次包。浏览器夹具/日志见共享工作区`summary-native-check/`。


## 参考默认列与自定义（原型完成，2026-09-10T20:38:31+08:00）

- 默认：论文名称固定；online时间、期刊/会议、主要功能、代码、数据集、结构、评估与指标、备注。结构可图文混排，核心方法/关联笔记可选启用；保留紧凑行与滚轮缩放。
- 自定义：增列/改名/显隐/拖排/调宽/移除恢复/恢复默认。字段ID稳定；移除不删内容，恢复默认保留自定义列。元信息来自文献，未知online时间留空；总结不重复存元信息。
- 范围/验证：只改HTML原型与两份状态；Chromium 20+14+10=44项通过，无页面异常，含默认列精确匹配、元数据/图文编辑独立、移除恢复不丢内容。未改原生源码/真实资料，MD持久化未接入。
- 下一步：评审该默认模板；按下述MD与索引方案接入，迁移保留旧字段。原型路径`docs/prototypes/library-views.html`。


## 总结MD与紧凑综览（原型完成，文件存储未接入，2026-09-10T19:09:37+08:00）

- 边界：记录称“总结”；保留现有快速索引/标签/文件夹，只有右侧列表/综览切换，不新增专题集合。
- 原型：去大标题和滑条；单行工具栏。缩小单/双行省略、不挂载图片；放大全文展开、行高随内容增长。Ctrl/⌘滚轮缩放，悬停小缩放控件也可直接滚轮；锚点/合帧与可见行虚拟化。
- 存储建议：每篇`files/papers/<paperId>/总结.md`为唯一内容源，图片放`summary-assets`相对引用。列用稳定字段ID；布局另存。SQLite仅可重建索引，按需读取/增量解析/缓存，滚轮不触发读盘；保留现有阅读笔记。
- 落地约束：共享文件会话、AST保留未知字段、原子写/外部冲突检测；托管总结写入须受备份恢复闸门保护。首次索引重建与真实MD库规模待实测。
- 修改/验证：仅`docs/prototypes/library-views.html`及两份状态；原有20+新增14项Chromium检查通过，1000条模拟行实际挂载<40。MD读写/原生应用尚未实现，无真实资料操作。
- 交接修正：上轮本地原型已交付，但项目副本因父目录不存在未写入；本轮创建目录并补齐，独立核对后交付。后续先评审该版交互，再接MD持久化。


## 文献库与阅读器可靠性整改（首批完成并验证，待桌面验收，2026-09-10T18:18:54+08:00）

目标：按优化报告顺序实施明确的小修复，不再只做评估。详情见 [首批修复记录](RELIABILITY_FIRST_BATCH_2026-09-10.md)。

### 已完成

- 首批可靠性整改已实施：正常文献读回排除笔记墓碑，删除仍保留内容/server_version/delete outbox；重复删除与不存在ID无新同步操作。拒绝外文献ID、已删除笔记旧保存与不存在父文献；新增可选expected标题/正文条件校验，避免覆盖并发修改。
- 导入不再INSERT OR REPLACE覆盖原文献或文件；文献ID路径校验、全流程重复检测串行、新目录独占、数据库登记失败仅清理本次副本，原PDF的哈希与写入字节一致；保留重复内容返回原文献及多译文功能。删除入口同时拒绝越界存储ID。
- 备份改用SQLite Backup API，包含未checkpoint WAL；唯一临时目录完成后发布，清单记录数据库/附件SHA256。恢复先在隔离暂存区校验/迁移/重定位托管附件，输入备份不改写，生成恢复前安全备份，再按日志提升文件与数据库。步骤失败回退，进程中断后启动前回退；不宣称经过断电/硬盘故障实验。
- 新增命令边界维护闸门，覆盖资料库/笔记/标注/阅读状态/工作台/历史/同步命令；备份恢复与本进程正在执行的I/O互斥，忙时明确拒绝而非嵌套等待。恢复成功后禁止旧会话读写，界面明确要求重启；恢复前统一等待文件Markdown和文献笔记保存。未启用WAL或修改既有数据库持久化参数。
- 文献Markdown笔记改为固定paper/note身份的共享串行保存会话；900ms防抖、blur、Ctrl+S、关闭共用一个队列，保存失败不切换/新建，切标签卸载会补存，保存途中编辑继续顺序写入。增加恢复草稿、条件冲突保护、重试、导出和确认放弃；关闭窗口等待未完成写入。独立Markdown文件仍使用既有文本会话，只共用关闭保护。
- 修复原生保存后全库刷新把用户拉回旧文献的问题，改为只更新对应笔记；内存仓库尊重传入noteId并保持标题原文，避免新建ID不一致/重复笔记。原生数据库已保存但浏览器缓存配额失败时不再误报数据库保存失败。
- PDF切换/关闭/加载失败时销毁loading task和worker；单页渲染失败不再产生未处理Promise或无限加载，提供原页重试且保留原位坐标。保留原有视口渲染/延迟释放，不把全pages.map误认为全画布即时绘制。
- 安全依赖定向更新：pdfjs-dist 6.3.289、@mdxeditor/editor 4.2.4、js-yaml 4.3.2、nanoid 3.3.18、postcss 8.5.28；针对MDX精确锁定旧yaml使用兼容4.x补丁override，未使用audit fix --force。Prism为main.tsx实际导入，改为显式依赖prismjs 1.30.0，不再依赖MDX间接携带。
- 所有破坏/故障/并发回归使用隔离临时库或模拟回调；未启动用户应用、未读写真实资料库、未提交Git。本轮未生成EXE，Windows latest仍为17:43旧包，不包含本轮修复。

### 验证结果

- npm run verify — PASS，cmd_1789035307818_30 exit0，71.136s；生产构建、所有既有检查、新增test:reliability及154 Rust tests passed / 1 benchmark ignored。日志 .build/reliability-verify.log。
- 新增15项Rust安全测试通过：7项笔记/导入行为、1项expected冲突、6项备份恢复（WAL/校验/跨根路径/旧格式不改输入/5个失败边界/中断恢复）、1项维护闸门。既有startup_backup_restore完整payload测试通过；保留全部旧回归。
- test:reliability — 10/10 PASS：串行合并、固定ID、失败重试、写入时撤回/关闭、恢复冲突基线、缓存失败、跨文献隔离、异常返回ID、确认放弃与期间新编辑保护、原生命令闸门覆盖（最后一项为静态补充）。core smoke增加传入ID/原始标题/重复更新断言。
- 隔离Chromium真实React组件交互 — 文献笔记10/10、PDF生命周期/渲染5/5 PASS，无未捕获异常。笔记编辑器表面/原生保存回调及PDF加载任务为受控stub，不等于完整Windows WebView2或真实PDF标注视觉验收。Arena workspace reliability-ui-check/{harness.tsx,check.mjs,results.log,pdf-harness.tsx,pdf-check.mjs,pdf-results.log}。
- 真实PDF.js 6.3.289运行回归 — 内置指南及带文本PDF夹具各2轮打开/75%与150%canvas渲染/关闭（共8次渲染）；文本夹具提取成功，损坏输入拒绝且释放任务。由npm run test:pdfjs纳入完整verify，不以stub代替实际PDF.js解析/绘制。
- npm audit --json — PASS exit0，high/critical/total均为0；日志 .build/reliability-audit-final.json；仅代表当前依赖公告审计，不是渗透测试或绝对安全保证。
- get_diagnostics — 0 errors / 0 warnings；npm run test:agent-status 最终通过。随后git diff --check exit2，仅报告未触碰的既有docs/notes/DEVELOPMENT_TASKS.md:1933文件末空行，未清理他人修改；不是verify失败。

### 已知风险/未完成

- 本轮源码经过自动化验证但未打包/安装或实际Windows WebView2手验。现有latest是2026-09-10 17:43版本，仍含旧问题/旧依赖；不要把它当作本轮修复包。
- 维护闸门为本进程命令边界协调，不替代跨进程独占锁；恢复前须关闭其他实例/外部数据库工具。进程中断回退已做隔离模拟，未测试真实断电、磁盘硬故障、同步盘锁/杀毒软件全组合。
- 备份范围仍是SQLite及files/papers托管附件，不包含外部项目Markdown/任意外部绑定文件；旧备份无清单时可兼容恢复，但不能追溯验证当年缺失的数据。恢复草稿受localStorage容量限制，导出/独立备份仍必要。
- PDF重开/绘制已测试，但双栏同步、长文档、选区/批注、缩放坐标与页面失败提示位置还需真实Windows手验；未量化实际EXE冷启动/可交互时间。
- 文献库全部工作流、更完整双链/引用重命名以及大型App收敛仍是后续项；关系图、社区、云同步服务端和新AI扩展未动。

### 下一步

- 先对本轮源代码做隔离Windows桌面验收：笔记新建/输入/快速切标签/保存失败与确认放弃、PDF原文译文切换/选区/标注/缩放、备份恢复后的重启与安全备份可读。需要交付时再按package:windows流程打包，不误用17:43旧latest。
- 继续按优化评估顺序：补跨进程/恢复实际失败条件验证；测真实冷/暖启动到可交互trace，再决定整库localStorage/列表渲染优化，不能把合成SQL计时当作启动数据。
- 随后检查文献库批量操作/元数据/删除失败语义/搜索导出与更完整双链（标题/别名/重命名更新）；不扩展关系图、社区和云同步服务端。
- 依赖更新后保留MDX→js-yaml override直至上游解除旧精确锁；后续升级继续分别执行PDF/Markdown行为回归和audit。

下方历史“未修复/5 high/已打包”均指对应时间点；本轮源码已修复且audit为0，但没有替换旧latest EXE。


## 最新Windows交付与项目优化评估（打包与评估完成，待桌面验收，2026-09-10T17:44:44+08:00）

目标：交付最新EXE/NSIS安装器，检查项目下一阶段优化顺序。

修改文件：优化评估报告及两份状态文件；交付二进制由标准打包脚本生成，业务源码未额外改动。

### 已完成

- 2026-09-10 Windows标准打包完成（npm run package:windows，cmd_1789033113570_5 exit0）。A4 Note0.1.2/x64，构建时间2026-09-10T17:43:13+08:00；包含原位新建、启动CLI探测移除、数据库优化及既有Markdown/Reader修复。
- 交付 artifacts/windows/latest/a4note.exe（31,355,904 bytes）与 A4 Note_x64-setup.exe（20,771,156 bytes），build-info.json记录两项SHA256；旧latest归档至 artifacts/windows/archive/0.1.2-20260910-173835-8176，本次隔离构建目录已清理。
- 新增项目优化评估 docs/notes/PROJECT_OPTIMIZATION_REVIEW_2026-09-10.md：按数据语义/备份恢复/依赖安全→实测交互性能→文献库闭环→双链→工程收敛安排，暂缓关系图/社区/云同步和新AI扩展。本轮不修改业务源码、不提交Git、不启动用户应用或操作真实文献。
- 评估发现软删除读回不一致：delete_note_in_database设置deleted_at，但list_notes_for_paper没有排除墓碑；使用当前查询在隔离内存SQLite中复现删除前后均返回1条。该问题尚未修复，未宣称已完成Windows UI删除入口验收。

### 验证结果

- npm run verify — PASS（当前源码，cmd_1789033008291_3 exit0；生产构建及全部检查，139 Rust tests passed，1项计时基准按设计ignored）。日志 .build/release-sept10-verify.log。
- npm run package:windows — PASS；独立Get-FileHash对照build-info.json两项一致。EXE 7E0A8E8EE6CABC3DC0D6933197CA88804DC9FBD94C17678A302D2FD207D94EFA；安装器 FD0B5C94E4806792BA6F9412D531A257B27019B979805E93E80B46A2B9C2D157。日志 .build/windows-package-sept10.log。
- npm audit --json — exit1，5 high受影响包/0 critical：@mdxeditor/editor、js-yaml、nanoid、pdfjs-dist、postcss；没有运行audit fix。原始 .build/release-sept10-audit.json。
- get_diagnostics — 0 errors / 0 warnings；软删除列表SQL级隔离复现成立（不是实际桌面UI测试）。

### 已知风险/未完成

- 新包已生成但未启动/安装或进行Windows WebView2人工验收；依赖5 high与笔记软删除读回风险尚未处理，不把打包成功等同于可安全公开发布。
- 备份直接复制DB/附件、恢复删除目录后复制的失败回退与在线一致性问题仍待整改；性能仍缺真实启动trace，合成数据库基准不等于EXE可交互时间。

### 下一步

- 先备份并使用可信测试文件验收2026-09-10 17:43的新包；原位新建、启动无CLI探测、状态重启保留、Markdown保存冲突/双链、PDF切换缩放均需桌面验证。
- 按 PROJECT_OPTIMIZATION_REVIEW_2026-09-10.md 启动下一批：优先修复软删除正常读取/搜索导出与墓碑同步的边界，补导入失败/身份复用测试；随后一致性备份/分阶段恢复、依赖安全分组升级。
- 前端性能先测，再决定缓存迁移/列表虚拟化/同步文件读取优化；不直接删localStorage、不重写App、不顺手扩展关系图社区。
- 本轮已重新打包；下方历史记录中的“未打包/旧latest”仅反映当时状态，当前latest以本轮build-info为准。


## 启动与数据库保守优化（已实现并自动化验证，待打包/桌面验收，2026-09-09T19:55:41+08:00）

目标：移除启动CLI探测，在保留当前数据/功能的前提下减少数据库启动负担。

修改文件：`src/features/agents/useAgentProviders.ts`、`src/features/agents/AgentSessionPanel.tsx`、`src-tauri/schema.sql`、`src-tauri/src/database.rs`、`src-tauri/src/guide.rs`、`src-tauri/src/library_papers.rs`、`src-tauri/src/library_notes.rs`、`src-tauri/src/library_annotations.rs`、`src-tauri/src/library_ai.rs`、`src-tauri/src/state_commands.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/startup_tests.rs`、`scripts/verify-startup-safety.mjs`、`scripts/verify-all.mjs`、`package.json`、`docs/notes/AGENT_STATUS.md`、`plans/PROJECT_STATUS.json`。

### 已完成

- 用户明确选择“去掉启动时的自动探测”。移除 useAgentProviders 的450ms计时器/挂载探测，保留会话面板手动重新检测；显示“尚未检测”而非误报未安装，并对连续手动刷新做 single-flight。未删除 CLI/AI 功能或启动实际 CLI。
- 数据库初始化增加私有 aster_schema_migrations 表，schema.sql 内容 SHA256 + Rust migration revision 标记当前版本；常规入口仅检查实际数据库标记，避免反复DDL、旧folder扫描与ALTER。迁移/修复/标记在 IMMEDIATE 事务内提交，真实迁移错误不再吞掉；失败可重试。同路径恢复旧库会重新识别，不使用按路径缓存的数据库就绪状态。
- 新增5个关系/文件夹计数索引，并在每次完整加载的同一个连接内复用6类关系查询的prepared statement。保留SQL查询、排序与全部notes/annotations/files/tags/thread IDs返回，不引入分页/懒加载，不削减正文搜索或完整导出数据。
- 内置指南已存在时不再重写元数据/标签/笔记/阅读状态/时间戳/PDF；首次创建使用一笔事务写入关联行，并使用create_new避免覆盖已有文件。仅修复仍绑定标准位置但缺失的内置PDF，不重建用户删除/改绑的笔记或文件绑定。保留缺失整篇指南时首次创建的原有行为。
- save_workbench_state 改为 Tauri command(async)，SQLite工作不再执行于窗口线程；前端250ms防抖及串行保存队列未改变。未改变journal_mode/synchronous/外键配置，未引入WAL/共享连接池，保留当前备份方式。
- 保留上一轮文件夹原位新建及Markdown安全/基础双链/阅读器功能；本轮没有清除浏览器整库缓存、修改真实文献库、运行应用、生成新EXE或提交Git。

### 验证结果

- npm run verify — PASS（cmd_1788954820573_42，exit 0；生产构建、startup-safety及所有既有检查、139 Rust tests passed；1项计时benchmark默认ignored，另行显式运行成功）。日志 .build/startup-optimization-verify.log。
- 新增 startup_ 数据库安全测试 — 9/9 PASS：旧字段/未知字段/原始内容保留、warm初始化不获取写锁/不改DB字节、迁移失败无成功标记并可重试、同路径换旧DB、4线程初始化/seed一致性、指南编辑和PDF保留/缺失资产修复、首次seed失败事务回滚、索引前后完整payload与folder counts一致、实际隔离备份恢复一致。
- 同机同debug profile合成基准（1000文献/4000笔记/6000标注/3000文件/2000线程，7轮中位数）：warm initialize 1.901ms → 0.473ms；full list 5499.945ms → 44.264ms。首次优化测得41.697ms，最终复测44.264ms。命令 cargo test --manifest-path src-tauri/Cargo.toml startup_database_benchmark -- --ignored --nocapture；日志 .build/startup-db-before.log / .build/startup-db-after-final.log。
- 隔离React hook检查 — 7/7 PASS：挂载/700ms后零探测、手动single-flight、成功/失败/重试、重新挂载零探测、浏览器模式无native调用；模拟platform API，未启动真实Codex/Claude。Arena workspace startup-hook-check/{check.mjs,results.log}。
- get_diagnostics — 0 errors / 0 warnings。

### 已知风险/未完成

- 性能数字是合成数据下的Windows debug函数基准，不是用户实际EXE冷启动时间；没有WebView2长任务trace或完整启动到可交互计时，不能保证消除所有1–5秒卡顿。
- 首次使用新版会在真实库添加内部迁移记录表与5个索引，后续走轻量检查；未删除/重建用户业务表，建议更新前保留正常备份。SQLite备份与运行中并发写入的原有限制未在本轮重构。
- 浏览器整库localStorage同步缓存、全列表DOM渲染和大文件Markdown读取仍保留以控制兼容风险；待实际桌面测量后再决定下一步。
- Windows latest仍是2026-09-09 17:14的0.1.2包，不含原位新建和本次启动/数据库优化；未做真实WebView2和用户数据验收。

### 下一步

- 如需桌面交付，使用 npm run package:windows 生成含原位新建 + 本轮启动/数据库优化的新EXE/NSIS安装包，沿用latest/archive交付规则，不强制终止用户进程。
- 新版运行前备份；首次迁移后同机对比多次重启可交互时间，并验收文献/文件夹/收藏已读、笔记标注、搜索导出、工作台恢复保存、指南编辑保留及手动CLI检测。若仍卡顿，再测前端缓存/渲染与文件读取，不直接改删缓存。
- 本轮已实施上述保守优化；以下历史记录中的“只完成静态排查/待用户确认”描述此前阶段，不是当前工作状态。


## 文献库文件夹原位新建（已实现并自动化验证，待打包/桌面验收，2026-09-09T17:34:39+08:00）

目标：右键新建在目标树节点直接命名，不再跳到顶部表单。

修改文件：`src/features/library/LibrarySceneSidebar.tsx`、`src/ui/styles/workbench.css`、`scripts/verify-library-behavior.mjs` 和两份状态文件。

### 已完成

- 文献库原位新建完成：移除文件类标题下的创建表单，右键新建在目标节点下方第一行显示临时文件夹图标/名称输入框，按子层级缩进；父节点及祖先自动展开，命名期间不允许折叠隐藏该行。
- 顶部两个新建入口统一在默认资料库下创建；系统根右键只允许新建，仍禁止重命名/删除。默认名称“新建文件夹”自动全选、聚焦并滚入可见区域。
- Enter/勾号确认，Esc/叉号取消；IME composition Enter/Escape 不误提交或取消；点击别处保留草稿而不自动创建。只有确认时调用原 onCreateFolder，取消无空文件夹残留。
- 创建错误就地提示且保留名称/恢复焦点；同步 ref 防同一时刻重复请求，保存期间禁用取消与新建入口；同一目标复用未完成输入，切换目标只保留一行，目标消失清理无效草稿。创建与重命名互斥，原有重命名/拖入文献/选择行为保留。
- 本轮仅修改 LibrarySceneSidebar.tsx、workbench.css、verify-library-behavior.mjs 和两份状态文件；未改 App/Native 数据接口、Markdown/Reader、启动性能、用户真实数据，未提交 Git。

### 验证结果

- npm run verify — PASS（cmd_1788946372842_36，exit 0；生产前端构建、更新的原位新建静态断言及所有既有检查、130 Rust tests；日志 .build/library-inline-create-verify.log）。
- 隔离 Chromium + React 19 真实组件交互检查 — PASS 14/14（模拟创建回调，不访问真实文献库）：根/子层级、折叠父自动展开、选中默认名、Enter/Esc、取消零调用、pending 单次提交、同步/异步失败保留焦点重试、合成 IME 事件、空名拦截、根保护、目标切换/删除、320px 侧栏布局、原重命名。脚本在 Arena workspace folder-ui-check/{harness.tsx,check.mjs,check-results.log}。
- get_diagnostics（LibrarySceneSidebar.tsx）— 0 errors / 0 warnings。

### 已知风险/未完成

- 本轮未重新生成 Windows EXE/安装包；artifacts/windows/latest 仍为 2026-09-09 17:14 构建，不含本次原位新建。Chromium 模拟交互不等于 Windows WebView2 与真实中文 IME 人工验收；没有在用户真实资料库创建测试文件夹。

### 下一步

- 如需在桌面版使用本次原位新建，按 npm run package:windows 打包，沿用 latest/archive 合同；不要强行终止运行中的用户程序。
- Windows WebView2 验收右键安抚的/入门等节点新建的正确位置、中文输入法回车候选、键盘/勾号确认、Esc/叉号取消、同名失败重试与嵌套缩进。启动专项优化仍只完成前轮静态排查，未实施。


## 启动卡顿排查（静态检查完成，未实施优化，2026-09-09T17:20:35+08:00）

目标：分析每次界面显示后 1–5 秒无法操作的可能原因。

修改文件：仅两份交接状态文件。

### 已完成

- 启动卡顿静态排查：用户反馈每次界面显示后约 1–5 秒无法操作。本轮仅检查源码/既有构建日志，未改业务源码、未触碰真实文献数据库、未启动/停止应用或重打包。
- 确认桌面 createAsterCore 仍默认 LocalDocumentRepository：先同步解析全库 localStorage，SQLite loadNativeDocuments 完成后 replaceAll 又同步 JSON.stringify + localStorage.setItem 全库；LibraryScene 对全部可见记录 map 渲染。
- 确认 initialize_database 在多个读写入口反复执行 schema、历史 folder 扫描和列检查；seed_default_guide 每次启动都重写内置 PDF、元数据、标签、内置笔记（代码与“仅首次且保留编辑”的注释不符）。
- 确认 list_papers 全量加载每篇 notes/annotations/tags/files/thread IDs，循环追加多次 SQL 查询；save_workbench_state、目录枚举和 Markdown 读取仍为同步原生命令。
- 已有异步措施不能遗漏：initialize_library/list_papers/list_folders/load_workbench_state/detect_agent_cli 已使用 command(async)；AI CLI 探测只延后 450ms，仍在每次启动执行；diagnostics/sync 状态当前只在设置打开时加载。

### 验证结果

- 启动路径静态核对完成；既有 Windows 构建日志主 index chunk 为 1,818.52 kB（gzip 560.44 kB），PdfReader 已拆独立 chunk。体积不是启动后冻结的直接证据。

### 已知风险/未完成

- 尚无真实 Windows WebView2 performance trace、各阶段耗时或改前改后数据；以上是代码中确认的开销/阻塞风险，不是已证明的唯一根因，也未宣称性能已改善。原 17:14 Windows 包保持不变。

### 下一步

- 建议经用户确认后做启动专项优化：先加入前端长任务/阶段耗时及 Rust 命令计时，再移除同步重活、对数据库初始化和内置指南更新去重、将 CLI 探测改按需；全量缓存调整必须审查浏览器模式与历史缓存兼容，不可直接删除用户缓存。
- 视实测瓶颈再做文献批量查询/列表虚拟化和重组件懒加载；不得破坏正文搜索、完整导出、笔记/标注恢复或关闭保存保证。最终以同机同数据多次启动到可交互时长对比，并完成 verify/新包桌面回归。


## Windows 最新修复打包（已完成，待桌面验收，2026-09-09T17:15:06+08:00）

### 已完成

- Windows 最新修复打包完成：npm run package:windows exit 0，A4 Note 0.1.2 / windows-x64，构建时间 2026-09-09T17:14:12+08:00；包含最新 Markdown 安全/基础双链与文献库修复。
- 交付目录 D:\WorkSpace\Aster\artifacts\windows\latest：a4note.exe（31,308,288 bytes）、A4 Note_x64-setup.exe（20,767,168 bytes）与 build-info.json。
- 旧 latest 已归档至 artifacts/windows/archive/0.1.2-20260909-170816-42060；本轮隔离构建目录已由脚本清理。未强行结束用户进程、未启动应用、未提交 Git、未覆盖源码目录 release。

### 验证结果

- npm run package:windows — PASS（生产前端构建、Rust optimized release、NSIS x64 安装包，命令 cmd_1788944895564_24，exit 0）。
- Get-FileHash SHA256 与 build-info.json 两项一致；EXE 6C9C4B1F6782A5D8EB02676DB039C229F9C5B768D16BEB8EFBEAABC9B6FC71EB；installer 585CACDCA79FAB642DF52E2FD32404F9F85935283FF72204964C20BD8DB43B1A。
- 此前最终源码 npm run verify 已通过，含全部 130 Rust tests；本轮打包未修改业务源码。

### 已知风险/未完成

- Windows 打包成功不等于桌面验收通过：未运行新 EXE/安装器，未执行真实 WebView2 点击、关闭及重启回归；既有高级双链、文献库剩余能力和依赖审计风险不因打包而解决。

### 下一步

- 使用 artifacts/windows/latest 下的新 EXE 或安装包进行 Windows WebView2 人工验收；先备份文献数据库和 Markdown 文件，再检查已读/收藏重启保留、快速访问/文件夹、Markdown 保存冲突与基础双链。
- 本次打包已完成，以下历史交接中的“未生成 EXE/待打包”只描述当时状态，不是当前交付状态。


## 文献库基础功能补全（自动化完成，待桌面验收，2026-09-09T17:05:16+08:00）

### 已完成

- 文献库快速访问修复：smart view 不再被普通 folderId 过滤或重置；主列表与 Markdown/CSV 导出使用同一筛选结果，最近导入限定真实最新 50 篇，支持搜索/标签叠加。
- 已读、收藏、最近查看写入 SQLite；PaperSummary 与 nativePaperToDocument 读回全部状态及 created_at。新增列只追加，保留旧 papers.status，并验证旧数据库重复初始化兼容。
- 状态操作逐文献串行，原生成功后更新 UI，提交期间禁用重复状态操作；打开文献和切回已打开阅读标签都记录查看时间，不修改 PDF/笔记内容。
- 文献库文件夹树恢复系统根、子目录递归及展开，保留孤立节点并防止环形父子关系导致无限递归；根目录未归档文献可访问。新建/重命名失败保留输入，成功后展开父目录；右键菜单清理和 Escape 关闭修复。
- 本轮保持 Markdown 安全修复、PDF 阅读器实现、关系图和社区主线不变；只补齐文献库现有入口。

### 验证结果

- npm run verify — PASS（最终源码，包含生产构建、test:library-behavior、Markdown 安全、Reader、插件/UI/架构检查及全部 130 Rust tests）。
- cargo test --manifest-path src-tauri/Cargo.toml library_state — PASS（2 项：状态落库/重开/无关元数据保留与旧 schema 幂等迁移）。
- npm run test:library-behavior — PASS（快速视图、时间排序/50 篇上限、普通文件夹、环/孤立节点、Native 时间/布尔值映射及调用接线）。
- get_diagnostics — 0 errors / 0 warnings。

### 已知风险/未完成

- 本轮只有自动化与静态诊断，未执行真实 Windows WebView2 点击/拖动/重启验收。
- 数据库兼容测试使用隔离临时目录；已有数据库新增 is_favorite/last_viewed_at 将在应用下次初始化时执行。历史上已丢失的前端缓存状态无法凭空恢复。
- 资料库切换/多窗口并发状态覆盖、大库性能与其余文献库未完成能力不在本轮验收范围。

### 下一步

- Windows 桌面验收本轮文献库：最近查看/导入/未读/收藏切换、组合搜索标签、列表与导出一致性、已读收藏重启保留、切换 Reader 标签更新最近查看、默认及嵌套文件夹操作。
- 确认桌面验收后按 npm run package:windows 重新打包；本轮未生成 EXE/安装包、未提交 Git，也未对用户真实文献执行导入/删除或测试迁移。
- 下一轮继续审查文献导入/元数据/批量操作；不要把本轮三组修复表述为“文献库全部完成”。
- 社区维持 backlog；双链高级能力和上一轮依赖审计的 5 high 风险仍待专门处理。


## Markdown 文件安全与基础双链修复（自动化完成，待桌面验收，2026-09-09T16:53:49+08:00）

### 已完成

- Markdown 文件安全/基础双链修复：打开文件不再规范化并写盘；正文编辑保留原始 frontmatter、BOM 和换行；属性显式编辑使用 YAML AST 保留未知结构。
- 标题与文件名解耦，移除自动重命名；共享会话串行保存并在文件树重命名/移动/删除前协调写盘；Rust 临时文件 + sync_all + 原子替换，并按 expected_content 拒绝外部冲突覆盖。
- 保存错误保留缓冲与本地恢复草稿，新增重试/导出草稿/重新加载入口；窗口关闭等待保存并在冲突时阻止关闭。缓存容量受 WebView localStorage 配额限制，不保证替代备份。
- 基础双链统一到共享解析器：同目录、项目根目录、子目录扫描、相对路径、中文与显示别名；歧义、越界和扫描上限显式报错；阅读视图点击与编辑器 Ctrl/Cmd+点击接通。
- 用户确认长期有知识库驱动社区/社交计划，当前阶段聚焦本地文献库、Markdown、阅读器；本轮未修改文献库/PDF 阅读器业务，不扩展废弃或未完成的关系图。

### 验证结果

- npm run verify — PASS（最终代码；含新增 test:markdown-safety、生产构建、Reader、架构、插件/UI、文献库导出及全部 128 项 Rust 测试）。
- cargo test --manifest-path src-tauri/Cargo.toml text_file_io — PASS（3 项新增测试：原子保存/BOM/CRLF、外部冲突不覆盖、已删除文件不重建）。
- get_diagnostics — 0 errors / 0 warnings。
- git diff --check — 存在本轮未修改的 docs/notes/DEVELOPMENT_TASKS.md:1933 EOF 空行告警，未清理他人改动。
- npm audit — 5 high（@mdxeditor/editor、js-yaml、nanoid、pdfjs-dist、postcss）；未执行 audit fix。

### 已知风险/未完成

- 本轮自动化验证通过，但没有进行真实 Windows WebView2 鼠标/键盘和关闭窗口回归。
- 本地草稿缓存基于 localStorage，有容量与浏览器存储限制；原子替换+两次内容检查并非对不合作外部进程的文件锁，不宣称绝对消除检查与替换间的竞争窗口。
- 标题/块双链目前明确提示未支持；文件名改变不自动重写其他笔记引用，需后续单独实现。
- npm audit 报告 5 high，尚未处理；未改动相关依赖版本以避免影响阅读器和编辑器。

### 下一步

- Windows WebView2 人工验证：只打开关闭不改写文件；CRLF/复杂 frontmatter 编辑；快速编辑后重命名/移动；外部冲突、导出/恢复草稿和窗口关闭保护；不同入口双链导航。
- 本轮未生成新的 Windows EXE/安装包、未提交 Git；需要运行更新后的开发桌面版，或在人工验收后按 npm run package:windows 打包。
- 双链剩余工作：标题/块定位、frontmatter aliases 检索、反向链接、重命名后批量引用更新和大型知识库增量索引。
- 后续按用户优先级继续补全文献库未完成能力；社区/社交保持 backlog。单独安排依赖漏洞评估，不与当前修复混改。


## Markdown 列表编辑态稳定性修复（2026-09-08T20:43:45+08:00）

目标：完成 Markdown 列表编辑态修复，消除光标进入或离开列表语法时正文横向跳动的问题。

已完成：

- 移除列表源码态专用的整行 `padding-left` 覆盖；普通、有序与嵌套列表在源码态和渲染态保持同一层级缩进。
- 源码 `- ` / `1. ` 使用与渲染 marker 相同的宽度预算；编辑标记时正文起点不会变化。
- 源码态移除仅用于缩进的前导空格，避免在已有层级内边距上再叠加一次缩进；任务列表的源码标记覆盖在 gutter 中，checkbox 与正文位置保持不变。
- 更新静态回归断言，覆盖稳定 marker 宽度、任务列表和禁止恢复源码态 padding 覆盖。

修改文件：

- `src/features/explorer/MarkdownLivePreviewEditor.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 通过。

已知风险/未完成：`npm run build` 与 `npm run verify` 均被工作区既有的 `src/features/library/LibrarySceneSidebar.tsx:192` 未定义 `onSelectPaper` 阻断；本轮未生成 Windows EXE，也未完成桌面端鼠标/键盘编辑回归。

下一步：先修复或整合文献库侧栏的 `onSelectPaper` 编译错误，再运行完整验证和 Windows WebView2 的普通、有序、嵌套、任务列表编辑回归；通过后再打包 EXE。

## Markdown 列表源码缩进与字体修正（2026-09-08T20:15:10+08:00）

目标：修正列表语法显示源码时文字整体后移、列表与标题间距过大的问题。

已完成：

- 列表源码激活行不再保留渲染圆点所需的整段左侧空白，顶层列表从正文左边界约一个字符宽度开始。
- 嵌套列表源码按固定一级缩进递增，保持层级关系且避免额外空白。
- 列表源码标记改为继承正文字体、字号和行高，源码显示不会因代码字体宽度变化导致内容跳动。

修改文件：

- `src/features/explorer/MarkdownLivePreviewEditor.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:agent-status` 通过。

已知风险/未完成：尚未重新生成 Windows EXE，也未在桌面端对不同层级列表进行鼠标点击和键盘编辑回归。

下一步：用户确认列表视觉位置后，运行 `npm run package:windows` 生成交付版本。

## 文献库主区标题栏移除（2026-09-08T20:12:21+08:00）

目标：移除文献库主内容区重复显示的“文献库 / 篇数 / 最近导入”标题栏，让列表从搜索与操作工具栏直接开始。

已完成：

- 删除 `LibraryScene` 的主区标题栏，左侧侧栏中的文献库名称、篇数，以及主区搜索、筛选、结果数和导入操作保持不变。
- 清理标题栏专用 CSS 和小屏响应式规则，主区不再保留空白高度。
- 移除只服务于该标题栏的“最近导入文献”内部状态；导入成功与失败状态仍保留在工作台状态区域。

修改文件：

- `src/features/library/LibraryScene.tsx`
- `src/features/library/types.ts`
- `src/features/library/useImportFlow.ts`
- `src/ui/App.tsx`
- `src/ui/styles/library.css`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:ui-state`、`npm run test:agent-status` 和完整 `npm run verify` 均通过；包含 125 项 Rust 测试。

已知风险/未完成：本轮未生成 Windows release exe，也未进行新的 WebView2 截图；需在桌面版确认文献库在常规和窄窗口下搜索栏直接贴近工作区顶部。

下一步：如需交付 Windows 版本，运行 `npm run package:windows`；后续继续按用户提出的文献库界面调整处理。

## Markdown 图片源码可编辑与字号修正（2026-09-08T00:18:00+08:00）

目标：修复 Markdown 编辑模式下图片源码无法用光标移动、插入和修改的问题，并让图片源码字号与正文一致。

已完成：

- 激活图片时保留原始 Markdown 文本，不再用不可编辑 widget 替换源码，因此光标可以在 alt、URL 和标题参数中移动和编辑。
- 图片预览改为紧跟源码后的附加 widget；点击预览会选中对应源码范围，避免光标落到下一行。
- 图片源码使用正文继承字号和行高，代码字体仅作为字形，不再固定为过小的 12px。

修改文件：

- `src/features/explorer/MarkdownLivePreviewEditor.tsx`
- `src/ui/styles/workbench.css`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:agent-status` 通过。

已知风险/未完成：本轮未生成 Windows release exe，也未完成桌面端图片源码编辑的鼠标回归；需要确认点击图片、源码范围选中、键盘插入和换行后的预览位置。

下一步：在 Windows WebView2 中验证图片源码编辑手感；确认后运行 `npm run package:windows` 生成交付版本。

## TASK-BOARD-2 配对失败诊断修复（2026-09-07T19:54:34+08:00）

目标：继续排查 Agent Board 中 T3 配对链接持续失败的问题，并让浏览器错误显示能区分代理故障和配对凭据故障。

已完成：

- 确认 T3 正式 `/oauth/token` 合同仍是 token exchange；`/api/auth/session` 未配对时返回 `authenticated:false`，本机 endpoint 和 Agent Board 端口均可访问。
- 修复浏览器/WebView fetch 调用上下文：connector 现在把 fetch 绑定到 `globalThis`，避免 WebView 的 `Illegal invocation` 被误报为“本机配对代理不可用”。
- 配对输入支持完整 URL、`/pair#token=...`、Hosted `host` 形式和 T3 “Show code” 的直接 pairing code；Hosted endpoint 按 T3 客户端规则归一到环境根路径。
- 代理和 connector 只传递 T3 非敏感 `code/reason` 错误字段，不回显响应原文、token 或授权头。
- 脱敏浏览器验证：无效码现在显示“配对失败（upstream_rejected）”，不再显示网络/代理不可用。

修改文件：`apps/agent-board/src/connector.mjs`、`apps/agent-board/src/connector.d.ts`、`apps/agent-board/server.mjs`、`apps/agent-board/index.html`、`apps/agent-board/README.md`、`apps/agent-board/test/connector.test.mjs`、`plans/task-board/investigation/inspect-t3code-bundle.mjs`、本状态文件和 `plans/PROJECT_STATUS.json`。

验证结果：agent-board 19/19；三个 Node 语法检查；根目录 `npm run build`、`npm run test:architecture`、`npm run test:agent-status` 通过；T3 预览浏览器实测 raw code 错误路径通过。

已知风险/未完成：尚未获得新的未消费真实 pairing token，因此没有真实 snapshot/schema、dispatch 或 WebSocket subscribe 结果；真实链接仍可能过期或已被打开消费。

下一步：在 T3 桌面端重新生成一次 pairing link 或 Show code，生成后不要先打开；刷新 `http://127.0.0.1:4174`，endpoint 填 `http://127.0.0.1:3773`，直接粘贴并测试。成功后先记录非敏感 snapshot 合同，再考虑后续确认式 dispatch。

## TASK-BOARD-2 配对链接接入（2026-09-06T09:56:57+08:00）

目标：让独立 Agent Board 直接接受 T3 `/pair#token=...` 链接，并通过正式 OAuth token exchange 读取只读 snapshot。

已完成：

- connector 新增配对链接解析和 `/oauth/token` exchange；兼容完整 URL、`/pair#token=...` 相对路径、query token 与 Hosted `host` 参数。
- 配对输入改为普通文本并禁用浏览器原生 URL 校验；相对路径会使用 HTTP endpoint 自动补全，避免“请输入网址”阻断提交。
- 浏览器跨端口 CORS 已改由 Agent Board 同源代理处理：页面只收到短时连接句柄，服务进程内存保存 access token，连接句柄 15 分钟过期，清除凭据时主动销毁。
- 代理默认只允许 `127.0.0.1:3773`、`localhost:3773` 与已知 LAN T3 origin；其他 environment 必须通过启动变量显式授权。服务默认只监听 `127.0.0.1`。
- 中文控制台、mock server 和 18 项测试覆盖成功/失败、请求体、同源代理句柄、Bearer snapshot 和凭据脱敏；新版控制台已重新启动在 `http://127.0.0.1:4174`。
- 对此前链接的直接真实只读交换曾返回 HTTP 400；在旧版浏览器 CORS 路径中尝试过的链接可能已消费，因此未再复用。没有请求真实 snapshot、没有 dispatch、没有订阅。

修改文件：`apps/agent-board/**`、`plans/task-board/TASK-BOARD-2.md`、`plans/task-board/TASK-BOARD-2-REPORT.md`、两份项目状态文件。

验证结果：agent-board 18/18；三个 Node 语法检查；同源代理端到端 mock token exchange/snapshot/clear 成功；根目录 `npm run build`、`npm run test:architecture` 和 `npm run test:agent-status` 通过。

已知风险/未完成：一次性链接可能已被旧 CORS 请求消费或过期；新版代理尚未用新真实链接验证。真实 snapshot/schema、dispatch 与 WebSocket subscribe 尚未验证或实现。

下一步：刷新 `http://127.0.0.1:4174` 后新建一个配对链接，直接粘贴到“T3 配对链接”字段测试。真实 snapshot 成功后才能继续 capability 记录；真实发送仍须 UI 二次确认。

## TASK-BOARD-2 配对链接路由确认（2026-09-06T09:12:47+08:00）

目标：确认用户生成的 T3 链接是否为 environment 配对链接。

已完成：

- 只读检查用户提供的 `http://192.168.56.1:3773/draft/<id>`：返回 T3 页面，但对应源码路由是 `/_chat/draft/$draftId`，用途是恢复聊天草稿，不是环境配对。
- 确认真正配对链接使用 `/pair?token=...`；Hosted pairing URL 还包含 `host` 参数。
- 确认桌面端生成入口是 `Settings -> Connections -> Authorized clients -> Create link`；该区域需要当前环境连接和 `access:write` 管理范围。

验证结果：`/draft/<id>` HTTP 200 页面检查通过；`/api/auth/session` 返回未认证状态；未读取或输出任何 token。

已知风险/未完成：用户当前提供的链接不能用于 agent-board 认证；尚未获得真正 `/pair?token=...` 链接或完成配对。

下一步：用户在 T3 桌面端 Connections 中创建配对链接后，直接打开带 `/pair?token=...` 的链接完成配对，再执行 TASK-BOARD-2 的 snapshot 验证。

## TASK-BOARD-2 本机 T3 endpoint 已定位（2026-09-05T21:58:34+08:00）

目标：把真实 T3 接入从“缺 endpoint”推进到可由执行 Agent 完成配对和只读验证。

已完成：

- 确认 T3 Code 本机 environment 监听 `http://127.0.0.1:3773`，根路径和 `/health` 返回 HTTP 200。
- 只读请求 `GET /api/orchestration/snapshot` 返回 HTTP 401，错误为 `auth_invalid/missing_credential`。
- T3 配对页面明确要求一次性 pairing token 或 pairing secret；未读取、记录或输出凭据内容。
- 已将 `plans/task-board/TASK-BOARD-2.md` 更新为可分派状态，要求执行 Agent 在内存中处理配对凭据，并继续 capability、单次确认 dispatch 和订阅验证。

验证结果：本机根路径/health 200；snapshot 401（预期的未配对状态）；`npm run status` 通过。

已知风险/未完成：尚未在配对后调用 snapshot、dispatch 或 WebSocket；外部 `https://t3.chat` 导航被安全审查拒绝，不能用它替代本机 endpoint。

下一步：用户在 T3 桌面端完成 Pair with this environment 后，指定 Agent 使用 TASK-BOARD-2 记录非敏感 schema 结果，再由 UI 二次确认一次真实任务投递。

## 独立 SVG 鹈鹕骑行动画（2026-09-05T20:14:28+08:00）

目标：创建一个无需构建、打开即运行的 HTML，展示鹈鹕骑自行车的 SVG 2D 动画。

已完成：

- 新增根目录 `pelican-bike-animation.html`，使用内联 SVG 绘制海岸、栈道、自行车和戴围巾的鹈鹕。
- 加入车轮/踏板旋转、鹈鹕起伏、翅膀拍动、腿部踩踏、云朵漂移、海面波纹和旗帜摆动动画。
- 加入暂停/继续、重播、清晨/黄昏切换按钮，并支持 `prefers-reduced-motion`。

修改文件：

- `pelican-bike-animation.html`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：未创建或运行项目测试（按用户要求）；已检查 HTML 文件存在且包含 SVG、动画关键帧和交互脚本。

已知风险/未完成：未进行浏览器截图回归；页面可直接双击打开，建议在浏览器中确认动画帧率和窄屏裁切。

下一步：用户可直接打开 `pelican-bike-animation.html` 观看动画。

## Markdown 大纲换行与宽度调整（2026-09-05T19:58:03+08:00）

目标：解决右侧 Markdown 大纲标题被边缘裁切的问题，让大纲条目支持换行并增加清晰的条目间距。

已完成：

- 大纲条目改为自适应高度，标题可按中文字符自然换行。
- 大纲条目之间增加 8px 空行间距，层级和彩虹导轨仍由真实行高测量对齐。
- 大纲字号从 `16px`（`--ui-font-size * .888889`）调整为 `--ui-nav-font-size`，当前默认约 15px。
- 大纲面板从 `204/248px` 调整为窄窗口 220px、常规最大 280px，给长标题更多空间。
- 正文内容、正文字号和正文布局未修改。

修改文件：

- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:agent-status` 通过。`npm run test:architecture` 仍被工作区已有的 Markdown 表格选择器断言阻塞（当前实现使用共享 `:where(.md-body, .markdown-live-codemirror) table` 规则，本轮未改动该无关断言）。

下一步：在 Windows EXE 中确认窄窗口下大纲换行、空行间距、彩虹导轨和滚动行为；确认后再重新打包。

## TASK-BOARD-2 任务卡建立（2026-09-05T19:50:13+08:00）

目标：为真实 T3 capability、单次确认投递和 WebSocket 订阅固定执行边界。

已完成：

- 新增 `plans/task-board/TASK-BOARD-2.md`，列明 schema/capability 实测、二次确认、单次 dispatch、订阅游标和错误分类验收。
- 任务状态标为 `blocked（等待用户授权的 T3 environment endpoint）`；没有 endpoint、认证方式和授权窗口前，不执行任何真实网络请求。

下一步：用户提供非敏感 endpoint 标识与认证授权后，再由执行 Agent 生成 TASK-BOARD-2 报告并实现受保护的真实 connector 能力。

## TASK-BOARD-1 收口与安全扫描复核（2026-09-05T19:48:46+08:00）

目标：完成 TASK-BOARD-1 的最后交接，确认独立 agent-board connector 没有凭据字面量泄漏或遗留本地服务。

已完成：

- 将 connector 测试中的认证材料改为明确的 `REDACTED_TEST_*` 合成值，避免安全扫描把测试 fixture 误报为真实凭据。
- 确认 4177/4178 及常用开发端口没有 agent-board/mock 监听；未停止不明 Node 进程。
- 重跑 agent-board 单元测试、三个 Node 语法检查和凭据模式扫描，结果全部符合预期。

验证结果：`apps/agent-board` 测试 14/14 通过；`node --check`（connector/app/server）通过；扫描 `fixture-token|fixture-access|fixture-proof|secret@example|Authorization: Bearer|Authorization: DPoP` 无命中；根项目 `npm run build` 和 `npm run test:agent-status` 通过。

已知限制：仍没有用户授权的真实 T3 environment endpoint，不能验证真实 snapshot、dispatch 或 WebSocket subscribe。根项目 `npm run test:architecture` 另有既有 Markdown CSS 静态契约失败（要求缺失的 `.md-body table {`），本轮按任务边界未修改 `src/**` 或架构脚本；全仓库 `git diff --check` 另被既有 `docs/notes/DEVELOPMENT_TASKS.md` 末尾空行和换行风格警告阻断。

下一步：TASK-BOARD-2 需要用户提供非敏感 endpoint 标识、认证方式和允许的 capability/schema 测试窗口；在此之前只保留 mock/fallback，不实现真实发送。

## Markdown 目录导轨最终 Windows 交付（2026-09-05T15:04:51+08:00）

目标：交付右侧 Markdown 目录中“仅有子标题才显示展开符号和彩虹导轨”的最终 Windows 版本。

已完成：

- 有子标题的标题显示 Chevron，并为其可见后代绘制彩虹导轨。
- 无子标题的标题保持文件树叶子行样式，不显示展开符号或自有导轨。
- 导轨与展开符号保留间距，且从父行底部下方开始、在最后一个后代行上方收束。
- `npm run package:windows` 成功生成并提升最新 EXE、NSIS 安装包；旧版本已归档。

交付文件：

- `artifacts/windows/latest/a4note.exe`
- `artifacts/windows/latest/A4 Note_x64-setup.exe`
- `artifacts/windows/latest/build-info.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status`、`npm run verify` 和 `npm run package:windows` 均通过；最新 EXE SHA-256 为 `3E737F444A1C075E919AE18F5290AD8935E08813563A4DE9FB07B808A8A2EC71`。

已知风险/未完成：T3 预览未能加载 Tauri 原生运行时；最终视觉需以最新 Windows EXE 为准。

下一步：关闭旧版 A4 Note 后运行 `artifacts/windows/latest/a4note.exe`；安装需求使用 `artifacts/windows/latest/A4 Note_x64-setup.exe`。

## Markdown 目录导轨与展开符号收敛（2026-09-05T14:43:18+08:00）

目标：修正右侧 Markdown 目录中彩虹导轨穿过展开符号，以及无子标题行错误显示展开符号和彩虹导轨的问题。

已完成：

- 只有存在子标题的标题行显示 Chevron 展开符号；正文内容不再被误认为可折叠子树。
- 没有子标题的标题行不再生成彩虹导轨，保持为文件树风格的普通叶子行。
- 彩虹导轨改为从父标题行底部下方 3px 开始，并在最后一个可见后代行上方收束，避免与 Chevron 粘连。
- 同步更新 Reader 静态校验规则。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 均通过。

已知风险/未完成：本轮未重新生成 Windows EXE；T3 预览仍无法提供真实桌面截图，需要在 Windows WebView2 中确认导轨与 Chevron 的间距。

下一步：用户确认源码效果后运行 `npm run package:windows` 生成新 EXE；如旧版仍运行导致 latest 锁定，使用带标识的独立产物。

## TASK-BOARD-1 t3code connector 已完成（2026-09-05T15:13:17+08:00）

目标：在独立 `apps/agent-board` 中实现未配置提示、认证连接测试、脱敏 snapshot 映射和不发送网络请求的 dry-run 投递预览。

当前范围：

- 仅使用用户显式配置的 endpoint；本轮没有真实 endpoint，因此自动化只使用本地脱敏 mock server。
- 连接器集中处理 URL、临时认证头、响应解析、错误分类和 T3 状态映射；UI 不直接实现协议细节。
- 禁止真实 `thread.turn.start`、凭据持久化、桌面 IPC、DOM 抓取和本地数据库访问。

已完成：独立 app、纯函数/mock 测试、浏览器初始状态和错误状态检查、TASK-BOARD-1 报告。

验证：agent-board 测试 14/14 通过；根项目 `npm run build`、`npm run test:architecture`、`npm run test:agent-status` 通过；命令行脱敏 mock snapshot 返回 HTTP 200。

已知限制：没有用户授权的真实 T3 environment endpoint，因此未执行真实 snapshot/dispatch/subscribe；本轮没有真实 `thread.turn.start` 入口。

下一步：TASK-BOARD-2 先做用户确认的真实 endpoint/schema capability 测试，再实现确认后单次 dispatch 和 WebSocket 订阅。

## TASK-BOARD-0 报告 review 与 TASK-BOARD-1 生成（2026-09-05T14:06:00+08:00）

目标：审核 t3code 接入能力探测结果，并把下一步连接测试任务整理成可供用户审核和分派的任务卡。

已完成：

- 审核 `plans/task-board/TASK-BOARD-0-REPORT.md`：结论 `A` 有静态合同证据，覆盖 T3 orchestration HTTP/WebSocket RPC、Codex app-server、线程 ID、投递命令、状态和事件订阅。
- 确认报告没有读取凭据、完整消息或本地会话数据库，也没有发送真实消息。
- 明确限制：T3 当前没有公开 localhost 监听，授权 environment 上的 snapshot/dispatch/subscribe 尚未实调；不能把“协议存在”当成“连接已打通”。
- 将 `plans/task-board/TASK-BOARD-0.md` 标记为 `done（主 Agent review 通过）`。
- 生成 `plans/task-board/TASK-BOARD-1.md`，范围是 endpoint 连接测试、snapshot 映射和显式确认的 dry-run 投递预览；禁止真实发送。

修改文件：

- `plans/task-board/TASK-BOARD-0.md`
- `plans/task-board/TASK-BOARD-1.md`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：已完成报告逐项 review；随后运行 `npm run status` 和 `npm run test:agent-status`，状态结构校验通过。

已知风险/未完成：TASK-BOARD-1 仍需用户提供明确授权的 T3 environment endpoint 和认证方式；没有 endpoint 时只能验证 mock/fallback，不能声称真实连接成功。

下一步：用户审核 TASK-BOARD-1 后，指定另一个 Agent 执行；完成后再决定是否实现真实 dispatch、WebSocket 订阅和任务板 UI。

## TASK-BOARD-0 t3code 接入能力探测完成（2026-09-05T13:40:52+08:00）

目标：确认 t3code/Codex 是否提供可供外部任务控制台使用的正式接入面。

已完成：

- 生成调查报告 `plans/task-board/TASK-BOARD-0-REPORT.md`，结论为 `A`：T3 orchestration HTTP/WebSocket RPC 与 Codex app-server 均提供会话/线程读取、指定线程投递和事件流能力。
- 确认本机 T3 Code Nightly `0.0.39.0`，安装包版本 `0.0.39-nightly.20260904.1280`，commit `d6e29dc9dee9`；Codex CLI `0.153.4`。
- 只读检查 T3 bundle 中的 snapshot、thread detail、dispatch、subscribe 合同、认证 middleware 和运行状态枚举；未读取凭据/消息、未发送消息、未创建会话。
- 新增允许的探测脚本 `plans/task-board/investigation/inspect-t3code-bundle.mjs`，仅输出接口合同字符串和去重后的静态证据。

修改文件：

- `plans/task-board/TASK-BOARD-0-REPORT.md`
- `plans/task-board/investigation/inspect-t3code-bundle.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`node plans/task-board/investigation/inspect-t3code-bundle.mjs`、`npm run test:agent-status` 均通过；端口探测未发现当前 T3 进程公开监听 `3000/4000/4096/5173/8000/8205`。

已知风险/未完成：尚未在授权 environment 上实际调用 snapshot/dispatch/subscribe；T3 nightly orchestration schema、认证和 pairing/relay 权限仍需连接器测试确认。桌面 IPC、DOM 抓取和本地数据库不属于正式接入证据。

下一步：进入 `TASK-BOARD-1`，先实现用户配置的 environment endpoint 连接测试、snapshot 映射和显式确认的 `thread.turn.start` 投递；无 endpoint 时保留任务包 + 剪贴板 + 用户确认 fallback。

## Markdown 目录借鉴文件树视觉（2026-09-05T13:20:32+08:00）

目标：让 Markdown 右侧目录借鉴文件目录树的紧凑布局和视觉语言，改善截图中顶部空白、展开符号、层级缩进和彩虹导轨不一致的问题。

已完成：

- 移除目录面板重复的“目录”标题行，让第一个文档标题直接从顶部开始显示。
- 目录行改为文件树同款固定行高、16px Chevron/占位和 20px 层级缩进；叶子标题保留占位，避免标题文字左右跳动。
- 彩虹导轨颜色和透明度与文件树统一，并让导轨测量同时使用叶子节点占位的中心位置。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 均通过。

已知风险/未完成：T3 预览仍无法提供真实 Markdown 桌面截图；本轮未重新生成 Windows release 包，需要在 Windows WebView2 中确认目录首项、嵌套标题、滚动和窄栏下的实际观感。

下一步：如需交付，运行 `npm run package:windows`，再从 `artifacts/windows/latest/` 启动最新免安装版进行人工确认。

## TASK-BOARD-0 t3code 接入能力探测（2026-09-05T12:41:37+08:00）

目标：为独立开发任务控制台确认 t3code/Codex 的正式接入面，优先判断是否可以枚举对话、向指定对话发送任务和读取 Agent 运行状态。

已完成：

- 生成任务卡 `plans/task-board/TASK-BOARD-0.md`，状态为 `ready`，等待用户指定其他 Agent 执行。
- 任务被限制为只读调查，不允许修改 Aster 产品代码、发送外部消息或读取凭据。
- 验收要求包含 t3code 版本、插件/MCP/IPC/本地 API 证据、会话 ID、消息发送、状态读取和 fallback 方案。

修改文件：

- `plans/task-board/TASK-BOARD-0.md`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：任务卡已按 `AI_DEVELOPMENT_PLAN.md` 第 13 节扩展；分派前需由执行 Agent 运行 `git status --short` 和 `npm run test:agent-status`。

已知风险/未完成：当前没有 t3code 正式任务分配 API 的已验证事实；在探测报告完成前不能承诺一键发送。用户仍需手动指定执行 Agent。

下一步：执行 Agent 读取任务卡并生成 `plans/task-board/TASK-BOARD-0-REPORT.md`，主 Agent review 结论后再拆分任务板 UI 和连接器实现。

## Markdown 目录首项修正 Windows 交付（2026-09-05T12:26:29+08:00）

目标：将当前 Markdown 目录首项 Chevron/彩虹导轨对齐修正打包为可交付的 Windows 版本。

已完成：

- 执行标准命令 `npm run package:windows`，前端生产构建、Rust/Tauri release 编译和 x64 NSIS 打包全部成功。
- 最新免安装版和安装包已写入 `artifacts/windows/latest/`；旧版本自动归档到 `artifacts/windows/archive/0.1.2-20260905-122113-6320/`。
- `build-info.json` 已记录本轮构建时间、版本、平台和两个交付文件的 SHA-256。

交付文件：

- `artifacts/windows/latest/a4note.exe`
- `artifacts/windows/latest/A4 Note_x64-setup.exe`
- `artifacts/windows/latest/build-info.json`

验证结果：`npm run package:windows` 成功；EXE SHA-256 为 `5AEFC75D2B01B81D1D4A0A9C5386A2EAE40FD44E2E1C650198117770EA7BF12C`，安装包 SHA-256 为 `38EB7E85415BB048CC1E8C74F538FD45927BEA820E959AD1F212FAF054A1D27F`。

已知风险/未完成：本轮未获得 T3 桌面截图；仍需在 Windows WebView2 中确认首个一级标题、滚动、折叠和窄侧栏下的 Chevron 与彩虹导轨实际对齐效果。

下一步：关闭旧版 A4 Note 后运行 `artifacts/windows/latest/a4note.exe`，优先回归右侧 Markdown 目录首项、滚动同步、折叠和窄栏布局；安装需求使用 `artifacts/windows/latest/A4 Note_x64-setup.exe`。

## Agent 协作入口确认（2026-09-05T12:22:31+08:00）

目标：梳理项目目录和既有跨 Agent 协作机制，明确后续由主 Agent 负责需求拆解、任务分派和交接。

已完成：

- 确认 `AGENTS.md` 是最短入口；`DEVELOPMENT_HANDBOOK.md` 规定模块边界、插件规则、交接格式和验证矩阵。
- 确认 `AGENT_STATUS.md` 是人类可读历史，`plans/PROJECT_STATUS.json` 是机器可读快照，`npm run status` 用于快速查看计划、主线和下一步。
- 确认 `DEVELOPMENT_WORKFLOW.md` 和 `AI_DEVELOPMENT_PLAN.md` 已提供任务拆分模板；后续需求会补齐目标、影响目录、禁止修改、验收标准、验证命令、风险和回滚信息后再分派。
- 确认仓库没有可执行的项目内 `SKILL.md` 或任务队列；`src/features/agents` 属于产品内本机 CLI Agent 功能，不承担开发 Agent 协调。

修改文件：

- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：

- `npm run status`
- `npm run test:agent-status`（通过）

已知风险/未完成：当前工作区已有大量未提交修改和构建产物；后续分派必须保留这些既有改动。状态快照的 `next`/`risks` 仍包含较多历史人工回归项，不能直接当成全部新任务。

下一步：用户提出具体需求后，由主 Agent 先读取最新状态，形成单一目标、单一责任边界的任务简报，再分派给对应 Agent；完成或阻塞时同步本文件和 `PROJECT_STATUS.json`。

## Markdown 目录首项导轨与 Chevron 对齐修正（2026-09-04T22:56:22+08:00）

目标：修正右侧 Markdown 目录中首个一级标题的彩虹导轨/收起符号偶发缺失，并统一导轨与 Chevron 的中心位置。

已完成：

- 导轨测量改为以实际绝对定位的导轨覆盖层为坐标原点，同时恢复滚动容器偏移，避免列表内边距、滚动和 WebView2 亚像素取整造成恒定偏移。
- 文档根一级标题在内容暂时为空或 React 列表重排期间仍保留 Chevron 和短导轨兜底，首项不会因为无后续正文而消失。
- 为导轨覆盖层、导轨和 Chevron 增加统一的 `box-sizing`/零外边距，保证水平和垂直中心稳定。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/ui/styles/workbench.css`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：已通过 `npm run test:reader`、`npm run build`、`npm run verify` 和 `npm run test:agent-status`；完整验证包含 125 项 Rust 测试。

已知风险/未完成：T3 预览当前没有打开实际 Markdown 文件，尚未完成真实桌面截图；需要在 Windows WebView2 中确认首项、滚动、窄栏下的实际观感。

下一步：如需 Windows 交付，使用 `npm run package:windows` 生成 `artifacts/windows/latest/` 下的 EXE 和安装包；桌面端优先确认首个 H1、滚动和窄栏下的导轨/Chevron 对齐。

## Reader 关闭最后一个 PDF 后显示空状态（2026-09-04T20:07:12+08:00）

目标：关闭阅读器中的最后一个 PDF 后，不再自动回退显示最近打开的文献，而是显示 Reader 空状态提示。

已完成：

- `src/ui/App.tsx` 中 Reader 场景只从带有明确文献 ID 的 PDF 标签解析文献；固定 Reader 场景标签不再回退到全局 `selectedPaper`。
- 关闭最后一个 PDF 后，Reader 保留场景上下文并渲染“还没有可阅读的文献”空状态；从文献库再次打开 PDF 仍会创建并激活对应 Reader 标签。
- `scripts/verify-ui-state.mjs` 增加静态回归断言，防止后续重新引入最近文献回退逻辑。
- `scripts/verify-reader-rendering.mjs` 的目录导轨断言同步到当前 `lastDescendantIndex > index` 实现，消除过时校验失败。

验证结果：`npm run build`、`npm run test:ui-state`、`npm run test:reader`、`npm run test:architecture`、`npm run verify`、`npm run test:agent-status` 和 `cargo test`（125 项）均通过；完整 `npm run verify` 已成功完成。

已知风险/未完成：T3 预览服务仍返回 HTTP 503，未完成真实桌面截图；需在 Windows WebView2 中确认关闭多个 PDF、关闭最后一个 PDF 后的空状态，以及再次打开 PDF 后的恢复流程。

下一步：如需 Windows 交付，运行 `npm run package:windows`；桌面回归优先覆盖最后一个 PDF 关闭和 Reader 空状态提示。

## PDF 缩放修复 Windows 交付（2026-09-04T18:47:03+08:00）

目标：将 PDF 缩放抖动修复后的当前源码生成可交付 Windows EXE 和安装包。

已完成：

- 执行标准命令 `npm run package:windows`，前端构建、Rust/Tauri release 编译和 NSIS 打包全部成功。
- 最新免安装版与安装包已写入 `artifacts/windows/latest/`；旧版自动归档至 `artifacts/windows/archive/0.1.2-20260904-184142-21752/`。
- 当前 EXE SHA-256：`F988CB42776C922A194BE2D41CE983AADC3F1FC92B7DB2A73A56F6FF2656393C`。
- 当前安装包 SHA-256：`B3F01E898E68A765B6DDE2DBA903E9F701AEB8563E17E541498A7103F3ADEEC8`。

验证结果：`npm run package:windows` 成功；此前本轮源码已通过 `npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run verify` 和 `npm run test:agent-status`。

已知风险/未完成：T3 预览服务仍无法提供真实桌面截图；需在 Windows WebView2 中确认鼠标锚点缩放、页面边缘无空白闪动，以及文本层和标注层持续对齐。

下一步：关闭旧版 A4 Note 后启动 `artifacts/windows/latest/a4note.exe`，重点回归顶部/底部/左右边缘的 Ctrl+滚轮缩放，以及工具栏缩放和 Ctrl 快捷键缩放。

## PDF 缩放抖动修复交接（2026-09-04T18:26:19+08:00）

目标：继续修复阅读界面缩放 PDF 时的视角抖动、鼠标锚点偏移和边缘空白，并覆盖工作台内与独立资源标签两条 PDF 渲染路径。

已完成：

- Ctrl+滚轮使用鼠标所在文档点作为缩放锚点；连续滚轮期间先使用临时 compositor transform，避免每个滚轮事件触发 PDF.js 重绘。
- 缩放提交后在布局阶段清理临时 transform，读取真实内容布局并一次性恢复 `scrollLeft`/`scrollTop`，同时按容器边界裁剪滚动位置。
- `displayZoom` 与已提交 `zoom` 保持一致，避免页面、文本层和标注层在两套缩放状态之间抖动。
- 主阅读器查询限定当前活动工作台标签；独立 `PdfResourceTab` 使用局部根节点查询自身 PDF，避免多个标签互相取错内容。
- 新增共享 `PdfZoomAnchor` 类型并统一 Reader 组件、上下文、工具栏和 App 的回调契约；补充 Reader 静态回归断言。

修改文件：

- `src/features/reader/pdf/types.ts`
- `src/features/reader/types.ts`
- `src/features/reader/index.ts`
- `src/features/reader/pdf/PdfReader.tsx`
- `src/features/reader/PdfResourceTab.tsx`
- `src/features/reader/ReaderDocumentPane.tsx`
- `src/features/reader/ReaderContext.tsx`
- `src/features/reader/ReaderToolbar.tsx`
- `src/ui/App.tsx`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run verify` 和 `npm run test:agent-status` 均通过；完整验证包含 125 项 Rust 测试。

已知风险/未完成：T3 预览服务返回 HTTP 503，尚未完成真实桌面截图和鼠标回归；需在 Windows WebView2 中确认顶部、底部、水平边缘缩放时无空白闪动，并回归工具栏缩放、Ctrl+快捷键和 Ctrl+滚轮缩放。

下一步：如需交付 Windows 包，运行 `npm run package:windows`；启动 `artifacts/windows/latest/a4note.exe` 后人工确认 PDF 缩放锚点、边缘滚动和标注层对齐。

## 资源标签关闭后的场景侧栏保持（2026-09-04T18:23:41+08:00）

目标：修复关闭 PDF、Markdown 或未知文件标签后左侧侧栏错误跳回场景选择的问题。

已完成：

- 使用 `lastSceneRef` 保留最近有效场景；关闭最后一个资源标签或进入无活动标签状态时，侧栏继续使用原场景上下文。
- 打开 PDF、Markdown 等可识别资源时写入所属 `sceneId`，并确保对应场景的 canonical tool tab 存在。
- 增加统一 `closeWorkspaceTab` 入口；关闭当前资源标签后优先激活所属场景的 canonical tool tab，避免相邻的其他场景标签接管焦点。
- 未知文件从 Markdown 场景打开时继续继承笔记侧栏上下文；主动点击“返回场景”仍可回到场景选择。
- 未注册 opener 的未知文件使用打开前的 `activeScene ?? lastSceneRef.current` 作为 fallback，并将该 `sceneId` 持久化到资源标签；关闭 PNG 等文件时可稳定回到原笔记侧栏。
- Reader 公共出口补齐 `PdfZoomAnchor` 及相关 PDF 类型导出，保持 `App.tsx` 类型引用与静态契约一致。
- `verify-ui-state` 增加资源场景保留、canonical tab 和关闭焦点回归断言。

修改文件：

- `src/ui/App.tsx`
- `scripts/verify-ui-state.mjs`
- `src/features/reader/index.ts`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:ui-state`、`npm run test:architecture`、`npm run test:scene-plugins`、`npm run verify` 和 `npm run test:agent-status` 均通过；完整验证包含 125 项 Rust 测试。

已知风险/未完成：T3 预览服务此前返回 HTTP 503，未完成自动化桌面截图；需要在 Windows 版确认关闭 PDF、Markdown 和 PNG 后侧栏仍保持原场景。当前未重新生成 Windows release 包。

下一步：关闭旧版程序后运行当前开发版本，分别验证阅读、笔记和笔记场景中的未知文件关闭流程；如需发布安装包，再运行 `npm run package:windows`。

## Markdown 目录 Chevron 修正版 Windows 交付（2026-09-04T17:35:16+08:00）

目标：交付包含右侧 Markdown 目录顶部 Chevron 展开符号修正的最新 Windows 版本。

已完成：

- 通过 `npm run test:agent-status`，状态文件格式校验通过。
- 通过 `npm run package:windows`，前端构建、Rust/Tauri release 编译和 NSIS 打包成功。
- 最新免安装版和安装包已发布到 `artifacts/windows/latest/`，旧版已自动归档。

交付文件：

- `artifacts/windows/latest/a4note.exe`
- `artifacts/windows/latest/A4 Note_x64-setup.exe`
- `artifacts/windows/latest/build-info.json`

验证结果：EXE SHA-256 为 `D7556116000D6859256ECC807CEDA7A4EC54FF5D1E348936CE681E8A81A885DD`；安装包 SHA-256 为 `7F5D567D5E2816A02B48D03802780D89CE7397D88C92EF0A7333259AFFD0AE57`。构建时间为 2026-09-04 17:33（北京时间）。

已知风险/未完成：T3 预览服务仍不可用，未完成 Windows WebView2 实机截图；需人工确认多层标题、折叠、窄栏和滚动时的 Chevron 与彩虹导轨对齐。

下一步：关闭旧版程序后运行 `artifacts/windows/latest/a4note.exe`，检查右侧 Markdown 目录展开符号、导轨连续性和折叠后的线路收缩。

## PDF 缩放锚点与抖动修复（2026-09-04T17:32:40+08:00）

目标：修复阅读界面缩放 PDF 时视角跳动、鼠标锚点偏移以及缩放到边缘时的空白/滚动位置不稳定。

已完成：

- Ctrl+滚轮以鼠标所在文档点作为缩放锚点，连续滚轮期间使用临时 compositor transform，避免每个滚轮事件触发 PDF.js 重绘。
- 缩放提交后在布局阶段清除临时 transform，重新读取真实内容位置并一次性恢复 `scrollLeft`/`scrollTop`；滚动位置按容器边界裁剪。
- `displayZoom` 与已提交的 `zoom` 保持一致，避免页面尺寸、文本层和标注层在两套缩放状态之间抖动。
- 修正 Reader 静态校验中对 Chevron 图标来源的过时断言。

修改文件：

- `src/features/reader/pdf/PdfReader.tsx`
- `src/ui/App.tsx`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run verify`、`npm run test:agent-status` 均通过；完整验证包含前端生产构建、Reader/架构/插件/UI 检查和 125 项 Rust 测试。

已知风险/未完成：T3 预览服务仍不可用，尚未完成 Windows WebView2 实机截图；需重点确认缩放到页面顶部、底部和水平边缘时没有空白闪动，并回归工具栏按钮缩放、Ctrl+快捷键缩放和 Ctrl+滚轮缩放。

下一步：在关闭旧版程序后运行 `artifacts/windows/latest/a4note.exe`，人工回归 PDF 缩放锚点、边缘滚动和标注层对齐；如需交付新包，再运行 `npm run package:windows`。

## Markdown 目录展开符号统一（2026-09-04T17:20:32+08:00）

目标：修正右侧 Markdown 目录彩虹导轨顶部的异常空白，并与左侧文件目录统一使用 Chevron 展开符号。

已完成：

- 目录中存在子标题的条目显示 Lucide `ChevronRight`，默认展开时旋转为向下符号；叶子标题不显示多余占位图标。
- 展开符号按 H1-H6 层级与对应彩虹导轨对齐，图标位于导轨上层，不影响目录文字和标题跳转。
- 补充 Reader 静态回归断言，确保目录使用 Chevron 结构和层级定位样式。
- 重新生成当前 Windows EXE 和 NSIS 安装包，旧版自动归档。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`
- `artifacts/windows/latest/`

验证结果：`npm run build`、`npm run test:reader` 和 `npm run test:architecture` 通过；随后完成 Windows 标准打包。

已知风险/未完成：尚未执行真实 Windows 桌面截图，需人工确认 Chevron 与彩虹导轨在多层标题、窄栏和滚动时的视觉对齐。

下一步：关闭旧版后运行 `artifacts/windows/latest/a4note.exe`，打开包含 H2-H6 嵌套标题的 Markdown，检查展开符号、导轨连续性和标题跳转。

## Windows 交付包重新生成（2026-09-04T09:00:24+08:00）

目标：按标准 Windows 打包流程重新生成当前源码对应的免安装 EXE 和 NSIS 安装包。

已完成：

- 执行 `npm run package:windows`，前端生产构建和 Tauri release 编译均成功。
- 最新文件已写入 `artifacts/windows/latest/`，旧版本归档到 `artifacts/windows/archive/0.1.2-20260904-085615-19036/`。
- 构建元数据已记录在 `artifacts/windows/latest/build-info.json`。

修改文件：

- `artifacts/windows/latest/a4note.exe`
- `artifacts/windows/latest/A4 Note_x64-setup.exe`
- `artifacts/windows/latest/build-info.json`
- `artifacts/windows/archive/0.1.2-20260904-085615-19036/`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run package:windows` 成功完成。EXE SHA-256 为 `2B61D4F30482C809D901D04F8033BD9E9BBF16D6F0A29F2E7591261BEBCD232A`，安装包 SHA-256 为 `2B3AF1BB9C278F1472F32CA95F75F55426129797C3C040E7EA28C51BFEBF1BA6`。

已知风险/未完成：未执行真实 Windows 桌面回归；仍需人工确认启动、安装和现有功能的实际观感。

下一步：关闭旧版 A4 Note 后运行 `artifacts/windows/latest/a4note.exe`，或使用同目录的 `A4 Note_x64-setup.exe` 安装。

## Reader 工具栏点击问题复核与最新 Windows 交付（2026-09-03T21:38:20+08:00）

目标：复核阅读界面顶部整行按钮点击无反应的问题，并交付包含修复的 Windows 版本。

已完成：

- Reader 场景贡献保留 live runtime proxy，不再在插件贡献创建时展开成首次渲染快照；工具栏状态和回调会在每次渲染时读取最新值。
- 保持工具栏与 PDF 文档、文本层、标注层、侧栏的交互边界；工具栏根节点不再拦截 Pointer/Mouse Down/Up，按钮 click/change 可以正常进入 React 状态更新。
- `npm run package:windows` 成功生成并提升 `artifacts/windows/latest/a4note.exe` 与 NSIS 安装包，旧 latest 已归档。

修改文件：

- `src/features/reader/contributions.tsx`
- `src/ui/sceneAdapters.tsx`
- `scripts/verify-reader-rendering.mjs`
- `src/features/reader/ReaderToolbar.tsx`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status`、完整 `npm run verify`（125 项 Rust 测试）和 Windows 标准打包均通过；最新 exe SHA-256 为 `19924AE4433317ADB16E657CC6F84D59211C2DB963A03898B1689C00C21B3542`，安装包 SHA-256 为 `BB2459670108A3269F9344DEF8B68EA1427BF654425F852F84DE004F439C3907`。

已知风险/未完成：T3 预览服务本轮仍返回 HTTP 503，无法完成自动化桌面点击截图；需要在 Windows 版确认原文/译文/对照、标注、缩放、页码和侧栏按钮的状态变化。

下一步：关闭旧版 A4 Note 后，从 `artifacts/windows/latest/a4note.exe` 启动本轮包，逐项回归阅读工具栏按钮。

## Reader 工具栏点击修复与 Windows 交付（2026-09-03T20:28:25+08:00）

目标：修复阅读界面顶部“原文/译文/对照”、标注工具、缩放和侧栏按钮整行无法点击的问题。

已完成：

- 移除 `ReaderToolbar` 根节点上的 Pointer/Mouse Down/Up `stopPropagation()`；这些处理器会在 Tauri/WebView2 事件链中吞掉工具栏控件的激活路径。
- 保留工具栏、PDF 文档、文本层、标注层和侧栏的 `data-reader-layer` 与 `pointer-events` 层级隔离，让页面手势不会覆盖控件命中，同时不阻断控件自身的 click/change 事件。
- 更新 Reader 静态回归校验，明确禁止工具栏根节点重新加入鼠标/指针事件拦截。

修改文件：

- `src/features/reader/ReaderToolbar.tsx`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run test:reader`、`npm run test:architecture`、`npm run build`、`npm run verify` 和 `npm run test:agent-status` 均通过。修正 `MarkdownFootnote` 使用当前 lucide-react 版本可用的 `Undo2` 图标后，`npm run package:windows` 已成功发布新 exe 和 NSIS 安装包，旧 latest 已自动归档。

已知风险/未完成：T3 协作预览打开请求返回 503，未完成真实桌面点击截图；需在 Windows 版确认工具栏各按钮、右侧面板和 PDF 页面手势的命中范围。新包 exe SHA-256 为 `A4E1739533E3FBA3BCABEA931723407060189C7C646A067CA62EC5F817B4C2D8`。

下一步：从 `artifacts/windows/latest/a4note.exe` 运行新版本，逐项点击原文/译文/对照、标注工具、缩放、页码和侧栏按钮，确认状态变化和面板打开/关闭均正常。

## Markdown 目录导轨定位与滚动条收尾（2026-09-03T19:19:44+08:00）

目标：继续修正右侧 Markdown 目录彩虹导轨在窄栏、滚动和 WebView2 下的稳定性，保持导轨连续、选中反馈不遮挡线路，并移除原生滚动条残留。

已完成：

- 目录列表建立本地定位上下文，导轨覆盖层的绝对定位不再依赖外层布局，窗口变化和列表滚动时保持与标题行对齐。
- 为 Chromium/WebView2、Firefox 和旧版 Edge 分别补充滚动条隐藏规则，目录面板不再显示右侧灰色滚动条或两端按钮。
- 增加 Reader 静态回归断言，锁定目录定位上下文和三套滚动条隐藏契约。
- 使用标准 Windows 流程重新生成当前版本免安装 exe 和 NSIS 安装包，旧 latest 自动归档。

修改文件：

- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`
- `artifacts/windows/latest/`
- `artifacts/windows/archive/0.1.2-20260903-190756-20424/`

验证结果：`npm run build`、`npm run verify`、`npm run test:reader`、`npm run test:architecture` 和 `npm run test:agent-status` 均通过；Rust 测试 124 项全部通过。最新 exe SHA-256 为 `650A281C0A57C73B55DDC61A02C36144F0D8E4332A14DD4E9B15D358EDC70D22`，安装包 SHA-256 为 `3FFD17F2A8A072D9250AE652320326328DFD1EEC1F3DFF7B0679C074FD5430AF`。

已知风险/未完成：T3 预览服务仍返回 503，未执行真实桌面截图；需要在 Windows 版确认 H2-H6 多层标题导轨、折叠收缩、窄栏滚动和文献库文件夹移动的实际观感。

下一步：关闭旧程序后运行 `artifacts/windows/latest/a4note.exe`，打开包含 H2-H6 嵌套标题的 Markdown，确认导轨不跨章节连接、折叠后收缩、文字与导轨层次清晰且目录滚动条完全隐藏。

## 文献库文件夹管理与导航（2026-09-03T19:12:22+08:00）

目标：将文献库工作区侧栏改为可持久化的文件夹/标签导航，并提供创建、重命名、删除和文献移动能力，移除主列表重复索引栏。

已完成：

- 新增 `LibraryFolder` 前端模型；桌面端文献列表返回真实 `folder_id`。
- 初始化数据库时创建不可删除的“默认资料库”根文件夹，兼容旧文献。
- 新增文件夹列表、创建、重命名、删除和批量移动文献的 Tauri 命令及前端 API；删除文件夹会把文献和子文件夹迁移到父级。
- `LibrarySceneSidebar` 改为树形文献导航，支持多级文件夹、数量、标签筛选、行内创建和重命名、文件夹操作菜单。
- 文献主区域与侧栏共享当前文件夹筛选；单篇/批量操作菜单可移动到任意文件夹，筛选状态持久化。
- 移除主界面内部文件夹/标签索引栏，详情面板和现有搜索、排序、导出、批量管理能力保留。

修改文件：

- `src/core/types.ts`
- `src/core/asterCore.ts`
- `src/platform/nativeApi.ts`
- `src/shared/hooks/usePersistedUiState.ts`
- `src/features/library/LibraryScene.tsx`
- `src/features/library/LibrarySceneSidebar.tsx`
- `src/features/library/contributions.tsx`
- `src/features/library/types.ts`
- `src/ui/App.tsx`
- `src/ui/styles/library.css`
- `src/ui/styles/workbench.css`
- `src-tauri/src/database.rs`
- `src-tauri/src/library_papers.rs`
- `src-tauri/src/lib.rs`

验证结果：`npm run build`、`cargo check --manifest-path src-tauri/Cargo.toml` 和 `npm run verify` 均通过；完整验证包含 125 项 Rust 测试。

已知风险/未完成：本轮未执行 T3/Windows 桌面截图；需在桌面端确认侧栏树形层级、文件夹菜单、窄宽度表现和真实 SQLite 文件夹迁移操作。导入对话暂未加入目标文件夹选择，当前可在导入后通过移动菜单归类。

下一步：运行最新 Windows 构建，测试创建顶级/子文件夹、重命名行高、删除非空文件夹、单篇/批量移动以及重启后的筛选和文件夹状态。

## Reader 交互层和 PDF 标签清理（2026-09-03T19:03:51+08:00）

目标：从阅读器整体交互架构修复顶部标注工具、缩放/页码控件和右侧面板按钮命中不稳定的问题，并移除阅读界面可见的 PDF 类型标签。

已完成：

- 阅读器根节点、工具栏、文档区、PDF 表面、页面、文本层、标注层和右侧面板增加稳定的 `data-reader-layer` 交互边界。
- 工具栏和右侧面板在事件入口停止向文档层冒泡；侧栏拖动手柄保持独立窄命中区。
- 文本选择、标注空白层和标注对象明确分配 `pointer-events`，页面手势不会遮挡工具栏和面板操作。
- 移除顶部工具栏和“正在阅读”列表中的可见 PDF 类型标签，空状态改为通用“暂无打开文档”。
- Reader 静态校验覆盖交互边界、指针命中规则和 PDF 标签清理。

修改文件：

- `src/features/reader/ReaderScene.tsx`
- `src/features/reader/ReaderToolbar.tsx`
- `src/features/reader/ReaderSideDrawer.tsx`
- `src/features/reader/ReaderSceneSidebar.tsx`
- `src/features/reader/ReaderDocumentPane.tsx`
- `src/features/reader/pdf/PdfReader.tsx`
- `src/features/reader/pdf/PdfPageView.tsx`
- `src/features/reader/pdf/PdfTextLayer.tsx`
- `src/features/reader/pdf/AnnotationOverlay.tsx`
- `src/ui/styles/reader.css`
- `scripts/verify-reader-rendering.mjs`
- `scripts/verify-ui-state.mjs`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run verify` 和 `npm run test:agent-status` 均通过；完整 `verify` 包含插件、资源、Reader、UI 静态检查及 124 项 Rust 测试。

已知风险/未完成：T3 预览服务返回 503，未执行真实桌面点击截图；需要在 Windows 版确认顶部工具栏、右侧面板、文本选择和标注对象在不同缩放下的命中范围。

下一步：如需交付 Windows 版本，运行标准 `npm run package:windows`，从 `artifacts/windows/latest/` 使用最新免安装版或 NSIS 安装包进行人工回归。

## Markdown 右侧目录导轨构建收尾（2026-09-03T18:49:28+08:00）

目标：在保持右侧 Markdown 目录连续彩虹导轨修正的基础上，恢复文献库插件接线、更新过时的静态契约检查，并生成包含当前源码的 Windows 交付包。

已完成：

- 补齐文献库视图的文件夹移动回调，桌面端调用受限原生接口，浏览器预览同步内存文档状态。
- 修复 `LibraryScene` 的 `LibraryFolder` 类型导入，确认文献库侧栏由插件贡献渲染。
- 更新 UI 状态和场景插件静态检查，使其验证当前插件侧栏结构，不再要求已移除的文献库内部索引栏或空状态占位。
- 生产构建、Reader/架构/场景插件检查、全量 `npm run verify` 和 124 项 Rust 测试均通过。
- 使用标准 `npm run package:windows` 生成当前 Windows 免安装版和 NSIS 安装包；旧 `latest` 已归档。

修改文件：

- `src/ui/App.tsx`
- `src/features/library/LibraryScene.tsx`
- `scripts/verify-ui-state.mjs`
- `scripts/verify-scene-plugin-wiring.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`
- `artifacts/windows/latest/`
- `artifacts/windows/archive/0.1.2-20260903-183947-28500/`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:ui-state`、`npm run test:scene-plugins`、`npm run verify`、`npm run test:agent-status` 和 `npm run package:windows` 均通过；Rust 测试 124 项全部通过。最新 exe SHA-256 为 `9FD97E0F20CE67711D78E03D8554EC433F8E41D9B2B23D55726F278611677EFB`，安装包 SHA-256 为 `E528DF12B57CD2E77144147DF581A18D340199798E021549F35A7A2E7BF43B08`。

已知风险/未完成：T3 预览服务仍不可用，未执行真实桌面截图；需要在 Windows 版确认多层标题导轨、滚动同步、窄侧栏对比度以及文献库文件夹移动的实际观感。

下一步：关闭旧程序后运行 `artifacts/windows/latest/a4note.exe`，打开包含 H2-H6 嵌套标题的 Markdown，确认导轨分章节连续、折叠收缩、悬浮加粗且不遮挡目录文字；安装包为 `artifacts/windows/latest/A4 Note_x64-setup.exe`。

## Markdown 右侧目录连续彩虹导轨（2026-09-03T15:50:31+08:00）

目标：将 Markdown 文档右侧目录从逐行拼接的短竖线改为按标题层级连续延伸的彩虹导轨，保持目录文字和选中反馈清晰。

已完成：

- 目录列表测量每个标题行的实际位置，按标题层级和连续子树生成独立导轨段；导轨会随嵌套标题连续延伸，并在父级边界自然收束。
- 导轨放在目录列表的独立覆盖层中，避免每一行重复绘制；目录文字位于导轨上层，选中/悬浮背景不会遮挡彩虹线。
- 当前标题或鼠标悬浮标题所在的祖先导轨会加粗并提升对比度；浅色和午夜主题继续使用各自的低饱和彩虹色板。
- 目录宽度变化、窗口缩放和内容更新会通过 `ResizeObserver`/布局帧重新测量；滚动列表保持导轨与标题位置同步。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run verify` 和 `npm run package:windows` 均通过；完整验证包含插件/资源/Reader/UI 检查和 124 项 Rust 测试。最新 exe SHA-256 为 `45167C1210A9DD32EF85FA2D1EBDB5803533652C0274655341578C5697526BEA`，安装包 SHA-256 为 `84977217ED88C6907E0B300FF584DF599CF2AC131ADBB646907DC309E0351123`。

已知风险/未完成：T3 桌面预览服务当前不可用，未执行真实 Windows 截图；需在 Windows 版确认多层标题、折叠目录和窄侧栏下的导轨位置与对比度。标准 Windows 产物已生成，但仍需在目标机器上确认启动、安装以及不同缩放比例下的实际观感。

下一步：运行 `artifacts/windows/latest/a4note.exe`，打开包含 H2-H6 嵌套标题的 Markdown，确认滚动、悬浮、选中和窗口缩放时导轨连续且不遮挡文字；安装包位于 `artifacts/windows/latest/A4 Note_x64-setup.exe`。

## Windows 打包流程规范化（2026-09-03T15:42:09+08:00）

目标：统一 Windows exe/安装包的交付位置，并将上一版本与当前版本分开保存，避免不同功能版本散落在仓库根目录或覆盖旧文件。

已完成：

- 新增 `npm run package:windows` 标准打包命令；构建使用独立的 `.build/tauri-packaging/<run-id>/target` Cargo 目标，不覆盖旧的 `src-tauri/target/release/a4note.exe`。
- 最新免安装 exe、NSIS 安装包和构建元数据固定写入 `artifacts/windows/latest/`：`a4note.exe`、`A4 Note_x64-setup.exe`、`build-info.json`。
- 每次成功打包前，旧 `latest` 整目录自动移动到 `artifacts/windows/archive/<version>-<timestamp-pid>/`，保留可回溯的上一版本。
- 失败构建保留临时目录用于排查；成功构建自动清理临时目录。仓库根目录遗留的上一版拖放包已迁入 `artifacts/windows/archive/0.1.2-pre-standard-20260903/`。
- `build-info.json` 记录版本、构建时间、平台、文件名和 exe/安装包 SHA-256。
- README、开发手册和 `.gitignore` 已补充新的目录约定；`npm run tauri:build` 保留为底层调试命令，不作为交付流程。
- 修复目录树导轨测量回调的 TypeScript `never` 推断错误，恢复当前源码的生产构建。

修改文件：

- `scripts/package-windows-release.mjs`
- `src/features/explorer/MarkdownResourceTab.tsx`
- `package.json`
- `README.md`
- `docs/notes/DEVELOPMENT_HANDBOOK.md`
- `.gitignore`
- `artifacts/windows/latest/`
- `artifacts/windows/archive/0.1.2-pre-standard-20260903/`

验证结果：`npm run package:windows -- --dry-run`、`node --check scripts/package-windows-release.mjs`、`npm run build`、两次真实 `npm run package:windows`、`npm run test:agent-status` 均通过；最终 exe SHA-256 为 `B285349D8ABD422660B519BD6A7E366E69D6258653555C7CCD48D71762824D9B`，安装包 SHA-256 为 `78A00DFEF7B256BC792168CE3A4213DEB00B6C4030CBAC7154D9FAC2BD620447`。

已知风险/未完成：本轮未执行 T3 桌面截图；需要在 Windows 上确认固定目录中的 exe 启动和安装包安装流程。旧的历史构建中间目录仍按原有可恢复隔离策略保留，不作为新的交付入口。

下一步：后续 Windows 交付统一执行 `npm run package:windows`，从 `artifacts/windows/latest/` 取包；需要回退时从 `artifacts/windows/archive/` 选择对应版本。当前真实归档目录为 `artifacts/windows/archive/0.1.2-20260903-153616-18468/`。

## Markdown 文件树拖动源反馈与 Windows 打包（2026-09-03T15:12:45+08:00）

目标：增强文件树拖动源的过程反馈，让用户明确看到正在拖动的文件或文件夹；完成构建验证并生成独立 Windows 交付包。

已完成：

- 鼠标、触控笔和触摸分别使用 6px、8px、12px 启动阈值；未超过阈值时仍保持普通点击行为，不会误触发拖动。
- 拖动超过阈值后，源行增加强调色、左侧高亮和淡化效果；鼠标旁显示包含图标、名称和“拖到文件夹”提示的浮动预览。
- 浮动预览使用 Portal 渲染并设置 `pointer-events: none`，不会遮挡目标文件夹的命中和放置反馈。
- 窗口失焦、页面隐藏、`pointercancel` 和组件卸载都会清理拖动源、预览和目标状态；行使用 `user-select: none` 与 `touch-action: none` 保证拖动稳定。
- 架构静态校验新增阈值、源行反馈、浮动预览和清理逻辑断言；修正断言与实际函数声明一致。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-architecture-boundaries.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:architecture`、`npm run verify` 和 `npm run test:agent-status` 均通过；完整验证包含插件、资源、Reader、UI 检查和 124 项 Rust 测试。独立 Cargo 目标 `.build/tauri-file-tree-drag-feedback-final/` 的 `npm run tauri:build` 已成功生成 release exe 与 x64 NSIS 安装包。

产物：

- `a4note-file-tree-drag-feedback-latest.exe`
- `src-tauri/target/release/a4note-file-tree-drag-feedback-latest.exe`
- `A4 Note_0.1.2_x64-setup-file-tree-drag-feedback-latest.exe`
- 构建目录：`.build/tauri-file-tree-drag-feedback-final/`
- 免安装 exe SHA-256：`A6D83110A23B352EED197C6DBA57F1E7754D2ED21D1DE838B193BB5C992AB362`
- 安装包 SHA-256：`69DA092796DF10FC1DECE5236857D4C54C2D70D57BEDB216F9CF7C1624E89218`

已知风险/未完成：T3 预览服务仍不可用，未完成自动化桌面截图；需要在 Windows 版确认不同缩放比例、长文件名和拖动源浮动预览的实际观感与命中区域。

下一步：关闭旧版程序后运行 `a4note-file-tree-drag-feedback-latest.exe`，确认拖动文件/文件夹时源行高亮、预览跟随、目标文件夹反馈和释放后的普通点击行为。

## Markdown 属性图标视觉调整（2026-09-03T14:56:05+08:00）

目标：继续优化 Markdown 笔记属性左侧图标，去掉突兀的背景形状，让按钮尺寸跟随界面字号并保持系统默认鼠标样式。

已完成：

- 属性图标按钮改为透明的小圆角方形，尺寸固定为 26×30px，避免圆形胶囊背景造成视觉负担。
- 仅在悬浮和按下时显示低对比度主题背景，图标颜色同步强调色，普通状态不显示边框或底色。
- 保留 Pointer Events 属性拖动和系统默认箭头光标，普通点击打开属性菜单的行为不变。

修改文件：

- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 均通过；此前文件树拖放中的 `dragPreviewPosition` 构建错误在当前工作区不再复现。

已知风险/未完成：本轮未执行新的 T3/Windows 桌面截图，需在桌面端确认圆角方形图标在窄侧栏和不同界面字号下的实际观感。

下一步：运行当前最新免安装版，确认属性图标短按菜单、垂直拖动排序、悬浮反馈和窄侧栏布局。

## 通用文件页不可预览状态重设计（2026-09-03T09:52:03+08:00）

目标：修复笔记场景打开 PNG 等无法识别文件时，旧版文件标题和外部打开按钮错误出现在正文区域的问题；顶栏保持现有默认功能。

已完成：

- 通用 `FileTab` 不再渲染“在文件管理器中显示”“用默认程序打开”“在 VS Code 中打开”三个按钮。
- 保留当前默认工作台顶栏不变，不增加文件上下文操作或新的顶栏能力。
- 文件页改为轻量文件身份栏；二进制文件显示图标、文件名、路径和居中的不可预览状态，移除旧的大块空白卡片观感。
- 普通文本文件仍可预览，文件大小和截断提示逻辑保持不变。
- 增加架构静态断言，防止旧操作按钮和外部打开调用回到通用文件页。

修改文件：

- `src/features/explorer/FileTab.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-architecture-boundaries.mjs`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status` 均通过；已使用独立 Cargo 目标完成 `npm run tauri:build`，同时生成免安装 exe 和 x64 NSIS 安装包。

产物：`a4note-unsupported-file-page-latest.exe`（根目录免安装版，30,661,632 bytes）；SHA-256：`5D856E9981AF5E0F785778CF71FBEB888E0D4D5D0D73FD35E2CEC0F17378F5AA`。构建目录：`.build/tauri-unsupported-file-page/`。

已知风险/未完成：本轮未执行 T3 桌面截图；需要在 Windows 版确认 PNG 等二进制文件的空状态布局、长路径省略和窄窗口表现。

下一步：关闭旧版程序后运行 `a4note-unsupported-file-page-latest.exe`，在桌面端检查 PNG 等未知文件打开、切换标签和默认顶栏布局。

## Markdown 文件树拖入文件夹（2026-09-03T14:32:30+08:00）

目标：支持在 Markdown 文件树中拖动文件或文件夹，将其移动到另一个文件夹；不提供同级排序拖动。

已完成：

- 文件树条目改用窗口级 Pointer Events 拖动，超过 6px 阈值后显示拖动源淡化状态；避开 Tauri WebView 中原生 `draggable` 按钮拖不动的问题。
- 文件树行恢复系统默认箭头光标，不再显示 `grab`/`grabbing` 手型；普通点击仍分别打开文件或展开目录。
- 只有文件夹行接受放置，目标文件夹使用强调背景、左侧标记和“放入此文件夹”提示；同级项目不会响应放置。
- 禁止移动到自身、子文件夹或当前父文件夹，后端拒绝同名覆盖并校验源路径、目标路径和目录自包含关系。
- 新增 `move_path` 平台/Tauri 命令；移动文件夹后，Markdown 工作区和工作台中已打开的文件标签、URI、活动路径会同步更新。
- 增加 Rust 文件系统移动专项测试及架构指针拖动契约断言；拖动后 click 标记会自动清理，避免释放到空白处误吞下一次普通点击。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/features/markdown/MarkdownWorkspaceScene.tsx`
- `src/platform/projects/projectApi.ts`
- `src/platform/projects/index.ts`
- `src/ui/App.tsx`
- `src/ui/styles/workbench.css`
- `src-tauri/src/project_commands.rs`
- `src-tauri/src/workspace_fs.rs`
- `src-tauri/src/lib.rs`
- `scripts/verify-architecture-boundaries.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run verify` 均通过；完整验证包含插件、资源、Reader、UI 检查和 124 项 Rust 测试。本轮已生成独立 Windows release exe 和 x64 NSIS 安装包。

产物：`a4note-file-tree-pointer-drag-latest.exe`、`src-tauri/target/release/a4note-file-tree-pointer-drag-latest.exe`、`A4 Note_0.1.2_x64-setup-file-tree-pointer-drag-latest.exe`。免安装 exe SHA-256：`3F39F0A5AB8AE96C87BFA6C3C2979B37DBAEB9A56CADC8220766E516F3BF7101`。

已知风险/未完成：T3 预览服务不可用，未完成桌面端拖放截图；项目根目录不是可见条目，当前版本仅能放入树中显示的文件夹。需在 Windows 版确认不同缩放比例和长路径下的命中区域。

下一步：关闭旧程序后运行 `a4note-file-tree-pointer-drag-latest.exe`，测试文件和文件夹拖入目标文件夹、重名拒绝、非法目标拒绝以及打开中的 Markdown 标签路径同步。

## Markdown 属性拖动跟手与稳定占位（2026-09-03T09:46:56+08:00）

目标：让 Markdown 笔记属性拖动预览接近原属性条，锁定横向位置，仅垂直跟随鼠标，并保证待插入区域始终存在且不造成列表跳动。

已完成：

- 预览条使用原属性行的宽度、高度、三列布局和间距，拖动开始时记录鼠标抓取点，预览顶端按抓取点计算，不再使用固定偏移。
- 拖动阈值只计算 Y 轴位移；预览 X 和宽度固定在原属性行位置，左右移动不会改变拖动结果。
- 拖动源行从正常列表流中移除，并由唯一的等高彩色占位槽位替代；占位槽位按属性行垂直中心计算插入索引，拖动过程中不会消失或反复增减高度。
- 指针短暂离开属性面板时保留最后有效占位位置，释放到面板外则取消排序；释放时重新按最终 Y 坐标计算并写回 YAML 顺序。
- 修正文件树组件中已声明但未解构的 `onMoveEntry`，恢复整包 TypeScript 构建。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/features/explorer/FileTreePanel.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 和完整 `npm run verify` 均通过；完整验证包含 123 项 Rust 测试。

已知风险/未完成：T3 预览服务无法提供真实桌面截图，本轮未生成新的 Windows release exe；需要在 Windows 版确认预览条与鼠标抓取点、上下拖动和边界取消的实际手感。

下一步：运行最新 Windows 免安装版，测试属性条从首项、中间项、末项拖动到不同位置，以及左右移动时横向位置保持不变。

## Markdown 文件树移除目录横向导轨（2026-09-03T00:46:14+08:00）

目标：修正二级及更深层文件夹前残留的横向连接线，只保留 Chevron 展开控件和纵向彩虹导轨。

已完成：

- 删除 `FileTreePanel` 中的 branch 测量、状态和 JSX 渲染，不再为任何目录行绘制横向连接线。
- 删除 `.file-tree-guide-branch` 及其高亮、颜色映射和 reduced-motion CSS；纵向导轨和路径高亮保持不变。
- 文件夹层级仍通过 Chevron 和 20px 缩进表达，展开/折叠不会影响目录树点击区域。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/ui/styles/workbench.css`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status` 和独立 `npm run tauri:build` 均通过；`rg` 检查确认无 branch 类型、渲染或 CSS 引用。已生成免安装 exe 和 x64 NSIS 安装包。

产物：`a4note-file-tree-no-horizontal-latest.exe`、`src-tauri/target/release/a4note-file-tree-no-horizontal-latest.exe`、`A4 Note_0.1.2_x64-setup-file-tree-no-horizontal-latest.exe`。免安装 exe SHA-256：`C29783A55507BA7763FBD082180A8C1641DFB278935ED7E546A85D18EE8EC179`。

已知风险/未完成：T3 预览服务仍不可用，未完成桌面端截图；需要在 Windows 版确认二级文件夹前无横线、纵线连续且选中背景不遮挡。

下一步：关闭旧程序后运行 `a4note-file-tree-no-horizontal-latest.exe`，检查多层目录展开、折叠、悬浮和窄侧栏下的导轨观感。

## Markdown 文件树 Chevron 版 Windows 打包（2026-09-03T00:36:51+08:00）

目标：将当前文件树展开控件、导轨叠放和 20px 层级缩进修改打包为可直接运行的 Windows 版本。

已完成：

- 使用独立 Cargo 目标完成 Tauri release 编译和 x64 NSIS 安装包生成，未覆盖默认 `a4note.exe`。
- 免安装 exe 已复制到工作区根目录和 `src-tauri/target/release`，安装包已复制到根目录便于查找。

产物：`a4note-file-tree-chevron-latest.exe`、`src-tauri/target/release/a4note-file-tree-chevron-latest.exe`、`A4 Note_0.1.2_x64-setup-chevron-latest.exe`。免安装 exe SHA-256：`4ED211D26AD893CF6512BF770E3CD0278500356347A3BE542DB6F2EAD69E83AE`。

验证结果：Tauri release 构建成功；前端构建、架构检查和 Agent 状态检查在本轮改动前后均通过。

已知风险/未完成：T3 预览服务不可用，未完成桌面截图；需在 Windows 版确认新 Chevron、文件行无横杠、彩虹线不被选中背景遮挡以及多层目录间距。

下一步：关闭旧程序后运行 `a4note-file-tree-chevron-latest.exe` 做实际交互确认。

## 构建产物清理（2026-09-03T00:24:39+08:00）

目标：清理历史 exe 和编译中间文件，保留当前可交付版本。

已完成：

- 工作区根目录保留既有的 `a4note-file-tree-rainbow-refined-latest.exe`，并新增本轮交付的 `a4note-file-tree-inline-rename-no-delete-latest.exe`。
- 历史 exe、旧 release 副本、`dist`、`.build`、`src-tauri/.build`、`src-tauri/target` 和临时验证文件已移入 `.cleanup-build-artifacts-20260903`，未删除源码或文档。
- 清理采用可恢复隔离方式，避免永久删除误伤；当前 exe 未被覆盖。

验证结果：已确认根目录只剩当前最新版 exe；`npm run test:agent-status` 通过。

下一步：后续需要打包时重新运行 Tauri release 构建；完成后可继续使用同一隔离目录策略管理历史产物，并保留本轮交付 exe。

## Markdown 文件树 Chevron 与层级间距优化（2026-09-03T00:20:38+08:00）

目标：继续贴合参考图优化 Markdown 文件树的展开控件、导轨可见性和多层目录间距。

已完成：

- 文件夹展开标记改用与笔记属性一致的 Lucide `ChevronRight`，展开状态旋转向下。
- 文件行不再绘制横向 branch 连接线，去掉文件名前的横杠；目录之间仍保留层级连接关系。
- 彩虹导轨覆盖层提升到行背景之上，选中行的阴影不会遮挡纵向彩虹线；展开按钮置于连接线之上。
- 统一层级步进从 12px 调整为 20px，行内缩进、导轨和连接线共享同一 CSS 变量，避免多层目录挤在一起。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/ui/styles/workbench.css`
- `docs/notes/AGENT_STATUS.md`
- `plans/PROJECT_STATUS.json`

验证结果：`npm run build`、`npm run test:architecture` 和 `npm run test:agent-status` 均通过；本轮未重新打包 exe，沿用当前 `a4note-file-tree-rainbow-refined-latest.exe`。

已知风险/未完成：T3 预览服务仍不可用，未完成桌面截图；需要在 Windows 版确认 Chevron、20px 层级间距及选中行导轨叠放效果。

下一步：运行当前最新版 exe，检查多层文件夹展开、折叠和选中状态下彩虹导轨是否保持清晰。

## Markdown 笔记属性拖动预览（2026-09-03T00:09:56+08:00）

目标：继续完善 Markdown 笔记属性拖动体验，拖动时隐藏原属性内容，显示跟随指针的属性预览卡片，并用彩色占位块标识插入位置。

已完成：

- 属性图标拖动超过 5px 后生成包含图标、属性名、当前值和类型的浮动预览卡片，卡片通过 portal 渲染到 `document.body`，不拦截指针事件。
- 拖动源行仅保留原有布局高度，所有属性内容局部使用 `visibility: hidden` 隐藏，不修改 Markdown 源文件。
- 目标位置改为独立的彩色占位块和左侧强调条，不再使用横向细线；占位块支持行上半部/下半部前后插入判断。
- 拖动经过占位块时通过最近属性行回退定位，释放、取消和移出属性区域都会清理预览、占位和拖动状态；普通点击仍打开属性菜单，鼠标保持系统默认样式。
- Reader 静态校验新增预览卡片、源行隐藏和占位块断言。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:ui-state`、`npm run test:architecture` 和完整 `npm run verify` 均通过；完整验证包含 123 项 Rust 测试。

已知风险/未完成：本轮未生成新的 Windows release exe，也未完成桌面端真实鼠标截图；需要在 Windows 版确认预览卡片偏移、占位块观感及窄侧栏下的布局。

下一步：运行最新 Windows 免安装版，测试拖动到目标行上方/下方、拖出属性区取消、短按打开菜单以及长属性值截断。

## Markdown 文件树彩虹导轨细节优化（2026-09-03T00:09:12+08:00）

目标：按照参考效果收紧 Markdown 文件树的完整树状导轨，使用简洁 `>` 展开符号，并移除文件前的圆点/图标。

已完成：

- 展开目录的彩虹导轨改为从该目录行下方开始，延伸到整棵可见子树的最后一行；父级导轨连续贯穿子目录，折叠后子树及其导轨同步消失。
- 文件夹展开标记改为固定宽度的 `>`，展开时旋转为向下；文件行不再显示圆点，保留不可见对齐占位和父子短横向连接线。
- 导轨位置与新展开符号中心对齐，位置、长度、悬浮高亮和折叠变化均保留轻微过渡。
- 使用独立 Cargo 目标生成新的免安装版和 x64 NSIS 安装包，未覆盖旧的默认 `a4note.exe`。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/ui/styles/workbench.css`
- `plans/PROJECT_STATUS.json`
- `docs/notes/AGENT_STATUS.md`

验证结果：`npm run build`、`npm run test:architecture`、完整 `npm run verify`（包含 123 项 Rust 测试）均通过；T3 预览服务本轮返回 503，未完成桌面截图。

产物：`a4note-file-tree-rainbow-refined-latest.exe`、`src-tauri/target/release/a4note-file-tree-rainbow-refined-latest.exe`、`.build/tauri-file-tree-rainbow-refined/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。免安装 exe SHA-256：`D2C47F0DED23C7E29716AC8A4958AF3D83679E672CAC985FB307826C5BED3234`。

已知风险/未完成：无法通过 T3 预览完成真实悬浮与截图确认，需要在 Windows 版检查多层目录展开、折叠、窄侧栏和深色主题下的导轨长度及颜色观感。

下一步：运行 `a4note-file-tree-rainbow-refined-latest.exe`，重点确认文件树展开符号、父子导轨连续性和折叠后的线路收缩。

## Markdown 文件树右键操作（2026-09-02T23:57:38+08:00）

目标：为 Markdown 文件树增加文件右键菜单，提供删除、重命名和在资源管理器中打开三个操作。

已完成：

- 文件条目右键打开固定定位菜单，并高亮当前操作文件；目录和非 Markdown 文件不显示该菜单。
- 删除使用工作台统一确认弹窗，删除成功后关闭对应打开标签并刷新文件树。
- 重命名使用文件名主体输入，保留原 `.md`/`.markdown`/`.mdx` 扩展名；打开中的标签、资源 URI 和活动路径同步更新。
- “在资源管理器中打开”复用现有 `revealPath` 平台接口，失败信息回传当前场景状态。
- 独立 Markdown 工作区和工作台 Markdown 侧栏均已接入三个回调；补充架构静态回归断言。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/features/markdown/MarkdownWorkspaceScene.tsx`
- `src/ui/App.tsx`
- `src/ui/zh.ts`
- `src/ui/styles/workbench.css`
- `scripts/verify-architecture-boundaries.mjs`

验证结果：`npm run build`、`npm run test:ui-state`、`npm run test:architecture`、`npm run test:reader`、`npm run test:agent-status` 和完整 `npm run verify` 均通过；Rust 123 项测试通过。

已知风险/未完成：本轮未生成新的 Windows release exe，也未完成桌面端右键菜单截图；需要在 Windows 版确认确认弹窗、重命名标签同步和资源管理器定位。

下一步：基于当前源码生成带右键菜单的 Windows 免安装版，测试文件树文件的三个操作。

## Markdown 文件树统一彩虹导轨（2026-09-02T23:50:51+08:00）

目标：为 Markdown 笔记目录增加完整的树状层级导轨，避免每个目录块各自显示断开的竖线。

已完成：

- 在整个文件树滚动区域增加统一导轨层，按实际行位置绘制连续纵线和父子横向连接线。
- 按目录深度循环使用低饱和彩色导轨；当前文件或鼠标悬浮文件的父级路径会加粗并提高亮度。
- 导轨设置为不可交互，不改变文件打开、目录折叠、删除和定位的点击区域；窗口大小、字体和目录展开变化由 `ResizeObserver` 重新测量。
- 增加深色主题颜色和 `prefers-reduced-motion` 兼容处理。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、完整 `npm run verify` 和独立 `npm run tauri:build` 通过；包含前端架构、Reader、插件检查和 123 项 Rust 测试。

产物：`a4note-file-tree-rainbow-latest.exe`、`src-tauri/target/release/a4note-file-tree-rainbow-latest.exe`、`.build/tauri-file-tree-rainbow/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。免安装 exe SHA-256：`AA48E96308BACA52D2C5B45C4E8FF7A5F00336E1818F42008E5A6B313F5DD0BB`。

已知风险/未完成：T3 预览服务返回 503，未完成桌面截图和真实鼠标悬浮确认；需在 Windows 版确认连续导轨、折叠目录和不同主题下的实际观感。

下一步：运行 `a4note-file-tree-rainbow-latest.exe`，检查不同目录展开状态、侧栏宽度和明暗主题下的完整导轨观感，确认彩色线路密度符合预期。

## WebView2 原生滚动条路径修正并重新打包（2026-09-02T23:40:51+08:00）

目标：解决上一版桌面程序仍显示滚动条上下三角的问题。

原因：新版 Chromium/WebView2 在元素设置非默认 `scrollbar-width: thin` 或 `scrollbar-color` 时，会优先使用原生滚动条，导致 `::-webkit-scrollbar-button` 隐藏规则不参与渲染。

已完成：

- 将全局滚动条属性改为 `scrollbar-width: auto; scrollbar-color: auto;`，让 WebView2 使用项目定义的 8px WebKit 滚动条。
- 将场景上下文列表和 CodeMirror 滚动区域的 `scrollbar-width: thin` 改为 `auto`，避免局部规则重新触发原生路径。
- 保留 `scrollbar-width: none` 的目录、标签和 PDF 隐藏滚动条规则，以及方向按钮的 `display: none !important`、零尺寸和无背景规则。
- 使用独立 Cargo 目标重新生成免安装程序和 x64 NSIS 安装包，未覆盖可能被旧进程锁定的默认 `a4note.exe`。

修改文件：

- `src/ui/styles/base.css`
- `src/ui/styles/workbench.css`
- `plans/PROJECT_STATUS.json`
- `docs/notes/AGENT_STATUS.md`

验证结果：`npm run build`、`npm run test:architecture`、`npm run verify`、`npm run test:agent-status` 和独立 `npm run tauri:build` 均通过；完整验证包含 123 项 Rust 测试。

产物：`a4note-scrollbar-no-arrows-v2-latest.exe`、`src-tauri/target/release/a4note-scrollbar-no-arrows-v2-latest.exe`、`.build/tauri-scrollbar-no-arrows-v2/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。免安装 exe SHA-256：`1330814BD4EFAEF1759370F8D60867385E651FF92B4882CADA94E53B48F8FC61`。

已知风险/未完成：T3 预览服务仍不可用；用户已在 Windows 免安装版确认 WebView2 顶部和底部三角按钮已消失。

下一步：滚动条三角按钮修复已完成；后续桌面端改动继续基于当前 v2 版本验证。

## Pointer Events 拖拽回归复核（2026-09-02T23:25:18+08:00）

目标：继续确认 Markdown 属性图标拖拽修复在构建和跨模块检查中保持有效。

已完成：

- 复核属性图标使用 Pointer Events 窗口级监听，HTML5 原生拖动已关闭，图标保持系统默认鼠标样式。
- `npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 和完整 `npm run verify` 均通过。
- 完整验证包含 123 项 Rust 测试；协作预览打开接口本轮返回 503，仍需用户在 Windows 免安装版做真实鼠标拖动确认。

下一步：运行 `a4note-property-pointer-drag-latest.exe`，分别测试属性图标短按菜单、拖到目标行上半部/下半部、拖出属性区取消和鼠标光标样式。

## Pointer Events 拖拽修复并打包完成（2026-09-02T23:15:05+08:00）

目标：修复属性图标无法拖动的问题，取消手形光标，并交付可直接运行的 Windows 程序。

已完成：

- 属性排序改用 Pointer Events 窗口级监听，拖动超过 5px 后启动，鼠标移出属性行仍可继续操作。
- 显式关闭属性图标的 HTML5 `draggable`，并将光标固定为系统默认样式；普通点击仍打开属性菜单。
- 目标行上半部/下半部插入前后、YAML 顺序保存和拖动后菜单抑制逻辑保持不变。
- 生成独立 Windows release 免安装程序和 x64 NSIS 安装包，未覆盖可能被旧进程锁定的默认 `a4note.exe`。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status`、完整 `npm run verify` 和独立 `npm run tauri:build` 通过；Rust 123 项测试通过。

产物：`a4note-property-pointer-drag-latest.exe`、`src-tauri/target/release/a4note-property-pointer-drag-latest.exe`、`.build/tauri-property-pointer-20260902/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。免安装 exe SHA-256：`A9715D30D173B548EC2FD0F2C672707F6EFDF403BC8A9B2623E8B1227D4B1EBC`。

已知风险/未完成：T3 协作预览打开请求返回 503，未完成真实桌面鼠标截图；需在 Windows 版确认短按菜单、拖动到目标行上方/下方以及拖到行外取消。

下一步：运行 `a4note-property-pointer-drag-latest.exe`，打开含多个属性的 Markdown 笔记进行上述三组操作。

## Markdown 属性拖动改用 Pointer Events（2026-09-02T23:07:59+08:00）

目标：修复 Tauri WebView 中属性图标无法拖动的问题，并取消拖动时的手形鼠标样式。

已完成：

- 移除对 HTML5 `draggable` 按钮拖动的依赖，改用 Pointer Events 在窗口级监听移动、释放和取消事件，鼠标移出属性行后仍能继续拖动。
- 仅在指针移动超过 5px 后进入拖动状态，普通点击属性图标继续打开属性菜单。
- 保留目标行上半部/下半部插入前后和 YAML 顺序保存逻辑；拖动期间禁止默认文本选择。
- 属性图标光标恢复为系统默认样式，关闭 `grab/grabbing` 手形光标。
- Reader 静态回归断言同步覆盖 Pointer Events 处理器、`draggable={false}` 防护和默认鼠标光标。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 和完整 `npm run verify` 通过；Rust 123 项测试通过。

已知风险/未完成：T3 协作预览打开请求仍返回 503，无法完成真实桌面鼠标拖动截图；本轮未生成新的 Windows release exe。

下一步：在 Windows 版测试属性图标的短按菜单、拖动到目标行上方/下方、拖动到行外取消以及触摸板操作。

## WebView2 滚动条三角按钮移除并重新打包（2026-09-02T23:05:00+08:00）

目标：移除桌面版 WebView2 滚动条顶部和底部的原生三角按钮，同时保持当前简洁滑块和贴边布局。

已完成：

- 为通用、单按钮、垂直/水平递增递减和起止方向 `::-webkit-scrollbar-button` 伪元素增加定向规则。
- 统一使用 `display: none !important`、零尺寸、无边距/边框/背景，覆盖 WebView2 可能保留的方向按钮变体。
- 保持 8px 透明轨道、圆角胶囊滑块和文件树贴近侧栏右边缘的既有样式不变。
- 使用独立 Cargo 目标重新生成免安装程序和 x64 NSIS 安装包，未覆盖可能被旧进程锁定的默认 `a4note.exe`。

修改文件：

- `src/ui/styles/base.css`
- `plans/PROJECT_STATUS.json`
- `docs/notes/AGENT_STATUS.md`

验证结果：`npm run build`、`npm run test:architecture`、`npm run verify`、`npm run test:agent-status` 和独立 `npm run tauri:build` 均通过；完整验证包含 123 项 Rust 测试。

产物：`a4note-scrollbar-no-arrows-latest.exe`、`src-tauri/target/release/a4note-scrollbar-no-arrows-latest.exe`、`.build/tauri-scrollbar-no-arrows/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。免安装 exe SHA-256：`79926703569D30026267F3B757BA0850D0794E6341290AD1DA8A777BF4774F86`。

已知风险/未完成：T3 预览服务仍不可用，未完成自动化桌面截图；需在 Windows 免安装版实际确认 WebView2 不再显示滚动条三角。

下一步：关闭旧版程序后运行 `a4note-scrollbar-no-arrows-latest.exe`，在文件树和其他可滚动区域检查顶部/底部箭头、滑块拖动和侧栏贴边效果。

## 文件树滚动条简洁贴边样式打包完成（2026-09-02T22:56:00+08:00）

目标：重新设计截图中侧栏文件树的滚动条，去掉两端三角，减少占用空间并贴近侧栏右边缘。

已完成：

- 全局滚动条改为 8px 紧凑尺寸、透明轨道和简洁圆角胶囊滑块；默认低对比，悬停和按住时使用主题强调色。
- 保留并明确隐藏 WebView 原生滚动条两端按钮，不显示上下三角。
- 文件树滚动区域取消额外稳定 gutter，并向工作区侧栏内边缘延伸 10px；内容保留等量右侧内距，避免文件名和删除按钮被遮挡。
- 重新生成独立 Windows release 免安装程序和 x64 NSIS 安装包，未覆盖可能被旧进程锁定的默认 `a4note.exe`。

修改文件：

- `src/ui/styles/base.css`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status`、完整 `npm run verify` 和独立 `npm run tauri:build` 通过；Rust 123 项测试通过。

产物：`a4note-scrollbar-style-latest.exe`、`src-tauri/target/release/a4note-scrollbar-style-latest.exe`、`.build/tauri-scrollbar-style/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。免安装 exe SHA-256：`A856D052B29ADBC148A61A8D181FA42CB4F96247B1FBAF013322A34B11BA1C74`。

已知风险/未完成：T3 预览服务返回 503，未完成桌面截图；需要在 Windows 版确认滚动条与侧栏右边缘的实际间距以及不同主题下的对比度。

下一步：运行 `a4note-scrollbar-style-latest.exe`，确认文件树滚动条无三角、滑块简洁且贴近侧栏右边缘。

## Markdown 属性拖拽排序验证完成（2026-09-02T22:38:26+08:00）

目标：让 Markdown 笔记属性可以通过左侧图标拖动调整 YAML 属性顺序，同时保持属性菜单点击和编辑输入稳定。

已完成：

- 属性行仅允许从左侧图标启动原生拖动，普通点击图标仍打开属性类型菜单。
- 拖到目标行上半部插入前方，拖到下半部插入后方；拖动中显示插入线和当前行的半透明状态。
- 放手后按新的顺序重写 frontmatter，沿用现有自动保存和最近属性记录逻辑；拖动完成后的 click 不会误打开菜单。
- Reader 静态回归断言已覆盖拖动处理器、目标位置、插入样式和正确的工作台样式文件引用。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-reader-rendering.mjs`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:reader`、`npm run test:agent-status` 和完整 `npm run verify` 通过；Rust 123 项测试通过。

已知风险/未完成：T3 协作预览打开请求返回 503，本轮无法完成桌面截图和真实鼠标拖动确认；默认 `src-tauri/target/release/a4note.exe` 未覆盖，也未生成新的 Windows release 包。

下一步：在 Windows 版打开含多个属性的 Markdown 笔记，拖动图标分别测试目标行上方/下方、首行/末行和拖动后再次点击菜单；如需交付桌面程序，再使用独立 Cargo target 生成 exe。

## Markdown 文件树隐藏文件大小（2026-09-02T22:35:26+08:00）

目标：让 Markdown 笔记目录保持简洁，不在文件名右侧显示文件大小。

已完成：

- 移除文件树行中的文件大小文本，仅影响视觉展示。
- 保留文件条目的 `size` 元数据和现有排序、打开、删除、定位逻辑，不影响文件管理功能。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`

验证结果：`npm run build`、`npm run test:agent-status` 通过；本轮未重新打包 Windows exe。

已知风险/未完成：未执行新的桌面截图，需在 Markdown 场景确认长文件名可用空间增加且工具栏和删除按钮布局正常。

下一步：如需桌面验证，运行现有最新免安装版；下次需要交付 exe 时再基于此改动重新构建。

## 侧栏最大宽度扩展至 480px 并打包完成（2026-09-02T22:32:04+08:00）

目标：允许用户将桌面端左侧栏继续向右扩展，为长文件名和工作区工具提供更多空间。

已完成：

- 将工作台侧栏最大宽度从 `360px` 提高到 `480px`；拖动、持久化恢复、标题栏 leading 区继续共用同一宽度常量。
- 保持 `300px` 最小宽度和窄窗口响应式规则不变，侧栏变宽时主内容仍使用剩余空间。
- 重新生成独立 Windows release 免安装程序和 x64 NSIS 安装包，未覆盖可能被旧进程锁定的默认 `a4note.exe`。

修改文件：

- `src/workbench/WorkbenchShell.tsx`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status`、完整 `npm run verify` 和独立 `npm run tauri:build` 通过；Rust 123 项测试通过。

产物：`a4note-sidebar-width-480-latest.exe`、`src-tauri/target/release/a4note-sidebar-width-480-latest.exe`、`.build/tauri-sidebar-drag-preview/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。免安装 exe SHA-256：`216D6183CD67AFFEB23AC276ADBD916C69DA30C861F6A3A1B21BC676ECE650C0`。

已知风险/未完成：未执行新的桌面截图，需在 Windows 版确认 480px 宽侧栏下标题栏和主内容的实际观感；默认 `src-tauri/target/release/a4note.exe` 未覆盖。

下一步：运行 `a4note-sidebar-width-480-latest.exe`，拖动分隔线确认可以从当前宽度继续扩展至约 480px，并检查 Markdown 文件树内容可读性。

## 侧栏拖动改为合成层预览并打包完成（2026-09-02T22:21:59+08:00）

目标：消除拖动侧栏时工作台内容每帧重排造成的延迟和卡顿。

已完成：

- 拖动期间不再更新真实 `--sidebar-width`，只使用分隔线的 `translate3d` 合成层跟随指针，避免标题栏、文件树、PDF 和 Markdown 正文反复布局。
- 松开或取消拖动时才提交最终宽度、持久化状态并清除预览位移；分隔线在拖动中加粗显示，便于识别当前预览位置。
- 重新生成独立 Windows release 免安装程序和 x64 NSIS 安装包，未覆盖可能被旧进程锁定的默认 `a4note.exe`。

修改文件：

- `src/workbench/WorkbenchShell.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status`、完整 `npm run verify` 和独立 `npm run tauri:build` 通过；Rust 123 项测试通过。

产物：`a4note-sidebar-drag-preview-latest.exe`、`src-tauri/target/release/a4note-sidebar-drag-preview-latest.exe`、`.build/tauri-sidebar-drag-preview/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。免安装 exe SHA-256：`C02B901FD36584198ECC67A1AE0BCC5600AD5951255792FD6F5F53D82072D042`。

已知风险/未完成：未完成本轮桌面截图，需要在 Windows 版实际确认手柄跟手和松手后的布局切换；默认 `src-tauri/target/release/a4note.exe` 未覆盖。

下一步：运行 `a4note-sidebar-drag-preview-latest.exe`，拖动侧栏分隔线确认预览位移无明显延迟，松手后正文和标题栏宽度正确更新。

## 顶部返回场景按钮右对齐打包完成（2026-09-02T22:07:17+08:00）

目标：将顶部“返回场景”按钮固定在左侧标题区域的最右端，同时保持 A4 Note 品牌和侧栏按钮完整显示。

已完成：

- 调整 `WindowTitleBar` 的元素顺序，在 A4 Note 与返回场景入口之间使用可伸缩拖拽区，将入口推到标题区域右侧。
- 重新生成独立 Windows release exe 和 x64 NSIS 安装包，未覆盖可能被旧进程锁定的默认 `a4note.exe`。
- 根目录和 `src-tauri/target/release` 的免安装 exe 使用同一构建产物，SHA-256 为 `CC6D34E07A93751C76E526A6798023CC4D265844E2A2365E65E4BAFBE7E7A3A6`。

修改文件：

- `src/workbench/WindowTitleBar.tsx`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status` 和独立 `npm run tauri:build` 通过。

产物：`a4note-titlebar-return-scene-latest.exe`、`src-tauri/target/release/a4note-titlebar-return-scene-latest.exe`、`.build/tauri-titlebar-action/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。

已知风险/未完成：T3 预览接口未用于本轮桌面截图，需要在 Windows 版实际确认按钮右对齐后的观感；默认 `src-tauri/target/release/a4note.exe` 未覆盖。

下一步：运行 `a4note-titlebar-return-scene-latest.exe`，进入 Markdown 工作区确认返回场景按钮位于左侧标题区域右端，并检查窄侧栏下整行内容不溢出。

## 顶部返回场景入口与侧栏最小宽度打包完成（2026-09-02T21:40:09+08:00）

目标：放大“返回场景”文字，将入口移动到顶部 A4 Note 右侧，并保证侧栏收窄时顶部内容始终完整显示。

已完成：

- `WorkbenchShell`/`WindowTitleBar` 增加标题栏左侧操作插槽，工作区的“返回场景”使用返回箭头和更大的界面控制字号显示在 A4 Note 右侧。
- 移除文件树工作区标题中的重复返回按钮。
- 侧栏拖拽、持久化恢复、标题栏 leading 区和窄窗口布局统一使用 `300px` 最小宽度；品牌名称和按钮保持不可压缩单行显示。
- 独立 Windows release 构建已完成，免安装 exe SHA-256 为 `F5E6F2E0679206DDD94512D10EC716A4FA8CB118379F996C8B95E70762935F5C`。

修改文件：

- `src/workbench/WindowTitleBar.tsx`
- `src/workbench/WorkbenchShell.tsx`
- `src/workbench/ProjectSidebar.tsx`
- `src/ui/App.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run verify`、`npm run test:architecture`、`npm run test:agent-status` 和独立 `npm run tauri:build` 通过；完整验证包含 123 项 Rust 测试。

产物：`a4note-titlebar-return-scene-latest.exe`、`src-tauri/target/release/a4note-titlebar-return-scene-latest.exe`、`.build/tauri-titlebar-action/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。

已知风险/未完成：T3 预览打开请求返回 503，未完成本轮桌面截图；默认 `src-tauri/target/release/a4note.exe` 未覆盖。

下一步：运行 `a4note-titlebar-return-scene-latest.exe`，确认不同界面字号和 300px 最小宽度下顶部内容的实际观感。

## 场景名称与工作区分隔（2026-09-02T21:36:42+08:00）

目标：缩短 Markdown 场景名称，并增强场景区与工作区之间的视觉分隔。

已完成：

- Markdown 场景显示名改为“笔记”，内部 `markdown` 场景 ID 和插件 ID 保持不变。
- 场景区增加底部留白，工作区区域增加轻量上边界和内边距，两个区域层次更清晰。
- 重新生成独立 Windows release exe 和 x64 NSIS 安装包；由于旧的场景多列 exe 正在运行，另存为新的免安装文件名。

修改文件：

- `src/core/markdownPlugin.ts`
- `src/ui/styles/workbench.css`

验证结果：`npm run verify`、`npm run test:scene-plugins`、`npm run test:architecture` 和 `npm run test:agent-status` 通过；Rust 123 项测试通过。

产物：

- `a4note-note-label-latest.exe`
- `src-tauri/target/release/a4note-note-label-latest.exe`
- `.build/tauri-scene-multi-column/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`

已知风险/未完成：T3 预览服务本轮不可用，未完成桌面截图；旧的 `a4note-scene-multi-column-latest.exe` 进程仍锁定原文件，未强制终止。

下一步：关闭当前旧版程序后运行 `a4note-note-label-latest.exe`，确认场景名称不再截断且“工作区”与场景区的间距符合预期。

## Smooth sidebar resizing (2026-09-02T21:47:06+08:00)

目标：消除侧栏拖动时外层布局过渡造成的明显延迟，并交付可直接运行的 Windows `exe`。

已完成：

- 拖动期间关闭工作台网格和标题栏左区的 `240ms` 过渡，宽度跟随指针即时更新。
- 拖动手柄增加 `touch-action: none` 和 `user-select: none`，避免浏览器默认手势干扰指针事件。
- 拖动期间关闭分隔线过渡并声明对应布局属性的 `will-change`，松手后恢复正常动画。
- 重新生成并复制 `a4note-sidebar-drag-smooth-latest.exe` 到工作区根目录和 `src-tauri/target/release/`。

修改文件：

- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run verify`、`npm run test:architecture`、`npm run test:agent-status` 和独立 `npm run tauri:build` 通过；免安装 exe SHA-256 为 `53C7D7765F5BCA94B2FCA2A75ADA2CC7DC5685AF380E5313D227CEDD616BF60A`。

已知风险/未完成：未执行新的桌面截图；需在 Windows 版实际拖动侧栏确认体感延迟已消除。

下一步：用户运行 `a4note-sidebar-drag-smooth-latest.exe`，拖动侧栏分隔线检查实时跟手效果。

## 顶部返回场景入口与侧栏最小宽度（2026-09-02T21:31:20+08:00）

目标：放大“返回场景”文字，将入口移动到顶部 A4 Note 右侧，并保证侧栏收窄时顶部内容始终完整显示。

已完成：

- `WorkbenchShell`/`WindowTitleBar` 增加标题栏左侧操作插槽，Markdown 工作区的“返回场景”使用返回箭头和更大的界面控制字号显示在 A4 Note 右侧。
- 移除文件树顶部旧的“返回场景”按钮，避免同一操作在侧栏内重复出现。
- 侧栏拖拽、持久化恢复、标题栏 leading 区和窄窗口布局统一使用 `300px` 最小宽度；按钮和品牌名称保持不可压缩单行显示。
- 侧栏折叠时保留现有的品牌隐藏行为，返回入口随工作区入口隐藏，重新展开侧栏后恢复。

修改文件：

- `src/workbench/WindowTitleBar.tsx`
- `src/workbench/WorkbenchShell.tsx`
- `src/workbench/ProjectSidebar.tsx`
- `src/ui/App.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run verify`、`npm run test:architecture`、`npm run test:agent-status` 通过；完整验证包含 123 项 Rust 测试。独立 `npm run tauri:build` 通过。

产物：

- `a4note-titlebar-return-scene-latest.exe`
- `src-tauri/target/release/a4note-titlebar-return-scene-latest.exe`
- `.build/tauri-titlebar-action/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`

已知风险/未完成：T3 桌面预览接口此前持续返回 503，未完成本轮截图；需要用户在 Windows 版确认不同界面字号下顶部按钮的实际观感。默认 `src-tauri/target/release/a4note.exe` 未覆盖。

下一步：运行 `a4note-titlebar-return-scene-latest.exe`，进入 Markdown 文件树确认顶部“返回场景”位置、文字大小以及 300px 最小宽度下的完整显示。

## 场景图标网格内边距修正（2026-09-02T21:17:08+08:00）

目标：消除场景图标网格左侧异常空白，让每列真正居中并随侧栏宽度自适应分配。

已完成：

- 恢复场景列表的 `padding: 0`、`margin` 和 `list-style` 重置，去除浏览器默认 `ul` 左内边距。
- 场景网格明确占满侧栏可用宽度，列轨道使用 `auto-fit` 和安全最小宽度，窄侧栏不会溢出。
- 继续使用工作台侧栏最小/最大宽度限制，侧栏拖动时场景列数随可用宽度变化。

修改文件：

- `src/ui/styles/workbench.css`
- `scripts/verify-scene-plugin-wiring.mjs`

验证结果：`npm run verify` 通过，包含 123 项 Rust 测试；独立 `npm run tauri:build` 通过并生成 exe 与 x64 NSIS 安装包。

产物已覆盖为最新版本：

- `a4note-scene-multi-column-latest.exe`
- `src-tauri/target/release/a4note-scene-multi-column-latest.exe`
- `.build/tauri-scene-multi-column/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`

已知风险/未完成：T3 预览接口本轮返回 503，未完成桌面截图；需用户在 Windows 版确认不同侧栏宽度下的列数和图标居中效果。默认 `src-tauri/target/release/a4note.exe` 仍可能被旧运行实例锁定。

下一步：关闭旧版程序后运行 `a4note-scene-multi-column-latest.exe`，确认场景图标从侧栏左边缘开始均匀排列。

## Sidebar width constraint and Windows package (2026-09-02T21:10:46+08:00)

目标：侧栏收窄时保持场景选择区的两列布局和顶部控制区完整可用，并交付可直接运行的 Windows `exe`。

已完成：

- 侧栏拖拽下限、持久化恢复和窄窗口布局统一为 `244px`；宽度仍可扩展到 `360px`。
- 生成并复制免安装程序 `a4note-sidebar-min-width-latest.exe` 到工作区根目录和 `src-tauri/target/release/`。
- 独立构建目录保留在 `.build/tauri-sidebar-min-width-20260902/`，旧运行中的 `a4note.exe` 未被覆盖。

修改文件：

- `src/workbench/WorkbenchShell.tsx`
- `src/workbench/index.ts`
- `src/ui/App.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status` 和 `npm run tauri:build` 通过；免安装 exe SHA-256 为 `F3EF93A307B4635DA749E36E8F24B5CA3D71BB8A16FF232F231A21505D41A017`。

已知风险/未完成：未执行新的桌面截图；需在 Windows 版拖动侧栏到最窄位置确认场景网格和文件树观感。

下一步：用户运行 `a4note-sidebar-min-width-latest.exe`，确认侧栏最窄宽度下两个区域均保持完整显示。

## Sidebar minimum width guard (2026-09-02T21:03:18+08:00)

目标：侧栏收窄时保持场景选择区的两列布局和顶部控制区完整可用。

已完成：

- 将侧栏拖拽和持久化宽度下限统一为 `244px`，避免旧的 `208px` 宽度把场景项压成错误布局。
- 窄窗口布局使用 `max(244px, var(--sidebar-width))`，保留用户向右扩展侧栏的能力。
- 导出统一的工作台侧栏宽度常量，避免拖拽、恢复和布局规则分叉。

修改文件：

- `src/workbench/WorkbenchShell.tsx`
- `src/workbench/index.ts`
- `src/ui/App.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture` 和 `npm run test:agent-status` 通过。

已知风险/未完成：未执行新的桌面截图；需在 Windows 版拖动侧栏到最窄位置确认场景网格和文件树观感。

下一步：生成包含本次侧栏最小宽度修正的 Windows 免安装 `exe`。

## 场景图标多列布局（2026-09-02T21:00:34+08:00）

目标：让场景选择区域在同一行显示更多图标，同时保持当前图标尺寸和中文名称布局。

已完成：

- 修正通用 `.workbench-tool-list` 的 flex 规则覆盖场景网格的问题，场景项现在真正使用 CSS Grid。
- 场景网格改为 `auto-fit` 响应式列数：窄侧栏保持至少两列，侧栏拉宽后自动增加列数。
- 每个场景项保留当前图标尺寸、上下排列和活动/悬停反馈；打开项列表继续跨满整行。
- 更新场景插件接线校验，覆盖响应式多列网格和通用列表样式隔离。

修改文件：

- `src/ui/styles/workbench.css`
- `scripts/verify-scene-plugin-wiring.mjs`

验证结果：`npm run build`、`npm run verify`、`npm run test:scene-plugins`、`npm run test:architecture` 和 `npm run test:agent-status` 通过；Rust 123 项测试通过。

产物：

- `a4note-scene-multi-column-latest.exe`
- `src-tauri/target/release/a4note-scene-multi-column-latest.exe`
- `.build/tauri-scene-multi-column/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`

已知风险/未完成：未执行桌面截图；需在 Windows 版确认不同侧栏宽度下的列数和长场景名称截断效果。默认 `src-tauri/target/release/a4note.exe` 仍是旧运行实例可能锁定的文件。

下一步：关闭旧版程序后运行 `a4note-scene-multi-column-latest.exe`，确认场景图标按侧栏宽度自动多列排列。

## Markdown 文件树字号与工具栏尺寸（2026-09-02T20:57:21+08:00）

目标：提高 Markdown 文件树在默认界面字号下的可读性，并扩大顶部操作按钮。

已完成：

- 文件名和文件夹名从界面字号的约 69% 提升至约 89%：默认 18px 界面字号时为 16px。
- 文件大小从约 58% 提升至约 72%：默认情况下为 13px。
- 顶部新建笔记、新建文件夹、排序、定位和全部展开/折叠按钮提升至默认 36px 点击区域，图标提升至约 21px。
- 目录文字、文件大小和按钮尺寸均继续随“界面字号”滑条变化；按钮设置最大 40px，避免窄侧栏溢出。

修改文件：

- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture` 通过。

已知风险/未完成：未执行新的桌面截图；需在最新 Windows 程序中确认长文件名在窄侧栏下的截断效果。

## 阅读子标签旧程序确认（2026-09-02T20:40:51+08:00）

结果：用户截图对应的运行进程仍是 `src-tauri/target/release/a4note.exe`（2026-08-29 旧文件），不是本轮生成的场景平铺版本。

- 最新免安装版已复制到工作区根目录 `a4note-reader-sidebar-scene-tiles-latest.exe`。
- 同一版本已复制到 `src-tauri/target/release/a4note-scene-tiles-latest.exe`，便于在 release 目录中区分旧文件。
- 最新安装包位于 `.build/tauri-scene-tiles/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。

已知风险/未完成：旧 `a4note.exe` 当前仍在运行并被系统锁定，不能直接覆盖；关闭旧程序后可删除旧快捷方式或改用带 `latest` 的新文件。

## 阅读标签归属与场景平铺构建（2026-09-02T20:26:29+08:00）

目标：移除全局导航中的阅读 PDF 子标签，并将场景选择改为大图标平铺布局。

已完成：

- 阅读 PDF/阅读文档标签不再显示在左侧全局“阅读”场景下方，只在阅读场景整栏侧栏中管理。
- 场景高亮逻辑改为仅引用全局实际可见的子项，阅读场景不会因隐藏子标签丢失选中状态。
- 已选场景改为两列大图标网格，图标在上、中文场景名在下，保留活动、悬停和键盘焦点反馈。
- 场景插件接线校验增加阅读标签归属和场景平铺布局回归断言。
- 使用独立 Cargo 输出目录完成 Windows release 构建，避免默认 release exe 被旧进程占用。

修改文件：

- `src/ui/App.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-scene-plugin-wiring.mjs`

产物：

- `a4note-reader-sidebar-scene-tiles-latest.exe`
- `.build/tauri-scene-tiles/release/a4note.exe`
- `.build/tauri-scene-tiles/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:scene-plugins`、`npm run test:ui-state`、`npm run test:agent-status`、完整 `npm run verify`（123 项 Rust 测试）和独立 `npm run tauri:build` 均通过。

已知风险/未完成：未执行新的桌面预览截图，需用户在 Windows 版本确认场景网格在窄侧栏下的观感，以及阅读侧栏标签的切换/关闭体验。

下一步：用户运行 `a4note-reader-sidebar-scene-tiles-latest.exe` 进行界面确认；默认 `src-tauri/target/release/a4note.exe` 仍可能被旧运行实例锁定。

## Markdown 文件树工具栏布局收尾（2026-08-29T22:31:20+08:00）

目标：完成目录树基础工具栏交付前的布局检查，并确保文件删除按钮不会撑开文件行。

已完成：

- 文件树顶部保留新建笔记、新建文件夹、排序、定位当前文件和全部展开/折叠五个操作；项目目录标题、隐藏文件开关和旧刷新按钮均未恢复。
- 文件行与 Markdown 删除按钮改为同一 flex 行布局，删除按钮仅在悬停或键盘聚焦时显示，不再造成横向溢出或换行。
- 预览服务本轮返回 503，未能执行桌面截图；以生产构建、完整验证和 Rust 测试覆盖。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run verify`、`npm run test:reader`、`npm run test:architecture`、`npm run test:ui-state`、`npm run test:agent-status` 和 `cargo test --manifest-path src-tauri/Cargo.toml` 通过（123 项 Rust 测试）。

已知风险/未完成：T3 桌面预览接口返回 503，需用户在 Windows 版本中确认图标排列和窄窗口观感；文件树右键菜单和外部修改后的手动刷新仍未实现。

下一步：生成独立 Windows release exe，交付用户测试。

## Markdown 链接与嵌套列表交互（2026-08-29T22:20:04+08:00）

目标：让实时预览和源码展开中的 Markdown 链接可直接打开，并让链接源码只在光标位于链接左右边界时显示；同时修正无序/有序列表的嵌套缩进、层级样式和有序列表独立编号。

已完成：

- 实时预览链接替换为可点击的链接组件，桌面端通过受控外部链接接口打开，浏览器预览回退到新窗口。
- 链接源码显示改为边界触发，点击已渲染链接不会再触发源码展示；图片链接不会被误识别。
- 列表按源文本缩进计算层级，子级获得独立缩进、marker 和层级线；有序列表按层级维护独立计数器，子列表从 1 重新编号。
- 保留 CodeMirror Markdown 的 Enter 自动续接列表、Tab/Shift+Tab 缩进和反缩进行为。

修改文件：

- `src/features/explorer/MarkdownLivePreviewEditor.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status`、完整 `npm run verify` 已通过（含 123 项 Rust 测试）；开发预览服务曾启动于 `http://localhost:1420/` 后已停止，T3 预览接口本轮返回 503，未完成浏览器截图。

已知风险/未完成：需在桌面端用示例文档确认链接点击、裸 URL、有序列表回车编号和 Tab 子列表的实际观感；源码边界触发依赖 CodeMirror 光标位置。

## Markdown 文件树基础工具栏（2026-08-29T22:13:36+08:00）

目标：完善 Markdown 文件树的基础操作入口，移除不需要的项目标题、隐藏文件和旧刷新控件。

已完成：

- 文件树顶部改为纯操作工具栏：新建笔记、新建文件夹、排序、自动显示当前文件、全部展开/折叠。
- 排序支持文件名正序/倒序、编辑时间正序/倒序、创建时间正序/倒序；目录始终排在文件前。
- 打开 Markdown 文档后，文件树会高亮当前文件；定位按钮会逐级加载并展开父目录，再滚动到当前文件。
- 新建笔记支持根目录和当前文件夹；新建文件夹使用 Rust 文件系统接口并校验名称和父目录。
- 移除显示隐藏文件开关、项目目录标题和原刷新按钮；保留已有 Markdown 删除按钮。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/features/markdown/MarkdownWorkspaceScene.tsx`
- `src/ui/App.tsx`
- `src/ui/styles/workbench.css`
- `src/platform/projects/projectApi.ts`
- `src/platform/projects/index.ts`
- `src-tauri/src/workspace_fs.rs`
- `src-tauri/src/project_commands.rs`
- `src-tauri/src/lib.rs`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:ui-state`、`npm run test:agent-status` 和 `cargo test --manifest-path src-tauri/Cargo.toml workspace_fs::tests` 通过（11 项）。

已知风险/未完成：本轮未加入文件树右键菜单；当前工作区其他入口仍可通过已有独立按钮打开文件、资源管理器和 VS Code。新建文件夹后的刷新依赖当前目录重新读取，外部程序修改文件时暂无手动刷新按钮。

下一步：在桌面版确认工具栏图标位置、排序弹出菜单和嵌套目录定位；随后补文件树右键菜单和完整交互测试。

## Markdown 笔记属性行布局微调（2026-08-29T21:54:48+08:00）

目标：修正 Markdown 笔记属性行的图标垂直对齐，收紧图标与属性名距离，并将属性名与属性值之间的留白扩大约一倍。

已完成：

- 属性名列使用 `minmax(78px, 156px)`，在空间足够时扩大属性名和值之间的布局留白，窄窗口保留可用的最小宽度。
- 属性行列间距从 `9px` 调整为 `4px`，让图标和属性名称更紧凑。
- 图标按钮与属性名称输入框统一为 `38px` 高，并将图标 SVG 设为块级渲染，避免字体基线造成上下偏移。

修改文件：

- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status` 均通过。

下一步：用户在桌面端打开包含多个属性的 Markdown 笔记，确认图标、名称和值列的视觉间距。

## Markdown 目录树功能审查（2026-08-29T21:44:27+08:00）

目标：检查 Markdown 目录树当前实现，区分已支持能力和仍未完善的交互、解析与验证范围。

结论：

- 当前支持 ATX 标题（`#` 至 `######`）、排除围栏代码块、层级缩进、独立滚动、编辑/阅读模式点击定位，以及排除独立文件标题。
- 目录仍是平面按钮列表，不是真正可展开/收起的树；没有滚动同步高亮，也没有点击隐藏在正文折叠区域内的子标题时自动展开父标题。
- 标题解析只覆盖 ATX 正则，未覆盖 Setext、引用/列表嵌套标题和完整 Markdown AST 文本；阅读模式的 HTML/Markdown 规范化还可能使行号定位失配。
- 目录打开状态、当前标题和滚动位置未持久化；没有搜索、层级过滤、全部展开/收起和宽度调整。
- 目录没有 `tree/treeitem` 语义、`aria-level`/`aria-expanded` 和树形键盘导航；现有 Reader 校验未覆盖目录行为。

修改文件：仅更新状态文件，未修改产品代码。

验证结果：`npm run test:reader`、`npm run build` 通过；现有校验主要覆盖渲染和标题删除，不覆盖目录滚动、折叠、无障碍和持久化。

下一步：优先实现滚动同步高亮和折叠区域自动展开，再升级为可访问的可折叠树，并补充标题解析与交互测试。

## Markdown 样式测试文档（2026-08-29T21:42:25+08:00）

目标：提供一份可直接打开的 Markdown 源码，用于集中检查当前编辑器和阅读模式的样式。

已完成：

- 新增根目录 `markdown-style-test.md`。
- 覆盖 YAML 属性、标题层级、强调文本、链接、嵌套列表、任务列表、普通引用、Note/Tip/Warning 等标注块、代码块、表格、本地图片、分隔线、脚注、数学公式和长文本换行。
- 图片引用仓库自带 `src-tauri/icons/128x128.png`，无需额外准备资源即可测试。

修改文件：

- `markdown-style-test.md`

验证结果：已检查文件内容和关键 Markdown 语法；`npm run test:agent-status` 通过。

下一步：在桌面版项目文件树中打开 `markdown-style-test.md`，分别检查编辑/阅读模式和目录定位效果。

## 阅读标签归属调整（2026-08-29T21:40:02+08:00）

目标：避免阅读 PDF 标签同时出现在全局场景导航和阅读场景侧栏中。

已完成：

- 全局场景导航不再渲染 `reader` 场景的打开项。
- 阅读 PDF/阅读文档标签继续由阅读场景整栏侧栏统一展示、切换和关闭。
- 当前活动标签只有在实际出现在全局导航时才参与子项高亮，阅读场景不会因此丢失选中状态。
- 增加场景插件接线回归断言，防止阅读标签重复显示逻辑回归。

修改文件：

- `src/ui/App.tsx`
- `scripts/verify-scene-plugin-wiring.mjs`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:scene-plugins`、`npm run test:ui-state` 和完整 `npm run verify` 均通过；Rust 测试 122 项全部通过。本轮未重新生成 exe。

下一步：用户运行当前 release 版本或开发版，确认左侧“阅读”下不再显示 PDF 子标签，并从阅读整栏侧栏切换文档。

## 场景侧栏过渡版 Windows 构建（2026-08-29T21:30:26+08:00）

结果：已将场景侧栏滑动过渡和返回按钮右对齐调整打包进 Windows release 版本。

产物：

- `src-tauri/target/release/a4note.exe`（2026-08-29 21:30:10）
- `src-tauri/target/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`（2026-08-29 21:30:10）

验证结果：`npm run tauri:build` 成功完成前端构建、Rust release 编译和 NSIS 安装包生成。

下一步：用户可直接运行 exe，确认场景侧栏进入/返回动画以及右上角“返回场景”按钮的位置。

## 场景侧栏切换过渡（2026-08-29T21:17:56+08:00）

目标：让场景导航与场景专属整栏侧栏之间的切换更平滑，并降低返回入口与窗口收起按钮的误触风险。

已完成：

- 场景导航和场景工作区侧栏同时保留在布局中，通过横向滑入、淡入过渡完成进入和返回，不再瞬间替换内容。
- 非当前侧栏视图不接收鼠标事件，切换时不会误触隐藏视图中的场景或文件项。
- “返回场景”按钮改为整栏顶部右对齐，与左上角侧栏收起按钮保持明显间距。
- 增加 `prefers-reduced-motion` 支持，用户关闭动态效果时跳过过渡。

修改文件：

- `src/workbench/ProjectSidebar.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:scene-plugins`、`npm run test:agent-status` 和完整 `npm run verify` 均通过；本轮未重新生成 Windows release exe。

已知风险/未完成：未执行新的桌面预览截图，需在桌面版确认进入、返回及减少动态效果设置下的实际观感。

下一步：用户确认过渡速度和返回按钮位置；如视觉效果合适，后续场景沿用同一工作区侧栏机制。

## Markdown 空状态最终构建（2026-08-29T21:05:56+08:00）

结果：无项目或无打开文档时均使用无标题空状态；修正无文件分支的单列填充布局后，已重新完成前端构建、完整 `npm run verify`、架构/状态校验和独立 Windows release 打包。

产物：工作区根目录 `a4note-empty-state-latest.exe`（构建原件：`.build/tauri-empty-state/release/a4note.exe`）。

## Markdown 空状态交付（2026-08-29T20:55:31+08:00）

结果：已完成无文档空状态的完整验证和 Windows 免安装构建。

- `npm run verify` 通过，包含前端构建、插件/资源/场景检查和 122 项 Rust 测试。
- 独立 Cargo 目录构建成功，免安装产物已复制为 `a4note-empty-state-latest.exe`。
- 工作台快照仍会保存 Markdown 资源标签和活动标签；文档内部模式、目录、属性折叠和滚动位置尚未持久化。

## Markdown 属性间距打包跟进（2026-08-29T20:52:56+08:00）

目标：交付包含属性区下方视觉空白加倍调整的 Windows 构建。

结果：默认 release 目录的旧 exe 被系统占用，Tauri 无法覆盖；已使用独立 Cargo 输出目录成功完成 release 构建和 x64 NSIS 打包。

产物：

- `a4note-properties-gap-latest.exe`
- `A4 Note_0.1.2_properties-gap_x64-setup.exe`
- 原始构建目录：`.build/tauri-properties-gap/release/`

验证结果：独立目录 `npm run tauri:build` 通过，前端构建、架构检查和状态文件校验通过。

## Markdown 场景无文档空状态（2026-08-29T20:47:46+08:00）

目标：从场景直接进入 Markdown 且没有打开笔记时，右侧保持简洁空白，只提示用户从左侧打开笔记。

已完成：

- 没有打开 Markdown 文档时隐藏右侧“Markdown 笔记”标题、项目名、新建笔记按钮和标签栏。
- 右侧编辑区域改为同背景空状态，并显示“从左侧打开一个 Markdown 笔记”提示；左侧文件目录不受影响。
- 有打开文档时继续使用原来的标签和编辑布局。
- 已确认工作台快照会持久化项目、工作区、资源标签和活动标签，因此上次打开的 Markdown 笔记会在再次启动时恢复；阅读/编辑模式、目录展开、属性折叠和滚动位置目前仍属于文档组件的临时 UI 状态。

修改文件：

- `src/features/markdown/MarkdownWorkspaceScene.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status`、`npm run verify` 已通过；独立 Cargo 目录的 Windows 免安装构建也已完成。

已知风险/未完成：未新增文档内部视图状态的持久化；这不影响上次文档标签和活动文档的恢复。

产物：工作区根目录 `a4note-empty-state-latest.exe`；原始构建目录为 `.build/tauri-empty-state/release/`。

## Markdown 属性与正文间距跟进（2026-08-29T20:44:52+08:00）

目标：将笔记属性区域下方的视觉空白扩大到当前约两倍，保留 Markdown 源码内容不变。

已完成：

- `.markdown-properties` 的底部布局间距从 `8px` 调整为 `30px`。
- 配合编辑器列间距，属性区与正文之间的总视觉分隔约为 `44px`，达到原约 `22px` 的两倍。
- 间距仍由 CSS 提供，不会向文档插入空行，也不影响属性收起逻辑。

修改文件：

- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture` 和 `npm run test:agent-status` 通过。

下一步：用户运行最新 exe，确认属性区下方与正文之间的视觉分隔是否合适。

## 内置场景整栏侧栏统一（2026-08-29T20:39:32+08:00）

目标：让文献库、阅读和 AI 对话与 Markdown 使用同一套整栏工作区侧栏交互。

已完成：

- 文献库、阅读、AI 对话和 Markdown 的内置插件均声明 `sidebarMode: 'workspace'`；点击场景后由宿主显示插件侧栏并保留“返回场景”入口。
- 阅读侧栏改为列出当前工作区已经打开的阅读标签（PDF 资源或阅读文档标签），支持切换和关闭，避免重新打开文件。
- 文献库和 AI 对话侧栏暂时保持空白，仅保留整栏顶部的返回按钮；后续可直接在各自插件侧栏贡献中加入专属工具。
- 移除整栏顶部重复的场景标题，保留各侧栏自身的内容层级，并为阅读标签补充紧凑、可滚动和悬停关闭样式。
- 同步更新种子场景元数据和场景插件接线校验，确保运行时不会被旧的 `contextual` 配置覆盖。

修改文件：

- `src/core/libraryPlugin.ts`
- `src/core/readerPlugin.ts`
- `src/core/aiPlugin.ts`
- `src/data/seedDocuments.ts`
- `src/features/reader/ReaderSceneSidebar.tsx`
- `src/features/reader/contributions.tsx`
- `src/features/library/contributions.tsx`
- `src/features/ai/contributions.tsx`
- `src/ui/App.tsx`
- `src/workbench/ProjectSidebar.tsx`
- `src/ui/styles/workbench.css`
- `scripts/verify-core-smoke.mjs`
- `scripts/verify-scene-plugin-wiring.mjs`
- `docs/notes/ARCHITECTURE.md`

验证结果：`npm run verify` 通过，包含前端构建、场景插件接线、架构边界检查和 122 项 Rust 测试；本轮未重新生成 exe。

已知风险/未完成：T3 协作预览接口此前受 HTTP 429 限流，未执行新的浏览器截图；需要在桌面版确认三个场景进入整栏后的实际视觉效果。

下一步：后续插件只需声明 `sidebarMode: 'workspace'` 并注册 `defaultSidebarPanel`，即可复用整栏侧栏和返回场景机制。

## Markdown 属性标题对齐打包跟进（2026-08-29T20:36:13+08:00）

目标：交付包含属性标题左对齐调整的 Windows release 构建。

验证结果：`npm run tauri:build` 通过，release exe 与 x64 NSIS 安装包均已生成，生成时间为 2026-08-29 20:35:58。

产物：

- `src-tauri/target/release/a4note.exe`
- `src-tauri/target/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`

## Markdown 属性标题左对齐跟进（2026-08-29T20:32:30+08:00）

目标：让“笔记属性”标题与下方 Markdown 标题使用同一条左侧内容基线，并让两个收起按钮位于同一左侧轨道。

已完成：

- 属性标题文字改为使用与 CodeMirror 正文相同的 8px 内容内缩。
- 属性收起按钮按正文标题收起按钮的控制尺寸和外侧间距定位，保持展开、收起状态的位置一致。
- 仅调整界面 CSS，不改变 Markdown 源码或属性数据。

修改文件：

- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture` 和 `npm run test:agent-status` 通过。协作预览服务返回 503，未能执行浏览器截图；未影响静态构建验证。

下一步：用户运行最新开发版或重新打包后的 exe，确认属性标题和正文标题的左边缘、收起按钮位置符合预期。

## Markdown 目录视觉跟进（2026-08-29T16:01:18+08:00）

目标：目录与正文完全无缝衔接，并避免文件标题在目录中重复显示。

已完成：

- 移除目录面板边界线和独立底色，目录固定在资源视口右侧，与 Markdown 内容共用背景。
- 文件标题由独立标题区域负责，不再作为目录第一项；目录仅显示正文标题层级。
- 目录保持标题固定、列表独立滚动，并增加 180ms 轻微淡入滑入动效；遵守减少动态效果设置。

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 和独立 Cargo 目录的 `npm run tauri:build` 均通过。

产物：已重新生成工作区根目录的 `a4note-toc-latest.exe`，生成时间为 2026-08-29 16:04:56。

## Markdown 目录固定面板跟进（2026-08-29T13:40:02+08:00）

目标：让 Markdown 目录与正文保持同一视觉层级，固定在资源视口右侧，并由目录列表独立滚动。

已完成：

- 修正目录按钮把 `\\u76ee\\u5f55` 当作可见文字的问题，按钮现在显示为“目录”。
- 目录面板改为资源视口内的固定右侧面板，不参与正文 flex 宽度计算，正文原始位置不变。
- 目录标题固定，标题列表独立滚动并隐藏滚动条；保持同一背景，仅用细分隔线无缝衔接。

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture` 和 `npm run test:agent-status` 均通过。因旧 exe 文件锁定，使用独立 Cargo 目录成功生成最新免安装版。

产物：`a4note-toc-latest.exe`（工作区根目录）；构建原件位于 `.build\\tauri-toc\\release\\a4note.exe`。

下一步：用户运行 `a4note-toc-latest.exe`，打开 Markdown 文件后点击顶部“目录”按钮，确认右侧固定面板和正文滚动互不影响。

## Windows release packaging follow-up（2026-08-29T13:37:42+08:00）

目标：重新生成包含当前 Markdown 属性区分隔修复的 Windows exe。

验证结果：`npm run tauri:build` 通过，release exe 与 x64 NSIS 安装包均已重新生成。

产物生成时间：2026-08-29 13:36:30。

## Markdown 目录入口跟进（2026-08-29T13:18:00+08:00）

目标：处理桌面版未看到 Markdown 目录按钮的问题，并交付包含目录功能的最新免安装 exe。

当前判断：目录按钮已存在于独立 Markdown 文件标签顶部工具栏；本轮已完成重新打包，按钮在编辑和阅读模式均显示。

验证结果：`npm run test:agent-status`、`npm run build` 和 `npm run tauri:build` 均通过；最新免安装 exe 生成于 2026-08-29 13:15:56。

下一步：用户运行最新 exe 后，在 Markdown 场景打开任意 Markdown 文件，确认目录和属性区间距。

## Markdown 文件树重命名布局跟进（2026-09-03T00:28:20+08:00）

目标：让 Markdown 文件树右键重命名与工作区名称保持一致，并移除文件行上的删除按钮；重命名时不得改变下方树项的位置。

已完成：

- 移除文件树文件行右侧的悬浮删除按钮；删除操作仍保留在文件右键菜单中。
- 重命名行和普通文件/目录行统一使用固定行高，输入框填充行高，进入重命名状态不再把下方内容推移。
- 保留行内重命名的 Enter 保存、Esc 取消、失焦保存和 Markdown 扩展名只读逻辑。

修改文件：

- `src/features/explorer/FileTreePanel.tsx`
- `src/ui/styles/workbench.css`

验证结果：`npm run build`、`npm run test:architecture`、`npm run test:agent-status` 和完整 `npm run verify` 均通过；Tauri release 构建成功，包含 123 项 Rust 测试。

产物：根目录免安装版 `a4note-file-tree-inline-rename-no-delete-latest.exe`，SHA-256：`D5FD6BC19EF1E2C7F8994E9D39BFF1944F171C6616385C0BF18712DEE6B40278`。

已知风险/未完成：本轮未执行 T3 桌面截图；需要在 Windows 版确认右键重命名时行高稳定、删除按钮不再出现在文件行且右键删除仍可用。

下一步：关闭旧版程序后运行上述免安装 exe，打开 Markdown 文件树测试重命名、取消、失焦保存和右键删除。

## 当前工作

- 正式总结首批＋标题下元信息标签（review，2026-09-10T21:14:16+08:00）。新Windows试用包已生成，待隔离桌面试用与后续索引/性能完善。
- 以顶部短交接为准；先前“仅原型/未打包”描述是历史阶段，已被本轮覆盖。


## Markdown frontmatter separator follow-up (2026-08-29T13:27:03+08:00)

目标：属性区与正文之间只保留界面视觉间距，不在 Markdown 源码中合成空行。

已完成：

- `composeFrontmatter` 在 YAML 结束符后只写入语法必需的一个换行，正文原有的前置空白原样保留。
- `.markdown-properties` 的底部间距继续由 `workbench.css` 提供，属性区收起或展开不会改变 Markdown 内容。
- 增加 reader rendering 静态回归断言，防止恢复固定 `\n\n` 写回逻辑。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `scripts/verify-reader-rendering.mjs`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status`、`npm run verify` 和 `npm run tauri:build` 均通过。

产物：

- `src-tauri/target/release/a4note.exe`
- `src-tauri/target/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`

已知风险/未完成：T3 预览自动化仍受 HTTP 429 限流，未执行真实键盘删除流程；需要用户在桌面版确认现有文档的源码是否不再出现合成空行。

## Markdown heading deletion follow-up (2026-08-29T12:28:00+08:00)

目标：修复带 frontmatter 的 Markdown 在实时编辑模式首次删除正文标题时复制受管文档标题的问题。

已完成：

- `splitFrontmatter` 保留关闭 YAML 分隔符后的原始空白；标题识别和编辑器输入单独跳过分隔空白，保证正文格式不被改写。
- 属性区与正文之间的视觉分隔由 `.markdown-properties` 的 CSS 间距提供，不向 Markdown 文本插入空行。
- `titleFromBody` 和 `stripDocumentTitle` 统一按首个非空物理行处理，只移除真正的文档标题，不会提升后续同名章节。
- 保留会话令牌和前一正文快照校验，旧编辑器事务无法覆盖当前编辑器。
- 清理 `src/ui/zh.ts` 中重复的 `fileTree` 和 `fileTreeNeedsFolder` 键，使构建验证恢复可执行。

修改文件：

- `src/features/explorer/MarkdownResourceTab.tsx`
- `scripts/verify-reader-rendering.mjs`
- `src/ui/zh.ts`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture`、`npm run test:agent-status` 和 `npm run verify` 均通过；`npm run tauri:build` 已生成 Windows release exe 与 NSIS 安装包。

已知风险/未完成：T3 预览自动化连接本轮因 429 限流未能执行真实按键流程；静态检查和全量构建已覆盖修复路径。

下一步：交付生成的桌面安装包，等待用户在真实 Markdown 文档中确认首次删除行为。

## 主线进度

| 主线 | 状态 | 说明 |
| --- | --- | --- |
| 工作台 / Project / Workspace / Tab | `done` | 已有 SQLite 快照和工作台外壳。 |
| Resource / 文件树 / Markdown 文件标签 | `done` | URI 规范化和资源注册表已落地。 |
| Reader / PDF / 标注 | `done` | Reader 模块已拆分，仍有后续性能和视觉优化项。 |
| Agent CLI / Codex / Claude / 历史 | `done` | 协议、进程、适配器、历史持久化已落地。 |
| 插件安全 / 市场索引 / 手动导入 | `done` | 仅官方签名插件和已验证本地导入包。 |
| 内置场景统一插件化 | `done` | 五个内置场景、主视图、上下文侧栏、资源归属和启停生命周期均由插件贡献驱动。 |
| 多端同步服务端 | `backlog` | 客户端底座已完成，服务端账号/设备/notes API 尚未完成。 |
| 社区功能 | `backlog` | 等同步服务端和权限模型稳定后再排期。 |

## 本次交接

已完成：

- 增加 `SceneContribution` 的侧栏和多打开项能力字段。
- 增加 `src/core/builtinScenePlugins.ts`，内置场景按插件方式生成。
- `createAsterCore` 改为通过插件激活注册场景；`library.core`、`markdown.core` 支持传入兼容的场景元数据。
- 增加 `src/workbench/sceneViews.tsx`，`App.tsx` 的内置视图通过注册表渲染。
- 增加 `SceneSidebarViewRegistry`，Markdown 文件树通过 `markdown.files` 场景贡献显示。
- 修正所有上下文场景统一使用注册侧栏；工作区布局是唯一的侧栏显隐状态，Markdown/PDF 不再走宿主特判。
- 新增仓库根目录 `AGENTS.md`、开发手册和本状态文件。

验证结果：

- `npm run build`：通过。
- `npm run verify`：通过，包含前端全量检查和 122 个 Rust 测试。
- `npm run status`：通过，能输出当前计划和下一步。
- `npm run test:agent-status`：通过，状态 JSON、手册、交接文件和根入口结构有效。
- `npm run test:scene-plugins`：通过，五个内置场景的插件归属、视图注册和旧标签迁移接线有效。

下一步：

1. 按计划排期多端同步服务端。
2. 保持外部插件视图位于签名校验和沙箱运行时之后。

## 最新交接（2026-08-29T09:22:34+08:00）

目标：完成全场景插件化迁移，确保场景、主视图、上下文侧栏、工作台面板和资源标签使用统一的插件生命周期。

已完成：

- 五个内置场景由 `overview.core`、`library.core`、`reader.core`、`ai.core`、`markdown.core` 插件激活；停用插件会释放其场景、视图、侧栏、设置、面板、命令、Provider 和资源打开器。
- 主视图和上下文侧栏通过实时注册表解析，React 适配集中在 `src/ui/sceneAdapters.tsx`；外部插件只允许签名的 `declarative-v1` JSON，由宿主渲染。
- PDF、Markdown 及插件资源统一通过资源打开器按 kind、扩展名或 URI scheme 路由；标签持久化 `sceneId`、`openerId`，恢复时优先使用原插件归属，避免插件停用后错误回退到其他场景。
- 插件停用前会关闭其拥有的资源标签并将活动场景切换到可用场景，设置中的场景和插件开关共用同一生命周期路径。

验证结果：

- `npm run build`：通过。
- `npm run verify`：通过，包含资源视图、资源打开器、声明式插件运行时、场景插件接线和 Rust 测试。
- `npm run test:agent-status`：通过，状态快照、开发手册和交接结构有效。

已知未完成：

- 多端同步服务端和社区功能仍为 `backlog`，不属于本轮插件化迁移范围。
- 外部插件不执行任意脚本；后续若扩展交互能力，必须继续经过签名校验和沙箱边界。

下一步：按计划排期同步服务端；后续新增场景必须新增插件定义、视图/侧栏贡献和启停测试，不得把场景分支写回 `App.tsx`。
## Current Handoff (ISO 2026-08-29T01:08:00+08:00)

Plan status: complete for the scene-pluginization track.

Completed:

- All five built-in scenes are activated by their own `*.core` plugin.
- Scene views and contextual sidebars resolve through live plugin registries.
- Plugin disable disposes every owned scene, view, sidebar, setting, panel, command, provider, and resource opener.
- React adapters are isolated in `src/ui/sceneAdapters.tsx`; the host only assembles state and resolves contributions.
- Verification scripts now assert the plugin contribution contract and the current UI boundary.

Verification:

- `npm run verify` passed, including build, frontend checks, plugin checks, and 122 Rust tests.
- `npm run test:agent-status` passed after the status snapshot update.

Next: schedule the sync-server backlog. External plugin payloads are already restricted to signed `declarative-v1` JSON and host-owned rendering; no arbitrary script execution is allowed.

## Resource opener handoff (2026-08-29)

Resource-backed tabs now use one contribution-driven resolver. It matches opener
kind, file extension, or URI scheme, applies deterministic priority ordering, and
filters disabled plugin/scene owners. Plugin-owned kinds are persisted with a
`plugin:` prefix so restored tabs stay on the plugin route. Validation passed:
`npm run test:resource-openers`, `npm run test:declarative-plugin-runtime`,
`npm run test:scene-plugins`, `npm run test:ui-state`, `npm run test:reader`, and
`npm run build`.

## Markdown heading deletion handoff (2026-08-29T11:43:20+08:00)

目标：阻止 Markdown 编辑模式删除标题字符时，旧编辑器事务把受管文档标题再次拼回正文并造成标题重复。

已完成：

- `MarkdownLivePreviewEditor` 的变更回调现在携带创建时的 `sessionId`；旧 CodeMirror 实例的迟到事务无法冒充当前编辑器。
- `MarkdownResourceTab` 为文档、编辑/源码模式和加载状态建立会话令牌，只接受当前会话且 `previousMarkdown` 与最后正文快照一致的事务。
- 实时编辑器继续只接收受管标题之外的正文，源码模式继续保存完整正文；删除标题字符不会再触发标题复制。
- 更新 Reader 渲染校验脚本，覆盖会话令牌和快照隔离断言。

修改文件：

- `src/features/explorer/MarkdownLivePreviewEditor.tsx`
- `src/features/explorer/MarkdownResourceTab.tsx`
- `scripts/verify-reader-rendering.mjs`

验证结果：`npm run build`、`npm run test:reader`、`npm run test:architecture` 和 `npm run verify` 均通过；Rust 测试 122 项全部通过。`npm run tauri:build` 已成功生成 release exe 与 NSIS 安装包。

已知风险/未完成：未在真实用户文档上通过自动化浏览器复现删除键流程；预览自动化快照超时，代码和全量测试均已通过。

下一步：交付以下产物：`src-tauri/target/release/a4note.exe` 和 `src-tauri/target/release/bundle/nsis/A4 Note_0.1.2_x64-setup.exe`。

## Scene plugin runtime binding handoff (2026-08-29T11:57:34+08:00)

Goal: make registered scene plugins render their real scene, contextual sidebar,
resource view, and lifecycle state after workbench restoration.

Completed:

- Added a framework-free plugin binding contract in `src/core/pluginBindings.ts`.
- Scene and sidebar adapters now bridge an early persisted-workspace render when
  an active plugin registration event has not reached the React host yet.
- `App.tsx` merges active first-party adapters by scene/id with deterministic
  de-duplication and refreshes the plugin snapshot once after mount.
- Disabled plugins remain filtered, and an active registration with a mismatched
  owner remains a diagnostic instead of crossing plugin boundaries.
- Added `scripts/verify-plugin-runtime-bindings.mjs` and included it in
  `npm run verify`.

Verification: `npm run build`, `npm run test:plugin-bindings`,
`npm run test:scene-plugins`, `npm run test:resource-views`,
`npm run test:declarative-plugin-runtime`, and `node scripts/inspect-builtin-runtime.mjs`
passed. The collaborative preview automation was rate-limited in this turn, so
the final visual check still needs a manual refresh of the dev preview.

## Plugin contribution ownership handoff (2026-08-29T12:12:44+08:00)

目标：让所有插件贡献都只能由其所属插件注册和释放，避免插件停用后残留或跨插件串线。

已完成：

- `src/core/asterCore.ts` 在插件上下文的场景、场景视图、场景侧栏、设置、工作台面板和资源打开器入口统一校验贡献归属。
- 工作台面板必须使用当前插件的 `plugin:<id>` source；显式声明其他插件 ID 的贡献会在激活期间被拒绝。
- `scripts/verify-core-smoke.mjs` 增加 owner-boundary 插件测试，覆盖越权注册、正常注册和停用后的完整释放。

验证结果：`npm run build`、`npm run test:core`、`npm run test:scene-plugins`、`npm run test:architecture` 均通过。

已知风险/未完成：自动化预览服务本轮未重新截图；用户已手动确认五个场景可以正常运行。同步服务端仍在 backlog。

下一步：按计划进入同步服务端 API 的实现与客户端联调；新增插件继续遵守本手册的归属校验和声明式视图协议。

## Scene workspace sidebar handoff (2026-08-29T12:48:07+08:00)

目标：恢复 Markdown 场景点击后将左侧整栏切换为文件目录，并为后续需要独立工作区侧栏的场景提供统一机制。

已完成：

- `SceneSidebarMode` 增加 `workspace`；声明式插件解析器接受该模式。
- Markdown 插件声明 `sidebarMode: 'workspace'`。点击 Markdown 场景或打开 Markdown 资源时，左侧整栏显示插件贡献的文件树。
- `ProjectSidebar` 增加通用场景工作区视图和“返回场景”按钮；返回后恢复场景选择、工作区和全局操作区。
- `App.tsx` 根据当前场景贡献控制进入/退出状态，资源打开和工作区恢复也遵循同一规则；未加入 Markdown 专用侧栏状态。
- 更新工作台样式、中文标签、开发手册、架构说明及场景/核心/声明式运行时验证断言。

修改文件：

- `src/core/types.ts`
- `src/core/declarativePlugin.ts`
- `src/core/markdownPlugin.ts`
- `src/ui/App.tsx`
- `src/workbench/ProjectSidebar.tsx`
- `src/workbench/workbenchLabels.ts`
- `src/ui/zh.ts`
- `src/ui/styles/workbench.css`
- `scripts/verify-scene-plugin-wiring.mjs`
- `scripts/verify-core-smoke.mjs`
- `scripts/verify-declarative-plugin-runtime.mjs`
- `scripts/verify-architecture-boundaries.mjs`
- `docs/notes/DEVELOPMENT_HANDBOOK.md`
- `docs/notes/ARCHITECTURE.md`

验证结果：`npm run build`、`npm run test:core`、`npm run test:scene-plugins`、`npm run test:declarative-plugin-runtime`、`npm run test:architecture` 和 `npm run verify` 均通过；Rust 122 项测试通过。

已知风险/未完成：本轮没有重新生成 Windows release exe；未进行新的桌面预览截图。其他场景可通过声明 `sidebarMode: 'workspace'` 复用此交互。
