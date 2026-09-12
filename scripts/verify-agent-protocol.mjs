/**
 * Behavioural test for the normalized Agent CLI contract (CLI-0).
 *
 * Runs the real TypeScript module through node --experimental-strip-types, so
 * src/core/agentProtocol.ts must stay free of runtime imports. The Rust side of
 * the same contract is covered by src-tauri/src/agent_cli/*.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

/* The app's relative imports are extensionless (Vite/tsc resolve them); node's
   ESM resolver does not, so point bare relative specifiers at their .ts file. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const protocol = await import('../src/core/agentProtocol.ts');

const session = 's1';
const run = 'r1';
const delta = (content, runId = run) => ({ type: 'delta', sessionId: session, runId, content });

// --- delta providers accumulate ----------------------------------------------
let state = protocol.createAgentRunState(session, run);
assert.equal(state.status, 'running');
assert.equal(state.textMode, 'delta', '默认按增量流处理');
state = protocol.reduceAgentEvents(state, [delta('你'), delta('好'), delta('。')]);
assert.equal(state.text, '你好。');

// --- snapshot providers replace ----------------------------------------------
let snapshot = protocol.createAgentRunState(session, run, 'snapshot');
snapshot = protocol.reduceAgentEvents(snapshot, [delta('你'), delta('你好'), delta('你好。')]);
assert.equal(snapshot.text, '你好。', '快照模式下每帧都是全文，不能拼接');

// --- another run must never bleed in -----------------------------------------
const stale = protocol.applyAgentEvent(state, delta('旧回合', 'r0'));
assert.equal(stale, state, '其他 runId 的事件必须原样返回同一个引用');
assert.equal(protocol.acceptsAgentEvent(state, delta('x', 'r0')), false);
assert.equal(
  protocol.applyAgentEvent(state, { type: 'delta', sessionId: 's9', runId: run, content: 'x' }),
  state,
  '其他会话的事件同样不接受',
);
assert.equal(protocol.applyAgentEvent(state, delta('')), state, '空增量不产生新状态');

// --- terminal events ----------------------------------------------------------
const completed = protocol.applyAgentEvent(state, { type: 'completed', sessionId: session, runId: run });
assert.equal(completed.status, 'completed');
assert.equal(completed.text, state.text, '回合结束不清空已有文本');
const stopped = protocol.applyAgentEvent(state, { type: 'stopped', sessionId: session, runId: run });
assert.equal(stopped.status, 'stopped');
assert.deepEqual(protocol.terminalAgentEventTypes, ['completed', 'stopped', 'failed']);
assert.equal(protocol.isTerminalAgentEvent({ type: 'delta', sessionId: session, runId: run, content: 'x' }), false);
assert.equal(protocol.isTerminalAgentEvent({ type: 'failed', sessionId: session, runId: run, error: {} }), true);

// --- one error carries the whole cause ---------------------------------------
const error = { kind: 'exited', message: 'Agent CLI 退出，退出码 9', detail: 'boom', exitCode: 9 };
const failed = protocol.applyAgentEvent(state, { type: 'failed', sessionId: session, runId: run, error });
assert.equal(failed.status, 'failed');
assert.deepEqual(failed.error, error, '错误整体透传，不拆成多个事件');

// --- tool payloads keep their order ------------------------------------------
const withTools = protocol.reduceAgentEvents(state, [
  { type: 'tool', sessionId: session, runId: run, payload: { name: 'read' } },
  { type: 'tool', sessionId: session, runId: run, payload: { name: 'write' } },
]);
assert.deepEqual(withTools.toolPayloads.map((payload) => payload.name), ['read', 'write']);

// --- restart is not a resumed turn -------------------------------------------
const started = protocol.applyAgentEvent(
  protocol.reduceAgentEvents(protocol.createAgentRunState(session, run), [delta('半句')]),
  { type: 'started', sessionId: session, runId: run },
);
assert.equal(started.text, '', 'started 表示这一回合从头开始，必须清掉残留文本');

// --- the gate replays only the run that opened --------------------------------
let gate = protocol.createAgentRunGate();
gate = protocol.bufferAgentEvent(gate, delta('早到 a', 'r2'));
gate = protocol.bufferAgentEvent(gate, delta('旧回合', 'r1'));
gate = protocol.bufferAgentEvent(gate, delta('早到 b', 'r2'));
const opened = protocol.openAgentRunGate(gate, 'r2');
assert.deepEqual(opened.replay.map((event) => event.content), ['早到 a', '早到 b']);
assert.equal(opened.gate.runId, 'r2');
assert.deepEqual(opened.gate.buffered, [], '重放后缓冲区清空');

// Once the run id is known there is nothing left to buffer.
const afterOpen = protocol.bufferAgentEvent(opened.gate, delta('直达', 'r2'));
assert.equal(afterOpen, opened.gate);

// A gate that never saw its run replays nothing rather than replaying everything.
const mismatched = protocol.openAgentRunGate(protocol.bufferAgentEvent(protocol.createAgentRunGate(), delta('x', 'r1')), 'r3');
assert.deepEqual(mismatched.replay, []);

// --- one shape for every rejection --------------------------------------------
assert.deepEqual(protocol.toAgentError(error), error, '运行时自己的错误原样透传');
assert.deepEqual(protocol.toAgentError(new Error('炸了')), { kind: 'internal', message: '炸了' });
assert.deepEqual(protocol.toAgentError('字符串错误'), { kind: 'internal', message: '字符串错误' });
assert.deepEqual(protocol.toAgentError({ message: '没有 kind' }), { kind: 'internal', message: '没有 kind' });
assert.deepEqual(protocol.toAgentError({ kind: 7, message: 'kind 不是字符串' }), { kind: 'internal', message: 'kind 不是字符串' });
assert.deepEqual(protocol.toAgentError(undefined), { kind: 'internal', message: 'undefined' });

// --- AGT-4: resource references are explicit and deduplicated ---------------
const resourcePrompt = protocol.formatAgentResourceContext('总结一下', [
  { id: 'resource-1', title: '论文.pdf', uri: 'file:///D:/论文.pdf' },
  { id: 'resource-1', title: '重复记录', uri: 'file:///D:/重复.pdf' },
  { id: 'resource-2', title: '笔记.md', uri: 'file:///D:/笔记.md' },
]);
assert.match(resourcePrompt, /\[Attached resources\]/);
assert.match(resourcePrompt, /@resource\(resource-1\) 论文\.pdf/);
assert.match(resourcePrompt, /@resource\(resource-2\) 笔记\.md/);
assert.equal((resourcePrompt.match(/@resource\(resource-1\)/g) ?? []).length, 1);
assert.equal(protocol.formatAgentResourceContext('原文', []), '原文');

// --- the transcript pairs a prompt with the run the runtime opened for it ------
let transcript = protocol.createAgentTranscript(session);
assert.deepEqual(transcript.turns, []);
assert.equal(protocol.isAgentTranscriptBusy(transcript), false);

transcript = protocol.appendAgentPrompt(transcript, '你好');
assert.equal(transcript.turns.length, 1);
assert.equal(transcript.turns[0].run, undefined, 'started 到达前这一回合还没有 run');
assert.equal(protocol.isAgentTranscriptBusy(transcript), true, '排队中的消息也算忙');

// Events for another session are ignored, by reference.
assert.equal(
  protocol.applyAgentEventToTranscript(transcript, { type: 'started', sessionId: 's9', runId: run }),
  transcript,
  '其他会话的事件必须原样返回同一个引用',
);
// So is anything but `started` for a run this transcript has never seen.
assert.equal(protocol.applyAgentEventToTranscript(transcript, delta('野帧')), transcript);

transcript = protocol.applyAgentEventToTranscript(transcript, { type: 'started', sessionId: session, runId: run });
assert.equal(transcript.turns.length, 1, 'started 认领最早那个还没有 run 的回合，而不是新开一轮');
assert.equal(transcript.turns[0].run.runId, run);
assert.equal(transcript.turns[0].prompt, '你好');

transcript = protocol.applyAgentEventToTranscript(transcript, delta('你'));
transcript = protocol.applyAgentEventToTranscript(transcript, delta('好'));
assert.equal(transcript.turns[0].run.text, '你好');

const unchanged = protocol.applyAgentEventToTranscript(transcript, delta(''));
assert.equal(unchanged, transcript, '空增量不产生新的 transcript，隐藏的标签页可以跳过渲染');

transcript = protocol.applyAgentEventToTranscript(transcript, { type: 'completed', sessionId: session, runId: run });
assert.equal(transcript.turns[0].run.status, 'completed');
assert.equal(protocol.isAgentTranscriptBusy(transcript), false, '回合结束后会话回到空闲');

// A run nobody asked for — a resumed conversation, or a second window — still lands.
transcript = protocol.applyAgentEventToTranscript(transcript, { type: 'started', sessionId: session, runId: 'r2' });
assert.equal(transcript.turns.length, 2);
assert.equal(transcript.turns[1].prompt, '');
assert.equal(transcript.turns[1].run.runId, 'r2');

// The transcript's textMode is what a new run inherits, so snapshot providers do
// not accumulate.
let snapshotTranscript = protocol.appendAgentPrompt(protocol.createAgentTranscript(session, 'snapshot'), '嗨');
snapshotTranscript = protocol.applyAgentEventToTranscript(snapshotTranscript, { type: 'started', sessionId: session, runId: run });
snapshotTranscript = protocol.applyAgentEventToTranscript(snapshotTranscript, delta('你'));
snapshotTranscript = protocol.applyAgentEventToTranscript(snapshotTranscript, delta('你好'));
assert.equal(snapshotTranscript.turns[0].run.text, '你好', '快照模式的回合不能把每帧拼起来');

// --- CLI-4: 历史行与 transcript 的互相映射 --------------------------------------
const history = await import('../src/core/agentHistory.ts');
const now = '2026-08-11T00:00:00.000Z';

// 只有开过 run 的回合才是历史：排队中的消息 CLI 还没看见，写进去等于伪造，
// 而且它拿到 run 之后会把后面每一条的 seq 全部挤位。
let live = protocol.createAgentTranscript(session);
live = protocol.appendAgentPrompt(live, '第一条');
live = protocol.applyAgentEventToTranscript(live, { type: 'started', sessionId: session, runId: 's1-1' });
live = protocol.applyAgentEventToTranscript(live, delta('答一', 's1-1'));
live = protocol.applyAgentEventToTranscript(live, {
  type: 'tool',
  sessionId: session,
  runId: 's1-1',
  payload: { kind: 'command', detail: 'cargo test' },
});
live = protocol.applyAgentEventToTranscript(live, { type: 'completed', sessionId: session, runId: 's1-1' });
live = protocol.appendAgentPrompt(live, '第二条');
live = protocol.applyAgentEventToTranscript(live, { type: 'started', sessionId: session, runId: 's1-2' });
live = protocol.applyAgentEventToTranscript(live, { type: 'stopped', sessionId: session, runId: 's1-2' });
live = protocol.appendAgentPrompt(live, '还在排队');

const rows = history.agentTranscriptToRecords(live, now);
assert.deepEqual(rows.map((row) => row.seq), [0, 1], '排队中的回合不落库，seq 必须连续');
assert.deepEqual(rows.map((row) => row.prompt), ['第一条', '第二条']);
assert.deepEqual(rows.map((row) => row.runId), ['s1-1', 's1-2']);
assert.equal(rows[0].answer, '答一');
assert.deepEqual(rows[0].toolPayloads, [{ kind: 'command', detail: 'cargo test' }]);
assert.equal(rows[1].status, 'stopped');
assert.equal('error' in rows[0], false, '没有错误就不写 error 字段');
assert.equal(rows[0].createdAt, now);

// 回填：按 seq 排，不按给过来的顺序排。
const restored = history.restoreAgentTranscript(protocol.createAgentTranscript(session), [rows[1], rows[0]]);
assert.deepEqual(restored.turns.map((turn) => turn.prompt), ['第一条', '第二条']);
assert.equal(restored.turns[0].run.text, '答一');
assert.equal(protocol.isAgentTranscriptBusy(restored), false, '回填出来的回合都已结束，输入框不能被卡住');
assert.equal(
  history.restoreAgentTranscript(restored, []),
  restored,
  '没有历史时必须返回同一个引用，避免多一次渲染',
);
assert.equal(
  history.restoreAgentTranscript(restored, [{ ...rows[0], sessionId: 's9' }]),
  restored,
  '别人的历史不进这个会话',
);

// 回填的 run id 必须带标记：supervisor 的计数器随进程重来，
// 新一轮完全可能拿到与历史同名的 runId。
assert.equal(restored.turns[0].run.runId, 's1-1#restored0');
assert.equal(history.isRestoredAgentRun(restored.turns[0].run.runId), true);
assert.equal(history.storedAgentRunId(restored.turns[0].run.runId), 's1-1', '存回数据库的是真实 runId');
assert.equal(history.restoredAgentRunId('s1-1#restored0', 0), 's1-1#restored0', '标记必须幂等');
assert.equal(history.isRestoredAgentRun('s1-1'), false);

// 同名的新一轮落在新回合上，不能把新答案流进历史里。
const afterRestart = protocol.applyAgentEventToTranscript(restored, { type: 'started', sessionId: session, runId: 's1-1' });
assert.equal(afterRestart.turns.length, 3, '重启后的新一轮必须自己开一个回合');
assert.equal(afterRestart.turns[2].run.runId, 's1-1');
assert.equal(afterRestart.turns[0].run.text, '答一', '历史回合的文本不能被新一轮改写');

// 一圈下来 seq 与 runId 都不变，所以重启多少次都不会重排历史。
assert.deepEqual(history.agentTranscriptToRecords(restored, now), rows, '回填再写回必须是同一批行');

// 被应用退出打断的一轮：状态修成已停止，否则 isAgentTranscriptBusy 永远为真，
// 输入框会一直卡在“停止这一轮”后面，而那一轮已经没有进程可停。
const interrupted = { ...rows[0], status: 'running', answer: '半句' };
const healed = history.restoreAgentTranscript(protocol.createAgentTranscript(session), [interrupted]);
assert.equal(healed.turns[0].run.status, 'stopped');
assert.equal(healed.turns[0].run.text, '半句', '半截答案照原样留着，不假装它完整');
assert.equal(protocol.isAgentTranscriptBusy(healed), false);
assert.equal(
  history.restoreAgentTranscript(protocol.createAgentTranscript(session), [{ ...rows[0], status: '天知道' }]).turns[0].run.status,
  'stopped',
  '认不出来的状态也只当停止，不猜成功或失败',
);

// 坏掉的列退回缺省值，而不是让整段历史打不开。
const broken = history.restoreAgentTranscript(protocol.createAgentTranscript(session), [
  { ...rows[0], status: 'failed', error: '不是对象', toolPayloads: undefined },
]);
assert.equal(broken.turns[0].run.error, undefined, '认不出的错误宁可不显示，也不编一个');
assert.deepEqual(broken.turns[0].run.toolPayloads, []);
assert.deepEqual(
  history.restoreAgentTranscript(protocol.createAgentTranscript(session), [
    { ...rows[0], status: 'failed', error },
  ]).turns[0].run.error,
  error,
  '真正的错误原样回填',
);

// 历史排在已有回合上面：加载期间发出去的消息保住自己的位置，也就保住了 seq。
const merged = history.restoreAgentTranscript(protocol.appendAgentPrompt(protocol.createAgentTranscript(session), '加载时发的'), rows);
assert.deepEqual(merged.turns.map((turn) => turn.prompt), ['第一条', '第二条', '加载时发的']);
assert.equal(merged.turns[2].run, undefined);
assert.deepEqual(history.agentTranscriptToRecords(merged, now).map((row) => row.seq), [0, 1]);

// --- CLI-4: 只写变了的行 --------------------------------------------------------
const digests = history.agentMessageDigests(rows);
assert.deepEqual(history.pendingAgentMessageWrites(rows, digests), [], '内容没变就一行都不写');
assert.deepEqual(
  history.pendingAgentMessageWrites(
    rows.map((row) => ({ ...row, createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z' })),
    digests,
  ),
  [],
  '摘要不含时间戳：光是时间变了不该重写',
);
assert.equal(
  history.agentMessageDigest(rows[0]),
  history.agentMessageDigest({ ...rows[0], runId: 's1-1#restored0' }),
  '带标记的 runId 与真实 runId 摘要相同，所以打开会话不会重写整段历史',
);
const growing = history.pendingAgentMessageWrites([{ ...rows[0], answer: '答一二' }, rows[1]], digests);
assert.deepEqual(growing.map((row) => [row.seq, row.answer]), [[0, '答一二']], '流式回答只重写自己那一行');
assert.deepEqual(
  history.pendingAgentMessageWrites([...rows, { ...rows[0], seq: 2, prompt: '新的一轮' }], digests).map((row) => row.seq),
  [2],
  '新回合是新增的一行',
);
// 被打断的那一行会被修好后写回一次：数据库里不留一个永远“运行中”的回合。
assert.deepEqual(
  history
    .pendingAgentMessageWrites(
      history.agentTranscriptToRecords(healed, now),
      history.agentMessageDigests([interrupted]),
    )
    .map((row) => row.status),
  ['stopped'],
);

console.log('verify-agent-protocol: ok');
