# PDF 文字标注就地编辑（任务 540986ab，星桥执行，2026-09-20）

任务：540986ab-f39c-4f30-b70a-4a8cf16c8bc4。分支：`feature/pdf-text-annotation-inline`；工作区：`.worktrees/task-pdf-text-annotation`。
基线：本地 `main` 393741a（merge round2 之后）。本分支最初基于 c66f7f5 开发，发现 main 已于 baa018e 合入一版 textarea 式就地编辑
（`useInlineTextAutoSize` / `pdf-inline-text-layout.css`）后，改为在 393741a 上重建并做了三方合并，保留 main 上高亮外观、按钮守卫等其它改动。

## 问题与基线

| 版本 | 行为（隔离浏览器实测，同一合成 PDF，100 / 200 / 335 %） |
| --- | --- |
| 安装版 0.1.22（`Aster-wt/archived-20260920`，`before-*` 截图） | 文字工具点击页面 → 弹出 240×168 px 的设置弹窗（B / I / 字号 / 颜色 / 文本域 / 取消 / 保存），保存后得到固定 22 % × 7 % 的框，字号 13 px（不随缩放变化）。 |
| main 393741a（baa018e 合入） | 点击直接出现 textarea，但仍是固定 22 % × 7 % 起始框、13 px 固定像素字号；只按 scrollHeight 增高，不横向伸展；无右/下边界处理；无字体大小的按需入口。 |

## 改动

### 交互
- 文字工具点击页面：不再出现任何设置弹窗，直接在点击处出现一个**紧凑的单行文本框**并聚焦（`InlineTextEditor.tsx`，`contentEditable="plaintext-only"`，`role="textbox"`），光标在框内。
- 输入时框先横向增长，到达上限（默认页面宽度 60 %，且不超过页面右边距 1.5 %）后自动换行并增高；Enter 换行，Esc / Ctrl+Enter / 点击外部提交。
- 新建时内容为空则丢弃、不产生标注；已有标注清空后提交则删除该标注。
- 选中已有文字标注（点击）不再自动弹设置面板；双击或“编辑”铅笔进入就地编辑；选中态的内联操作条新增 “Aa” 按钮，按需展开字号（12–32）/ 粗体 / 斜体 / 颜色小面板（`.annotation-text-style-panel`）。
- 工具栏（`ReaderToolbar.tsx`）：选中标注时不再自动打开上下文设置面板，改为由高亮的工具按钮按需切换；切换选中标注时关闭。
- 提交前后几何一致：提交时直接测量编辑框的真实尺寸转成百分比落库，标签渲染与编辑框共用同一套排版（字体、行高 1.3、内边距、换行规则），不会“跳一下”。
- 边界：点击点靠近右缘时起始框左移以保证最小 6 em 宽度；输入过程中若框底超过页面下边距，则实时上移（`keepInlineTextOnPage`，ResizeObserver）；提交时再做一次 `clampTextBoxToPage`。
- 手动拖动调整大小后该框变为固定宽度（`autoWidth:false`），之后编辑只增高不变宽；单击框体或手柄而未拖动时不再写入任何位置（原实现每次单击都会重写 position，且会把自动宽度框冻结为固定宽度）。

### 数据与缩放
- 新标注 `positionJson` 记录 `fontUnit:'page'`、`autoWidth:true`、`maxWidth`、`fontSize`（默认 16 = 100 % 时的像素值），渲染为 `calc(var(--pdf-display-zoom) * 16px)`，变量由 `PdfPageView` 写在 `.pdf-render-layer` 上，所以字号、内边距随页面缩放等比变化，100 / 200 / 335 % 下框相对页面的百分比几何完全一致。
- 旧标注（无 `fontUnit`）保持原有固定像素字号与固定宽度（`min-height` = 原高度，内容更长时向下延展而不裁切），默认值变化不影响它们；编辑旧标注只在文字确实变化或高度不够时写入。
- `textFontSize` 默认 13 → 16，仅作用于新建。

### 文件
- 新增：`src/features/reader/pdf/InlineTextEditor.tsx`、`pdfTextAnnotation.ts`（布局/边界/规范化纯函数）、`pdf-text-annotation.css`；`scripts/verify-pdf-text-annotation.mjs`（node 单测 + 源码契约，接入 `npm run verify`，`test:pdf-text-annotation`）；`scripts/verify-pdf-text-annotation-browser.mjs`（独立 CDP 回归，`MODAL_PHASE=before|after`）。
- 修改：`PdfReader.tsx`、`AnnotationMark.tsx`、`AnnotationOverlay.tsx`、`PdfPageView.tsx`、`types.ts`、`ReaderToolbar.tsx`、`package.json`、`scripts/verify-all.mjs`。
- 删除（被本实现取代，均无其它引用）：`src/features/reader/pdf/useInlineTextAutoSize.ts`、`pdf-inline-text-layout.css`、`scripts/verify-inline-text-height.mjs`（只测被删函数）、`scripts/verify-inline-text-escape-browser.mjs`（依赖的 `tests/fixtures/inline-text-escape.html` 在 main 上并不存在，脚本本身已不可运行；其覆盖的 Esc / IME 合成态 / Ctrl+Enter / 普通 Enter 行为改由新的浏览器回归覆盖）。二者均未接入 `npm run verify`。
- 回归脚本同步（仅测试文件）：`scripts/verify-ui-state.mjs` 把“选中标注自动打开设置面板”的源码契约改为新的按需切换契约；`scripts/verify-reader-rendering.mjs`
  把文字工具分支的契约改为就地编辑（`setInlineText` + 新建 positionJson 字段），并把高亮 inset / bottomBleed / baselineGap 三处断言同步到 main 393741a 上
  `pdfAnnotationHelpers.ts` 已经改掉的常量——这三处在 main 393741a 上本来就不匹配（merge round2 改了实现没改断言），即 main 自身的 `npm run test:reader` 当时已是红的；
  本分支只让断言反映 main 现有实现，没有改高亮实现本身（属 83352eb5 范围）。
- 未改：`src/ui/styles/reader.css` 原有规则、评论便签的 `.comment-popover`（便签仍用小弹窗）、`ReaderScene.tsx`、注解历史/持久化接口。

## 前后对比（同一合成两页 PDF，1366×768，隔离 Chrome，生产构建组件 + Tauri 桥接桩）

| 指标 | 修改前（安装版 0.1.22） | 修改后 |
| --- | --- | --- |
| 点击文字工具 | 240×168 px 设置弹窗，需填写并点保存 | 无弹窗；直接出现聚焦的编辑框 |
| 起始框（100 %） | 22 % × 7 %（约 135×55 px） | 9.8 % × 3.4 %（60×27 px，单行） |
| 字号 | 13 px，任何缩放下都是 13 px | 16 px；200 % → 32 px，335 % → 53.6 px（页面相对大小不变） |
| 长文本 | 固定框，超出部分裁切/滚动 | 横向长到 60 % 上限后换行，3 行 → 高 8.6 %；三档缩放下百分比几何一致（wPct 60.0 / hPct 8.64） |
| 右下角创建（97 %，98.5 %） | 框伸出页面 | 起始点左移到 82.8 %，输入时框保持在页面右缘 1.5 % 内并实时上移，提交后 y + h ≤ 98.5 % |
| 选中已有文字标注 | 自动打开设置面板 | 不弹；内联条上 “Aa” 按需展开，改字号 16 → 24 即时生效 |
| 旧标注（13 px，22 % × 7 %） | — | 200 % 下仍 13 px、几何不变；就地编辑后仅写入文字，无 position 写入 |
| 单击框/手柄 | 每次写一次 position | 不写入；拖动后才写 |

截图（`.tmp/pdf-text-annotation/{before,after}/`，随提交上传）：
before-text-tool-click-1 / -3.35、before-created-1 / -3.35；after-empty-box-1 / -2 / -3.35、after-typing-1 / -2 / -3.35、after-created-*、after-same-annotation-335、
after-edge-typing、after-edge-saved、after-legacy-editing-200、after-style-panel-on-demand、after-fixed-width-typing。

## 验证

- `npx tsc --noEmit -p tsconfig.app.json`：退出 0。
- `npm run test:pdf-text-annotation`：28 项通过（布局函数、边界数学、文本规范化、源码契约）。
- `node scripts/verify-pdf-text-annotation-browser.mjs`（after）：86/86 通过——三档缩放下 无弹窗 / 聚焦 / 起始尺寸 / 字号随缩放 / 横向增长再换行 / Esc 提交且只持久化一次 / 标签与编辑框几何一致；同一标注跨缩放几何一致；旧标注不受新默认影响且编辑后仅写文字；右下角边界；空框丢弃、清空删除；点击外部提交；单击不写入；拖动手柄固定宽度后只增高；Aa 面板按需出现并改字号；IME 合成态（CDP `Input.imeSetComposition`）中 Esc/Enter 不提交、合成结束后正常保存；无页面运行时异常。
- `MODAL_PHASE=before`（在 `Aster-wt/archived-20260920` 上运行同一脚本）：记录基线（弹窗与 22 % × 7 %、13 px）。
- 完整 `npm run verify`（含 `npm run build` 生产构建、全部 `test:*` 源码契约脚本与 Rust 测试）：退出 0，“A4Note verification passed”（日志 `.tmp/verify-logs/verify-2.log`；第一轮 `verify-1.log` 只有 `test:reader` / `test:ui-state` 两步失败，均为上文所述的断言同步问题，已修）。

## 边界与未做

- IME：只用 CDP 模拟了合成事件序列（`isComposing` / keyCode 229 处理路径），**真实 Windows 输入法未验证**，按任务要求标记为未验证项。
- 证据来自隔离 Chrome 中的生产构建组件与合成 PDF（Tauri `load_paper_file_bytes` 桥接为 fetch），不是安装版窗口；未触碰用户文献库。
- 文字标注默认背景仍为透明（沿用原默认值，可在 Aa 面板外的工具设置里改），未改这一默认。
- 与 83352eb5（工具设置面板 / 色块 / 高亮渲染）协调：本任务只改了工具栏“不自动弹出”的逻辑与文字标注自身的内联面板，未改 `ReaderToolPopover` 布局与色块尺寸；高亮层沿用 main 的 `PdfHighlightLayer` 接线。
- 未合并 main、未推送、未打包安装、未重启现用服务；仅提交待检查，由用户验收。
