# 文献库与阅读器可靠性：首批修复

更新：2026-09-10T18:18:54+08:00

状态：源码完成并通过自动化回归；未打包，待隔离Windows桌面验收。未操作用户真实资料。

## 已完成

- 首批可靠性整改已实施：正常文献读回排除笔记墓碑，删除仍保留内容/server_version/delete outbox；重复删除与不存在ID无新同步操作。拒绝外文献ID、已删除笔记旧保存与不存在父文献；新增可选expected标题/正文条件校验，避免覆盖并发修改。
- 导入不再INSERT OR REPLACE覆盖原文献或文件；文献ID路径校验、全流程重复检测串行、新目录独占、数据库登记失败仅清理本次副本，原PDF的哈希与写入字节一致；保留重复内容返回原文献及多译文功能。删除入口同时拒绝越界存储ID。
- 备份改用SQLite Backup API，包含未checkpoint WAL；唯一临时目录完成后发布，清单记录数据库/附件SHA256。恢复先在隔离暂存区校验/迁移/重定位托管附件，输入备份不改写，生成恢复前安全备份，再按日志提升文件与数据库。步骤失败回退，进程中断后启动前回退；不宣称经过断电/硬盘故障实验。
- 新增命令边界维护闸门，覆盖资料库/笔记/标注/阅读状态/工作台/历史/同步命令；备份恢复与本进程正在执行的I/O互斥，忙时明确拒绝而非嵌套等待。恢复成功后禁止旧会话读写，界面明确要求重启；恢复前统一等待文件Markdown和文献笔记保存。未启用WAL或修改既有数据库持久化参数。
- 文献Markdown笔记改为固定paper/note身份的共享串行保存会话；900ms防抖、blur、Ctrl+S、关闭共用一个队列，保存失败不切换/新建，切标签卸载会补存，保存途中编辑继续顺序写入。增加恢复草稿、条件冲突保护、重试、导出和确认放弃；关闭窗口等待未完成写入。独立Markdown文件仍使用既有文本会话，只共用关闭保护。
- 修复原生保存后全库刷新把用户拉回旧文献的问题，改为只更新对应笔记；内存仓库尊重传入noteId并保持标题原文，避免新建ID不一致/重复笔记。原生数据库已保存但浏览器缓存配额失败时不再误报数据库保存失败。
- PDF切换/关闭/加载失败时销毁loading task和worker；单页渲染失败不再产生未处理Promise或无限加载，提供原页重试且保留原位坐标。保留原有视口渲染/延迟释放，不把全pages.map误认为全画布即时绘制。
- 安全依赖定向更新：pdfjs-dist 6.3.289、@mdxeditor/editor 4.2.4、js-yaml 4.3.2、nanoid 3.3.18、postcss 8.5.28；针对MDX精确锁定旧yaml使用兼容4.x补丁override，未使用audit fix --force。Prism为main.tsx实际导入，改为显式依赖prismjs 1.30.0，不再依赖MDX间接携带。
- 所有破坏/故障/并发回归使用隔离临时库或模拟回调；未启动用户应用、未读写真实资料库、未提交Git。本轮未生成EXE，Windows latest仍为17:43旧包，不包含本轮修复。

## 验证

- npm run verify — PASS，cmd_1789035307818_30 exit0，71.136s；生产构建、所有既有检查、新增test:reliability及154 Rust tests passed / 1 benchmark ignored。日志 .build/reliability-verify.log。
- 新增15项Rust安全测试通过：7项笔记/导入行为、1项expected冲突、6项备份恢复（WAL/校验/跨根路径/旧格式不改输入/5个失败边界/中断恢复）、1项维护闸门。既有startup_backup_restore完整payload测试通过；保留全部旧回归。
- test:reliability — 10/10 PASS：串行合并、固定ID、失败重试、写入时撤回/关闭、恢复冲突基线、缓存失败、跨文献隔离、异常返回ID、确认放弃与期间新编辑保护、原生命令闸门覆盖（最后一项为静态补充）。core smoke增加传入ID/原始标题/重复更新断言。
- 隔离Chromium真实React组件交互 — 文献笔记10/10、PDF生命周期/渲染5/5 PASS，无未捕获异常。笔记编辑器表面/原生保存回调及PDF加载任务为受控stub，不等于完整Windows WebView2或真实PDF标注视觉验收。Arena workspace reliability-ui-check/{harness.tsx,check.mjs,results.log,pdf-harness.tsx,pdf-check.mjs,pdf-results.log}。
- 真实PDF.js 6.3.289运行回归 — 内置指南及带文本PDF夹具各2轮打开/75%与150%canvas渲染/关闭（共8次渲染）；文本夹具提取成功，损坏输入拒绝且释放任务。由npm run test:pdfjs纳入完整verify，不以stub代替实际PDF.js解析/绘制。
- npm audit --json — PASS exit0，high/critical/total均为0；日志 .build/reliability-audit-final.json；仅代表当前依赖公告审计，不是渗透测试或绝对安全保证。
- get_diagnostics — 0 errors / 0 warnings；npm run test:agent-status 最终通过。随后git diff --check exit2，仅报告未触碰的既有docs/notes/DEVELOPMENT_TASKS.md:1933文件末空行，未清理他人修改；不是verify失败。

## 使用变化

- 恢复备份成功后必须重启，避免旧编辑器/工作台自动保存把恢复结果覆盖。恢复前生成安全备份；输入备份保持不变。忙时重试，不强行终止读写。
- 笔记保存失败时不再自动跳走。可重试、导出草稿或确认放弃，关闭窗口会等待保存。检测到内容冲突时先导出，不静默覆盖。
- 正常文献列表/搜索/导出不显示已删笔记，同步墓碑仍保留。已有ID导入拒绝覆盖，重复内容仍返回原文献。

## 限制与后续

- 本轮源码经过自动化验证但未打包/安装或实际Windows WebView2手验。现有latest是2026-09-10 17:43版本，仍含旧问题/旧依赖；不要把它当作本轮修复包。
- 维护闸门为本进程命令边界协调，不替代跨进程独占锁；恢复前须关闭其他实例/外部数据库工具。进程中断回退已做隔离模拟，未测试真实断电、磁盘硬故障、同步盘锁/杀毒软件全组合。
- 备份范围仍是SQLite及files/papers托管附件，不包含外部项目Markdown/任意外部绑定文件；旧备份无清单时可兼容恢复，但不能追溯验证当年缺失的数据。恢复草稿受localStorage容量限制，导出/独立备份仍必要。
- PDF重开/绘制已测试，但双栏同步、长文档、选区/批注、缩放坐标与页面失败提示位置还需真实Windows手验；未量化实际EXE冷启动/可交互时间。
- 文献库全部工作流、更完整双链/引用重命名以及大型App收敛仍是后续项；关系图、社区、云同步服务端和新AI扩展未动。

- 先对本轮源代码做隔离Windows桌面验收：笔记新建/输入/快速切标签/保存失败与确认放弃、PDF原文译文切换/选区/标注/缩放、备份恢复后的重启与安全备份可读。需要交付时再按package:windows流程打包，不误用17:43旧latest。
- 继续按优化评估顺序：补跨进程/恢复实际失败条件验证；测真实冷/暖启动到可交互trace，再决定整库localStorage/列表渲染优化，不能把合成SQL计时当作启动数据。
- 随后检查文献库批量操作/元数据/删除失败语义/搜索导出与更完整双链（标题/别名/重命名更新）；不扩展关系图、社区和云同步服务端。
- 依赖更新后保留MDX→js-yaml override直至上游解除旧精确锁；后续升级继续分别执行PDF/Markdown行为回归和audit。

## 实现位置

- Rust：library_notes/import/papers、backup、library_access、命令入口闸门、lib启动回退；新增integrity_tests与备份/闸门测试，Cargo启用rusqlite backup feature。
- 前端：core/noteDocumentSession、platform/library/noteDocuments、pendingSaves；ReaderMarkdown/ReaderSidePanelContent、App/nativeApi/types、文本会话关闭保护；PDF加载释放/单页失败重试；reader样式。
- 回归：verify-reliability、verify-core-smoke、verify-pdfjs、verify-reader-rendering、verify-all；依赖package.json/package-lock.json。

未宣称“所有上线问题已解决”。本轮是按优先级完成的第一批数据与使用可靠性修复。
