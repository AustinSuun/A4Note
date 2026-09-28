/**
 * Doc2X CLI adapter verification (doc2x-translate-0).
 *
 * Runs the adapter against a fake CLI runner: request building, validation,
 * exit-code mapping and receipt parsing must all be decided without a real
 * Doc2X account. Run with:
 *   node --experimental-strip-types --test scripts/verify-doc2x-cli.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDoc2xTask } from '../src/platform/doc2x/doc2xOutcome.ts';
import {
  buildDoc2xAccountStatusRequest,
  buildDoc2xLoginRequest,
  buildDoc2xLogoutRequest,
  buildDoc2xModelsListRequest,
  buildDoc2xParseRequest,
  buildDoc2xRecordsListRequest,
  buildDoc2xTranslateRequest,
  buildDoc2xUsageRequest,
  defaultDoc2xTranslateSettings,
  describeDoc2xFailure,
  doc2xExitCodes,
  parseDoc2xJsonPayload,
  parseDoc2xReceiptText,
  parseDoc2xVersion,
  parseNodeMajor,
  validateDoc2xInput,
  validateDoc2xTranslateSettings,
} from '../src/platform/doc2x/doc2xCli.ts';

const file = { path: 'D:/library/papers/paper.pdf', bytes: 4_200_000 };
const run = { out: 'D:/library/translations/run-1', receiptPath: 'D:/library/translations/run-1/receipt.json' };
const cwd = 'D:/WorkSpace/Aster';

test('fixed-layout translation keeps layout flags and exports a PDF', () => {
  const request = buildDoc2xTranslateRequest(
    file,
    { ...defaultDoc2xTranslateSettings, translateType: 'pdf', targetLanguage: 'zh', pdfFontStrategy: 'page-optimal' },
    run,
    cwd,
  );
  assert.equal(request.command, 'doc2x');
  assert.deepEqual(request.args, [
    'translate',
    file.path,
    '--translate-type',
    'pdf',
    '--target-language',
    'zh',
    '--target-model',
    '10001',
    '--pdf-font-strategy',
    'page-optimal',
    '--to',
    'pdf',
    '--out',
    run.out,
    '--receipt',
    run.receiptPath,
    '--json',
    '--auth-mode',
    'oauth',
  ]);
  // Fixed-layout translation must not pass --convert-trans to the export.
  assert.equal(request.args.includes('--convert-trans'), false);
});

test('reflowed translation uses convert-trans and optional toggles', () => {
  const request = buildDoc2xTranslateRequest(
    file,
    {
      ...defaultDoc2xTranslateSettings,
      translateType: 'md',
      targetLanguage: 'ja',
      targetModel: '10002',
      termId: 'glossary-7',
      convertTrans: 'translate',
      contextualTranslation: true,
      ignoreTranslateTypes: ['table', 'reference'],
      exportFormat: 'docx',
      docxTemplate: 'academic',
    },
    run,
    cwd,
  );
  assert.equal(request.args.includes('--convert-trans'), true);
  assert.equal(request.args[request.args.indexOf('--convert-trans') + 1], 'translate');
  assert.equal(request.args[request.args.indexOf('--term-id') + 1], 'glossary-7');
  assert.equal(request.args[request.args.indexOf('--target-model') + 1], '10002');
  assert.equal(request.args[request.args.indexOf('--to') + 1], 'docx');
  assert.equal(request.args[request.args.indexOf('--docx-template') + 1], 'academic');
  assert.equal(request.args.includes('--contextual-translation'), true);
  const ignoreIndex = request.args.indexOf('--ignore-translate-types');
  const exportIndex = request.args.indexOf('--to', ignoreIndex);
  assert.deepEqual(request.args.slice(ignoreIndex + 1, exportIndex), ['table', 'reference']);
  assert.equal(request.args.includes('--pdf-font-strategy'), false);
});

test('every request pins the CLI OAuth account the user logged into', () => {
  const requests = [
    buildDoc2xTranslateRequest(file, defaultDoc2xTranslateSettings, run, cwd),
    buildDoc2xParseRequest(file, { exportFormat: 'md', out: run.out, receiptPath: run.receiptPath }, cwd),
    buildDoc2xAccountStatusRequest(cwd),
    buildDoc2xModelsListRequest(cwd),
    buildDoc2xRecordsListRequest(cwd, { kind: 'translate', limit: 5 }),
    buildDoc2xUsageRequest(cwd, 'ot_example'),
  ];
  for (const request of requests) {
    assert.equal(request.args[request.args.length - 2], '--auth-mode');
    assert.equal(request.args[request.args.length - 1], 'oauth');
  }
  // Login/logout are account operations, not task runs: no auth-mode flag.
  assert.deepEqual(buildDoc2xLoginRequest(cwd).args, ['login']);
  assert.deepEqual(buildDoc2xLoginRequest(cwd, { noBrowser: true }).args, ['login', '--no-browser']);
  assert.deepEqual(buildDoc2xLogoutRequest(cwd).args, ['logout']);
  assert.equal(buildDoc2xRecordsListRequest(cwd).args[5], '20');
  assert.equal(buildDoc2xRecordsListRequest(cwd).args[1], 'list');
  assert.equal(buildDoc2xUsageRequest(cwd, 'ot_example').args[2], 'ot_example');
});

test('settings validation rejects combinations the CLI cannot honour', () => {
  assert.deepEqual(validateDoc2xTranslateSettings(defaultDoc2xTranslateSettings), []);
  assert.ok(
    validateDoc2xTranslateSettings({ ...defaultDoc2xTranslateSettings, translateType: 'pdf', exportFormat: 'docx' })
      .length > 0,
  );
  assert.ok(
    validateDoc2xTranslateSettings({ ...defaultDoc2xTranslateSettings, translateType: 'pdf', convertTrans: 'origin' })
      .length > 0,
  );
  assert.deepEqual(
    validateDoc2xTranslateSettings({
      ...defaultDoc2xTranslateSettings,
      translateType: 'md',
      exportFormat: 'docx',
    }),
    [],
  );
  assert.ok(
    validateDoc2xTranslateSettings({ ...defaultDoc2xTranslateSettings, targetLanguage: 'klingon' }).length > 0,
  );
  assert.ok(
    validateDoc2xTranslateSettings({
      ...defaultDoc2xTranslateSettings,
      ignoreTranslateTypes: ['video'],
    }).length > 0,
  );
});

test('input validation encodes CLI size and format limits', () => {
  assert.deepEqual(validateDoc2xInput(file), []);
  assert.ok(validateDoc2xInput({ path: 'big.pdf', bytes: 301 * 1024 * 1024 }).length > 0);
  assert.ok(validateDoc2xInput({ path: 'photo.png', bytes: 4 * 1024 * 1024 }).length > 0);
  assert.deepEqual(validateDoc2xInput({ path: 'photo.png', bytes: 1024 }), []);
  assert.ok(validateDoc2xInput({ path: 'paper.docx', bytes: 1024 }).length > 0);
  assert.ok(validateDoc2xInput({ path: 'empty.pdf', bytes: 0 }).length > 0);
});

test('exit codes map to Chinese explanations and never fake success', () => {
  assert.equal(describeDoc2xFailure(0), null);
  assert.equal(describeDoc2xFailure(doc2xExitCodes.auth).kind, 'auth');
  assert.equal(describeDoc2xFailure(doc2xExitCodes.auth).retryable, false);
  assert.equal(describeDoc2xFailure(doc2xExitCodes.task).retryable, true);
  assert.equal(describeDoc2xFailure(doc2xExitCodes.export).retryable, true);
  assert.equal(describeDoc2xFailure(doc2xExitCodes.batchPartial).kind, 'batch-partial');
  assert.equal(describeDoc2xFailure(doc2xExitCodes.argument).retryable, false);
  assert.equal(describeDoc2xFailure(-1).kind, 'unknown');
  assert.match(describeDoc2xFailure(2).message, /登录|额度|订阅/);
});

test('receipt parsing reads the task id and output files from CLI JSON', () => {
  const receipt = parseDoc2xReceiptText(
    '[1/1] Processing: paper.pdf\n{"translateId":"ot_9f21","status":"success","outputFiles":["D:/out/paper.pdf"],"usage":{"pages":10}}\n',
  );
  assert.equal(receipt.translateId, 'ot_9f21');
  assert.equal(receipt.status, 'success');
  assert.deepEqual(receipt.outputFiles, ['D:/out/paper.pdf']);
  const snakeCase = parseDoc2xReceiptText('{"task_id":"ot_abc","output_files":["a.md","b.md"]}');
  assert.equal(snakeCase.translateId, 'ot_abc');
  assert.deepEqual(snakeCase.outputFiles, ['a.md', 'b.md']);
  assert.equal(parseDoc2xReceiptText('not json at all'), null);
  assert.equal(parseDoc2xReceiptText(''), null);
  const nested = parseDoc2xJsonPayload('{"receipt":{"id":"ot_nested"}}');
  assert.equal(nested.receipt.id, 'ot_nested');
  assert.equal(parseDoc2xReceiptText('{"receipt":{"id":"ot_nested","outputFiles":["x.pdf"]}}').translateId, 'ot_nested');
  // A login page or HTML error body must not be mistaken for a receipt.
  assert.equal(parseDoc2xJsonPayload('<!DOCTYPE html><html><body>Sign in</body></html>'), null);
});

test('version probes read CLI and Node versions', () => {
  assert.equal(parseDoc2xVersion('@noedgeai-org/doc2x-cli 0.2.0\n'), '0.2.0');
  assert.equal(parseDoc2xVersion('unknown build'), '');
  assert.equal(parseNodeMajor('v22.14.0'), 22);
  assert.equal(parseNodeMajor('20.11.1'), 20);
  assert.equal(parseNodeMajor(''), null);
});

test('fake CLI run: success produces a receipt, failure never does', async () => {
  const fakeRun = async request => {
    if (request.args.includes('--auth-mode') === false && request.args[0] !== 'login') {
      return { status: 1, stdout: '', stderr: 'missing auth' };
    }
    if (request.args.includes('ot_denied')) {
      return { status: doc2xExitCodes.auth, stdout: '', stderr: 'quota exceeded' };
    }
    return {
      status: 0,
      stdout: '{"translateId":"ot_ok","status":"success","outputFiles":["D:/out/paper.pdf"]}',
      stderr: '',
    };
  };

  const okRequest = buildDoc2xTranslateRequest(file, defaultDoc2xTranslateSettings, run, cwd);
  const okResult = await fakeRun(okRequest);
  assert.equal(describeDoc2xFailure(okResult.status), null);
  const receipt = parseDoc2xReceiptText(okResult.stdout);
  assert.equal(receipt.translateId, 'ot_ok');
  assert.deepEqual(receipt.outputFiles, ['D:/out/paper.pdf']);

  const deniedRequest = buildDoc2xTranslateRequest(
    file,
    { ...defaultDoc2xTranslateSettings, targetModel: 'ot_denied' },
    run,
    cwd,
  );
  const deniedResult = await fakeRun(deniedRequest);
  const failure = describeDoc2xFailure(deniedResult.status);
  assert.equal(failure.kind, 'auth');
  assert.equal(parseDoc2xReceiptText(deniedResult.stdout), null);
});

test('outcome mapping: a successful run keeps its receipt', async () => {
  const outcome = await runDoc2xTask(
    buildDoc2xTranslateRequest(file, defaultDoc2xTranslateSettings, run, cwd),
    async () => ({ status: 0, stdout: '{"translateId":"ot_1","outputFiles":["a.pdf"]}', stderr: '' }),
  );
  assert.equal(outcome.kind, 'success');
  assert.equal(outcome.receipt.translateId, 'ot_1');
  assert.deepEqual(outcome.receipt.outputFiles, ['a.pdf']);
});

test('outcome mapping: a non-zero exit never reports success', async () => {
  for (const status of [1, 2, 3, 4, 5, 6, 9]) {
    const outcome = await runDoc2xTask(buildDoc2xAccountStatusRequest(cwd), async () => ({
      status,
      stdout: '',
      stderr: 'boom',
    }));
    assert.equal(outcome.kind, 'failed');
    assert.equal(outcome.failure.kind, describeDoc2xFailure(status).kind);
    assert.ok(outcome.failure.message.length > 0);
  }
});

test('outcome mapping: a timeout is reported as a timeout, not a failure', async () => {
  const outcome = await runDoc2xTask(buildDoc2xAccountStatusRequest(cwd), async () => ({
    status: -1,
    stdout: '',
    stderr: '',
    timedOut: true,
  }));
  assert.equal(outcome.kind, 'timeout');
});

test('outcome mapping: a spawn failure surfaces the runner message', async () => {
  const outcome = await runDoc2xTask(buildDoc2xAccountStatusRequest(cwd), async () => {
    throw new Error('无法启动 doc2x 命令：program not found');
  });
  assert.equal(outcome.kind, 'error');
  assert.match(outcome.message, /无法启动 doc2x 命令/);
});

test('outcome mapping: success without JSON keeps the receipt null', async () => {
  const outcome = await runDoc2xTask(buildDoc2xAccountStatusRequest(cwd), async () => ({
    status: 0,
    stdout: 'Signed in as user@example.com',
    stderr: '',
  }));
  assert.equal(outcome.kind, 'success');
  assert.equal(outcome.receipt, null);
});

test('outcome mapping: the runner only ever receives oauth-pinned task requests', async () => {
  const seen = [];
  const runner = async (request) => {
    seen.push(request);
    return { status: 0, stdout: '{}', stderr: '' };
  };
  await runDoc2xTask(buildDoc2xTranslateRequest(file, defaultDoc2xTranslateSettings, run, cwd), runner);
  await runDoc2xTask(
    buildDoc2xParseRequest(file, { exportFormat: 'md', out: run.out, receiptPath: run.receiptPath }, cwd),
    runner,
  );
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.equal(request.command, 'doc2x');
    assert.equal(request.args.includes('--auth-mode'), true);
    assert.equal(request.args[request.args.indexOf('--auth-mode') + 1], 'oauth');
    assert.equal(request.cwd, cwd);
  }
});
