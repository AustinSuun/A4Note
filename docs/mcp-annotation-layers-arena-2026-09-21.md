# 标注图层系统第一阶段：数据模型、Reader 入口、图层管理与按层加载（任务卡 fb5e3f2f）

- 日期：2026-09-21；执行者：Arena（任务板 worker「Arena执行」）。
- 任务卡：`fb5e3f2f-0bef-4b64-a296-02a7466c1d19`（high）。
- 分支：`feat/annotation-layers-arena`，基于 `main 498745a`（工作树 `.worktrees/annotation-layers-arena`）。
- 提交：`bb45843`（模型/迁移/CRUD/前端状态）、`a353318`（Reader 入口、选择器、管理页、列表分组）、`507210a`（前端 reducer/竞态测试、Rust 性能夹具、layer/created 索引）、`e0dc81c`/`52a58f1`/`2ca97e1`（整层移动取自 store、对话框焦点回退、入口宽度、nativeApi 保持仅类型导入）、`93e551b`（合入 main 78dbc43）、`fc59a0a`（报告/状态）。

## 1. 领域模型与存储

- `annotation_layers`：`id, owner_kind('paper'|'resource'), owner_id, name, sort_order, kind('default'|'layer'|'attempt'), locked, archived_at, created_at, updated_at`，索引 `(owner_kind, owner_id, sort_order)`。paper owner 覆盖同一文献的源文件与译文标注；resource owner 覆盖通用资源，同一套规则（`src-tauri/src/annotation_layers.rs`）。
- `annotation_layer_views`：按 owner 记忆 `active_layer_id` 与 `visible_layer_ids_json`。活动层与可见层是不同状态；重启后 Reader 回到同一学习图层；损坏/缺失的偏好在读取时修复（活动层必须存在且未归档，可见层只保留存在的未归档层，活动层始终可见）。
- `annotations` / `resource_annotations` 增加 `layer_id TEXT NOT NULL DEFAULT ''`（旧库用 `ensure_column` 增列），索引 `(paper_id, layer_id, file_id, page)`、`(paper_id, layer_id, created_at DESC)` 及资源侧对应索引；图层信息不进入 `position_json`。
- 迁移（`database.rs::initialize_database`，`MIGRATION_REVISION = startup-2-annotation-layers`）：增列 → 建索引 → `backfill_layers`：为每个 paper 与每个有标注的 resource 创建确定性 id 的默认层（`layer-default-<ownerId>`），把 `layer_id` 为空/悬空的行回填到该层。全部在同一个 `IMMEDIATE` 事务内，与 ledger 完成标记一起提交；`INSERT OR IGNORE` + 条件 `UPDATE` 保证重复执行无重复层、无重复回填；失败回滚后下次启动重试。annotation id、paper/file/resource 归属、position、created_at 与笔记 `@annotation(id)` 引用不变（测试 `legacy_rows_join_the_default_layer_and_keep_identity_across_repeated_migrations`）。
- 兜底：任何按层读写前 `ensure_owner_layers` 只读检查 owner 是否已有层/是否有悬空行，仅在需要时写入，因此启动摘要对每篇文献的调用在常态下不产生写事务。

## 2. 图层规则（native 统一实现）

- 可写层 = 未锁定且未归档。`create/restore/update_*/delete/move` 都经 `assert_layer_writable_for` / `assert_annotation_writable`，锁定或归档层返回可读提示（「图层「X」已锁定，不能新增、修改或删除其中的标注」）。
- 创建请求携带 `layer_id`（前端在写入开始时捕获活动层；旧客户端留空时退回 owner 的活动层）；恢复请求携带快照中的 `layer_id`，撤销删除不会落入之后选择的层。
- `move_annotations_to_layer` 只改 `layer_id` 与 `updated_at`：id、几何、颜色、`created_at` 不变；来源层或目标层锁定即拒绝；不能跨 owner 移动。
- 归档/删除都要求 owner 仍有至少一个未归档层；`preview_annotation_layer_delete` 返回标注数、引用该层标注的笔记数（按 `@annotation(id)` 文本匹配）与可接收的目标层；`delete_annotation_layer(mode=move|purge)` 在一个事务内移动或删除标注再删层，视图自动回退到默认/首个层。
- 删除 paper 时同时删除其图层与视图行。备份/恢复是整库快照，图层、顺序、归档/锁定状态与归属随库还原。
- 有界读取：`PaperSummary.annotations` 只包含可见层的标注；`list_paper_annotations(paper_id, layer_ids)` 按层懒加载；`get_annotation(id)` 解析隐藏层中的引用；图层列表用一条聚合查询取计数（无 N+1）。

## 3. 前端

- `src/core/types.ts`：`Annotation.layerId`、`AnnotationLayer/View/State/DeletePreview`；`src/platform/nativeApi.ts`：图层命令封装与 `layer_id` 映射。
- `src/features/reader/useAnnotationLayers.ts`：按 owner 缓存图层状态与「已加载层」集合；显示隐藏层时按需拉取并合并到 `paper.annotations`（按 id 去重）；每次状态变更递增 token，过期响应不覆盖新状态；切换文献互不干扰；非 Tauri 运行时提供本地图层状态以便浏览器开发。提供 `writeLayerId()` / `writeBlockedReason`、`revealAnnotation(id)`（隐藏层先显示、归档层先恢复再定位）、`refresh()`。
- `useAnnotationHistory.ts`：`createAnnotation` 在调用时捕获目标层（排队期间切层不串层，锁定层直接以可读原因失败）；新增 `move` 历史动作（撤销按来源层分组回移）；create/delete/restore 快照携带 `layerId`。
- `App.tsx`：`AnnotationLayersContext` 包裹 ReaderScene；Reader 只收到可见层标注（`withVisibleLayers`），隐藏层不生成 AnnotationMark / SVG rect / 命中对象；笔记与关系面板定位标注时若目标在隐藏/归档层，先显示该层再聚焦并提示。
- `ReaderToolbar.tsx` + `AnnotationLayerPicker.tsx`：标注工具坞末尾的图层入口（叠层图标 + 活动层名 + 可见/总数），随现有工具坞在紧凑标题栏下保持可达；快速选择器为 `radiogroup`（方向键切换焦点），每行眼睛/锁按钮带 `aria-pressed` 与 `aria-label`，活动层不可隐藏；操作：新建空白图层、新建学习记录（空白 attempt 层设为活动并只显示自身，自动命名「第 N 次学习 · 日期」）、管理图层…（打开侧栏标注页的管理页）。
- `AnnotationListPanel.tsx`：图层筛选、多可见层时按层分组并显示层名/锁定徽标、单条「移到…」；`AnnotationLayerManager.tsx`：重命名、上下移、显示/隐藏、锁定、归档/恢复、整层移动、`alertdialog` 两步删除（显示标注数与引用笔记数，先移动或勾选确认后永久删除，取消不改数据，关闭后焦点回到触发按钮），`role="status"` 实时反馈。

## 4. 测试

- Rust（`cargo test`，共 214+ 项通过）：`annotation_layers` 6 项——旧行回填与重复迁移幂等、三次学习记录命名/顺序/只显示新层且历史保留、锁定拒绝写入与移动保持 id、恢复落回快照层、删除需保留一层且 move/purge 原子、视图偏好损坏修复与归档回退、资源 owner；既有 `library_tests`/`startup_tests`/`integrity`/`backup` 测试随迁移通过。
- 性能夹具（`perf_fixture_twenty_layers_ten_thousand_annotations_use_the_layer_index`）：20 层 × 500 = 10,000 条。实测（`cargo test --lib annotation_layers -- --nocapture`）：
  - 可见层读取（500 行）3.01 ms；全部 20 层（10,000 行）20.65 ms；图层计数聚合 0.82 ms；切层（写视图 + 有界读取）19.35 ms；种子写入 69 ms。
  - 查询计划：`SEARCH annotations USING INDEX annotations_by_layer_created (paper_id=? AND layer_id=?)`；计数走 `annotations_by_layer_*` 覆盖索引。
- 前端（`npm run test:annotation-layers`，51 断言）：默认层加载、学习记录清空视图、显示已加载层不重复拉取、活动层不可隐藏、锁定阻断写入、归档退出视图；隐藏层首次显示的懒加载、慢响应被后续状态取代且每层只加载一次、切换文献缓存隔离；定位隐藏/归档层标注、移动保持 id、删除预览与最后一层保护、purge 清理内存；历史：调用时捕获写入层、锁定层拒绝且无 native 调用、move 可撤销/重做、恢复使用快照层；源码契约（Reader 只见可见层、选择器/管理页可访问性属性）。
- 既有：`npm run test:reader`、`node scripts/verify-annotation-history.mjs`（175）、`verify-architecture-boundaries`（lib.rs 仍在 160 行封顶内）、`verify-reader-rendering`、`test:ui-state`、`npm run build` 通过。

## 5. 隔离实例验收（真实窗口 + SQLite）

- 构建：`.tmp/f4/build-f4.mjs`（`tauri build --debug --no-bundle`，身份 `app.aster.research.dev.arena-f4.*`，端口 1487 / CDP 9317）。
- 驱动：`.tmp/f4/f4-layers-driver.mjs`（独立 HOME/AppData/WebView2 profile、`checkDevAdmission`、CDP 真实鼠标、`node:sqlite`）。合成 PDF 两页，每次运行清空隔离库。**56/56 通过**（`.tmp/f4/evidence/summary.json`、`driver.log`、截图 `01`–`08`）：
  1. 旧标注入默认层：关闭应用后直接写入 2 条 `layer_id=''` 的行并删掉图层/视图行，再启动 → 两行都落到 `layer-default-<paperId>`，id/position/created_at 不变，页 1 渲染 2 个高亮；工具坞图层入口在视口内，显示「默认图层」与 1/1。
  2. 连续三次「新建学习记录」：每次新层为活动层、名为「第 N 次学习 · 日期」、只显示自身，页 1 无历史标记（0 个 mark/0 个 SVG rect），新高亮写入当前学习记录；入口显示 1/4；数据库仍保留全部 5 条记录。
  3. 叠加历史：选择器里显示默认层的眼睛 → 页 1 同时显示第 3 次的 1 条与旧的 2 条（3 个高亮），隐藏的第 1/2 次不渲染；入口 2/4。
  4. 管理页：锁定活动层 → 入口标出阻塞、拖选高亮不产生记录并显示「已锁定，请解锁或切换到可写图层」；解锁；整层移动（第 1 次 → 默认层）保持 id 只改 `layer_id`；归档第 2 次后选择器不再提供该层，恢复后回到使用中；删除对话框显示标注数并获得焦点，取消不改数据；对第 2 次选择「先移动」删除 → 标注 id 不变落入默认层、层被删除；对第 1 次选择永久删除 → 需勾选确认，删除后焦点回到管理页。
  5. 重启：关闭进程再启动，活动层与可见数量（2/2）与重启前一致，可见层标记照常渲染。
  6. 20 × 500 夹具：关闭应用写入 20 层 × 500 条（共 10,000 + 5 条），只显示第 20 层 → 重新打开后 DOM 中 `.annotation-mark` 500 个、SVG rect 500 个（两页），JS 堆 39 MB；再显示一层 → 1000 个标记，最长 long task 466 ms，堆 50 MB；隐藏后回到 500 个；切层期间 PDF canvas 元素保持同一实例（未重建位图/文字层）。

## 6. 边界与后续

- 第一阶段不含 OCR 判题、成绩统计、答案系统与云端协作；`kind='attempt'` 即一次学习/练习 session，模型可扩展到题库、图片等 resource。
- 不使用 PDF Optional Content Group；不改变几何、颜色、字号与渲染算法。
- 同步：当前笔记同步不覆盖标注与图层（`sync_*` 表仅有笔记）；多设备图层同步属于后续边界，未声称支持。
- 通用 resource 阅读页目前写入其默认层（`PdfResourceTab`），图层选择器仅接入 paper Reader；resource 端后续复用同一 hook 即可。
- 撤销历史中的 move 在图层被永久删除后会因目标层不存在而失败并提示，不会重建孤儿记录。

## 7. 运行记录

- Rust：`cargo test`（src-tauri）214 项通过；`annotation_layers` 6 项含性能夹具，数据见 §4。
- 前端：`npm run test:annotation-layers` 51 断言；`verify-annotation-history` 175；`verify-reader-rendering`、`verify-architecture-boundaries`、`test:ui-state`、`test:reader-helpers` 通过；`npx tsc -b`、`npm run build` 通过。
- 隔离实例 arena-f4：56/56（§5）。
- `npm run verify`：在 `2ca97e1`（含全部功能提交）上全量通过（`.tmp/f4/verify2.log`）；合入 main 78dbc43 后在 `fc59a0a` 上复跑，仅 `apps/project-tasks/test/onboarding.test.mjs` 出现一次环境性失败（同机其他 Agent 并行占用服务端口），单独重跑 `npm run test:project-tasks` 86/86 通过，其余步骤全部通过（`.tmp/f4/verify3.log`）。
- 性能说明：一次显示 500 条标注的层会触发约 0.5 s 的渲染长任务（React 标记节点 + 高亮 SVG），没有页面级冻结；进一步降低需要按可见页虚拟化标记渲染，列为后续优化。
