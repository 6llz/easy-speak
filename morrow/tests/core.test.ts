import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  consumeStream,
  DEFAULT_SETTINGS,
  demoReview,
  parseHint,
  parseReview,
  requestChatCompletion,
  validateSettings,
  wordsIn,
} from '../src/lib/core.ts';
import { formatTime } from '../src/lib/format.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-only-key' };

test('显式图片读取使用内容块，保留原文字消息与凭据边界，非法图片不联网', async () => {
  let calls = 0;
  const imageDataUrl = 'data:image/png;base64,YWJj';
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.ok(!String(url).includes('test-only-key'));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.messages[0].content, 'Read reference only.');
    assert.deepEqual(body.messages[1].content, [
      { type: 'text', text: 'Describe it.' },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ]);
    assert.equal(body.max_tokens, 1800);
    return Response.json({ choices: [{ message: { content: 'A cup of coffee.' } }] });
  };
  const messages = [
    { role: 'system', content: 'Read reference only.' },
    { role: 'user', content: 'Describe it.' },
  ];
  assert.equal(
    await requestChatCompletion(settings, messages, { imageDataUrl }),
    'A cup of coffee.',
  );
  assert.equal(messages[1].content, 'Describe it.');
  await assert.rejects(
    requestChatCompletion(settings, messages, {
      imageDataUrl: 'https://untrusted.example/image.png',
    }),
    /图片格式/,
  );
  await assert.rejects(
    requestChatCompletion(settings, messages, { imageDataUrl: 'data:image/svg+xml;base64,YWJj' }),
    /图片格式/,
  );
  assert.equal(calls, 1);
});

test('图片理解达到输出上限时提示拆分，不把半截识别当作完整材料', async () => {
  globalThis.fetch = async () =>
    Response.json({
      choices: [{ finish_reason: 'length', message: { content: 'Partial image text' } }],
    });
  await assert.rejects(
    requestChatCompletion(settings, [{ role: 'user', content: 'Read this.' }], {
      imageDataUrl: 'data:image/png;base64,YWJj',
    }),
    /未能完整读取/,
  );
});

test('配置拒绝缺少密钥、空模型和带凭据的接口', () => {
  assert.match(validateSettings(DEFAULT_SETTINGS) || '', /API Key/);
  assert.match(validateSettings({ ...settings, model: ' ' }) || '', /模型名称/);
  assert.match(
    validateSettings({ ...settings, baseUrl: 'https://user:pass@example.com' }) || '',
    /密码/,
  );
  assert.match(
    validateSettings({ ...settings, baseUrl: 'https://example.com?token=secret' }) || '',
    /查询/,
  );
});

test('远端接口强制 HTTPS，本机开发允许 HTTP', () => {
  assert.equal(validateSettings({ ...settings, baseUrl: 'https://example.com/v1' }), null);
  assert.match(validateSettings({ ...settings, baseUrl: 'http://example.com' }) || '', /HTTPS/);
  assert.equal(validateSettings({ ...settings, baseUrl: 'http://localhost:1234/v1' }), null);
  assert.equal(validateSettings({ ...settings, baseUrl: 'http://127.0.0.1:1234/v1' }), null);
  assert.equal(validateSettings({ ...settings, baseUrl: 'http://[::1]:1234/v1' }), null);
});

test('辅导 JSON 支持围栏，拒绝缺失字段和错误词组结构', () => {
  const hint = {
    angle: '从心情说起',
    words: [{ en: 'wind down', zh: '放松' }],
    example: 'I like walking.',
  };
  assert.deepEqual(parseHint(`\`\`\`json\n${JSON.stringify(hint)}\n\`\`\``), hint);
  assert.throws(() => parseHint('{"angle":"hello"}'), /不完整/);
  assert.throws(() => parseHint('{"angle":"x","example":"x","words":[]}'), /不完整/);
  assert.throws(() => parseHint('{"angle":"x","example":"x","words":[null]}'), /不完整/);
  assert.throws(() => parseReview('{}'), /不完整/);
  assert.throws(() => parseReview('null'), /格式/);
});

test('结构化点评允许无需纠错，不强行生成错误', () => {
  const review = {
    positive: '说得清楚',
    original: '',
    improved: '',
    explanation: '继续分享',
    tag: '表达清晰',
  };
  assert.deepEqual(parseReview(JSON.stringify(review)), review);
  assert.equal(demoReview('Today was great.').tag, '示范反馈');
  assert.equal(demoReview('I am agree with you.').improved, 'I agree');
});

test('辅导 JSON 解析错误不回显回复正文，返回对象只保留约定字段', () => {
  assert.throws(
    () => parseHint('{"secret":"test-only-key",broken}'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /格式异常/);
      assert.ok(!error.message.includes('test-only-key'));
      return true;
    },
  );
  const review = {
    positive: '说得清楚',
    original: '',
    improved: '',
    explanation: '继续分享',
    tag: '表达清晰',
  };
  assert.deepEqual(parseReview(JSON.stringify({ ...review, extra: 'provider metadata' })), review);
  assert.throws(() => parseReview(JSON.stringify({ ...review, positive: null })), /不完整/);
});

function sseResponse(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

test('SSE 支持任意 UTF-8 拆包、CRLF、结束标记及缺少末尾换行', async () => {
  const body =
    ': keepalive\r\ndata: {"choices":[{"delta":{"content":"Hello 你"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"好!"}}]}\r\ndata: [DONE]';
  const bytes = new TextEncoder().encode(body);
  const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
  const updates: string[] = [];
  const result = await consumeStream(sseResponse(chunks), (value) => updates.push(value));
  assert.equal(result, 'Hello 你好!');
  assert.deepEqual(updates, ['Hello 你', 'Hello 你好!']);
});

test('空流与供应商流式错误不能伪装成成功回复', async () => {
  const encoder = new TextEncoder();
  await assert.rejects(
    consumeStream(sseResponse([encoder.encode('data: [DONE]\n')]), () => {}),
    /没有返回内容/,
  );
  await assert.rejects(
    consumeStream(
      sseResponse([encoder.encode('data: {"error":{"message":"secret-provider-detail"}}\n')]),
      () => {},
    ),
    /流式回复失败/,
  );
});

test('SSE 遇到 DONE 立即返回并取消仍然开放的响应流，忽略结束后的正文', async () => {
  let wasCancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Complete."}}]}\n\ndata: [DONE]\n\ndata: test-only-key\n',
          ),
        );
      },
      cancel() {
        wasCancelled = true;
        // 供应商的清理可能永远不结束，不能影响已完成回复。
        return new Promise(() => {});
      },
    }),
  );
  assert.equal(await consumeStream(response, () => {}), 'Complete.');
  assert.equal(wasCancelled, true);
  assert.equal(response.body?.locked, false);
});

test('SSE 支持多行 data、独立 CR 分隔以及角色和用量事件', async () => {
  const content =
    'data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\r\r' +
    'event: message\rdata: {"choices":[\rdata: {"delta":{"content":"你好"}}]}\r\r' +
    'data: {"choices":[],"usage":{"completion_tokens":2}}\r\rdata: [DONE]\r';
  const bytes = new TextEncoder().encode(content);
  const updates: string[] = [];
  assert.equal(
    await consumeStream(sseResponse(Array.from(bytes, (byte) => new Uint8Array([byte]))), (text) =>
      updates.push(text),
    ),
    '你好',
  );
  assert.deepEqual(updates, ['你好']);
});

test('SSE 拒绝畸形 UTF-8、无效 JSON 和嵌套字段，且不泄露正文', async () => {
  const encoder = new TextEncoder();
  const invalidEvents: (string | Uint8Array)[] = [
    'data: {"secret":"test-only-key",broken}\n\n',
    'data: {"choices":{"0":{"delta":{"content":"false success"}}}}\n\n',
    'data: {"choices":[null]}\n\n',
    'data: {"choices":[{"delta":{"content":42}}]}\n\n',
    new Uint8Array([0xff]),
  ];
  for (const event of invalidEvents) {
    await assert.rejects(
      consumeStream(
        sseResponse([typeof event === 'string' ? encoder.encode(event) : event]),
        () => {},
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /无效的数据/);
        assert.ok(!error.message.includes('test-only-key'));
        return true;
      },
    );
  }
});

test('SSE 对未结束的行、多行事件和累计回复都限制内存并释放流', async () => {
  const encoder = new TextEncoder();
  const oversizedEvents = [
    `data: ${'x'.repeat(300000)}`,
    Array.from({ length: 300 }, () => `data: ${' '.repeat(1024)}\n`).join(''),
    Array.from(
      { length: 80 },
      () => `data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(1024) } }] })}\n\n`,
    ).join(''),
  ];
  for (const content of oversizedEvents) {
    let wasCancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(content));
        },
        cancel() {
          wasCancelled = true;
        },
      }),
    );
    await assert.rejects(
      consumeStream(response, () => {}),
      /回复过长/,
    );
    assert.equal(wasCancelled, true);
    assert.equal(response.body?.locked, false);
  }
});

test('真实请求使用独立教练模型、正确路径与头部，密钥不进入请求体', async () => {
  let capturedRequest: Request | null = null;
  globalThis.fetch = async (input, init) => {
    capturedRequest = new Request(input, init);
    return Response.json({ choices: [{ message: { content: ' Hello there. ' } }] });
  };
  const result = await requestChatCompletion(
    { ...settings, baseUrl: 'https://example.com/v1/' },
    [{ role: 'user', content: 'Hello' }],
    { model: 'coach-model' },
  );
  assert.equal(result, 'Hello there.');
  assert.ok(capturedRequest);
  const request = capturedRequest as Request;
  assert.equal(request.url, 'https://example.com/v1/chat/completions');
  assert.equal(request.headers.get('Authorization'), 'Bearer test-only-key');
  const body = await request.json();
  assert.equal(body.model, 'coach-model');
  assert.equal(body.thinking.type, 'disabled');
  assert.ok(!JSON.stringify(body).includes(settings.apiKey));
});

test('支持供应商忽略流参数并返回标准 JSON 的兼容路径', async () => {
  const updates: string[] = [];
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: 'A full response.' } }] });
  assert.equal(
    await requestChatCompletion(settings, [{ role: 'user', content: 'Hi' }], {
      onChunk: (text) => updates.push(text),
    }),
    'A full response.',
  );
  assert.deepEqual(updates, ['A full response.']);
});

test('供应商鉴权错误有明确提示，不把任意响应内容回显', async () => {
  globalThis.fetch = async () => new Response('test-only-key', { status: 401 });
  await assert.rejects(
    requestChatCompletion(settings, [{ role: 'user', content: 'Hi' }]),
    /API Key 无效/,
  );
});

test('模型空响应与无效响应必须报错', async () => {
  globalThis.fetch = async () => Response.json({ choices: [] });
  await assert.rejects(requestChatCompletion(settings, []), /没有返回内容/);
  globalThis.fetch = async () => Response.json(null);
  await assert.rejects(requestChatCompletion(settings, []), /无效的数据/);
});

test('HTTP 成功状态的畸形 JSON、伪造 choices 与错误对象不能成为成功回复', async () => {
  const invalidBodies = [
    '',
    '{"secret":"test-only-key",broken}',
    JSON.stringify({ choices: { 0: { message: { content: 'false success' } } } }),
    JSON.stringify({ choices: [null] }),
    JSON.stringify({ choices: [{ message: 'false success' }] }),
    JSON.stringify({ choices: [{ message: { content: 123 } }] }),
    JSON.stringify({ error: { message: 'test-only-key' } }),
  ];
  for (const body of invalidBodies) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(requestChatCompletion(settings, []), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /无效的数据|模型回复失败/);
      assert.ok(!error.message.includes('test-only-key'));
      return true;
    });
  }
});

test('标准 JSON 兼容响应也有正文和内容长度限制', async () => {
  for (const body of [
    JSON.stringify({ choices: [{ message: { content: 'x'.repeat(70000) } }] }),
    JSON.stringify({ padding: 'x'.repeat(300000), choices: [] }),
  ]) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(requestChatCompletion(settings, []), /回复过长/);
  }
});

test('正文读取中断有可恢复的网络提示，不回显底层错误', async () => {
  for (const stream of [false, true]) {
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('test-only-key'));
          },
        }),
        { headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' } },
      );
    await assert.rejects(
      requestChatCompletion(settings, [], stream ? { onChunk: () => {} } : {}),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /读取模型回复失败/);
        assert.ok(!error.message.includes('test-only-key'));
        return true;
      },
    );
  }
});

test('超时覆盖 JSON 和 SSE 正文读取，取消挂起连接并显示超时提示', async (context) => {
  for (const stream of [false, true]) {
    const timeoutController = new AbortController();
    context.mock.method(AbortSignal, 'timeout', () => timeoutController.signal);
    let resolveReading: () => void = () => {};
    const isReading = new Promise<void>((resolve) => {
      resolveReading = resolve;
    });
    let reads = 0;
    let wasCancelled = false;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (reads++ === 0) controller.enqueue(new TextEncoder().encode(' '));
            else resolveReading();
          },
          cancel() {
            wasCancelled = true;
          },
        }),
        { headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' } },
      );
    const completion = requestChatCompletion(settings, [], stream ? { onChunk: () => {} } : {});
    await isReading;
    timeoutController.abort(new DOMException('expired', 'TimeoutError'));
    await assert.rejects(completion, /模型响应超时/);
    assert.equal(wasCancelled, true);
    context.mock.restoreAll();
  }
});

test('取消请求继续传递取消信号，避免成为普通网络错误', async () => {
  const controller = new AbortController();
  globalThis.fetch = async (_input, init) => {
    return new Promise((_resolve, reject) =>
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('cancelled', 'AbortError')),
        { once: true },
      ),
    );
  };
  const promise = requestChatCompletion(settings, [], { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});

test('供应商直接抛出 AbortError 时保持取消语义，已取消请求不再联网', async () => {
  globalThis.fetch = async () => {
    throw new DOMException('cancelled', 'AbortError');
  };
  await assert.rejects(requestChatCompletion(settings, []), { name: 'AbortError' });
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return Response.json({ choices: [] });
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestChatCompletion(settings, [], { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(fetches, 0);
});

test('用户在正文读取期间取消仍保持 AbortError 并释放流', async () => {
  const controller = new AbortController();
  let wasCancelled = false;
  const updates: string[] = [];
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(streamController) {
          streamController.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' +
                'data: {"choices":[{"delta":{"content":"Ignored"}}]}\n\ndata: [DONE]\n\n',
            ),
          );
        },
        cancel() {
          wasCancelled = true;
        },
      }),
      { headers: { 'Content-Type': 'Text/Event-Stream; charset=utf-8' } },
    );
  await assert.rejects(
    requestChatCompletion(settings, [], {
      signal: controller.signal,
      onChunk: (text) => {
        updates.push(text);
        controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(wasCancelled, true);
  assert.deepEqual(updates, ['Hi']);
});

test('词数仅统计用户英语，格式化时间不出现负值', () => {
  assert.equal(
    wordsIn([
      { id: '1', role: 'assistant', content: 'Hello friend' },
      { id: '2', role: 'user', content: "I'm winding down. 我在放松" },
    ]),
    3,
  );
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(-1), '00:00');
});
