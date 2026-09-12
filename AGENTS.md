# A4 Note Agent 入口

开始任何开发任务前，先在 `D:\WorkSpace\Aster` 执行：

```powershell
Get-Content -Encoding utf8 docs\notes\DEVELOPMENT_HANDBOOK.md
Get-Content -Encoding utf8 docs\notes\AGENT_STATUS.md
npm run status
git status --short
```

稳定的模块边界、插件化规则、交接格式和验证矩阵以
`docs/notes/DEVELOPMENT_HANDBOOK.md` 为准；当前进度以
`plans/PROJECT_STATUS.json` 为准，人类可读的交接摘要见
`docs/notes/AGENT_STATUS.md`。

完成或阻塞任务时，同时更新上述两个状态文件的 `updatedAt`、工作范围、验证结果和下一步。提交前至少运行
`npm run test:agent-status`；涉及代码时按开发手册选择 `npm run build` 或 `npm run verify`。

不要把实时进度复制到 Skill、README 或提示词中。Skill 只能承载不随单个任务变化的操作流程，状态文件才是跨 Agent、跨时间的项目事实来源。
