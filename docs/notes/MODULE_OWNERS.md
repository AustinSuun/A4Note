# Aster 模块负责人建议

本文档用于多人协作时明确模块边界和 review 责任。当前可以先作为建议表使用，后续团队稳定后再替换成具体人员姓名或 GitHub 账号。

## 1. Owner 职责

模块 owner 负责：

- 审查该模块的 PR。
- 维护模块边界。
- 判断是否需要拆分文件。
- 确认改动没有破坏核心工作流。
- 冲突时主导解决。

owner 不是唯一能改该模块的人，但涉及该模块的重要改动应由 owner review。

## 2. 模块划分

| 模块 | 目录 | 建议 owner | Review 重点 |
| --- | --- | --- | --- |
| 产品目标和架构 | `docs/notes/GOAL.md`, `docs/notes/ARCHITECTURE.md` | 产品/架构负责人 | 方向是否一致，边界是否清晰 |
| Core | `src/core/` | 核心架构负责人 | 类型、关系系统、命令、Provider、插件边界 |
| Platform | `src/platform/` | 桌面能力负责人 | Tauri 调用封装、文件/数据库边界 |
| Backend | `src-tauri/` | Rust/SQLite 负责人 | 数据库迁移、文件复制、命令安全、测试 |
| Library | `src/features/library/` | 文献库负责人 | 导入、标签、表格、详情、导出 |
| Reader | `src/features/reader/`, `src/features/reader/pdf/PdfReader.tsx` | 阅读器负责人 | PDF 渲染、标注、右侧面板、阅读空间 |
| AI | `src/features/ai/`, `src/core/aiProviders.ts` | AI 负责人 | Provider 抽象、上下文、会话绑定 |
| Workbench | `src/workbench/` | 工作台负责人 | 命令面板、面板 Host、布局扩展 |
| UI System | `src/shared/ui/`, `src/ui/styles.css` | UI 负责人 | token、组件一致性、视觉规范 |
| Settings | `src/features/settings/` | 设置负责人 | 设置持久化、诊断、备份入口 |
| Docs | `README.md`, `docs/` | 文档负责人 | 新人入口、协作流程、标准一致性 |

## 3. 高风险文件

这些文件改动需要额外 review：

```text
src/core/types.ts
src/core/relations.ts
src/core/asterCore.ts
src/platform/nativeApi.ts
src/ui/App.tsx
src/features/reader/pdf/PdfReader.tsx
src/ui/styles.css
src-tauri/src/lib.rs
src-tauri/schema.sql
package.json
```

## 4. 临时规则

在团队人数较少时，可以一个人兼任多个 owner，但 PR 仍应按模块边界说明影响范围。

如果某个任务跨越三个以上模块，先拆任务，不要直接开大 PR。

如果必须跨模块修改，PR 说明里要写清楚：

```text
为什么必须跨模块：
每个模块改了什么：
回滚风险：
验证命令：
```
