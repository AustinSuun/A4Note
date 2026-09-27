# MCP 交付：总结笔记（总览笔记）字段操作区重排 + 卡片直接编辑 + 字号统一 + 移除「高级源码」入口（arena-two，2026-09-27）

- 任务卡：`9ddfe985-4cf4-4a32-9b22-c1ca9476026d`（spec_revision 4）
- 分支：`fix/summary-note-layout-arena-two`（worktree `.worktrees/summary-layout-arena-two`，最初基线 `90182b6`，已 rebase 到 `main` `d1ab0a2`）
- 提交：`418cd8d` fix(summary): direct-edit overview note cards, compact field toolbar, app-scale typography, no 高级源码 entry（+ 本文档 / 状态文件提交）
- 与后续任务 `07abf228`（字体 / 标题 / 左侧拖拽把手布局）的衔接：本任务只动 `SummaryDocumentEditor` 内部（卡片、工具区、字号），阅读器笔记面板头部（`总结笔记 ▾`、拖拽把手 `.note-workspace` / `note-document-actions`）未改，留给 07abf228。

## 1. 问题

`SummaryDocumentEditor`（阅读器笔记面板「总结笔记」与文献库综览「编辑完整总结」对话框共用）的旧实现：

1. 顶部字段操作区纵向堆叠三段说明 + 三行控件（`新建或管理字段` / `添加已有字段` 标题 / 全宽 select / `添加到本篇` + `在末尾写自由内容`），阅读器面板宽 459px 时高 205px，select 宽 369px；说明文字与控件穿插，视觉上像三块独立表单。
2. 每张卡片（自由内容 / 字段）右上角一个 `编辑` 按钮，点击正文不能编辑；空字段只显示「尚未填写」。
3. 卡片标题、正文均继承面板 18px（与 App 其他文字不一致、明显偏大）。
4. 综览对话框头部有 `高级源码` 按钮（切到整篇 textarea），普通用户容易误入；阅读器面板则靠 dock 的 `源码` 开关。

## 2. 变更

| 文件 | 变更 |
| --- | --- |
| `src/features/library/SummaryDocumentEditor.tsx` | 重写呈现层，保留同一份 `parsed.document` / `source` / `getCurrent` / `onChange` 会话契约（不复制笔记数据，仍是父级 note session 的视图）。**操作区**：两行 `role=group`「字段：新建或管理字段 · 选择要添加的字段… · 添加到本篇」「自由内容：在末尾写自由内容」+ 一段说明；无可添加字段时 select 显示「没有可添加的字段」并禁用。**直接编辑**：每张卡片的预览区是 `role=button tabIndex=0 aria-label="编辑<标题>"`，点击 / Enter / Space / F2 进入编辑；点击链接、按钮、表单控件、`[data-annotation-ref]`、或存在文字选区时不进入编辑（`closest()` 命中自身 currentTarget 不算控件）；键盘焦点本身不开编辑器、不写入。空卡片显示「尚未填写，点击开始输入」占位，点击即编辑；只读 / 非活动面板下无 `role=button`、无操作区、占位为「尚未填写」。同一时刻只挂一个共享 `MarkdownLiveEditor`（`editing` 段），编辑头部显示 `编辑中` + `添加图片到此区域` +（自由段）`归类选中文本`。**焦点**：`focusPending` 在 `useEffect([active])` 里用 `requestAnimationFrame` 轮询 `.cm-content`（≤120 帧），首次也推迟一帧——同一 commit 内立即 focus 会落到 dev StrictMode 即将重建的 CodeMirror 实例上（原生 dev:live 中实测 focusin 后立刻 focusout）。修复了组件内 `const document = parsed.document` 遮蔽 `globalThis.document` 导致 `document.querySelector` 抛错、添加字段后不聚焦的问题。**添加已有字段**：仅在显式点击 `添加到本篇` 后 `replaceSummaryFieldText(..., '', true)` 写入当前笔记并进入该字段编辑；全局目录 / 其他笔记不动。**恢复入口**：解析失败时 `role=alert` + `打开高级源码修复`；写入失败且错误提示含「源码」时 alert 内提供 `打开源码修复`。 |
| `src/features/library/summary-document-editor.css` | 紧凑、左对齐的卡片系统：操作区 `flex-wrap` 两行、标签 12px、控件 13px；卡片 `header strong` 13px/600、正文 14px（`.summary-document-editor .summary-document-preview h1/h2/:is(h3…h6)/p` 显式覆盖 `.md-body` 的大标题字号），空卡片 81px；编辑态卡片 2px 主色描边；容器 `padding-bottom:100px` 让最后一张卡片能滚出底部样式 dock；无水平溢出（窄窗 360px 面板实测 `horizontalOverflow=false`）。 |
| `src/features/library/SummaryEditor.tsx` / `summary.css` | 综览对话框头部删除 `高级源码` 按钮；整篇源码模式改为底部工具行右侧的弱化入口 `以源码修复…`（`.summary-source-repair`，muted 样式），仍是同一 `sourceMode` textarea + 保存并关闭流程。 |
| `scripts/verify-summary-direct-edit-browser.mjs` | 新增（并入 `test:summary-fields`）：24 项断言——源码契约（无 `编辑` 按钮、无 `高级源码`、`role=button` 预览、`以源码修复…`）、点击空占位 / 正文进入编辑、链接点击不进入编辑、键盘 Tab 只聚焦不写入、Enter 打开并聚焦、编辑不产生空字段写入、只读态无编辑面、添加字段立即可输入、切换卡片不丢内容、无 pageerror；截图 `.tmp/summary-direct-edit/01-rest.png`、`02-editing.png`。旧代码上源码契约断言直接失败。 |
| `scripts/verify-summary-direct-edit-native.mjs` | 新增：附着运行中的 dev:live 隔离实例（CDP），阅读器面板「总结笔记」+ 综览对话框两条路径，7 个用例（rest / 直接编辑自由内容 / 添加字段并直接输入 / 关闭重开持久化 / 窄窗 / 对话框 / 对话框直接编辑）+ 亮暗色截图；`after` 模式硬断言，`before` 模式仅记录基线。 |
| `scripts/verify-summary-assignment-ui-browser.mjs` | 适配直接编辑：等待 `.cm-content` 而非点 `编辑`；断言 `以源码修复…` 存在。 |
| `package.json` | `test:summary-fields` 末尾追加 `verify-summary-direct-edit-browser.mjs`。 |

未改动：`summaryDocument.ts` / `summaryEditorPatch.ts` / `librarySummary.ts`（字段目录、标记解析、补丁、会话与保存 / 冲突保护均沿用），`SummaryFieldSettings`、`SummaryAssignmentDialog`、阅读器 `ReaderMarkdown` 的会话 / 保存 / dock。

## 3. 「在旧代码上失败」证明

`git checkout 90182b6 -- SummaryDocumentEditor.tsx summary-document-editor.css SummaryEditor.tsx summary.css` 后：`node scripts/verify-summary-direct-edit-browser.mjs` 在第一组源码契约断言（`no per-card 编辑 button in source`）失败；原生驱动 `before` 模式记录：每卡 `编辑` 按钮 7/8 个、点击正文不进入编辑（`direct:false, viaButton:true`）、标题 / 正文 18px、操作区 205px 高 / select 369px 宽、综览对话框头部 `高级源码` 1 个、无 `以源码修复…`。恢复后全部通过（见 §5）。

## 4. 验证矩阵

| 步骤 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `npm run test:summary-fields`（catalog 28 / document 68 / editor-patch 22 / catalog-browser 10 / reader-bridge 9 / per-note-catalog 11 / transaction 48 / assignment-ui 31 / tab-host 14 / scroll 4 / **direct-edit 24**） | 全部通过 |
| `node scripts/verify-summary-provision.mjs` | 通过 |
| `npm run build` | 通过 |
| `npm run verify`（rebase 到 `d1ab0a2` 后全量） | 除 `test:ui-state` 外全部通过；`test:ui-state` 失败于 `verify-ui-state.mjs:383` 断言 `ReaderToolbar` 不含 `reader-toolbar-center`，该类名由 `42184f1`（Reader: return to live library tab）引入，`git merge-base --is-ancestor 42184f1 90182b6/d1ab0a2` 均成立——基线与当前 main 上同样失败，与本任务无关，未改动 reader 文件。日志 `.tmp/verify2.log` |

## 5. dev:live 隔离实例（原生 WebView2 窗口）验收

- 启动：`.tmp/native/live-sum.mjs`（`liveDevPlan(root,{instance:'arena-two-sum',port:1499,cdpPort:9329})` + `checkDevAdmission`，vite 注入 `VITE_A4NOTE_DEV_*`，`tauri dev --config` 隔离配置，`CARGO_TARGET_DIR` 复用 `.build/live-dev/promo/target`），identifier `app.aster.research.dev.arena-two-sum.wcd1fd4d1e9`，独立 `AsterData` / WebView2 profile，底部 DEV 绿条「arena-two-sum · 独立测试库（原生已核验 …）」在每张截图可见。未触碰真实资料库。
- 驱动：`node scripts/verify-summary-direct-edit-native.mjs before|after`（CDP 9329），路径：文献库 → 双击示例文献 → 笔记面板 → 文档切换 → 新建 / 打开总览笔记；综览 → 编辑完整总结。
- `after`（`.tmp/shots/summary-direct-edit-native/after/`，`report.json` `errors:[]`，pageerror / console.error 0）：
  - `01-reader-rest`：操作区两行（高 145px，select 156px），自由内容 + 字段卡片左对齐，标题 13px / 正文 14px，无 `编辑` 按钮，无居中大标题。
  - `02-reader-editing`：点击正文 → 共享编辑器就地打开、`编辑中` + `添加图片到此区域`，`focused:true`，输入后 `已保存`。
  - `03-reader-added-field-editing`：选择 `online 时间` → `添加到本篇` → 新卡片立即进入编辑且聚焦（`alreadyEditing:true, focused:true`），输入「字段内容 after」。
  - `04-reader-reopen`：关闭再打开笔记面板，自由内容与字段内容均持久（`persisted:true, fieldPersisted:true`）。
  - `05-reader-dark`（midnight）、`06-reader-narrow`（900×700，面板 360px，`horizontalOverflow:false`）。
  - `07-overview-dialog` / `08-overview-dialog-editing` / `09-overview-dialog-dark`：头部仅 `保存并关闭`，工具行 `导出完整草稿 · 以源码修复… · 放弃草稿 / 重新读取`，卡片可直接编辑并聚焦。
  - 恢复路径实测：对话框 `以源码修复…` → textarea 改写整篇 → `保存并关闭` 成功（用于重置测试笔记）。
- `before`（同一实例上把 4 个文件 checkout 到 `90182b6`，HMR 生效后跑 `before`）：`.tmp/shots/summary-direct-edit-native/before/`，见 §3 数据；截图归档 `docs/screenshots/summary-direct-edit-arena-two/`：`before-01-reader-rest.png` / `after-01-reader-rest.png`、`before-02-reader-editing.png` / `after-02-reader-editing.png`、`before-07-overview-dialog.png` / `after-07-overview-dialog.png`，另有 `after-03-reader-added-field-editing.png`、`after-04-reader-reopen.png`、`after-06-reader-narrow.png`。

## 6. 不做 / 边界

- 不改字段目录规则、不自动补写空字段（编辑器只在内容变化时 `onChange`，添加字段时写入的是显式的空标记块——与旧行为一致）。
- 阅读器面板 dock 的 `实时 / 源码` 开关是通用 Markdown 工具，保留；「高级源码」只从总结笔记的常规 UI 中移除，破损结构走 alert 内的 `打开高级源码修复 / 打开源码修复` 与对话框 `以源码修复…`。
- 未安装 / 打包 / 发布，未重启 4319，未动真实资料库。
