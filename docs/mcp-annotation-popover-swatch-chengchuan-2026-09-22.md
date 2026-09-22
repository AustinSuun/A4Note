# 阅读标注工具设置弹窗：色板裁切修复与文本框色板对齐

- 日期：2026-09-22
- 执行者：澄川
- 任务：`23528921-0e07-491b-871c-1b20531fe7f5`（claimed_spec revision 6）
- 分支：`annotation-popover-swatch-chengchuan`
- 交付 commit：`9a180c4`（fix）→ 合并入本地 main `29341cc`（--no-ff merge，基线 `59ca336`，合并时 main 侧含 `cc89d12` 橡皮指针修复；其后 main 又前进至 `d6d70d8`/`bd77244`，本次合并仍在历史中）

## 问题与根因

1. 弹窗内容宽度写死 `width: min(300px, calc(100vw - 40px))`（reader-annotation-dock.css），而色板行最小内容宽度 = 自定义色 34px + 间距 8px + `repeat(10, 26px)` 预设（含 6px 间隙共 314px）≈ 356px，加内边距后约 380px，右侧两列预设与选中描边（box-shadow 外扩 4px）被裁切，出现横向滚动。
2. `.tool-option-color-group` 使用 `auto auto max-content` 网格；「无背景」复选框（allowTransparent）插入后占据第一列，把背景组的自定义色与预设色整体右移，与文字颜色/外边框两组左边缘不一致。

复现与量测：隔离 headless Chrome + 真实组件/CSS（`scripts/verify-reader-popover-layout-browser.mjs`），修复前 barScrollW 397 > barClientW 396，且 300px 宽度下右列裁切（与用户参考图一致）。

## 修复

- `ToolColorPalette` 重构为「标题行（label + 无背景开关）+ 色块行（自定义色 + 预设网格）」两行结构；「无背景」不再占色板列，开/关不引起跳位。
- `.tool-option-color-group` 改为纵向 flex；新增 `.tool-option-color-heading` / `.tool-option-color-row` 契约；弹窗内色板组去除继承的 `border-right` 分隔线。
- 弹窗宽度改为内容驱动：有色板的工具 `min(calc(40px + 34px + 8px + 10×swatch + 9×gap), calc(100vw - 40px))`（≈396px），无色板工具保持 300px，避免空白。
- 窄屏（≤480px CSS viewport）预设改 5 列换行、宽度随视口，纵向滚动不横向裁切。
- 不缩色块、不删颜色、不用 overflow:hidden 掩盖；未 reintroduce 关闭 ×（e5e73f0f 已移除，保持 headerAction 结构）；不改数据语义、不加新设置项。

## 验证结果

- `npm run build`（worktree，tsc + vite）：通过。
- 新增 `scripts/verify-reader-popover-layout-browser.mjs`（`npm run test:reader-popover-layout`）：**合并后代码 166/166 通过**，覆盖 高亮/下划线/自由画笔/箭头/文本框/图形 × {1280×800 @UI 100%/125%/150%、800×600、460×700}：无横向溢出/滚动、20 个预设与选中描边完整可见、文本框「文字颜色/外边框/背景」三组自定义色+预设列左边缘差 ≤1px、「无背景」开/关无跳位、无运行时异常。证据：`.a4-tests/reader-popover-layout/layout-2026-09-22T02-34-08-728Z`（合并后）。
- 既有焦点回归 `scripts/verify-reader-popover-focus-browser.mjs`：合并前（本分支）367/367 通过。合并后脚本写死的工具栏数量假设 `===9` 已不成立——快捷键卡片（`fd35859` 等）给工具栏新增了第 10 个按钮「阅读器快捷键设置」（实测 DOM 按钮 10 个）。将数量假设放宽为 `>=9` 后复跑：367 项通过，4 项失败且全部是新按钮「阅读器快捷键设置」自身的脚本预期（四组 主题×宽度 场景），与本卡六个工具的弹窗焦点/Tab/Esc/外部点击行为无关；该脚本不在 `verify-all` 流水线内，属快捷键卡片并入 main 后的既有待同步项，本卡不代改。证据：`.a4-tests/reader-popover-focus/focus-2026-09-22T02-50-58-287Z`。
- `npm run verify`（合并后 main 全量）：首轮在 `test:ui-state` 失败——旧断言仍要求 `.tool-option-color-group` 的 `grid-template-columns: auto auto max-content`；上游随后提交 `bd77244 test(ui): align palette assertions with integrated main layout` 将断言对齐到本修复的 flex 行契约后，**当前 main 全量 `npm run verify` 通过（"A4Note verification passed"，Rust 215/0/5 ignored 等全绿）**。
- get_diagnostics（reader 目录）：0 error / 0 warning。
- 运行环境记录：CSS 视口 1280×800 / 800×600 / 460×700；UI 缩放 100%/125%/150%（deviceScaleFactor 1/1.25/1.5）；DPR 1；隔离 headless Chrome；dev:live 使用系统 WebView2（Edge 153）。

## dev:live 证据

- 隔离实例：`npm run dev:live -- --instance chengchuan --port 5210 --cdp-port 9231`，identifier `app.aster.research.dev.chengchuan.w8cbe287824`，独立状态目录 `.tmp/live-dev/chengchuan`，不触碰正式资料库（productionLibraryCopied: false）。
- 官方运行时验证 `scripts/verify-dev-live-runtime.mjs --cdp-port 9231 --expect-instance chengchuan`：**21/21 通过**，badge 文案完整：`DEV chengchuan · 独立测试库（原生已核验 app.aster.research.dev.chengchuan.w8cbe287824/AsterData）· app.aster.research.dev.chengchuan.w8cbe287824`，mode=isolated；报告与截图在 `.tmp/live-evidence/chengchuan-1790045515076/`（runtime-report.json + screenshots/）。
- 受限说明（如实）：隔离实例打开 PDF 需经系统文件对话框，无法在无人值守下注入样例，故 dev:live 窗口未加载阅读器场景；弹窗布局与色板几何由上面的隔离 Chrome 回归（真实组件 + 应用 CSS，含 console/pageerror 采集）覆盖。`.tmp/shots/dl-01-app.png`、`dl-02-reader.png` 为实例窗口截图（早期帧读取到 badge 的 `DEV` 前缀系采样时机，完整文案以上述运行时验证为准）。

## 影响文件

- `src/features/reader/ReaderToolbar.tsx`
- `src/ui/styles/reader.css`
- `src/features/reader/reader-annotation-dock.css`
- `scripts/verify-reader-popover-layout-browser.mjs`（新增）
- `package.json`（新增 `test:reader-popover-layout` 别名）

## 遗留/移交

- `scripts/verify-reader-popover-focus-browser.mjs` 的 `===9` 工具数量假设已被快捷键卡片的第 10 个按钮（阅读器快捷键设置）使旧，需由快捷键卡片同步（含该新按钮自身的 4 项脚本预期）。
- 未做：安装、打包、发布、生产资料库写入；`.tmp/` 与 `.a4-tests/` 证据目录不入库。

