# 公开问题板与 agent 闭环（issue intake）

这份文档定义「用户反馈 → 问题板 → 授权 → agent 开工 → PR → 人工验收」的规则。
入口是 GitHub Issues（公开），出口是 PR；**中间每一步都要留痕、可回滚**。

## 1. 用户从哪进

| 入口 | 用途 |
| --- | --- |
| `Bug 报告` 表单 | 行为不对、崩溃、渲染/交互异常 |
| `功能建议` 表单 | 新能力、体验改进 |
| `安装 / 升级问题` 表单 | 装不上、闪退、扩展不工作 |
| [私密漏洞报告](https://github.com/AustinSuun/A4Note/security/advisories/new) | 安全问题，**不得**走公开 issue |

表单字段就是分诊与开工要用的字段（版本 / 平台 / 复现步骤 / 期望 / 实际 / 报错原文）。
`blank_issues_enabled: false`：必须走模板，避免一句「用不了」。

## 2. 标签生命周期（谁能加）

| 标签 | 谁能加 | 含义 |
| --- | --- | --- |
| `needs-triage` | 模板自动 / 任何人 | 待分诊 |
| `needs-info` | 任何人（含 agent） | 缺字段，等作者补 |
| `security` | 任何人 | 已转私密报告，公开区不再讨论 |
| **`agent:ready`** | **只有人（维护者/调度员）** | 已授权 agent 开工，spec 冻结 |
| `agent:working` | agent | 正在做，防重复认领 |
| `agent:review` | agent | 有 PR 了，等人验收 |

> 规则来自既有实践：**agent 不能自己扩权，也不能改需求**。人只加一个标签，等于一次授权。

## 3. agent 闭环（每轮幂等）

```
1. 读     node scripts/issue-triage.mjs            # 只读分诊，产出 .tmp/issue-intake/report.{md,json}
2. 取     只处理带 agent:ready 的 issue（默认按最旧优先），一次一条
3. 锁     评论「我来处理」+ 把自己加进 agent:working，再去掉 agent:ready
4. 做     分支 fix/issue-<N>（记录 base commit），改代码 + 按仓库惯例补验证脚本
5. 验     npm run verify 相关子集 → 推分支 → 等 CI Verify 变绿（不许跳过失败）
6. 交     开 PR：标题带 (fixes #N)，正文含改动摘要 + 改前/改后证据（截图、命令输出）
7. 评     回评 issue：结论 + 证据路径 + 分支 + PR 号，标 agent:review
8. 闭     人 merge 后 issue 自动关闭；失败也要回评失败原因，绝不静默
```

证据落到 `.tmp/issue-intake/<N>/` 或 PR 描述里，与既有交付习惯一致（命令输出 + 截图 + 提交 sha）。

## 4. 门禁与安全（公开仓库的红线）

1. **永不自动合并**：`main` 受保护，必须 CI 全绿 + 人工点合并。
2. **最小权限**：自动化只用能读写 issue/PR、能推 `fix/*` 的 token；**不给** secrets、release、force-push 权限。
3. **自托管 runner 不能挂在公开仓库的 PR 上**：fork 的 PR 可以执行任意代码，等于把你机器交出去。需要真桌面的自托管 runner 只允许 `workflow_dispatch` 或仓库内分支触发，并单独隔离（详见 `docs/` 服务器方案）。
4. **只认标签**：没有 `agent:ready` 的 issue，agent 一行代码都不动。
5. **安全类先分流**：`scripts/issue-intake-core.mjs` 命中安全关键词即转私密报告，且**优先于授权判定**。
6. **限速**：同一时间只允许一条 `agent:working`；同一主题重复 issue 先合并再开工。
7. **可回滚**：拿掉 `agent:ready` 即停止；已开的 PR 直接关掉，分支保留。

## 5. 分诊器怎么用

```bash
node scripts/issue-triage.mjs                      # 当前仓库（gh 需已登录）
node scripts/issue-triage.mjs --repo AustinSuun/A4Note --limit 100
node scripts/issue-triage.mjs --offline payload.json   # 不联网，拿 gh 的 JSON 跑
```

输出四个桶（agent 队列 / 可开工候选 / 待补信息 / 安全类），并把报告写到 `.tmp/issue-intake/`。
它**只读**：不评论、不贴标签、不改状态；判断规则有回归脚本 `npm run test:issue-intake`。

## 6. 维护者要做的三件事

1. 看到「可开工候选」→ 判断值不值得做 → 加 `agent:ready`（= 接受这份 spec）。
2. 看到「待补信息」→ 让 agent 回一条列清缺什么（或自己回）。
3. 验收 PR：看证据、跑一次真机、点合并。
