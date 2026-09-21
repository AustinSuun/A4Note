# 阅读器图形/箭头 Escape 取消草稿 - 青穗

日期：2026-09-21
任务：009cede5-ee59-44f0-9e4f-213171b97158
分支：fix/reader-escape-qingsui
基线：main 18f3ea9

## 问题

审计 F4：图形/箭头工具按下拖动，松手前按 Escape，松手后仍保存记录。原 `PdfReader.tsx` 仅在 window blur 时取消草稿，没有 Escape 处理，且 `finishShapeAnnotation` 闭包读取的 `dragDraft` 来自异步渲染状态，Escape 后紧跟 mouseup 可能读到旧值。

## 改动

- 新增 `src/features/reader/pdf/usePdfShapeDraft.ts`：
  - 同步 ref 保存 live draft，`setDraft` 同步更新 ref 与渲染状态，保证 Escape 后立即生效。
  - `cancel` 清空 ref 与状态，返回是否曾有草稿。
  - `takeDraft` 原子取出并清空，避免二次保存。
  - `useLayoutEffect` 在 documentKey/tool 切换时取消，防止草稿跨文档/工具残留。
  - `useEffect` 监听 `keydown` Escape（忽略 defaultPrevented、isComposing、contentEditable/input/textarea/select/[role=textbox]）与 `blur`，仅在实际取消时 preventDefault/stopPropagation，不干扰文字标注编辑的 Escape。
  - 卸载时清理监听并置空 ref，旧 finish 回调失效。

- 修改 `src/features/reader/pdf/PdfReader.tsx`：
  - `dragDraft` 改由 `usePdfShapeDraft(source.key, activeTool)` 管理。
  - `finishShapeAnnotation` 首行 `takeDragDraft()` 取出并清空，后续沿用原有尺寸校验与保存逻辑，移除原 `setDragDraft(null)`。
  - 其余交互（begin/update）保持不变，沿用新 setter。

- 新增 `scripts/verify-reader-shape-cancel.mjs`：
  - 真实 React/Chromium 生命周期回归，覆盖 rect/arrow/area 三工具：
    - Escape 清除预览且 mouseup 不落库
    - 同步 Escape 后立即 stale finish 被取消
    - blur 取消不保存
    - 零尺寸点击不落库
    - 正常完成恰好一次保存
    - 真实鼠标拖动 + Escape + 释放
    - input/contentEditable 保留自身 Escape
    - composing/prevented/other-key 不被吞
    - document/tool 切换使旧草稿失效
    - idle Escape 不被吞
    - unmount 移除监听并使旧 finish 失效
  - 隔离组件测试，非原生 SQLite 验收；生产持久化回调为 spy，验证不落库逻辑。

## 验证

- `scripts/verify-reader-shape-cancel.mjs`：25 PASS，0 console error/pageerror（已加 data: favicon 规避 404）
- `get_diagnostics` src/features/reader/pdf：0 error
- `npm run build`：通过（tsc -b && vite build）
- `npm run verify`：后台全链曾跑至 test:agent-protocol 后失败（cargo 长耗时），本次提交前已单独跑 build、reader、reader-helpers、dev-live 等关键步骤，待合并后由主工作树补全完整 verify
- 手动检查：Escape 后预览消失、再 mouseup 无落库；blur 同样取消；零尺寸点击无落库；文字编辑框内 Escape 不被拦截

## 未覆盖

- 原生 Tauri 窗口的独立测试库截图与 SQLite 行证据：本任务为纯前端草稿生命周期，持久化由上层传入，组件回归已覆盖不落库语义；如需真实窗口验收，可在 `npm run dev:live -- --instance qingsui --port 1425 --cdp-port 9235` 下复现并截图，当前未执行以避免第二原生实例冲突
- 完整 `npm run verify` 全绿待主分支合并后重跑

## 协调

- 同域进行中 b6c1a566 已归档或独立分支，未改其几何/文字层/工具栏
- 仅改 PdfReader 草稿状态与完成入口，补丁聚焦
