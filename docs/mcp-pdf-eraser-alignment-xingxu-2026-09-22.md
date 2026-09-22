# PDF 橡皮擦圆环与实际命中对齐

- 任务：`fcd4d8d6-a1bb-46cb-b960-469127d50437`，spec2，星序。
- 分支：`fix/eraser-alignment-xingxu`；独立 worktree `.worktrees/eraser-xingxu`。
- 原生：官方 `dev:live`，实例 `eraser-xingxu`，1468 / CDP 9268，身份 `app.aster.research.dev.eraser-xingxu.we087c6dd3f`。所有原生截图保留 DEV 独立测试库条。未接触正式资料库，未打包、安装、推送或发布。
- 参考附件 `159c653e-7968-4e98-b7ae-0fec6a4029b0` 已下载查看，SHA256 `9057809e2a551e723b3828d7e49aaee2d41da0f8cf2d488433cbaa84eafc4571`。早期 404 为转录错误，并非附件缺失。

## 先复现，后改产品

修复前在包含当前 Reader/文字层/图层入口改动的 main 代码（`0bf3081`）上，通过真实 Windows/Tauri 打开 Mean Flows PDF，工具栏选蓝色 `#5c8edb`，用真实鼠标画笔生成笔迹、滚动并擦除。不是以合成 DOM 或旧卡通过结果代替原生复现。之后合入 main `0004643` 的文档更新，保留双方状态记录。

相同四场景分别执行 `probe.mjs before-blue` / `after-blue`；截取按住指针时圆环与真实缺口共存的画面。单位均为 CSS px：

| UI / PDF | 修复前圆环−指针 (x,y) | 修复后圆环−实际缺口中心距离 | 修复后直径 / 缺口宽度 |
|---|---:|---:|---:|
|100% / 100%|约 (0,0)|0.00624|18 / 17.99933|
|80% / 100%|(-46.52248,-53.85000)|0.00004|14.40000 / 14.39973|
|140% / 100%|(+162.78248,+155.21999)|0.00621|25.20000 / 25.19987|
|80% / 370%|(-134.93875,-164.10936)|0.00622|14.40000 / 14.39977|

原始 JSON 记录 pointer client 点、page/render rect、local 尺寸、UI/PDF zoom、scroll、DPR、圆环 DOM 中心、真实 SVG 分段和缺口中心。另有原生回读的 `position_json` 及连续拖动采样帧，不能把“预测会命中”冒充实际裁剪。

## 根因与最小修复

`client - rect.origin` 已经是缩放后的 viewport CSS 偏移；旧预览直接把它作为层内 `left/top: px`，受 UI zoom 再缩放一次。旧命中半径又用 viewport rect 除 local CSS 工具直径，造成圆环直径与真实缺口不一致。此问题不需要移动文本层或硬编码侧栏补偿。

1. `pdfCoordinates.ts` 在既有采样中保留 rect/raw pixels/inside/page percentages，增加 computed local layout width/height（测试/不可测量节点回退 client 尺寸、再 rect）。
2. `PdfReader.tsx` 预览状态存页百分比；命中半径为 `eraserSize / layoutSize * 50`。
3. `PdfPageView.tsx` 用百分比定位圆环中心，直径仍是原来的 local CSS 工具尺寸。

未改精确线段裁剪、图层权限、pointer capture、页外停止、累计保存、乐观几何、错误重试/放弃反馈；没有固定 x/y 偏移、DPR 乘数或按缩放特判。文字层仍与标注共用 render layer。

## 验证

- `test:pdf-eraser-precision`：26 项通过（包括原来的裁剪/页外断言）。
- 新 `test:pdf-eraser-alignment`：真实 PdfReader + PdfTextLayer + 两页 PDF，217 检查 / 24 场景通过；UI 70/80/100/118/140/200%、PDF 100/118/140/350%、侧栏偏移/滚动、840px 窄窗、0.85 compositor scale、圆/方形与 DPR 1/1.25/1.5。真实 DOM 与 SVG 缺口对齐，禁止只做源码字符串断言。
- 旧产品红测：UI80 / PDF118 的真实 DOM 圆环误差 110.316085px，退出 1；修复后通过。before 目录和失败日志保留。
- 原生追加四场景：PDF118%、PDF140%、fit-width × 侧栏开/关、1100/840px resize，通过；中心误差均小于 0.0063px，直径误差小于 1px。
- 原生专项：45 检查通过。DPR 模拟三档的原生 `get_annotation` 回读缺口中心/宽度；undo 精确恢复、redo 精确恢复裁剪几何；快速连续拖动五帧坐标/实际 SVG 记录，无断跳/多余碎岛；按住离页/右侧空白不再擦除，回入不跳，松手后 hover 不擦除，离页清除预览；未接触相邻蓝线、其他页、隐藏层几何逐字相等；reload 后原生 JSON 和界面两段一致；锁定层不修改且保留明确反馈。
- 正常原生场景 pageerror / console error 为 0；锁定负测产生 1 条预期 `Annotation operation failed … 已锁定` 日志，原样保留并单独分类，未把它隐瞒成“所有流程 0 error”。
- PowerShell `npm run verify` 退出 0，包含 build/TypeScript、Reader/selection、文字层、图层、橡皮、全部既有验证及 Rust 215 passed / 0 failed / 5 ignored。Reader 范围 diagnostics 0。

### 测试工具修正说明与限制

初版原生脚本误把松手后仍在页内的合法 hover 圆环要求为隐藏；改为验证松手不再擦除、移出页后清除，没有修改产品交互。锁定负测日志明确分类为预期拒绝。窄窗脚本先恢复宽窗再使用可见缩放控件，避免把隐藏按钮超时当作产品回归。所有最终成功结果依据进程退出码与完整检查；浏览器 JSON 仅在全部场景结束后标记 passed。

成对 before/after 原生截图使用宿主原始 WebView DPR 1.25（未设置 metrics override）。追加的 DPR 1/1.25/1.5 与窄窗矩阵使用浏览器/WebView metrics 模拟，不等价于三台物理 DPI 显示器；未取得物理 DPR 1/1.5 环境，物理多屏独立验收仍由用户/验收者完成。浏览器夹具的持久化是内存回调，原生保存证据来自另一路真实 Tauri native API，不混为一谈。开发者证据不是独立验收。

## 证据与复跑

- `.tmp/shots/eraser-alignment/{before-blue,after-blue}-result.json` 与同名前缀 PNG。
- `.tmp/shots/eraser-alignment/native-matrix-result.json`、fit-width/窄窗 PNG。
- `.tmp/shots/eraser-alignment/native-contract-result.json`、`native-persisted-gap.png`、`native-locked.png`；含五帧连续坐标和三个原生标注回读。
- `.tmp/shots/eraser-browser/{before,after}/result.json`；`.tmp/eraser/{browser-before,browser-final,verify}.log`。
- 私有原生驱动 `.tmp/eraser/{probe,native-matrix,native-contract}.mjs` 只面向该隔离实例；不得改端口后盲目运行到正式库。证据压缩包包含这些脚本以便审查，不纳入通用产品测试入口。
- 可重复 CI：`npm run test:pdf-eraser-precision`、`npm run test:pdf-eraser-alignment`、PowerShell `npm run verify`。

交付必须由本地 main 包含最终交付 SHA 后提交；准确交付/合并 SHA 由任务卡 delivery JSON 绑定。用户检查实际效果并验收，执行者不自行归档。
