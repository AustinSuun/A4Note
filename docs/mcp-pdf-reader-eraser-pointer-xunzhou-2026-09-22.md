# PDF 阅读器橡皮擦指针坐标与页外边界回归（巡舟，2026-09-22）

## 任务

- 任务：`ecbf83de-3190-45af-b4f4-f23fcb35b7b2`
- 分支：`fix/reader-eraser-pointer-xunzhou`
- 基线：`59ca3364fc71bd9eda8245956ad7e7187ca4a3bb`
- 隔离实例：`xunzhou-eraser`
- 原生标识：`app.aster.research.dev.xunzhou-eraser.wa02eb63e4b`
- 前端 / CDP：`1464` / `9364`
- 范围：只修复橡皮擦预览/命中的坐标来源与页外停止行为；不重做绘画、图层或其他标注工具。

## 运行时复现与判断

在 Windows/Tauri `dev:live` 隔离实例中打开内置双页指南，DPR 为 `1.25`。

### 修复前

在 `118%`、页面未滚动时，渲染层矩形为：

```text
left=424.20001220703125
top=71
width=731.6000366210938
height=1034.8499755859375
```

- 指示环请求中心 `(972.9000396728516, 422.8489916992188)`，实测偏差 `(-0.0000153px, -0.0114978px)`。
- 同一中心点击后，笔迹缺口落在请求的页面 `x=75%` 附近；本隔离实例没有复现所报“右下偏移”，因此不虚构修复前偏移证据。
- 已稳定复现边界缺陷：指示环中心越过页面右边界 `5px` 后环已隐藏，但笔迹仍发生变化。也就是旧逻辑允许“页面外一枚橡皮半径”继续命中。
- 修复前完整数据：`.tmp/eraser-before-result.json`；截图：`.tmp/eraser-before.png`、`.tmp/eraser-before-off-page.png`、`.tmp/eraser-before-final.png`。

判断：现有命中与预览分别内联换算坐标，虽在本次样本中数值一致，却没有共同契约；页外逻辑则明确把页面外半径范围视为可擦除区域。最小且可验证的修复是：建立一次原始 client→PDF 渲染层采样，预览与命中共享；中心一旦离开页面即停止，不做 clamp、DPR 或 zoom 二次乘算。

## 实现

### `src/features/reader/pdf/pdfCoordinates.ts`

新增 `pdfPointerCoordinates(element, clientX, clientY)`：

- 只解析一次 `pdf-render-layer` 与 `getBoundingClientRect()`；
- 同时返回原始 `xPx` / `yPx`、`xPercent` / `yPercent`；
- `inside` 使用严格、未钳制的页面矩形判断；
- 无效数值或零尺寸矩形返回 `null`；
- 不乘 `devicePixelRatio`，也不额外乘 PDF zoom。

### `src/features/reader/pdf/PdfReader.tsx`

- 指示环和实际擦除命中使用同一个 `pdfPointerCoordinates` 契约。
- 任意 `!pointer?.inside` 样本在遍历标注和更新缓存前立即返回。
- 指针捕获、连续拖动的累计几何缓存、精确线段裁剪和保存队列保持不变。

### `scripts/verify-pdf-eraser-precision.mjs`

从 16 项扩为 22 项，新增：

- 分数像素、页面滚动后的 client→pixel/percent 换算；
- 页面外原始百分比继续超过 100%，不 clamp；
- 离开后回到同一位置得到完全相同坐标；
- 指示环与命中必须调用同一 helper；
- 页面外样本必须在接触 ink 之前返回；
- 禁止恢复“页面 + 橡皮半径”可擦除范围。

## 修复后原生验收

CDP 驱动真实 Windows/Tauri WebView，在同一隔离实例中完成三组绘制、预览、单击擦除、按压拖出页面、右侧空白移动、回到页面、撤销/重做、重载和跨页隔离：

| 场景 | DPR | 滚动 | 指示环中心误差 | 重建命中中心误差 | 页外稳定 | 回到页面 | 第 2 页 |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| 100% | 1.25 | 0 | `(-0.000012, -0.003594)px` | `(-0.000014, -0.000001)px` | 通过 | 无跳变 | 未变化 |
| 120% | 1.25 | 0 | `(-0.005012, -0.000652)px` | `(-0.000079, 0.000012)px` | 通过 | 无跳变 | 未变化 |
| 120% | 1.25 | `scrollTop=320` | `(0, -0.011953)px` | `(-0.000076, -0.000024)px` | 通过 | 无跳变 | 未变化 |

说明：脚本内部场景文件名沿用早期 `zoom125` 名称，但实际工具栏与结果 JSON 均记录为 `120%`。

其他结果：

- 三组均只切除接触线段，保留未接触两端；可写可见层共验证 3 条 ink。
- 页面外指示环隐藏，按住移动不再更改 geometry；回到页面后继续按真实坐标工作。
- undo 改回几何，redo 恢复相同的 style/polyline fingerprint。
- 重载后 3 个 fingerprint 全部存在，保存队列为空。
- 第 2 页在全部场景、撤销/重做和重载后保持不变。
- 额外创建隔离验收层：隐藏层 DOM 不存在且擦除后持久 geometry 不变；锁定活动层时 DOM 与持久 geometry 均不变，工具栏 title、ARIA label 和 `role=alert` 明确显示“已锁定，请解锁或切换到可写图层”。测试后所有验收层已解锁，活动/可见层恢复默认层。
- 完整结果：`.tmp/eraser-after-result.json` 与 `.tmp/eraser-layer-result.json`。
- 关键截图：`.tmp/eraser-after-zoom100-preview.png`、`.tmp/eraser-after-zoom125-preview.png`、`.tmp/eraser-after-scrolled-preview.png`、`.tmp/eraser-after-locked-layer.png`。

### 浏览器错误记录

- `pageerror`：0。
- 应用逻辑 console error：0。
- 记录到两次开发服务器 `favicon.ico` 404（初次加载与重载）；与 Reader/标注逻辑无关，未隐瞒或过滤。完整记录保存在结果 JSON。

## 验证

- `npm run test:pdf-eraser-precision`：22/22 通过。
- `npm run test:reader`：通过。
- `npm run test:reader-helpers`：通过。
- `npm run test:annotation-layers`：55/55 通过（脚本按设计会打印锁定/唯一层拒绝错误）。
- `npm run verify`：通过；Rust `215 passed / 0 failed / 5 ignored`，结尾 `A4Note verification passed`。
- VS Code / language service diagnostics（worktree，error+warning）：0。
- `git diff --check`：通过。

`@napi-rs/canvas` / `DOMMatrix` / `Path2D` 警告来自 Node 环境下 pdfjs 的可选 canvas polyfill，定向测试与完整 verify 均以退出码 0 完成。

## 证据文件

任务提交附件使用以下文件（均来自隔离实例或真实命令日志）：

- `.tmp/task-evidence/eraser-before-result.json`
- `.tmp/task-evidence/eraser-after-result.json`
- `.tmp/task-evidence/eraser-layer-result.json`
- `.tmp/task-evidence/eraser-before-off-page.png`
- `.tmp/task-evidence/eraser-after-zoom100-preview.png`
- `.tmp/task-evidence/eraser-after-zoom125-preview.png`
- `.tmp/task-evidence/eraser-after-scrolled-preview.png`
- `.tmp/task-evidence/eraser-after-locked-layer.png`
- `.tmp/task-evidence/relevant-tests.log`
- `.tmp/task-evidence/npm-verify.log`
