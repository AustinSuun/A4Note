# 资料库大文件存放位置（6557dc15）— arena 交付记录

- 任务：`6557dc15-7413-4b09-887e-38a7be6de6e6` 资料库大文件存放位置：浏览器插件采集的 PDF 与译文 PDF 不再默认写入 C 盘，可选存储目录并支持迁移（spec 1，用户原话：插件下载的 PDF 与译文文件不要放到 C 盘）。
- 分支：`feat/library-files-root-arena`（worktree `.worktrees/storage-root-arena`），基线 main `f891c15`；交付与合并 SHA 见任务卡。
- 边界：未打包、未安装、未推送、未发布；不改 paper/file 数据模型语义与 PDF 阅读/标注；macOS/Linux 保持既有默认（无推荐盘、无磁盘空间读数）。

## 1. 现状与根因

所有库内文件都由 `src-tauri/src/app_paths.rs` 的 `app_data_root()`（Tauri `app_data_dir` → `%APPDATA%\<identifier>\AsterData`）派生：`library_import.rs` 把原文复制到 `files/papers/<paper>/source.pdf`、译文写到 `translated.<lang>.<file>.pdf`；`capture/ingest.rs` 把插件采集的 PDF 入库到 `files/papers/<paper>/captures/<id>/`，采集下载缓存在同级 `A4CaptureData/items/`（1 GiB 上限）；`guide.rs`、`library_summaries.rs`（`总结.md`）、`library_papers.rs`（删除文献目录）、`backup.rs`、`diagnostics.rs` 各自再拼一次 `root/files/papers`。Windows 上这一切都在系统盘。`paper_files.path` 保存的是绝对路径。

## 2. 实现

### 2.1 后端 `src-tauri/src/storage.rs`（新增）

| 能力 | 说明 |
| --- | --- |
| 配置 | `<AsterData>/storage.json`：`{ version, filesRoot, promptDismissedAt }`；临时文件 + rename 落盘；相对/空值忽略 |
| 解析入口 | `files_root(root)` = 配置目录或 `<AsterData>/files`；`papers_root(root)` = `<files root>/papers`；`capture_cache_root()` = 自定义时 `<files root>/capture`，否则沿用 `A4CaptureData`；`known_papers_roots()` 同时给出当前与默认目录（未迁移时旧文件仍可打开/删除） |
| 校验 `validate_candidate` | 绝对路径、不含 `.`/`..`、不是盘根；沿用 `dev_environment::safe_path` 拒绝符号链接/联接点；不能在 AsterData 内也不能包含 AsterData；隔离实例（dev:live）必须留在 `<身份>/` 目录内、生产必须在 AppData 之外；`create_dir_all` + 写探针文件确认可写；返回是否系统盘与磁盘剩余/总量 |
| 磁盘 | Windows `GetDiskFreeSpaceExW`（剩余/总量）、`GetLogicalDrives`+`GetDriveTypeW` 找剩余最多的非系统固定盘（≥2 GiB）→ 推荐 `X:\A4Note\files`；隔离实例推荐 `<身份>\A4NoteFiles`；`dir_size` 统计文件占用 |
| 迁移 `migrate_files_root` | 全程持 `library_import::IMPORT_LOCK` + 全局 `MIGRATING` 标志；枚举旧 `papers` 树（含符号链接即拒绝）→ 目标磁盘剩余空间 ≥ 总量 + 64 MB → 逐文件复制并按大小 + SHA-256 校验（目标已有同内容跳过、不同内容报错）→ 事务内把 `paper_files.path` 前缀改写到新目录（`backup::suffix_under`，Windows 大小写不敏感）→ 写 `storage.json` → 删除旧文件与空目录。任一步失败或取消：删除已复制文件、数据库与配置不变；配置写失败则回滚数据库路径。进度经 `library://storage-migration` 事件推送（copying/database/cleanup/done） |
| 命令 | `get_library_storage`、`validate_library_files_root`、`set_library_files_root(path, migrate)`（`path=null` 恢复默认；`migrate=false` 只影响新文件）、`cancel_library_files_root_migration`、`dismiss_library_storage_prompt` |

调用点全部改走解析入口：`app_paths::get_aster_paths().files_root`（设置页/诊断/「打开文件库」）、`library_import.rs`（原文/译文）、`capture/ingest.rs`（采集入库目录与越界校验）、`capture/library_api.rs`（`open_file` 接受当前与默认两个根）、`capture/native_runtime.rs`（采集缓存目录，`capture.db` 仍留 `A4CaptureData`；重启后生效）、`library_papers.rs`（删除文献时清理两个根下的目录）、`library_summaries.rs`（总结托管目录 + 反链接检查）、`guide.rs`（内置指南 PDF 与修复）。`library_import`/`ingest` 在取得导入锁后再检查 `ensure_not_migrating()`：迁移期间新导入/采集会等待锁释放、落到新目录，不会写进旧目录。

### 2.2 备份与恢复（`backup.rs`）

备份复制的是 `papers_root(root)`（外部目录同样进入备份，manifest `files_root` 记录实际来源）；恢复时目标为当前 `papers_root(root)`：旧树先重命名到同卷的 `.restore-old-files-<token>`（默认布局仍在 AsterData 下，外部布局在文件根下，`restore_scratch_home`），再用 `move_dir`（同卷 rename、跨卷复制后删除）把暂存树放到位；`recover_interrupted_restore` 按同一规则回退。既有 `integrity_*` 测试全部保持通过。

### 2.3 前端

- `src/features/settings/sections/LibraryStorageSettings.tsx`（新增，挂在 设置 → 资料库 → 「文件存储位置」，`catalog.ts` 可搜索）：当前文件目录 + 复制、`默认/自定义 · 系统盘 · 已占用 · 磁盘剩余/总量`、推荐提示、「同时迁移现有文件」复选（默认勾选）、按钮「选择目录…」（`plugin-dialog` 文件夹选择 → 后端校验 → 保存）、「使用推荐位置」、「恢复默认位置」、「打开所在文件夹」、迁移中的进度条（`role=progressbar`、复制/写库/清理阶段文案、当前文件）与「取消迁移」；结果/错误经 `#library-storage-status`（status/alert live region）播报，成功后刷新宿主路径。
- `src/features/library/LibraryStorageNotice.tsx`（新增，资料库场景顶部）：仅在「默认位置 + 有推荐盘 + 未选择过」时出现，一次性提示把 PDF/译文移出系统盘，「使用推荐位置」（迁移）或「保持默认，不再提示」（写 `promptDismissedAt`）；已有用户不会被静默迁移。
- `src/platform/nativeApi.ts`：类型与 6 个封装 + `formatByteSize`；`zh.ts` 导入提示改为「复制到资料库文件目录（可在设置中更改）」。

## 3. 验证

- Rust：`cargo test` 235 passed / 0 failed / 5 ignored（连续两轮；含新增 `storage::tests` 5 项：默认解析与配置回读、校验矩阵、迁移往返、冲突与取消不改库、不迁移切换保留旧绑定）。首轮曾暴露两个问题并已修复：备份恢复回退目录位置（默认布局保持原位）与迁移标志检查放在导入锁之后（避免与并发导入互相误判）。
- 前端：`npx tsc --noEmit` 0；`npm run build` 通过；`test:settings-ui` 116/116；新增 `npm run test:library-storage-browser` 31/31（真实 `LibraryStorageSettings` + `LibraryStorageNotice` 跑在脚本化 `__TAURI_INTERNALS__` 上：默认态事实/推荐/按钮、提示卡与不再提示、迁移进度条与 aria-valuenow、完成后状态与命令参数、不迁移切换、目录被拒绝、取消选择、恢复默认、迁移取消、空间不足告警、键盘可达、无 pageerror），已加入 `scripts/verify-all.mjs`。
- 完整 `npm run verify`：见任务卡验证字段（worktree 内运行）。
- dev:live 隔离实例 `arena-storage`（1467 / CDP 9367，身份 `app.aster.research.dev.arena-storage.w16aca31389`，含 DEV 状态条，pageerror/console error 0）——`.tmp/shots/library-storage/native/`：
  - `00-library-notice`：默认位置在系统盘，资料库场景出现推荐提示（隔离实例的推荐目录按规则留在实例目录 `<身份>\A4NoteFiles`）。
  - `01-settings-default` → 点「使用推荐位置」→ `02-settings-after-migration`：`已把 3 个文件（1.1 MB）迁移到 …\A4NoteFiles\papers，数据库已更新 3 条记录`；磁盘核对：旧 `AsterData\files\papers` 目录消失，新树 3 个文件，`storage.json.filesRoot` 指向新目录。
  - 真实导入（`import-probe.json`）：切换到自定义目录后 `import_pdf_to_library` 新文献落在 `…\A4NoteFiles\papers\paper-e7cd47d3…\source.pdf`，`import_translated_pdf_to_library` 落在同目录 `translated.en.*.pdf`，期间默认 `AsterData\files\papers` 不存在（AppData 下无新增大文件）；`03-settings-custom-after-imports`、`05-library-after-imports`（文献列表可见新文献）。
  - `04-settings-dark-150`：深色主题 + 150% UI 缩放，块内完整不裁切。
  - `06-settings-restored-default`：「恢复默认位置」把 4 个文件迁回、数据库更新 4 条、自定义目录清空删除；随后探针再次往返 6 个文件同样成功。
- 浏览器采集缓存：`Service.root` 在启动时解析，切换后「下次启动生效」已在设置文案中说明；采集入库目录即时生效。

## 4. 限制与后续

- 采集下载缓存（`items/`）不随迁移搬动（已入库副本才是资料，缓存可重新下载）。
- 推荐盘仅 Windows 固定盘且剩余 ≥2 GiB；无其它盘时不提示，仅设置页可手动选择。
- 迁移期间导入/采集会等待锁而不是立即失败；超大库迁移时 UI 显示进度并可取消。
- 隔离实例的推荐目录仍在实例所在盘（AppData），这是 dev:live 安全门的要求，生产环境推荐的是其它固定盘。
- dev:live 实例 `arena-storage`（1467/9367）在交付时仍在运行，按仓库规则未由 agent 结束。
