// Regression guard for the task scene -> service binding guide.
// Renders TaskBindingGuide against stubbed preflight results and asserts the
// guide reports blockers instead of silently offering a launch that will fail.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve('src/features/taskboard');
const temp = path.resolve('.tmp/task-binding-guide', String(process.pid));
fs.mkdirSync(temp, { recursive: true });
let checks = 0;
const check = (v, m) => { assert.ok(v, m); checks++; };

const preflight = (over = {}) => ({
  ready: true,
  node: { status: 'ok', version: '22.14.0', required: '22.13', detail: '' },
  resources: { status: 'ok', detail: '' },
  project: { status: 'ok', path: 'D:/demo', detail: '' },
  port: { status: 'free', value: 4319, detail: '' },
  ...over,
});

try {
  const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, 'TaskBindingGuide.tsx'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText.replace("from '../../platform/projectTaskLauncher'", "from './launcherStub.mjs'");
  fs.writeFileSync(path.join(temp, 'TaskBindingGuide.mjs'), compiled);

  // Stub stands in for the Tauri bridge; the real probe is exercised in Rust.
  const stub = `
export let current = null;
export let fail = null;
export const setProbe = (p, f = null) => { current = p; fail = f; };
export const supportsLocalTaskLaunch = () => true;
export const preflightLocalTasks = async () => { if (fail) throw new Error(fail); return current; };
export function preflightBlockers(p) {
  const out = [];
  if (p.node.status !== 'ok') out.push(p.node.detail || '无法确认 Node.js 环境。');
  if (p.resources.status !== 'ok') out.push(p.resources.detail || '缺少任务服务资源。');
  if (p.project.status === 'unset') out.push('尚未选择项目文件夹。');
  else if (p.project.status === 'invalid') out.push('所选项目文件夹无效或已不存在。');
  if (p.port.status === 'invalid' || p.port.status === 'unknown') out.push(p.port.detail || '端口不可用。');
  return out;
}`;
  fs.writeFileSync(path.join(temp, 'launcherStub.mjs'), stub);

  const stubMod = await import(pathToFileURL(path.join(temp, 'launcherStub.mjs')).href);
  const { TaskBindingGuide } = await import(pathToFileURL(path.join(temp, 'TaskBindingGuide.mjs')).href);

  // Rendering is synchronous, so the first paint shows the pre-probe state.
  const paint = (props) => renderToStaticMarkup(React.createElement(TaskBindingGuide, {
    connected: false, port: 4319, busy: false, onStart: () => {}, ...props,
  }));

  const first = paint({});
  check(first.includes('检查运行环境'), '首屏列出环境检查步骤');
  check(first.includes('选择项目文件夹'), '首屏列出选择项目步骤');
  check(first.includes('启动服务并验证身份'), '首屏列出启动与身份校验步骤');
  check(first.includes('不会随软件或系统自动启动'), '首屏声明不自动启动服务');
  check(first.includes('不会结束占用端口的其他程序'), '首屏声明不抢占端口');

  // Blockers are computed, not guessed.
  const b = stubMod.preflightBlockers;
  check(b(preflight()).length === 0, '环境齐备时没有阻塞项');
  check(b(preflight({ node: { status: 'too_old', version: '20.11.0', required: '22.13', detail: 'Node.js 版本过低' } }))
    .some(x => x.includes('版本过低')), 'Node 版本过低被报为阻塞');
  check(b(preflight({ node: { status: 'missing', version: '', required: '22.13', detail: '没有找到 Node.js' } }))
    .some(x => x.includes('没有找到 Node.js')), '缺少 Node 被报为阻塞');
  check(b(preflight({ resources: { status: 'missing', detail: '缺少任务服务资源' } }))
    .some(x => x.includes('缺少任务服务资源')), '缺少打包资源被报为阻塞');
  check(b(preflight({ project: { status: 'unset', path: '', detail: '' } }))
    .some(x => x.includes('尚未选择项目文件夹')), '未选目录被报为阻塞');
  check(b(preflight({ project: { status: 'invalid', path: 'D:/gone', detail: '' } }))
    .some(x => x.includes('无效')), '目录失效被报为阻塞');

  // A busy port is a warning, not a blocker: it is usually this project's own service.
  check(b(preflight({ port: { status: 'in_use', value: 4319, detail: '端口 4319 已被占用' } })).length === 0,
    '端口占用不算阻塞，允许复用已在运行的服务');

  const steps = String(fs.readFileSync(path.join(root, 'TaskBindingGuide.tsx'), 'utf8'));
  check(!/kill|taskkill|netstat -ano.*\/F/i.test(steps), '引导不包含结束进程的操作');
  check(steps.includes('onStart'), '引导把启动动作交回看板，不自行 invoke 启动命令');
  check(!steps.includes("invoke('start_project_tasks'"), '引导不直接调用启动命令');

  console.log(`verify-task-binding-guide: ${checks} checks passed`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
