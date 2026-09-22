# 文本标注控件简化与文字颜色绑定（青岚）

## 范围

任务 `54576b3e-88a1-4d35-890c-575501d503bb`，spec 4。独立分支 `feat/text-annotation-controls-qinglan`，基线 `9714b06292ddb0e192e488cc465e56cb520bef5a`。

## 根因与实现

- 文本字形颜色渲染自 `positionJson.textColor`，原悬浮色点却读取并更新通用 `annotation.color`，因此色点变化不能可靠代表或修改文字前景色。现在文本标注的悬浮颜色入口统一读取 `textColor`，预设色与自定义色均通过现有 `onUpdateTextStyle` 持久化；非文本标注继续走原通用颜色路径。
- 移除文本工具展开面板的字号、文字外框开关及外框色板；保留文字颜色、背景/无背景、加粗和倾斜。仅删除 UI，历史 `fontSize`/`borderColor` 和缩放、布局、持久化语义不变。
- 移除选中态悬浮栏的 `Aa` 与二级样式/字号面板，直接提供独立 B/I 按钮，支持组合、`aria-pressed`、可见焦点和键盘原生按钮操作。
- 删除两个字号下拉组件及对应无引用 CSS，不以 `display:none` 留空壳。

## 验证

- `npm run build`：通过。
- `npm run test:pdf-text-annotation`：33/33。
- `node scripts/verify-pdf-text-annotation-browser.mjs`：97/97；覆盖真实 PdfReader DOM 的直接 B/I、pressed 状态、文字色写入 `positionJson.textColor` 且不改 `annotation.color`、固定/自适应框缩放、编辑、边缘放置、IME 与重叠标注；pageerror 0。证据在 `.tmp/pdf-text-annotation/after`。
- `git diff --check`：通过。

## 边界

未改内部字号与遗留外框字段，未改其它图形/箭头颜色与边框设置，未触碰橡皮坐标修复。未打包、安装、推送或发布。
