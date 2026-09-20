# Merge Round2 报告（2026-09-20）

基线 main c66f7f5 → 合并后 main baa018e。本地合并，不推送；本地打包 0.1.23，不安装不发布。

## 范围（12 项）

- 分支直合 3：f2528fae + 7f3debcf（9362cdd）、04922ea7（8b7e51a）。
- 脏树移植 7：a2967d26、865be9f6、e220fdf6、f376994b、849245b5、2a6ec117、fdcf97df（baa018e）。
- 纯复核 1：a14eca65（无代码，免动）。7281de4c 被分支覆盖，免动。

## 移植清单（baa018e，13 改 + 12 新）

- 整体取 8：AnnotationMark、AnnotationOverlay、ReaderToolPopover、
  library_annotations.rs、pdf/types.ts、pdfAnnotationHelpers.ts、
  taskboard-dialog.css、verify-annotation-history.mjs。
- 新文件 12：7 个 reader 源（高亮外观 ×4、inline-text ×2、PdfHighlightLayer）
  + 5 个 verify 脚本（arrow-width、inline-text-escape、inline-text-height、
  pdf-highlight、task-modal-review-ui）。
- 手术移植 5 处：toolbar 箭头步长 0.2→0.1 + 高亮控件接线；nativeApi
  created_at 返回类型；history 用服务端时间戳；TaskBoard 复核摘要置顶；
  PdfReader inline 文本编辑（state/reset/打开×2/saveInlineText/接线）。

## 为变绿做的 2 处修正

1. editSticky 死三元 `annotation.type==='text'?...` → `'#fff4b8'`
   （新 text 分支 return 后必然收窄为 comment；与工作区 fdcf97df 版逐字一致）。
2. TaskBoard `DetailSection` → `detailSection`（main c66f7f5 预存笔误，tsc 必红）。

## 排除（未归档在途工作，一律未合）

pdfInteraction 字体随框缩放；PdfResourceTab/Portal/PdfPageView/geometry/
findbar/pan/zoom 脏区；provisionSummaryNotes；TaskServiceControls 接线。

## 验证（集成区，全部绿）

- tsc -b：0 错误。
- verify-inline-text-height：23 断言；verify-pdf-highlight：42 断言；
  verify-annotation-history：175 断言。
- cargo timestamp_tests：1 passed。
- 6 个 browser 脚本 node --check 全过（本机无 playwright，不可跑；
  归档时已在各自环境通过）。
- 依赖闭包扫描：已移植文件的一阶依赖中，仅 pdfInteraction 有工作区
  新增（已排除），其余皆为 main 超前或已移植。

## 打包 0.1.23

- 0.1.22 已被 round1 占位（package/0.1.22-archived-main），故取 0.1.23。
- 源提交 baa018e（dirty=true：仅版本号未提交，main 保持 0.1.9 惯例）。
- 产物：artifacts/windows/latest（exe + 安装包 + 签名 + latest.json 0.1.23，
  updaterSigned=true）；旧 latest 已按惯例归档到
  archive/0.1.23-20260920-213520-30116。
- Exe SHA-256：621392B4773F7BC299E2D3170BB9D5BD51B3665CB282DEB3394783843DC93C573
