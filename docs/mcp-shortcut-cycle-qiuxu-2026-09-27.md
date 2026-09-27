# 组合快捷键提示：本次 Ctrl 周期抑制

任务：7e18e7d8-b224-4c47-9731-8884eadafbca；执行者：Arena-秋序。
日期：2026-09-27。分支：`fix/shortcut-cycle-qiuxu`；基线：`main` 的 `90182b6`。

## 结论与范围

当前 main 已包含 `30f476f` 的 `HINT_HOLD_DELAY_MS = 500`。项目根仍在旧分支 `fix/markdown-fast-scroll-arena`，不能用该分支的 150ms 推断 main 回退。本任务保留 500ms 单一计时器，不改快捷键映射、执行条件、保存或提示样式。

复现并修复两条遗漏路径：

1. 先按 Shift/Alt 再按 Ctrl：原先把 Ctrl 当作一次新的单独按住，在 500ms 后显示提示；释放 Shift/Alt、继续按 Ctrl 还会保持显示。
2. 子编辑器以 `stopPropagation()` 接管组合键：窗口冒泡监听收不到键下事件，已有计时器继续显示提示。

`src/shared/shortcuts/dispatcher.ts` 增加捕获阶段的**只观察**监听，只隐藏提示并标记本周期已用组合键，不执行命令、不 preventDefault、不阻止传播。命令仍由原有冒泡监听派发。Ctrl 释放在捕获阶段观察；两个 Ctrl 同时按住时，仅在最后一个释放后重置。下一次单独长按恢复原 500ms 提示。

## 证据和验证

隔离实例：`npm run dev:live -- --instance qiuxu-shortcut --port 1457 --cdp-port 9357`。所有原生截图保留底部 `DEV qiuxu-shortcut · 独立测试库（原生已核验…）`；未复制或操作正式资料库。

| 验证 | 基线 | 修后 |
| --- | --- | --- |
| 真实 React 组件 Chromium 时间序列 | 11/16；5 项失败 | 16/16 |
| 原生 WebView2：文献库与 PDF 阅读器 | 21/31；两场景共 10 项失败 | 31/31 |
| dispatcher 单元测试 | 新增反序修饰键断言可复现失败 | 95 项通过 |
| core / 布局 / 设置 | 原有回归 | 52 / 36 / 22 项通过 |
| shortcuts-browser | 原有全面回归 | 491 项通过 |
| pdf-find-entry-browser | 原有搜索入口回归 | 35 项通过 |

覆盖快速 Ctrl+B/H/Z、300ms 未出现、650ms 已出现、提示显示后再组合、450ms 接近阈值的组合键、普通键释放而 Ctrl 仍保持、下一周期恢复、Shift/Alt 先按、子级接管。原生原有 PDF 为隔离库内置指南，实际 PDF 内容可见；该 PDF 没有文字层，不把此测试宣称为 PDF 文字高亮功能验收。子级吞事件使用明确注入的受控 DOM 监听模拟，不冒充所有编辑器的完整端到端测试。IME、输入框、改绑、模态框、失焦等沿用 dispatcher 与 491 项浏览器回归，未声称覆盖所有操作系统输入法/系统快捷键。

原生前后 `pageerror` / `console.error` 均为 0。`get_diagnostics` 对本任务快捷键源码返回 0 条；TypeScript/Vite 构建、architecture、agent-status、`git diff --check` 全部通过（整组命令退出 0）。没有运行完整 `npm run verify`，不声称全仓库/Rust 全回归完成。

证据均在独立工作树下的 `.tmp/shots/shortcut-cycle/`，不提交图片到 docs：

- `native/baseline/results.json`、`native/after/results.json`。
- `native/after/timeline.json`：键下/键上、提示 class 切换的 `performance.now()` 时序。
- `native/{baseline,after}/reader-Shift-first.png`、`reader-child-owned.png`、`reader-hold.png` 等全幅图；文献库对应图同目录。
- `component/{baseline,after}/results.json` 与修后时序。

## 过程中的失败与边界

- 新工作树首次原生构建缺少生成的 `resources/native-host/host-manifest.json`；只运行项目自带 `prepare-native-host.mjs --debug` 补齐调试构建资源，没有注册浏览器、安装或发布。
- 首次原生修后采样仍呈现基线行为，记录保留在 `native/after-stale-before-reload/`。随后显式重载原生页面，核对 Vite 提供的 dispatcher 含观察器与 500ms，再取得 31/31。不能把首轮失败当通过。
- 首轮观察器把所有带 Ctrl 的非 Control 键也设为 `controlDown`，单元回归揭示既有测试的事件序列问题；最终只在 Control 键本身与其他修饰键同时按下时建立该状态。原有 63 项及新增 32 项随后全通过。
- 不改正在由其他执行者处理的轻量提示外观、悬浮窗拖动、总览笔记编辑。原生截图仍展示基线样式，不代表并行样式任务结果。

## 交付

最终记录：实现 `e94c3e6f5f2ae425507e0b605653ddf2932900b1`，与 main 的 `6d1f06f18f8200a786caa79956cc83333a2ee0ab` 整合为 `556c4c7bdb50356af3c2bd0427e6007a638d7a76`，仅双状态追加记录冲突，保留双方内容。整合后快捷键、组件16项、architecture与build重新通过；干净本地main已快进至556c4c7。任务submit成功进入review（revision14），9份结果附件已上传。未自行验收。

本任务仅提交 dispatcher 最小修复、单元和组件/原生回归脚本、verify-all 接线及文档/双状态。合并前检查 main 干净并通过常规 Git 合并，不强制覆盖他人分支或未提交改动；实际交付 SHA 与本地 main 包含关系写入任务板 delivery。

提交后供用户检查，不自行归档。未打包、安装、推送、发布或变更正式资料库。
