# Settings UI 重构交付记录（05795e28，arena-one，2026-09-21）

卡片：`05795e28-ddec-465e-840a-0aacbc9f4d84`「重构 Settings UI：统一信息架构、响应式布局、可访问性与反馈状态」。
工作树/分支：`.worktrees/settings-arena` / `refactor/settings-ui-arena`，基线 `main@498745a`。

## 交付结构

- `src/features/settings/index.tsx`：从约 20KB 单体缩为编排层（分类导航、全局搜索、`initialSection` 受控同步、分区渲染），并再导出 `defaultSettings` 与全部类型，保持 `App.tsx`/`usePersistedUiState.ts` 既有导入不变。
- 基础设施：`types.ts`（设置类型与默认值）、`catalog.ts`（分类与搜索目录）、`primitives.tsx`（`SettingGroup`/`SettingField`/`ToggleRow`/`ActionRow`/`StatusLine`/`EmptyState`）、`useAsyncStatus.ts`（busy/success/error 状态机）、`updateModel.ts` + `updateViews.tsx`（更新流程共享模型与视图）。
- 分类 section：`sections/{General,Appearance,Library,Plugins,Sync,Updates,About}Section.tsx`，每类一个文件，更新逻辑集中在 `onChange`/受控回调，无循环依赖与重复更新分支。
- 样式：新增 `src/features/settings/settings.css` 作为布局唯一权威（218px + `minmax(0,1fr)` 网格、`auto-fill minmax(min(340px,100%),1fr)` 分组、`.is-wide` 替代 `nth-child`、`--busy/--success/--error/--info` 状态色、36px 开关行、1180/1040 断点）；从 `src/ui/styles/components.css`（446→302 行）与 `workbench.css`（2318→2288 行）中移除全部 `.settings-*`/`.plugin-*`/`.extension-status-*`/`.sync-settings-*`/`.diagnostics-*` 块，消除双列冲突与 `nth-child` 依赖。删除零引用的 `settings-typography.css`。
- 更新组件：`BrandUpdateMenu.tsx`（portal dialog、`showModal`/`onCancel`/焦点回归）、`BrandUpdateNotice.tsx`（`shouldAutoCheck` + 4s 首查 / 6h / focus 触发）、`UpdateSettings.tsx`（与菜单共享 `updateModel` 状态与动作）、`CaptureSettings.tsx`（PAGE_SIZE=8 分页 + 3s 轮询 + `data-capture-total`/`data-capture-rendered`）。
- 测试：新增渲染级套件 `scripts/verify-settings-ui.mjs`（真实 DOM + CDP，115 项断言）；`scripts/verify-ui-state.mjs`、`scripts/verify-brand-update.mjs`、`scripts/verify-architecture-boundaries.mjs` 按新结构更新；`package.json` 新增 `test:settings-ui`，`verify-all.mjs` 注册 `test:settings-ui` 与 `verify-brand-update`。

## 验收项对照

1. 单体拆分完成，共享 primitives + 每类 section，无循环依赖（`verify-architecture-boundaries` 通过）。
2. 分类导航键盘完整：方向键/Home/End 移动、Enter/Space 激活、roving `tabIndex`、`aria-current="page"`、当前项可识别、Sync/Update 图标来自不同 icon 组件；键盘激活后焦点留在导航（方向键可继续用），外部切换（`initialSection`/搜索命中）焦点落到新分区 `h2`（`tabindex="-1"`）。
3. 全局搜索：`combobox`+`listbox` 结构、按分类名/设置标题/关键词过滤、命中跳转、空状态、键盘打开并聚焦、Escape 关闭。
4. 所有 `input/select/textarea/button` 有可见 label 或 ARIA 名称；开关/整行控件点击目标 ≥32×32；禁用与 `focus-visible` 有独立样式。
5. 980/1280/1440 宽 × 字号 10/18/32 组合无溢出/裁切/重叠，操作可达（6 张布局截图 + 逐分类渲染截图）。
6. 样式权威化如上述，断点 1180/1040 且被测试覆盖。
7. 同步 busy/pending/last error/logout，以及备份/剪贴板/市场/捕获/更新的一致 loading/success/error/empty 状态与 aria-live：成功用 `role="status"`、失败升级 `role="alert"`，重复操作不新增 live 节点（断言 `live-region 节点数不增长`）。
8. Capture 0/1/100 条：0 条空状态、1 条单行且无分页按钮、100 条只渲染 8 行并可「显示更多 / 展开全部 / 收起」，全部任务可达。
9. `UpdateSettings` 与 `BrandUpdateMenu` 共用 `updateModel`（检查/下载/重试/安装/最新版本/错误文案一致）。
10. `initialSection` 挂载后外部变更可同步（`normalizeSection` 非法值回退 `general`），切换分区保留未提交输入，焦点不落在不可见内容。
11. 渲染级测试覆盖导航键盘、label/ARIA、live-region、搜索、`initialSection` 同步、Capture 100 策略、980px 与字号 10/32——不使用源码字符串/正则断言作为唯一手段。
12. `npm run test:ui-state`、相关测试与 `npm run build` 全绿；`verify-brand-update.mjs` 的 Node 24 VM 失败已修复（补 `../nativeApi` mock 与 `updateModel` 断言）。

## 验证证据

- `npm run build`：`BUILD_EXIT=0`（`✓ built in 1.17s`），日志 `.tmp/arena/build-settings.log`。
- `node scripts/verify-settings-ui.mjs`：**115/115 通过**，证据 `.tmp/shots/settings-ui/`（19 张 PNG + `result.json`）。
- `node scripts/verify-ui-state.mjs`、`node scripts/verify-brand-update.mjs`：通过。
- `node scripts/verify-architecture-boundaries.mjs`：通过（settings 断言改指 `sections/PluginsSection.tsx`、`sections/GeneralSection.tsx`、`settings.css`，并新增 `./sections/` 组合与断点断言）。
- `npm run verify`：`A4Note verification passed`（含 Rust 209 项测试）。

## 未完成与已知风险

- 未打包、未安装、未发布，未重启线上实例；本轮只改源码与测试。
- 既有告警：`INEFFECTIVE_DYNAMIC_IMPORT`（provisionSummaryNotes）与 vite chunk >500kB，均非本卡引入。
- `apps/project-tasks/test/offline-takeover.test.mjs` 在 `npm run verify` 高负载并发下曾偶发失败，单独重跑（本工作树与 main）均 4/4 通过，判为环境时序抖动，未改动该测试。
