# 0.1.33 发布记录 — 2026-09-24

## 结果

- 正式版本：https://github.com/AustinSuun/A4Note/releases/tag/v0.1.33
- 公开时间（GitHub）：2026-09-24T12:01:47Z。
- 桌面0.1.33；配对浏览器扩展0.6.5。
- 冻结源码及不可变tag：`5bd3d86524601b66e7f09bdf7a69b46a03f965d5`。
- PR19经正常受保护流程合并，远程main合并提交`02fa56d`。
- 必需Verify成功：https://github.com/AustinSuun/A4Note/actions/runs/35995341957/job/107618814154

## 本版范围

包含0.1.32的总览字段、图片托管与快捷键提示改进；新增上版冻结后完成的bc998c9笔记面板三态模式记忆/按论文隔离、面板边距与滚动条/正文限宽、悬浮圆弧手柄和入口短长按提示。版本文件、发布说明同步更新。保留已有真实动画结束等待修复，CDP响应超时12→30秒以适应冷CI解析，未削弱断言。

## 实际验证

- 标准Windows签名构建428940ms成功，扩展0.6.5配对成功。
- 992个跟踪源文件与冻结构建快照逐字节核验；构建引入的3处纯换行差异已精确恢复。build-info原样保留实际`sourceDirty:true`观测，没有篡改元数据。
- PE0.1.33、安装包/EXE SHA-256、固定公钥更新器签名及可信注释校验成功。更新器签名不等同于Authenticode。
- 本地agent-status、看板94项及动效69×2（正常与模拟reduce宿主）通过；随后准确源码的GitHub必需Verify成功。
- 5个公开附件由独立环境完整HTTPS下载，逐项大小/SHA-256与原始Windows产物及GitHub digest一致；latest、非草稿正式release及远程tag均核验。
- 旧0.1.32的5个文件已原样归档在`artifacts/windows/archive/0.1.33-20260924-115003-11588/`，更早发行未覆盖。

## 安全边界和证据

未安装或启动正式资料环境；未修改用户正式笔记；未泄露签名私钥；未绕过分支保护、改写发布tag或将开发交付冒充用户验收。此前PR18报告提交已作为祖先纳入本次PR19，不依赖PR18本身的CI结果。

证据位于发布worktree `.tmp/release-0133/` 的`verification.json`、`ci.json`、`merged.json`、`published.json`、`published-expected.json`和`published-verification.json`。
发布后文档提交仅为留档，不属于已冻结的发布二进制源码；不改写tag/安装包。

## 公开附件核验原始结果

```json
{
  "passed": true,
  "method": "Independent public HTTPS download from sandbox; all full file sizes/SHA-256 compared with original Windows build and GitHub digests",
  "commit": "5bd3d86524601b66e7f09bdf7a69b46a03f965d5",
  "tag": "v0.1.33",
  "url": "https://github.com/AustinSuun/A4Note/releases/tag/v0.1.33",
  "publishedAt": "2026-09-24T12:01:47Z",
  "verified": [
    {
      "name": "A4-Note-Capture-0.6.5.zip",
      "size": 136241,
      "sha256": "4d89d926cbe397ef39be9d861ef13f8f13819b75571e3617348353046a201913"
    },
    {
      "name": "A4.Note_x64-setup.exe",
      "size": 23096734,
      "sha256": "094070d15bd7bf26eb15defa900c9bd280321162198caecca82921594ff2b157"
    },
    {
      "name": "A4.Note_x64-setup.exe.sig",
      "size": 420,
      "sha256": "459089876d7d0f413f855f0c7eb952e0d112ed7cce279522ce75f28401ae83e5"
    },
    {
      "name": "build-info.json",
      "size": 865,
      "sha256": "54f00d28be685d0746433ad2f5d1ae555f9f13c0f5ff34eae43b6e946875503a"
    },
    {
      "name": "latest.json",
      "size": 1047,
      "sha256": "53a23dfed9d7f50d5b57d5b28cea20f66350c5ee52683a1e9614b915279f6598"
    }
  ]
}
```
