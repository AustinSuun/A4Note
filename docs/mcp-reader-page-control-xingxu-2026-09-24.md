# PDF 页码控件交付报告

- 任务：`f4ea1a89-e06d-44e6-bb95-cd9f1775addd`，需求版本 **spec2**。
- 执行：星序；分支 `fix/reader-page-control-xingxu`。
- 基线：本地 main `f891c15da11890f6b081444a59abc7ada2fa3ba3`；实现提交：`da96422c5c08cd7ee190b9ef9ae1fd1752815159`。
- 已保留并整合随后主线的文件存储位置功能 `1d099a9fc7b11e65a0cfbd251d77d65a0b16bba7`（整合提交 `7196501a5372437544110089651dfbff9da3ca23`）；用户额外授权的测试隔离修复为 `e54e56b945523c1fb807b17d00ab4448415ec2f1`。
- 验证期间 main 又增加右键菜单精简 `bf29ccabbaf1b93428eeb6cd9a78139a67992234`，已通过整合提交 `078594adbeff4995f760fa4c36b370e8c639a545` 保留；Reader 与 Rust 相比隔离修复提交无差异，并再次执行完整验证。
- 正式交付提交与本地 main 合并 SHA 以任务卡结构化 delivery 为准。仅提交待用户检查，不自行验收归档。

## 已完成

1. 左上角“当前页 / 总页数”改为关联同一输入框的完整 label 命中区，至少 60×24 CSS px。当前数字、斜线、总页数、空隙、内边距都能点入；总页数仍只读。首次聚焦选中数字，保留 Tab、焦点提示和读屏说明。
2. 输入只写草稿，普通重渲染和外部滚动不覆盖草稿。Enter 或真正离开整个控件时提交；Escape 取消。提交先同步消费事务，再调用跳转，避免 Enter 后 blur 重复调用。
3. 只接受范围内的整数。空值、非法字符、0、超出总页数、未修改以及已在目标页均不跳转；不再静默删除非法字符或把越界值钳制到首尾页。页数不足 1 时禁用。
4. 草稿绑定论文、源文件/译文身份、阅读模式、并排活动侧及总页数；换文档、页数变化、隐藏保留的阅读器时丢弃草稿。
5. 失焦判定避开窗口暂时失活及短暂重聚焦。对于鼠标/笔/触控按下引起的失焦，等指针释放和切换文档的 click 完成后再判断，防止按住外部按钮期间提前提交。文档事件监听在隐藏/卸载时清理。

未修改 PDF 渲染、滚动/缩放算法、标注保存、资料库结构、存储业务代码、快捷键绑定或其他 Agent 的工作区；未打包应用、安装、推送或发布。

## 复现与验证

### 修改前

已读取任务参考图。官方 `dev:live` 独立实例中导入自生成的 16 页测试 PDF，另准备同页数译文和第二篇测试论文，没有复制或操作正式资料库。

真实桌面复现：第 2 页时点击总页数不会聚焦输入框；把草稿输入为 `1` 后再点控件内部，输入失焦，PDF 的 `scrollTop` 从 **950.4** 降到 **7.2**，实际提前跳到第 1 页。

初版 55 项浏览器回归在旧实现上 **23 通过、32 失败**。后续增加普通点击切文档、按住 120ms 再释放切文档的回归，分别捕获了微任务判定和仅等一帧判定的不足；最终实现均通过。

### 最终结果

| 验证 | 结果 |
|---|---|
| 页码纯逻辑 | **34/34** |
| 真实组件浏览器回归 | **59/59**，无 pageerror/console.error |
| 原阅读器优先级回归 | **74 项通过**；保留原断言并补 3 项 |
| 隔离原生桌面主组 | **50 项通过、10 张截图** |
| 原生补充组 | **9 项通过、2 张截图** |
| TypeScript、Reader、架构、状态校验 | 通过 |
| 源码编辑器诊断 | 0 错误、0 警告 |
| 完整 PowerShell `npm run verify` | **078594a 上通过 69 步，Rust 236 / 0 / 5 项既有忽略；命令 exit0、总耗时 211.529s** |

**最终 main 差异整合：** 完整验证期间 main 又增加 `cd6329c8e7d6e9d721ecaa8164f3ea50391345c3`，只删除文献库侧栏标题中的重复新建按钮及无用图标导入，并新增对应测试。已保留并整合为 `0ee25bcb299b1535ce167b679ae2459f9d53f360`；Reader 与 Rust 源码相对已完整验证的 078594a 无差异。对这一最终组合执行 **13 项相关回归全部通过**：build、库侧栏/右键菜单/存储位置浏览器、资料库行为、UI-state、页码纯逻辑及浏览器、阅读器优先级、Reader、架构、状态、默认并行 cargo。没有将此次定向复验冒充为最终快照的 70 步全套重跑。

完整验证命令 `cmd_a7c608f8fc066ebb7c20194ffc4097f3a7a41ea94ac69991`；后续整合回归命令 `cmd_094a1f8ca4b7d34df94ca55d1cb9d9d9b7a4ed48fed614b3`。此后仅改本报告及双状态，再检查状态与 diff。

原生两组共 **59 项、12 张修改后截图**，另保留 3 张修改前截图。覆盖 2/16、仍停留第 2 页时编辑草稿 12、提交到第 12 页、外部失焦、Escape、非法/未修改输入、输入时滚动、原文/译文/对照模式、跨论文保留视图、Ctrl+滚轮缩放、真实指针绘制矩形及重载后持久化、Tab 提交与焦点提示。

原生身份：`app.aster.research.dev.page-control-xingxu.w71123eba64`，Vite 1481 / CDP 9281。每组驱动先核对原生资料库路径及底部“DEV page-control-xingxu · 独立测试库（原生已核验 …）”状态条。

### 过程说明与边界

- 首轮完整验证发现既有 `verify-reader-priority-fixes` 的 React 模拟桩不支持 `useId`、布局 effect 和新的外层 label blur。已更新模拟边界，保留原测试并新增断言；没有跳过该套件或降低产品断言。
- 原生测试等待实际目标页和滚动稳定，不能用固定 250ms 的中间页截图判断跳转失败；重载检查也等待 PDF 加载。保留阅读器的选择器限定可见区域，不把另一篇隐藏论文的 PDF 算作当前对象。
- 首次启动缺少新工作区的 native-host 调试资源，补跑官方准备脚本后启动成功，未注册浏览器宿主或安装应用。
- CSS 100%/125%/150% 是样式缩放压力验证，不等同于操作系统多显示器缩放覆盖。桌面使用合成测试 PDF；未使用正式文献或正式资料库。
- 不改变或额外承诺跨文档记忆滚动位置的策略；验证的是旧编辑草稿不被提交到新文档。
- 截图属于执行 Agent 的开发证据，不是独立验收。已停止自己的原生实例；最终验收与归档由用户执行。

## 新 main 整合阻塞与授权修复

首次整合后完整验证没有通过：唯一失败为默认并行 Rust 测试 `library_tests::tests::translated_pdf_import_requires_existing_paper_and_keeps_multiple_files`，在 `library_tests.rs:263` 收到“文件存储位置正在迁移，请等待迁移完成后再试。”；当轮 **234 通过、1 失败、5 项既有忽略**。保留失败日志，没有直接跳过后交付。

只读对比证实当时 Rust 与新 main 相同。`MIGRATING` / `CANCEL_REQUESTED` 是进程级原子标志，而存储测试原来的 `SERIAL` 互斥锁只约束同模块测试，不能隔离另一个工作线程上的资料库导入测试。修复前补跑默认并行 cargo 一次又通过 235/0/5，符合该问题的时序相关性；没有把它描述成每次稳定复现。

用户明确授权修复测试隔离后，仅修改 `storage.rs` 的 `#[cfg(test)] mod tests`：

- 将两个会修改全局迁移状态的原测试放入独立的当前测试可执行程序子进程，原测试体与全部业务断言保留。
- 精确过滤到单个案例，父测试同时检查退出码、对应案例成功行和“1 passed; 0 failed”，防止测试名称错误导致零项执行而假绿。
- 新增同进程跨线程回归：活动迁移可见、第二次迁移被拒绝、另一个线程的工作被阻止及取消信号共享、guard 释放后活动和取消标志全部清理。
- 不采用线程局部假标志，不改变生产原子变量或锁顺序，不设置 `RUST_TEST_THREADS=1`，不忽略或降低原断言。

默认并行 `cargo test --manifest-path src-tauri/Cargo.toml` **连续三轮退出 0，每轮 236 通过、0 失败、5 项既有忽略**；新增的一项按预期计入。已核验生产代码区与修复前逐字一致（仅规范化换行比较）。其后完整默认 PowerShell 验证 68 步通过；再整合 bf29 后的最终结果见上表。此轮不额外宣称复测存储迁移设置界面的原生效果，因为没有更改其业务或 UI。

## 文件范围

- `src/features/reader/ReaderPageControl.tsx`
- `src/features/reader/pageJumpDraft.ts`
- `src/features/reader/ReaderScene.tsx`（仅补传文档身份）
- `src/features/reader/reader-annotation-dock.css`（仅页码控件局部样式）
- `scripts/fixtures/page-control-host.tsx`
- `scripts/verify-reader-page-control.mjs`
- `scripts/verify-reader-page-control-browser.mjs`
- `scripts/verify-reader-priority-fixes.mjs`（原回归桩适配及增补）
- `package.json`、`scripts/verify-all.mjs`
- `src-tauri/src/storage.rs`（仅测试模块隔离及新增回归）
- 阅读器基线、配对状态文件和本报告

## 证据位置

相对工作区 `.worktrees/reader-page-control-xingxu`：

- `.tmp/shots/page-control/baseline/result.json`：旧实现红测。
- `.tmp/shots/page-control/after/result.json`：最终浏览器结果。
- `.tmp/shots/page-control-native/{before,after,extra}/`：原生 JSON 与截图。
- `.tmp/page-control/{native-before,native-after,native-extra}.mjs`：原生驱动及 PDF 夹具生成。
- `.tmp/page-control/verify-delivery.log`：页码实现、整合新存储主线前的完整成功日志。
- `.tmp/page-control/verify-integrated.log`：首次整合后的真实失败日志。
- `.tmp/page-control/verify-integrated-final.log`：测试隔离修复后的 68 步完整成功日志（命令 exit0/217018ms）。
- `.tmp/page-control/verify-latest-main.log`：078594a 保留右键菜单主线 bf29 后的 69 步完整成功日志。
- `.tmp/page-control/verify-final-integration.log` 与 `final-integration-result.json`：0ee25bc 保留侧栏主线 cd6329 后的 13 项相关整合回归。
- `.tmp/page-control/rust-parallel-{before,after-1,after-2,after-3}.log`：默认并行 Rust 检查记录。
- `.tmp/page-control/page-control-evidence.zip`：交付证据包，含逐文件 SHA-256 清单。

后续：用户检查任务卡的参考图、修改前后截图和实际交互，决定归档或反馈调整。无额外打包、安装或发布授权。
