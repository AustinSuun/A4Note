# A4 Note 0.1.32 发布与验证记录

## 结果

用户明确要求“打包推送发布一下”。已通过受保护分支流程合并、构建并正式发布 **v0.1.32 / Windows x64**：

- Release：https://github.com/AustinSuun/A4Note/releases/tag/v0.1.32
- 安装包：https://github.com/AustinSuun/A4Note/releases/download/v0.1.32/A4.Note_x64-setup.exe
- 发布源码：`bfd88ada2b94790694f1ba330023447c0e688e90`；GitHub tag 与此提交相同。
- PR：https://github.com/AustinSuun/A4Note/pull/17（已正常合并，无 admin/force 绕过）。
- 必需 Verify：https://github.com/AustinSuun/A4Note/actions/runs/35991355432/job/107605945310（SUCCESS）。
- GitHub 公布时间：2026-09-24T11:22:39Z；正式、非 draft、非 prerelease，已设为 latest。

## 范围

包含总览与文献库的稳定字段 ID、按需自定义字段、同源编辑与冲突保护、明确选区归类、图片缩略图/全图、空间自适应摘要、实际滚动根和深浅主题对比度修复；包含此前合入的文件存储迁移、库导航/菜单/列设置、PDF 页码改进；包含 `30f476f` 的 Ctrl 按住 500ms 才显示提示修复。浏览器扩展保持 0.6.5。

发行快照冻结后新增的其他 main 提交不会自动进入这个包。23671 阅读器笔记面板扩展优化不在此快照；不把其后合入的改动冒称已发布，不把开发者测试或发版当作任务用户验收。白板仍仅讨论。

## 构建与完整性

- 独立工作区：`D:/WorkSpace/Aster/.worktrees/release-0132-arena`。
- 标准 `npm run package:windows`（PowerShell），随后标准浏览器扩展打包；退出 0，合计 **433528ms**。
- 实际 EXE 内前端入口嵌入、构建 CSS 检查、Windows FileVersion/ProductVersion **0.1.32** 均通过。
- 两个 EXE 重新读取 SHA-256，与 build-info 相同；用配置固定公钥验证安装包 Minisign/Ed25519（BLAKE2b 摘要）及可信注释，均通过。
- **更新器签名不是 Windows Authenticode 代码签名。** 没有安装或运行新包，没有访问正式资料库，也没有输出私钥或密码。
- 构建前建立 987 个已跟踪文件的字节 SHA-256；构建后仅恢复已证明为换行变化的 Cargo.toml 与两份生成 schema，全部跟踪文件字节哈希与构建前相同。build-info 的 `sourceDirty: true` 保留实际构建观测，未伪造为 false。

| 产物 | 字节 | SHA-256 |
|---|---:|---|
| 本地 `a4note.exe` | 38500352 | `3E48306369CFBF96BA772628341F74F1F442AA632BD14CE11890F4ACB14BFC1A` |
| `A4.Note_x64-setup.exe` | 23093421 | `00DA4D5C6E49ED96DB7DFB83F1C04E144A21294336BACAEA3A584D462581FA57` |

规范本地产物目录：`D:/WorkSpace/Aster/artifacts/windows/latest/`。Release 提供安装包、更新签名、latest.json、build-info.json 和浏览器扩展，共 5 份附件。

## CI 故障与修正

第一次 CI（35990087101，源码 e441c93）仅 `test:note-enter-motion-browser` 失败；正常动效场景得到 0s 时长和直接 entered，说明测试运行在减少动态效果分支。原脚本没有明确设置正常场景的媒体偏好；该次其余步骤（包括 Rust 238 通过/0 失败/5 忽略）通过。

修正仅在回归脚本中通过 CDP 显式设置 `prefers-reduced-motion: no-preference`，并保留独立 `reduce` 分支的全部原有断言。增加宿主偏好检查和可选模拟宿主 reduce 的入口；普通环境与模拟环境各 **69/69** 通过，没有修改产品行为、跳过检查或放宽动画断言。以修正提交 bfd88ad 重新打包，PR 必需完整 Verify 成功后才合并及发布。

## 归档和线上回读

标准脚本归档时逐项比较 5 个旧文件哈希：

- 原 0.1.31（源码 71b09a8）完整保留在 `artifacts/windows/archive/0.1.32-20260924-105605-8292/`。
- 未发布的 e441c93/0.1.32 候选完整保留在 `artifacts/windows/archive/0.1.32-20260924-110912-7140/`。

发布脚本先核对 draft 附件完整性/大小/哈希再转为正式发布，并验证公开 URL。Windows 本机的发布后 `gh release download` 在 180 秒超时，因此没有把这次下载当成成功：另从独立沙箱经公开 HTTPS 完整下载了全部 5 个附件，逐一核对大小和 SHA-256，并把结果传回 Windows 再与本地实际打包文件逐字节哈希比较，**全部一致**。公共 tag、来源提交、最新版本和正式发布状态均已复核。

机器证据在发行工作区 `.tmp/release-0132/`：`package-status.json`、`verification.json`、`ci.json`、`merged.json`、`published.json`、`public-download-verification.json`、`published-verification.json`。这些是本次操作记录，不属于正式资料库。

## 后续

本报告是发布后记录，不修改已发布 tag、安装包或其 build-info。其余后续功能应独立验证后提高版本再发布，不能覆盖 v0.1.32 的签名附件。
