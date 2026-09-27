# OpenReview 论文 PDF 下载失败：根因定位与修复（iMF / aVC3VMPUmR）

- 日期：2026-09-27。
- 任务：021ac264-43a1-4487-814e-2ccc8e465266，spec 1，修复 OpenReview 论文识别后 PDF 下载失败。
- 执行者：Arena-秋序。基线：本地 main `bbab3b6`；隔离分支 `fix/openreview-imf-qiuxu`。
- 用户提供的失败入口：`https://openreview.net/forum?id=aVC3VMPUmR&referrer=…`（论文 ID `aVC3VMPUmR`）。

## 1. 论文身份已确认

| 项目 | 实际值 |
| --- | --- |
| 标题 | Improved Mean Flows: On the Challenges of Fastforward Generative Models |
| 会议 | CVPR 2026，Submission 36416，CC BY 4.0，`readers: everyone`（公开） |
| 作者 | Zhengyang Geng、Yiyang Lu、Zongze Wu、Eli Shechtman、J. Zico Kolter、Kaiming He |
| 页面 Download PDF 图标链接 | `https://openaccess.thecvf.com/content/CVPR2026/papers/Geng_Improved_Mean_Flows_On_the_Challenges_of_Fastforward_Generative_Models_CVPR_2026_paper.pdf` |
| OpenReview API `content.pdf` | 同上（CVF 官方站点） |
| 同篇预印本 | arXiv 2512.02012（CVF 页面 Related Material 指向它） |

即：**这篇 OpenReview 论文的 PDF 不由 openreview.net 托管，而由 CVF 官方站点托管。**公开 API 返回同样结论，可复现、无需登录。

## 2. 根因：候选链接选错，不是下载器故障

OpenReview 官方前端源码（`openreview/openreview-web`，2026-09-27 取读）：

- `app/forum/page.js::generateMetadata`：只要 `content.pdf` 存在，就写入
  `citation_pdf_url = https://openreview.net/pdf?id=${forumNote.id}`，
  **即使 PDF 托管在外部出版商**。
- `components/forum/ForumNote.js`：可见的 “Download PDF” 图标链接在 `content.pdf` 为绝对 URL 时直接指向外部地址，否则才用 `/pdf?id=${id}`。

本机实测（2026-09-27）`https://openreview.net/pdf?id=aVC3VMPUmR` → **HTTP 403、text/html、非 PDF**。
因此旧链路是：

1. `collector.js` 的 `primaryPdf` 选择器不匹配该图标链接（OpenReview 只用 `title="Download PDF"`，没有 `aria-label`），且图标链接无文字，`label` 为空；
2. `normalize.mjs` 只把 `citation_pdf_url` 作为正文候选，DOM 兜底扫描仅在“一个正文候选都没有”时才生效；
3. 结果唯一候选就是会 403 的同站代理地址 → 识别成功、下载失败。

下载器本身无缺陷：同一台主机上 arXiv PDF 原生 1.1–1.4s 完整下载并导入成功；CVF 正确地址也曾在原生下载中完整成功（见第 4 节）。

## 3. 修复内容（仅候选选择，未动下载安全边界）

- `apps/browser-extension/collector.js`：链接记录新增 `title` 属性；`primaryPdf` 选择器补充 `a[title="Download PDF"]`。仍只读 DOM 属性，不读 cookie、不执行页面脚本。
- `apps/browser-extension/normalize.mjs`：当页面存在**唯一**的 “Download PDF” 控制链接且与 `citation_pdf_url` 不同时，采用页面控制链接，并给出可理解警告“页面 PDF 元数据与页面下载链接不一致，已采用页面下载链接；请核对来源站点”。出现多个控制链接时不猜测，仍按元数据。
- `scripts/verify-capture.mjs`：新增 4 组边界断言（元数据与页面链接不一致→采用页面链接；一致→不变；多个控制链接→保持元数据；仅有控制链接→可解析）。

未修改：下载器的公共 HTTPS/443、公网地址检查、DNS 固定、逐跳重定向校验、HTML/登录页拒绝、大小与配额、lopdf 结构校验；未修改超时、代理白名单、TLS、SSRF 防护；未修改登录/验证码/权限流程与 `browser-assist.mjs` 的显式授权流程。

## 4. 验证证据

| 环节 | 实际结果 | 说明 |
| --- | --- | --- |
| 隔离 Chrome DOM 重放（复刻 OpenReview 真实服务端标记，其他网络阻断） | 修复前唯一候选 `https://openreview.net/pdf?id=aVC3VMPUmR`（该地址实测 403 text/html）；修复后唯一候选为 CVF PDF，标题与 6 位作者正确，并带不一致警告 | 用真实 `collector.js`/`normalize.mjs` 执行，非安装版扩展点击流程 |
| 原生 `download::process` 下载 CVF PDF | `state=complete`，3,438,232 字节，`sha256=41aa05bf6981da6922b74937b5b98ca41144da32fa4377ef1c8c3ae1ddadca6d`，lopdf 结构/页校验通过 | 与本机独立直接下载的字节数与 SHA-256 完全一致 |
| 原生隔离库导入与重复导入 | `hasSourcePdf=true`；重复导入仍为同一 `paperId` | 一次性临时库，已自动清理，未触碰正式库 |
| 复跑稳定性 | 同一用例 4 次运行：1 次 complete（79s）、1 次 `download_stream_failed`（收到 335,950/3,438,232 字节后约 35s 被重置）、2 次 12s 连接超时 | 见第 4.1 节，属远端主机对本机 IP 的限速/重置，非产品缺陷 |
| `node scripts/verify-capture.mjs` | 通过（含新增 OpenReview 边界断言） | 合成断言，非线上 E2E |
| `node scripts/verify-capture-native.mjs` | 通过 | mock 浏览器端口 |
| `cargo test --lib capture::` | 27 通过 / 0 失败 / 6 忽略 | 忽略项含两个显式联网诊断测试 |
| 诊断 | 改动文件 0 条 | — |

新增显式 opt-in 忽略测试 `src-tauri/src/capture/live_tests.rs::capture_live_openreview_cvf_imf_to_library`：固定使用 OpenReview 页面实际指向的 CVF 公开地址，调用现有原生下载、结构校验与隔离导入，默认不联网。

### 4.1 复跑为何不稳定（远端限速，非代码缺陷）

同一台主机上的对照测量（2026-09-27，均为 CVF 同一 PDF）：

| 客户端 | 结果 |
| --- | --- |
| curl 默认 UA，首次 | 完整 3,438,232 字节，3.16s，1.09 MB/s |
| Node HTTPS GET | 200，852ms；TCP 连接 275ms；DNS 单条 A 记录 20.127.184.81 |
| curl 应用 UA | 3,151,768/3,438,232 字节，40s 超时，78 KB/s |
| curl 浏览器 UA | 2,152,908/3,438,232 字节，40s 超时，53 KB/s |
| 原生 `download::process` 第 1 次 | complete，79s（约 43 KB/s，仍在 180s 预算内） |
| 原生 `download::process` 第 2–4 次 | 连接超时 12s ×2；流中断 `download_stream_failed` ×1 |
| 原生 arXiv PDF（同主机） | 1.1–1.4s 完整 18,082,601 字节 |

浏览器 UA 同样被限速，因此**不是 User-Agent 判定**；`arxiv.org` 不受影响，说明是该远端 CDN 对本机出口 IP 的限速/连接重置，随请求频次变化。据此**未修改**连接/请求超时、重试策略或代理白名单；失败时应用给出 `download_timeout` / `download_stream_failed` 明确错误与按附件重试入口，也可使用“浏览器辅助获取 PDF”。

## 5. 仍未满足的验收项（不自行验收）

1. 未在**已安装扩展**上完成真实点击下载 E2E（按约束不安装、不注册、不启动正式桌面）。
2. 未在**可视原生阅读器**中打开该 PDF 复核。
3. CVF 站点从本机网络当前连接超时，用户侧可能需要重试，或使用“浏览器辅助获取 PDF”（使用浏览器自身网络与登录态，60s 上限）。
4. 因此建议合入本地 main 后 **submit 用户验收**，不自行归档。

## 6. 证据位置

隔离工作树 `.worktrees/openreview-imf-qiuxu/.tmp/openreview-exact/`：

- `replay-summary.json`、`collected-openreview-replay.json`、`envelope-openreview-replay.json`、`openreview-forum-fixture.html`：DOM 重放前后候选对比。
- `native-cvf-test.log.txt`：CVF 原生下载 complete、3,438,232 字节、SHA-256 与导入成功日志。
- `live-final.log.txt`、`live-cvf-retry.log.txt`：一次成功与两次连接超时复跑的原始日志。
- `verify-capture.log`、`verify-capture-native.log`、`capture-regression-final.log`：脚本与 Rust 回归。
- `forum.json`、`guessed-pdf.json`：`/pdf?id=` 与论坛页在主机的实际响应记录。
- 上一阶段 iMF arXiv 诊断证据仍在 `.tmp/openreview-imf-probe/`（报告 `docs/mcp-openreview-imf-diagnostic-qiuxu-2026-09-27.md`）。
