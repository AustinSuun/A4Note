# Aster 代码开发标准

本文档定义 Aster 的代码组织、命名、模块边界和提交标准。目标是让多人开发时能减少冲突，并让每个模块可以独立理解、测试和维护。

## 1. 模块边界

当前前端主要分层：

```text
src/core/       纯业务核心和类型，不依赖 React/Tauri
src/platform/   Tauri/native API 封装
src/features/   业务功能模块
src/workbench/  工作台、命令面板、面板 Host
src/shared/     通用 UI、hooks、utils
src/ui/         应用入口、全局样式、中文文案和少量遗留组件
```

依赖方向：

```text
features -> core / platform / workbench / shared
workbench -> core / shared
platform -> core
core -> 不依赖 React、不依赖 Tauri、不依赖 UI
shared -> 不依赖具体 feature
```

禁止：

- `core` import `ui`、`features`、`platform`。
- feature 之间直接 import 内部文件。
- feature 绕过 `platform/nativeApi.ts` 直接调用 Tauri。
- 插件直接写 SQLite。
- 新功能把状态和 UI 继续堆进 `App.tsx`。

## 2. 模块公开接口

每个模块通过 `index.ts` 或 `index.tsx` 暴露外部接口。

推荐：

```text
src/features/library/
  index.ts
  LibraryScene.tsx
  LibraryDetailPanel.tsx
  ImportDialog.tsx
  types.ts
```

外部只写：

```ts
import { LibraryScene } from '../features/library';
```

不要写：

```ts
import { LibraryScene } from '../features/library/LibraryScene';
```

例外：模块内部文件可以互相 import。

## 3. 类型放置规则

- 跨模块共享类型放 `src/core/types.ts`。
- 单模块 props 和局部类型放模块内 `types.ts`。
- Tauri request/response 包装类型放 `src/platform/nativeApi.ts` 或后续 `src/platform/*`。
- 不要为了一个局部组件把类型塞进 `core/types.ts`。

## 4. React 组件规则

组件应满足：

- 一个文件优先控制在 300 行以内。
- 组件负责渲染和少量交互，不负责复杂数据持久化。
- 复杂状态放 hook。
- 复杂纯逻辑放 helper 或 core。
- props 类型清晰命名，例如 `ReaderToolbarProps`。

避免：

- 在 JSX 中写大段业务判断。
- 在组件里直接操作数据库。
- 在组件里同时处理导入、保存、弹窗、快捷键和数据格式化。
- 复制粘贴已有组件样式后局部改一套。

## 5. Hook 规则

hook 放置建议：

```text
src/shared/hooks/        通用 hook
src/features/<name>/     某个 feature 专用 hook
src/ui/App.tsx           暂时保留少量应用协调 hook
```

命名：

```text
useImportFlow
useChatThreads
useAnnotationHistory
usePersistedUiState
usePaperSelection
```

hook 不应直接渲染 UI。需要 UI 时返回状态和动作，由组件渲染。

## 6. 数据和副作用

数据流优先顺序：

1. UI 组件触发动作。
2. feature 或 App 层调用命令/hook。
3. platform 调 Tauri 或本地能力。
4. core 负责纯业务模型和关系映射。

新增本地能力时：

- Rust 命令在 `src-tauri`。
- 前端只通过 `src/platform/nativeApi.ts` 调用。
- 不要在 feature 中直接写 `invoke(...)`。

## 7. 文案和编码

- UI 文案集中在 `src/ui/zh.ts`。
- 中文文件必须保持 UTF-8。
- 新增文案不要硬编码在组件里，除非是临时调试文字且不会进入 UI。
- 发现乱码要立即修复。

## 8. 大文件控制

当前重点控制：

```text
src/ui/App.tsx
src/features/reader/pdf/PdfReader.tsx
src/ui/styles.css
```

新增代码不要继续扩大这些文件。需要改这些文件时，优先评估是否应先拆模块。

`src-tauri/src/lib.rs` 已经不在这张表里：`P2-1` 把它拆成了 97 行的模块表 + `generate_handler!` + `run()`，并且行数上限由 `npm run test:architecture` 断言（小于 160，且里面不许出现 `#[tauri::command]` / `rusqlite`）。新增后端命令写进拥有那几张表的领域模块，这里只加一行 `模块::命令`。

建议阈值：

- 单个 React 组件文件超过 300 行，需要考虑拆分。
- 单个纯逻辑文件超过 500 行，需要考虑按领域拆分。
- CSS 文件超过 300 行，需要考虑按 token、layout、component、feature 拆分。

## 9. 提交前检查

提交前至少检查：

```powershell
npm run build
npm run test:architecture
```

涉及核心流程时运行：

```powershell
npm run verify
```

不要提交：

```text
node_modules/
dist/
src-tauri/target/
临时日志
本地数据库
个人测试 PDF
```
