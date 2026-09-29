# “发现新版本”弹窗整理：开发交付记录（巡川）

任务 `ca2090dd-188a-477b-a3aa-93bb38456c33` spec 2；分支 `fix/update-dialog-xunchuan`；基线本地 main `a1f202b`。对照用户上传的红圈截图：更新日志的滚动条应贴近弹窗右边界，删去签名/备份的整段小字、勾选确认区和底部“仅提示”小字，已就绪时一键启动**原有**安装前流程。

只改标题栏弹窗 `BrandUpdateMenu.tsx` 和其局部 CSS，不改设置页、版本来源或原生 updater。安装按钮只在 `model.downloaded` 时出现，并按 `model.canInstall` 决定禁用，点击仍调用原有 `updateActions.install()`；原 updater 的“候选包已下载且签名验证成功才能安装、先冲刷未保存更改、再进行必要资料库备份、备份失败停止安装、最后才调用安装器”路径不变。下载中、安装中仍禁用，错误继续由现有 `role="alert"` 显示；GitHub 发布说明和关闭按钮保留。

## 原生隔离 UI 证据（不实际更新）

- `dev:live -- --instance xunchuan-update --port 1489 --cdp-port 9389`；测试身份 `app.aster.research.dev.xunchuan-update.w25db10aaff`，底部全图保留 `DEV xunchuan-update · 独立测试库`。仅在隔离窗口拦截前端 `updateModel.ts` 请求注入固定的模拟版本 `0.1.32 → 0.1.33` 与模拟日志；**安装/发布入口都由测试桩记录点击而非触发真实下载、安装或浏览器跳转**。未读/改正式资料库。
- 同为 1280×820 CSS 视口：`before-long.png`、`before-scrolled.png` 与 `after-long.png`、`after-scrolled.png`，含相同长日志和可滚动列表。弹窗右边到列表滚动区右缘从 **16.8px** 缩至 **0.8px**；修改后内容不横向溢出（`scrollWidth === clientWidth`），与滚动条间仍有 14px 内容内边距。修正了共享 `.settings-update-notes` 默认 `display:grid` 导致长 URL 迫使内部列表宽于容器的问题，只对本弹窗用 `display:block`；项目符号、缩进、中文断行及长 URL 经原生画面目视检查。
- `narrow-long.png`（980×680 CSS 视口，与原生最小窗口宽一致）、`short-long.png`、`not-ready-long.png`、`busy-long.png`、`failure-long.png` 检查窄窗口、短日志、未就绪、安装中及备份失败提示；全图保留 DEV 条。已就绪按钮无需勾选即可点，模拟点击计数 1；GitHub 入口与关闭按钮可操作。每个场景 `pageerror=[]`、`consoleError=[]`，汇总和精确视口/滚动几何在 `.tmp/update-dialog-shots/*-result.json`；模拟原生 UI 取证脚本 `.tmp/verify-update-dialog-live.mjs`。

## 安全回归与构建

- `node scripts/verify-brand-update.mjs`：原有“未下载不能安装、签名校验失败不能安装、保存冲突不能安装、成功时先保存再备份再安装”模拟断言通过；新增备份失败不会调用安装、失败态 body.inert 还原及修复后可重试，补充弹窗无遮蔽文案/勾选、`model.canInstall` 和局部滚动 CSS 的回归断言。模拟测试未调用任何实际安装。
- `npm run test:settings-ui`、`npm run test:extension-updates`、`npm run test:architecture`、`npm run build`、源码诊断 0 错误/警告及任务文件 `git diff --check` 通过；日志存于 `.tmp/update-*.log`。仅使用已有依赖；没有打包、安装、推送、发布或自行验收归档。

提交/合入本地 main 与任务板的实际哈希，以任务卡交付记录为准。
