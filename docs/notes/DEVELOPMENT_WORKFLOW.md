# Aster 协作开发流程

本文档说明多人协作时如何领任务、建分支、修改代码、提交合并请求和处理冲突。产品目标见 `GOAL.md`，模块边界见 `ARCHITECTURE.md`，代码规范见 `CODING_STANDARDS.md`，UI 规范见 `UI_GUIDELINES.md`。

## 1. 基本原则

- `main` 必须保持可运行。
- 不直接向 `main` 提交代码。
- 每个任务开独立分支。
- 每个 PR 只解决一个清晰问题。
- 合并前必须跑验证。
- 影响模块边界、数据结构、PDF 标注、文件导入、SQLite、AI Provider 或 UI 体系的改动必须有人 review。

## 2. 开发前必须读

新成员或新任务开始前至少阅读：

```text
README.md
docs/notes/GOAL.md
docs/notes/ARCHITECTURE.md
docs/notes/DEVELOPMENT_WORKFLOW.md
docs/notes/CODING_STANDARDS.md
docs/notes/UI_GUIDELINES.md
docs/notes/MODULE_OWNERS.md
```

如果任务只改一个模块，也要先看对应模块的 `index.ts` 和 `types.ts`，确认外部接口。

## 3. 任务拆分标准

一个任务应能在 1 到 3 天内完成，并且有明确验收标准。

好的任务例子：

```text
拆 ReaderToolbar 到独立模块
把 PdfReader 移到 features/reader/pdf
新增 shared/ui/Button
修复译文 PDF 标注 file_id 隔离
给 AI Provider 增加设置页展示
```

不好的任务例子：

```text
重做 UI
优化架构
完善阅读器
接入所有 AI
整理全部代码
```

每个任务至少写清：

```text
目标：
影响目录：
不允许修改：
验收标准：
需要运行的验证：
```

## 4. 分支命名

建议格式：

```text
feature/<module>-<short-name>
refactor/<module>-<short-name>
fix/<module>-<short-name>
docs/<short-name>
```

例子：

```text
feature/reader-toolbar
refactor/app-import-flow-hook
fix/annotation-file-id
docs/development-workflow
```

## 5. 开发流程

1. 从最新 `main` 创建分支。
2. 只修改任务相关目录。
3. 小步提交，提交信息写清楚模块和意图。
4. 提交 PR 前运行验证。
5. 填写 PR 模板。
6. 请求对应模块 owner review。
7. 通过后合并。
8. 合并后其他成员同步 `main`。

## 6. 验证要求

普通前端改动至少运行：

```powershell
npm run build
npm run test:architecture
```

涉及 UI 状态、阅读器、导入、标注、数据模型或 Rust 后端时运行：

```powershell
npm run verify
```

只改文档时可以不跑完整验证，但 PR 中要写明“仅文档改动”。

涉及 Tauri/Rust 命令时至少运行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

## 7. PR 合并规则

PR 必须说明：

- 改了什么。
- 影响哪些模块。
- 是否改了数据结构。
- 是否改了 UI。
- 是否影响导入、阅读、标注、AI 或插件。
- 跑了哪些验证。
- 有哪些风险或后续工作。

合并前至少满足：

- 构建通过。
- 架构边界检查通过。
- 对应模块 owner 已 review。
- 没有无关格式化和无关重构。
- 没有绕过 `core / platform / features / workbench / shared` 的边界。

## 8. 冲突处理

减少冲突的规则：

- 不让多人同时大改 `src/ui/App.tsx`。
- 不让多人同时大改 `src/features/reader/pdf/PdfReader.tsx`。
- 不让多人同时大改 `src/ui/styles.css`。
- 不让多人随意改 `src/core/types.ts`。
- 大文件拆分期间安排单人窗口期。

出现冲突时：

- 由对应模块 owner 主导解决。
- 不为了合并方便删除别人逻辑。
- 解决后重新运行相关验证。
- 冲突复杂时拆成更小 PR，不在一个 PR 里顺手重构多个模块。

## 9. 当前优先协作方向

近期优先级：

1. 从 `App.tsx` 抽出 hooks。
2. 把 `PdfReader.tsx` 移入 `features/reader/pdf/`。
3. 拆 `styles.css`，建立 UI token 和模块样式。
4. 填充 `shared/ui` 基础组件。
5. 按领域拆分 `src-tauri/src/lib.rs`。
