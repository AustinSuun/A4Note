// Cheap, read-only gate: skip a previously published version before compiling or signing.
import { readFile, appendFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release requires a stable semantic version');
const tag = `v${version}`;
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tag) throw new Error('Tag must match package version');
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'A4Note-release-plan' };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
const response = await fetch(`https://api.github.com/repos/AustinSuun/A4Note/releases/tags/${tag}`, { headers, signal: AbortSignal.timeout(30000) });
if (response.status !== 404 && !response.ok) throw new Error(`Cannot inspect release: HTTP ${response.status}`);
const publish = response.status === 404 || (await response.json()).draft;
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=${Boolean(publish)}\n`);
console.log(publish ? `Preparing ${tag}` : `${tag} already published; safely skipping duplicate release work.`);
