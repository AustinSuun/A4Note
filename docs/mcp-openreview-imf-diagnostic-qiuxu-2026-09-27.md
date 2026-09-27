# iMF 下载链路排查：尚未复现用户的 OpenReview 故障

- 日期：2026-09-27。
- 任务：021ac264-43a1-4487-814e-2ccc8e465266，spec 1。
- 执行者：Arena-秋序。
- 基线：本地 main `bbab3b6`；隔离分支 `fix/openreview-imf-qiuxu`。
- 结论：**已确认的 iMF arXiv 原生下载、PDF 结构校验、隔离库导入和重复导入成功；未确认同篇 OpenReview 失败链接，不能宣称原任务已修复。**

## 1. 样例身份与边界

用户确认以“iMF 流模型论文”继续排查下载失败。核对作者官方仓库后，当前能明确对应的是：

- Improved Mean Flows: On the Challenges of Fastforward Generative Models。
- 作者仓库：https://github.com/Lyy-iiis/imeanflow 。仓库 README 直接链接下述 arXiv 论文。
- 论文入口：https://arxiv.org/abs/2512.02012 。
- PDF：https://arxiv.org/pdf/2512.02012 。
- 上述来源于本次访问，访问日期 2026-09-27。没有从作者仓库或本次检索确认到同篇 OpenReview forum URL；这不是“该页不存在”的证明。

原版 MeanFlow、其他 MeanFlow 变体与 iMF 不可混为一篇。OpenReview 公共对照 `YicbFdNTTy` 不是 iMF，仅用于检查连通性，不作为任务的成功验收样例。

## 2. 实际网络与解析证据

| 环节 | 实际结果 | 不能据此推断的内容 |
| --- | --- | --- |
| 主机 curl 获取 iMF 摘要页 | HTTP 200，text/html，42,672 字节，无重定向 | 不代表 PDF 下载成功 |
| 现有扩展 collector + normalize 重放实际 HTML | 隔离无用户资料 Chrome 中正确识别标题、6位作者、arXiv ID 2512.02012、唯一 HTTPS PDF 候选 | 页面为下载后的 HTML 重放，其他网络全部阻断，不是安装版扩展完整点击流程 |
| 主机 curl，45秒期限，iMF PDF | HTTP 200、application/pdf，但仅收到 3,354,999 / 18,082,601 字节后超时，退出28 | 即使已有 `%PDF-` 魔数，也不是完整有效下载，更不能当作导入成功 |
| 主机 curl，OpenReview 对照 PDF | 连接 openreview.net:443 超时，HTTP状态0、0字节，退出28 | 本轮不是此前记录的403，不能沿用旧原因，也没有获取论文内容 |
| 原生 download::process，iMF PDF | 1,141ms 后 complete；完整 18,082,601 字节，通过现有 lopdf 结构/页校验与哈希计算 | 不代表 OpenReview 可下载，也不是可视阅读器验收 |
| 原生隔离导入与重复导入 | hasSourcePdf=true；重复调用仍为同一 paperId | 不代表用户正式库或已安装版本也复现同样结果 |

原生验证的完整文件 SHA-256：

```text
19a2a27ed86cc813bb0943ab43e80f4a80cf725aa692bb2f7d8c33cbbc8e12b7
```

测试通过一次性临时目录运行；自动清理测试 PDF、临时资料库和数据库。没有导入用户的正式资料库。curl 的不完整 PDF 保留在隔离工作树 `.tmp/openreview-imf-probe/` 作为失败证据，不是可交付论文文件。

## 3. 源码链核对

- `apps/browser-extension/collector.js`：从页面提取学术 metadata 和链接，不读取 cookies。
- `apps/browser-extension/normalize.mjs`：本次真实 iMF 页面正确产生唯一 `https://arxiv.org/pdf/2512.02012` 候选，无需凭论文标题猜 URL。
- `src-tauri/src/capture/download.rs`：公共 HTTPS/443、公共地址检查与 DNS 固定；逐跳验证重定向，明确拒绝 HTML/登录页面，文件长度/PDF结构/配额检查后才标为 verified。
- `src-tauri/src/capture/system_proxy.rs`：已有 arxiv.org 专用 Windows 静态回环代理适配，其他站点保持直接连接和 DNS 固定。未读取/输出用户代理配置或凭据，未修改代理设置。仅从源码可知两种传输路径可能不同，未断言本轮具体原因。
- `src-tauri/src/capture/ingest.rs`：在一次性资料库调用真实导入逻辑并确认重复导入身份一致。
- `apps/browser-extension/browser-assist.mjs`：现有显式用户点击辅助传输入口，没有擅自触发用户浏览器登录态或传送会话内容。

**curl 超时与原生快速成功构成重要反证：不能仅凭外部 curl 失败，就把原生下载超时、CORS、反爬或权限判定为根因。**本次没有放宽请求上限、代理白名单、TLS、SSRF、登录或重定向保护。

## 4. 本次代码与测试范围

仅新增显式 opt-in 的忽略测试：

`src-tauri/src/capture/live_tests.rs::capture_live_imf_pdf_to_library`

它固定使用公开 iMF arXiv 地址，调用现有原生下载、结构验证和隔离导入，检查重复导入同一 paperId。默认测试不会自动联网；必须显式指定 `--ignored`。没有修改下载产品逻辑、扩展运行逻辑或既有测试断言。

执行结果：

- `node scripts/verify-capture.mjs`：通过；合成解析/最小权限断言，不是线上 E2E。
- `node scripts/verify-capture-native.mjs`：通过；mock 浏览器端口的关联/重用/拒绝/断线/超时/分块传输断言。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib capture_live_imf_pdf_to_library -- --ignored --nocapture`：准备资源后1通过、0失败，原生下载及隔离导入成功。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib capture::`：27通过、0失败、5忽略。
- 新增测试文件的编辑器诊断：0条。
- `node scripts/verify-agent-status.mjs`、`git diff --check`：通过。
- 原生 Cargo 命令从 PowerShell 执行；复用本执行者此前已停止的独立开发构建缓存，没有启动正式应用。
- 首次原生编译因隔离工作树缺少 native-host 资源而退出101；随后按仓库脚本 `prepare-native-host.mjs --debug` 准备开发资源后成功。没有安装、注册扩展、打包发布或启动正式桌面。
- 构建有现有 dead_code/unused Manager 警告，不能称编译零警告。
- 未跑完整 `npm run verify` 或前端生产 build；未启动可视原生 DEV 阅读器，未完成实际浏览器扩展点击下载 E2E；不宣称满足原任务验收。

## 5. 证据与后续所需信息

本分支隔离工作树证据位于 `.tmp/openreview-imf-probe/`：

- `results.json`：公共 curl 状态、类型、字节数及失败类别。
- `imf-envelope.json`：从真实 HTML 重放所得的现有扩展解析结果。
- `native-test.log`：首次资源缺失编译失败，保留而非覆盖。
- `native-test-prepared.log`：原生 iMF 下载/校验/隔离导入成功日志。
- `capture-regression.log`：27通过、0失败、5忽略的相关 Rust 回归。

要继续定位用户实际故障，需要：

1. **点击下载时浏览器地址栏的完整 URL**，确认究竟是该 arXiv 页面，还是另一个 OpenReview 页面。
2. **插件或应用“下载帮助/任务详情”中的实际错误文字或截图**；如方便，一并给出桌面和扩展版本。
3. 不要提供密码、Cookie、登录令牌或完整私人日志。

任务应保留阻塞，不 submit、不自行验收。新增诊断测试、报告与双状态保存在独立分支；不把诊断结果合并成“已修复”，原 `c290355` 候选识别补丁也未擅自合入。取得实际失败入口后重新读取任务及主线，复现完整链路再决定最小修复。
