import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestCoachCompletion } from '../src/lib/coach.ts';
import { DEFAULT_SETTINGS, parseReview, parseHint, parseObject } from '../src/lib/core.ts';

const settings = {
  ...DEFAULT_SETTINGS,
  apiKey: 'test-only',
  provider: 'custom' as const,
  baseUrl: 'https://coach.example/v1',
};
const messages = [
  { role: 'system', content: 'Review the last user message in Chinese.' },
  { role: 'user', content: 'I go yesterday.' },
];
const review = {
  positive: '表达清楚',
  original: 'I go yesterday.',
  improved: 'I went yesterday.',
  explanation: '过去时',
  tag: '语法',
};
const hint = {
  angle: '描述活动',
  words: [{ en: 'go for a walk', zh: '散步' }],
  example: 'I went for a walk.',
};
const reply = (content: string, finish_reason = 'stop') =>
  Response.json({ choices: [{ finish_reason, message: { content } }] });

test('点评解析忽略完整思考块并保留JSON字符串中的花括号，歧义和非法对象拒绝', () => {
  const expected = { ...review, explanation: '用 {went} 表示过去；引用 "说明"。' };
  const content = [
    '<think>考虑一个示例 {"old":true}</think>',
    '以下是点评：',
    '```json',
    JSON.stringify(expected),
    '```',
    '完成。',
  ].join('\n');
  assert.deepEqual(parseReview(content), expected);
  assert.deepEqual(parseHint(`说明\n${JSON.stringify(hint)}\n结束`), hint);
  assert.throws(
    () => parseObject(`${JSON.stringify(review)}\n${JSON.stringify(review)}`),
    /格式异常/,
  );
  assert.throws(() => parseObject(`<think>未结束\n${JSON.stringify(review)}`), /格式异常/);
  assert.throws(() => parseObject(`\`\`\`json\n${JSON.stringify(review)}`), /格式异常/);
  assert.throws(() => parseObject('[{"positive":"not an object"}]'), /格式异常/);
  assert.throws(() => parseObject('{"positive":"cut off'), /格式异常/);
});

test('格式失败只重试教练一次，复用上下文但不回传坏回复，也不强制未知JSON参数', async (context) => {
  const bodies: Record<string, unknown>[] = [];
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return reply(bodies.length === 1 ? 'bad response with PRIVATE-TRACE' : JSON.stringify(review));
  });
  assert.deepEqual(
    await requestCoachCompletion(settings, messages, { kind: 'review', model: 'review-model' }),
    review,
  );
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].model, 'review-model');
  assert.equal(bodies[0].max_tokens, 1800);
  assert.equal(bodies[1].max_tokens, 2800);
  assert.equal('response_format' in bodies[0], false);
  const retried = bodies[1].messages as typeof messages;
  assert.deepEqual(
    retried.filter((entry) => entry.role === 'user'),
    [messages[1]],
  );
  assert.ok(!JSON.stringify(retried).includes('PRIVATE-TRACE'));
  assert.equal(messages[0].content, 'Review the last user message in Chinese.');
});

test('明确截断即使片段看似合法也重试，MiniMax使用对应token字段，正常提示不重试', async (context) => {
  const bodies: Record<string, unknown>[] = [];
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return reply(JSON.stringify(hint), bodies.length === 1 ? 'length' : 'stop');
  });
  const miniMax = { ...settings, provider: 'minimax' as const, model: 'MiniMax-M3' };
  assert.deepEqual(await requestCoachCompletion(miniMax, messages, { kind: 'hint' }), hint);
  assert.equal(bodies[0].max_completion_tokens, 1200);
  assert.equal(bodies[1].max_completion_tokens, 2000);
  assert.equal(bodies.length, 2);
  await requestCoachCompletion(miniMax, messages, { kind: 'hint' });
  assert.equal(bodies.length, 3);
});

test('连续格式失败结束加载并给可恢复提示，不回显供应商原始内容', async (context) => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return reply('PRIVATE-TRACE malformed');
  });
  await assert.rejects(
    requestCoachCompletion(settings, messages, { kind: 'review' }),
    (error: Error) => {
      assert.match(error.message, /点评未能完整整理/);
      assert.ok(!error.message.includes('PRIVATE-TRACE'));
      return true;
    },
  );
  assert.equal(calls, 2);
});

test('鉴权、限流、网络错误不做格式重试，已取消不发请求', async (context) => {
  let calls = 0;
  for (const status of [401, 429]) {
    context.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response('', { status });
    });
    await assert.rejects(requestCoachCompletion(settings, messages, { kind: 'review' }));
  }
  context.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new TypeError('Network');
  });
  await assert.rejects(requestCoachCompletion(settings, messages, { kind: 'review' }), /无法连接/);
  assert.equal(calls, 3);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    requestCoachCompletion(settings, messages, { kind: 'review', signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 3);
});

test('格式失败后取消阻止自动重试；请求和修复共用总超时', async (context) => {
  const cancelled = new AbortController();
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    calls++;
    cancelled.abort();
    return reply('not JSON');
  });
  await assert.rejects(
    requestCoachCompletion(settings, messages, { kind: 'hint', signal: cancelled.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
  const timeout = new AbortController();
  context.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  context.mock.method(globalThis, 'fetch', async () => {
    calls++;
    timeout.abort(new DOMException('timeout', 'TimeoutError'));
    return reply('cut off');
  });
  await assert.rejects(
    requestCoachCompletion(settings, messages, { kind: 'review' }),
    /辅导整理超时/,
  );
  assert.equal(calls, 2);
});
