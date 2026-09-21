# 阅读器橡皮擦：整块误擦与页外指针漂移修复（qingyan，2026-09-21）

卡片 `8dba61be`（原「跨页拖选高亮/下划线静默失效」）经用户验收后被退回 `queued`。用户确认原跨页实现「实现的不错」，
但追加了两项橡皮擦诉求：

1. 选择橡皮时，指针移出 PDF 页范围会发生位置漂移；
2. 橡皮擦不够细腻——擦除时会把橡皮尚未接触到的附近字迹整块擦掉，并追问「这个和画笔的设计也有关系吗」。

结论：**与画笔设计确有直接关系**。两个现象分别对应三处缺陷，均已修复。

## 根因

### 1. 整块误擦：稀疏采样的笔迹被按「整条边」丢弃

画笔为控制数据量而稀疏采样：`PdfReader.tsx` 的 `updateInkStroke` 仅在位移超过 `0.16`（页面百分比）时才追加一个点，
因此一条视觉上很长的笔迹可能只由少数几个点组成，相邻两点之间是一条很长的直线段。

旧 `eraseInkPosition` 的判定是布尔式的：只要 `segmentTouchesEraser` 判定橡皮与某条边**相交**，就调用 `separate()`
把这条边整段抛弃。于是橡皮只要蹭到长边的任意一点，**整条边覆盖的所有字迹范围都会消失**，这正是用户看到的
「还没接触到的附近字迹一整块被擦掉」。极端情况下，一条两点直线的笔迹被点中中部时，两段都不足 2 点，函数返回
`null`，整条笔迹被删除。

修复：改为**按参数区间裁剪**。`eraserSpanOnSegment` 解析求出线段进入/离开橡皮的参数 `[enter, exit]`
（圆形解一元二次方程，方形用 slab 裁剪），只移除该区间，并在边界处用 `interpolate` 插回新端点。
存活的两侧端点坐标保持不变，缺口宽度恰好等于橡皮直径。

### 2. 页外漂移：橡皮复用了会 clamp 的指针换算

`eraseInkAtPointer` 原本调用 `pointFromEvent`，而该 helper 会 `clamp(..., 0, 100)`。指针移出页面后坐标被钳到
边界值，橡皮便**沿着页边继续擦除**，表现为「位置漂移」。现改为直接用 `getBoundingClientRect` 计算未钳制的
百分比坐标，并在超出「页面 + 橡皮半径」范围时直接 `return`，页外不再擦除。

### 3. 预览圆环被钳制

`updateEraserCursor` 把圆环位置 `clamp` 到页面盒内，鼠标离开页面时圆环贴着页边滑动，与真实光标分离，
这是用户「漂移」观感的另一半。现保留原始坐标，圆环与光标始终重合。

## 改动

| 文件 | 说明 |
| --- | --- |
| `src/features/reader/pdf/pdfInk.ts` | 重写 `eraseInkPosition` 为区间裁剪；新增导出 `eraserSpanOnSegment`；`segmentTouchesEraser` 保留为布尔封装 |
| `src/features/reader/pdf/PdfReader.tsx` | `eraseInkAtPointer` 改用未钳制坐标并增加页外提前返回；`updateEraserCursor` 去掉 clamp |
| `scripts/verify-pdf-eraser-precision.mjs` | 新增回归（16 项） |
| `package.json` / `scripts/verify-all.mjs` | 注册 `test:pdf-eraser-precision` 并接入 `verify-all` |

提交：`c9e95cd`，分支 `fix/eraser-precision-qingyan`，基线 main `498745a`。

## 验证

### 单元回归（16/16）

`npm run test:pdf-eraser-precision`。覆盖：未命中返回同一对象；长稀疏边被裁剪而非整条丢弃；缺口宽度等于橡皮直径；
擦边仅移除极小片段；存活端点坐标不变；全覆盖返回 `null`；覆盖一端只裁该端且不产生断点；方形橡皮按盒边界裁剪；
各向异性半径分轴生效；完全不相交返回 `null`；原有 `null` 分隔符保留；包围盒按存活点重算；`pointInsideEraser` 圆/方契约；
以及三项源码契约（橡皮不使用 `pointFromEvent`、存在页外提前返回、预览环不再 clamp）。

**反向验证**：把 `pdfInk.ts` 与 `PdfReader.tsx` 临时换回 `main` 版本后重跑，测试在
「a long sparse edge is clipped, not discarded wholesale」处失败，实测旧代码对一条两点笔迹的中部单击返回 `null`
（整条删除），与用户描述一致，确认测试确实能捕获该缺陷而非空跑。

### 隔离实例实测（`qingyan` / 1433 / 9243）

真实 Tauri 窗口 + CDP 真实鼠标，样本为内置《A4 Note 使用指南》PDF：

- 用自由画笔画一条横贯页面的笔迹 → 1 条 ink，`polyline` 点数 `[41]`；
- 切换橡皮，在笔迹**正中单击** → 仍为 1 条 ink，`polyline` 变为 `[21, 21]`：笔迹从中间断开为两段，两端完整保留；
  截图 `.tmp/shots/ink-after-erase.png` 可见蓝色笔迹中央仅有一个与光标等大的圆形缺口，周围文字未受影响；
- 预览圆环定位：期望 `(790, 433)`，实测 `(790, 433)`，**漂移 0 px**；
- 按住左键从页内拖出页面右侧 150 px、400 px → `polyline` 保持 `[21, 21]`，**页外不再擦除**；
- 隔离 SQLite 只读复核：`ink` 行 1 条，`runs=[21, 21]`、`total_points=42`，与 DOM 一致；
- 全程 `pageerror` / `console error` 为空。

### 全量

`npx tsc --noEmit` 退出码 0；`npm run verify` 输出 `A4Note verification passed`（含新回归，Rust 209 passed / 0 failed）。

## 未覆盖项

- 仅验证了圆形橡皮的真实鼠标路径；方形橡皮与各向异性半径只有单元覆盖，未在真实窗口逐一回放。
- 未验证触控笔/触屏 pointer 事件，仅覆盖鼠标。
- 笔迹稀疏采样阈值（`0.16`）本身未调整；本次只让擦除与既有采样精度相匹配，未提高画笔采样率。
- 未安装、未发布、未重启 4319；未触碰真实资料库，隔离实例已退出且锁文件已清理。
