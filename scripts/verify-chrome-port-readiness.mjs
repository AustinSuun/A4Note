/* 每个自带 Chrome 的浏览器回归都必须用共享的等待器 —— 不许再手搓
   DevToolsActivePort 读取。Windows 上 Chrome 会先创建端口文件、后释放写锁，
   `existsSync` 通过不等于可读：这正是 CI 里 EBUSY 偶发失败（每次重跑就好）的根源。

   本检查只看静态事实：谁启动了 CDP、谁碰了端口文件。
   node scripts/verify-chrome-port-readiness.mjs */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const HELPER = 'wait-for-chrome-debug-port.mjs';
/* 允许直接提到 DevToolsActivePort 的文件：等待器本身、它的单测、以及本检查。 */
const ALLOWED_TO_MENTION = new Set([HELPER, 'verify-chrome-debug-port.mjs', 'verify-chrome-port-readiness.mjs']);

const entries = (await readdir('scripts')).filter((name) => name.endsWith('.mjs')).sort();
const sources = new Map();
for (const name of entries) sources.set(name, await readFile(`scripts/${name}`, 'utf8'));

/* ---------- 1. 启动 CDP 的脚本必须用共享等待器 ---------- */
const launchCdp = entries.filter((name) => sources.get(name).includes('--remote-debugging-port=0'));
assert.ok(launchCdp.length >= 25, `应当有一批自带 CDP 的浏览器回归（现在 ${launchCdp.length} 个）`);
const notUsingHelper = launchCdp.filter((name) => !sources.get(name).includes(HELPER));
assert.deepEqual(notUsingHelper, [],
  `这些脚本自启 Chrome 却没走共享等待器：${notUsingHelper.join(', ')} —— 用 waitForChromeDebugPort(profile) 取端口`);

/* 非 0 端口（写死端口）会让并发跑的两个回归互相踩，仍需报告。 */
const pinnedPorts = entries.filter((name) => /--remote-debugging-port=[1-9]/.test(sources.get(name)));
assert.deepEqual(pinnedPorts, [], `浏览器回归不要写死调试端口（会被并发/残留实例占用）：${pinnedPorts.join(', ')}`);

/* ---------- 2. 除了白名单，谁都不许再手搓端口文件 ---------- */
const handRolled = entries.filter((name) => !ALLOWED_TO_MENTION.has(name) && sources.get(name).includes('DevToolsActivePort'));
assert.deepEqual(handRolled, [],
  `这些脚本又在直接读端口文件（Windows 写锁竞态会偶发失败）：${handRolled.join(', ')} —— 改用 ${HELPER}`);
const polling = entries.filter((name) => !ALLOWED_TO_MENTION.has(name) && /fs\.existsSync\([^\n]*DevToolsActivePort/.test(sources.get(name)));
assert.deepEqual(polling, [], `「文件存在即就绪」的轮询是不可靠的就绪判定：${polling.join(', ')}`);

/* ---------- 3. 等待器本身保持它承诺的契约 ---------- */
const helper = sources.get(HELPER);
assert.ok(helper, `${HELPER} 必须存在：它是所有浏览器回归的唯一就绪判定`);
assert.match(helper, /export async function waitForChromeDebugPort\(profile/, '等待器导出 waitForChromeDebugPort(profile)');
assert.match(helper, /error\.code !== 'ENOENT' && error\.code !== 'EBUSY'/, '只对 ENOENT/EBUSY 重试，其它错误立刻抛出');
assert.match(helper, /\\\/devtools\\\/browser\\\//, '要校验端口文件第二行是 /devtools/browser/… —— 只认端口号会把半截文件当就绪');
assert.match(helper, /attempts = 150, intervalMs = 100/, '保留有界重试预算（默认 150×100ms），不能退化成无限等待');
assert.match(helper, /throw new RangeError\('Invalid Chrome readiness retry budget'\)/, '非法重试预算要显式报错');

/* ---------- 4. 单测与接线在场 ---------- */
const unitTest = sources.get('verify-chrome-debug-port.mjs');
assert.ok(unitTest, 'verify-chrome-debug-port.mjs 必须存在：等待器自己也要有回归');
assert.match(unitTest, /wait-for-chrome-debug-port\.mjs/, '单测要直接驱动等待器');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
assert.ok(packageJson.scripts['test:chrome-port-readiness']?.includes('verify-chrome-port-readiness.mjs'),
  'package.json 要接线 test:chrome-port-readiness');
/* 等待器单测在 verify-all 里是直接 node 调用的（不是 npm script），两种接线都认。 */
const verifyAll = await readFile('scripts/verify-all.mjs', 'utf8');
const wiredUnit = verifyAll.includes('verify-chrome-debug-port.mjs') || packageJson.scripts['test:chrome-debug-port']?.includes('verify-chrome-debug-port.mjs');
assert.ok(wiredUnit, '等待器单测要接进验证套件（verify-all.mjs 或 package.json）');
assert.ok(verifyAll.includes('test:chrome-port-readiness'), '本检查也要接进 verify-all.mjs');

console.log(`Chrome 端口就绪检查通过：${launchCdp.length} 个 CDP 回归全部走共享等待器，无人手搓端口文件轮询；等待器契约（ENOENT/EBUSY 重试、/devtools/browser 校验、有界预算）与单测接线完好。`);
