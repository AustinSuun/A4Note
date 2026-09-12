# 论文采集与双入口入库

更新时间：2026-09-11T22:07:33+08:00

## 产品约束

浏览器采集与普通本地PDF最终进入同一文献库；收件箱只做任务暂存。基础样本arXiv、PMC与标准学术元标签页，完整来源信息不能因旧表字段少而丢失。用户已授权自主安排后续实现至可试用。

## 0.3.0已落地

- Browser CaptureEnvelope → 配对/持久队列 → 补全/下载/校验 → LibraryIngest → papers/paper_files/paper_capture_records。
- 普通PDF原导入流程保留，在原事务中登记确认后的CaptureEnvelope形状快照；文献详情补充PDF直接复用LibraryIngest。没有强迫原导入界面先走浏览器。
- 以paper_capture_records一张表保存capture_id、paper_id、完整envelope_json、file_map_json及时间；替代原拟议的两张扩展表。删除文献清空快照关联并留墓碑，原任务重试不复活文献。
- DOI/正文hash/基础arXiv去重与冲突拒绝，保留手改投影、主PDF及标注file_id。新版本与补充PDF分别登记；同任务先元数据后补PDF可更新文件映射。
- 入库用维护闸门、原导入锁、即时SQLite事务；先网络后库锁；PDF副本重验哈希/create-only发布，不覆盖已有文件。
- Metadata：citation/DC、明确摘要DOM、ScholarlyArticle JSON-LD，DOI精确Crossref/PMCID精确Europe PMC，仅补缺失字段并保留证据/原始响应。配对时可关闭外部补全。arXiv提交/修订不冒充期刊online，基础ID与版本来源分开。
- 原生公开HTTPS正文/显式PDF补充材料下载；浏览器辅助PDF上传由具体站点用户授权触发，复用浏览器合法登录/网络但不读取或转发Cookie内容。上传鉴权/大小/并发/PDF结构校验，禁止覆盖，随后进入同任务队列。
- 文献表自动更新但不切换当前阅读选择；来源详情、附件打开/本地补充、任务设置面板和失败后的浏览器/本地补救已提供。

## 交付与验证

Windows release/NSIS已构建，builtAt2026-09-11T14:03:07.589Z（22:03:07+08）。cmd40发布旧latest时EBUSY；未杀进程，cmd43校验后另发artifacts/windows/capture-0.3.0-20260911，清理本次隔离staging。旧latest仍旧版。EXE SHA256 3CC7D0F36777488A5735B9CF29C174B92ED683B354795FC2083623169985A8E2；安装器6AC1EDAC31585A5B4B5260C8FB5511DCD5B779F2164E38F87750ACEE8853BBF1。扩展ZIP在artifacts/browser-extension，node scripts/package-capture-extension.mjs可重建。

最终全量verify cmd_1789135670935_44 exit0，Rust176通过/0失败/3忽略；capture_12通过/2显式联网忽略。原生真实回环HTTP覆盖上传/假PDF拒绝/禁止覆盖/同任务补全/取消。Crossref与Europe PMC联网通过；Chromium真实arXiv DOM、实际扩展配对/session/提交及2,215,244字节PDF辅助下载上传通过，上传接收端为协议fixture、站点权限由测试管理API授予。PMC浏览器本轮未取得论文元标签；原生arXiv网络10054重置，未算通过。

本次没有启动或安装真实应用、没有修改用户资料。原生直连arXiv失败是已知实测结果，非通过；浏览器辅助已实取对应PDF。完整Windows Chrome/Edge→安装版桌面人工验收仍待完成。

## 备份与安全边界

已入库完整快照和files/papers附件随原库备份；A4CaptureData队列及暂存副本仍单独备份，不声称整套收件箱已纳入原备份。配对/隐私/50MiB限制/1000任务/临时副本说明见扩展README。

第一批A/B和C的基础入库已完成，不代表最初全部二/三批目标均完成。当前仍是试用版，不能承诺所有出版社、付费墙、验证码或DRM场景自动下载。

## 后续验收与产品项

1. 使用资料副本安装capture-0.3.0-20260911中的新桌面包并加载扩展，完成人工Windows Chrome/Edge工具栏→桌面→文献表→阅读与重开验收；不以分段测试冒充完整GUI端到端。无需因旧latest占用重新编译或关闭用户进程。
2. 独立完整Inbox、分页/清理、批量URL列表和更细的恢复状态；现在为设置任务面板，不冒充独立场景插件收件箱。
3. 元数据冲突选择与编辑、更多结构化文献表列；当前保留完整快照但不覆盖既有用户字段。
4. 复杂CDN/过期URL重解析、站点覆盖深化、Range续传；辅助模式仍拒绝自动跨站重定向。
5. PDF进程隔离、正文/元数据语义核对、DNS时间预算和规模/故障注入验收。

## 自动化复现

- npm.cmd run verify
- cargo test --offline --manifest-path src-tauri/Cargo.toml capture_ --lib
- 显式联网：cargo test --offline --manifest-path src-tauri/Cargo.toml capture_live_ --lib -- --ignored --nocapture --test-threads=1（当前arXiv直连已知失败，勿改测试伪造通过）
- node scripts/package-capture-extension.mjs
- npm.cmd run package:windows；若latest占用，保存staging并另发独立目录，不强杀用户进程。本轮一次性恢复脚本publish-capture-trial.mjs已执行，staging已清理，不能重复执行。

浏览器自动化夹具在Arena共享工作区browser-check/check.mjs/results.log；接收端为fixture，不是Windows桌面。可选权限通过测试浏览器管理API授予，未人工点击站点授权对话框。
