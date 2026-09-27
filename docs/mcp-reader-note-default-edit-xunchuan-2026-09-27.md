# 阅读器笔记默认编辑态与布局菜单重设计交付记录（456497d8）

- 日期：2026-09-27（Asia/Shanghai）
- 任务：`456497d8-36d4-4493-975e-e0da04a90749`（in_progress rev4，owner a4046fff-89af-479e-b1f9-1d6bd0bb032b）
- 分支：`fix/reader-note-default-edit-xunchuan`（基于干净本地 main `8e01e50`）
- 执行者：巡川（Arena）

## 需求摘要

1. 阅读器侧栏与悬浮笔记**每次打开/重开默认实时编辑**；当次手动切「阅读」仅当次打开有效，重开恢复默认编辑。
2. 可写前提下正文立即可编辑；**不因默认打开而创建空笔记或写盘**；只读、冲突、失败与未保存草稿安全规则保留。
3. 布局三形态（悬浮速记 / 专注写作 / PDF 专注）入口重设计：菜单内每项含**线框图示 + 名称 + 快捷键 + 一句说明**，清晰表达差异；与独立的编辑/阅读内容态严格区分。
4. 保留现有快捷键、键盘导航、选中/hover/focus、形态往返、编辑器正文与 PDF 状态；覆盖窄窗、缩放、浅深主题。

## 实现

- 新增 `src/features/reader/noteContentMode.ts`：`useNoteContentMode`（模块内 ref 记录当次打开的手动选择；首开 edit，手动切换仅当次有效，卸载/重开重置）。
- `ReaderMarkdown.tsx` 换用新 hook；保存/草稿/只读/冲突逻辑不变。
- `ReaderNoteWorkbenchMenu.tsx`：三形态菜单项改为「32px 线框图示列（`ModeDiagram` SVG：PDF 页 + 笔记面板比例，当前项 accent 着色）+ 名称 + ✓当前 + kbd 快捷键 + 说明行」；菜单宽 300px，窄窗/缩放不破版。
- 紧凑三态 switch：`aria-label` 恒为形态名（动效回归硬断言契约），说明仅入 `title`（"名称：说明"）。
- `reader-writing-layout.css`：菜单图示列、说明行、浅深主题着色。
- 默认打开不创建空笔记/不写盘：沿用既有 saveNote 路径，未触碰。

## 验证（改前/改后，隔离 dev:live，真实 WebView2）

- 实例：`readermotion`（app.aster.research.dev.readermotion.wfaad5e2623，1439/CDP 9246），底部状态条「DEV readermotion · 独立测试库（原生已核验 …）」；junction 复用动效任务热 cargo target。
- 修复点定位：新工作树缺生成物 `src-tauri/resources/native-host/*`（.gitignore 内）导致 tauri build-script 硬失败；从动效工作树复制两文件后构建通过。
- **BEFORE**（旧代码，`.tmp/shots/reader-note-default-native/before/`，report 4 checks/0 errors）：first-open 编辑、manual-read 阅读、same-open 保留阅读、**reopen 仍阅读（旧行为缺陷证据，截图 03-reopen 为只读预览）**。
- **AFTER**（新代码，同目录 `after/`，4 checks/0 errors）：first-open `编辑模式`、manual-read `阅读模式`、same-open-floating `阅读模式`（布局切换不重置）、**reopen `编辑模式`（默认恢复，截图 03-reopen 为实时编辑器+格式工具条）**。两跑 pageerror/console error 均 `[]`。
- 合成浏览器 `scripts/verify-note-default-edit-browser.mjs`：**16/16**（run-2026-09-27T12-00-55-320Z），含浅/深主题、窄窗 980、缩放 125%/150% 菜单截图（`01-menu-light/03-menu-dark` 目视：图示+名称+✓+kbd+说明齐备，深浅主题正常）。
- 动效回归 `scripts/verify-note-enter-motion-browser.mjs`：**73/73**（run-2026-09-27T11-44-43-319Z）。中途修复：紧凑 switch 的 `aria-label` 恢复为形态名（说明移入 title）。
- `npm run test:architecture`、`npm run test:agent-status`、`npm run build`：全部通过（build 2.48s，仅既有 chunk 体积警告）。

## 新增回归资产

- `scripts/verify-note-default-edit-browser.mjs`（合成浏览器 16 项，含默认打开不写盘、重开恢复、只读/草稿安全、快捷键、形态往返、主题/窄窗/缩放）。
- `scripts/verify-note-default-edit-native.mjs`（dev:live 原生 before/after 取证，before 断言旧行为、after 断言新行为，产出 report.json + 截图）。
- `scripts/fixtures/reader-note-default-edit/manifest.json` + README（夹具说明）。
- `package.json` 增加 `test:note-default-edit-browser` / `test:note-default-edit-native`；`scripts/verify-all.mjs` 纳入浏览器脚本（原生脚本需隔离实例，不入 verify-all，与 motion 同例）。

## 限制与如实记录

- 原生取证使用隔离测试库（DEV 身份条核验），未触碰真实资料库；未打包/安装/推送/发布。
- 冷启动首帧等待等既有问题不在本任务范围，未虚称。
- dev:live 共用物理 cargo target 会死锁，执行期间仅单实例运行；实例已于取证后停止。

## 状态

分支提交后 ff 合入本地 main；任务板 submit review，待用户验收归档。

