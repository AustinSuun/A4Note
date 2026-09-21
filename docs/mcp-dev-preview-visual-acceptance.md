# 开发 Agent 使用 dev 预览自助验收（截图取证）

面向在本机执行 UI 任务的开发 Agent。**默认要求：涉及界面改动的任务，提交前必须用本流程产出截图证据**，不要只靠源码正则断言或口头描述「应该没问题」。

## 为什么默认要做

- 任务卡的验收项通常含「隔离UI验证」「无控制台报错」，源码断言覆盖不到实际渲染。
- 截图是交付时可复核的客观证据，避免把「测试通过」误当成「效果正确」。
- 能在提交前自己发现布局溢出、控件错位、空状态异常。

## 环境准备

Node 与 npm 不在非交互 shell 的 PATH 中，先显式导出：

```bash
export PATH="/c/Program Files/nodejs:$PATH"
```

本机已有 `playwright-core`（`node_modules/.bin/`）与 Chrome：

```
C:\Program Files\Google\Chrome\Application\chrome.exe
```

无需另装浏览器，`playwright-core` 直接用系统 Chrome 的 `executablePath` 即可。

## 优先用 preview，而不是 dev

`npm run dev`（vite，端口 1420）在本仓库会监视 `.worktrees/` 下的大量文件，出现持续 HMR reload，导致 Playwright `page.goto` 超时。

推荐：

```bash
npm run build
npx vite preview --port 4173 --strictPort
```

preview 服务静态产物，无 HMR 干扰，稳定得多。**注意：preview 跑的是 `dist/`，改完代码必须重新 `npm run build`，否则截到的是旧界面。**

两个服务都只监听 IPv6 回环，脚本里用 `http://localhost:<port>/`，**不要用 `127.0.0.1`**，否则 `ERR_CONNECTION_REFUSED`。

## 脚本骨架

```js
import fs from 'node:fs';
const log = m => fs.appendFileSync('D:\\WorkSpace\\Aster\\.tmp\\shot.log', m + '\n');
const { chromium } = await import('playwright-core');
const ctx = await chromium.launchPersistentContext('D:\\WorkSpace\\Aster\\.tmp\\prof', {
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true, args: ['--no-sandbox'], viewport: { width: 1280, height: 860 },
});
const page = ctx.pages()[0] || await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3500);
  // ...导航到目标界面...
  await page.screenshot({ path: 'D:\\WorkSpace\\Aster\\.tmp\\shots\\01.png' });
  log('ERRS:' + JSON.stringify(errs.slice(0, 5)));
} catch (e) { log('ERROR: ' + e.message); }
await ctx.close();
```

要点：

- **全程 try/catch 并写日志文件**。脚本崩了但没有日志，等于什么都没验证。
- **务必收集 `pageerror` 与 console error**，验收项里的「无控制台报错」靠它取证。
- 单次会话内走完所有步骤。**设置项在新的浏览器会话里不保留**，分多次脚本执行会丢状态。

## 进入任务场景（易错）

任务场景默认关闭，且有两个互相独立的开关，只开一个不会出现在侧栏：

1. 设置 → **插件管理** → 勾选「A4 Note 项目任务」(`tasks.core`)；
2. 设置 → **资料库** → 场景列表里勾选「任务」。

第 2 步常被忽略。开关渲染在 `library` 分区，不在插件管理。

## 浏览器预览的能力边界

浏览器预览**不能启动本机看板服务**，任务场景只能停在未连接态，界面会提示「当前是浏览器预览，不能启动本机程序」。

因此**依赖看板已连接态的 UI 截不到**。遇到这种情况：

- 如实说明哪部分截到了、哪部分受限截不到，并给出受限原因；
- **不要拿未连接态的截图冒充已连接态的验收**；
- 需要真实连接态时，交由用户在原生桌面窗口确认。

## 文件写入的坑

通过 PTY 往远程机写长文本会被截断（base64 分块 `printf` 同样不可靠，实测 1340 字节只落 1040）。

**写脚本文件一律用 `apply_patch` 工具**，它是 bridge 的原生写入通道，完整可靠。写完用 `read_files` 核对行数。

## 长任务执行

前台 `run_command` 上限 120 秒，且会被后续命令抢占终端，日志只剩「Interrupted while running」。

- Playwright 脚本用 `background: true` 提交，再轮询日志文件；
- 或用 `Start-Process -WindowStyle Hidden` 脱离终端。

## 交付要求

- 截图放 `.tmp/shots/`，**不要提交进 `docs/`**（`docs/` 只放分析与交接文档）；
- 提交说明里列出实际跑过的命令、截图覆盖的界面，以及未覆盖的部分及原因；
- 控制台报错为空要有日志佐证，不能凭印象写。

