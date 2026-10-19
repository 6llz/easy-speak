import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMiniMaxMiddleware } from '../server/minimaxProxy.ts';

function request(path: string, overrides: Record<string, unknown> = {}) {
  return Object.assign(Readable.from([Buffer.from('{"messages":[]}')]), {
    url: `/api/v1/minimax${path}`,
    method: 'POST',
    headers: { host: '127.0.0.1:5173', 'content-type': 'application/json', 'x-morrow-client': '1' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  }) as unknown as IncomingMessage;
}
class FakeResponse extends EventEmitter {
  status = 0;
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  chunks: Uint8Array[] = [];
  body = '';
  writeHead(status: number) {
    this.status = status;
    this.headersSent = true;
  }
  write(chunk: Uint8Array) {
    this.chunks.push(chunk);
    return true;
  }
  end(body = '') {
    this.body = body;
    this.writableEnded = true;
  }
  destroy() {
    this.destroyed = true;
    this.writableEnded = true;
  }
}
test('图片聊天请求允许有界的大于128KB正文，超4MB拒绝且不放宽朗读限制', async () => {
  let calls = 0;
  const handler = createMiniMaxMiddleware({
    getApiKey: () => 'test',
    fetch: async () => {
      calls++;
      return Response.json({ ok: true });
    },
  });
  for (const [route, length, expected] of [
    ['/chat/completions', 200 * 1024, 200],
    ['/chat/completions', 4 * 1024 * 1024 + 1, 413],
    ['/t2a_v2', 200 * 1024, 413],
  ] as const) {
    const source = request(route);
    const input = Object.assign(Readable.from([Buffer.alloc(length)]), {
      url: source.url,
      method: source.method,
      headers: source.headers,
      socket: source.socket,
    }) as unknown as IncomingMessage;
    const result = new FakeResponse();
    await handler(input, result as unknown as ServerResponse, () => {});
    assert.equal(result.status, expected);
  }
  assert.equal(calls, 1);
});
test('本机代理只允许固定路由、回环连接、同源请求和客户端标记', async () => {
  let calls = 0;
  const handler = createMiniMaxMiddleware({
    getApiKey: () => 'server-only-test-key',
    fetch: async () => {
      calls++;
      return Response.json({ ok: true });
    },
  });
  for (const input of [
    request('/chat/completions', { socket: { remoteAddress: '10.0.0.1' } }),
    request('/chat/completions', { headers: { host: 'evil.example', 'x-morrow-client': '1' } }),
    request('/chat/completions', {
      headers: { host: '127.0.0.1:5173', origin: 'https://evil.example' },
    }),
    request('/chat/completions', { headers: { host: '127.0.0.1:5173' } }),
    request('/../files'),
    request('/chat/completions?target=evil'),
  ]) {
    const response = new FakeResponse();
    await handler(input, response as unknown as ServerResponse, () => {});
    assert.ok(response.status >= 400);
    assert.ok(!response.body.includes('server-only-test-key'));
  }
  assert.equal(calls, 0);
});
test('服务状态只返回是否配置，转发凭据取自服务端并保留流式正文', async () => {
  const handler = createMiniMaxMiddleware({
    getApiKey: () => 'server-only-test-key',
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.minimaxi.com/v1/chat/completions');
      assert.equal(
        new Headers(options?.headers).get('authorization'),
        'Bearer server-only-test-key',
      );
      assert.equal(options?.redirect, 'error');
      return new Response('data: complete\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  const status = new FakeResponse();
  await handler(
    request('/status', { method: 'GET' }),
    status as unknown as ServerResponse,
    () => {},
  );
  assert.deepEqual(JSON.parse(status.body), { configured: true });
  const response = new FakeResponse();
  await handler(request('/chat/completions'), response as unknown as ServerResponse, () => {});
  assert.equal(response.status, 200);
  assert.equal(Buffer.concat(response.chunks).toString(), 'data: complete\n\n');
});
test('语音代理保留所选识别语言，空值不强制英语，非法语言在本机拒绝', async () => {
  const forwarded: (string | null)[] = [];
  const handler = createMiniMaxMiddleware({
    getApiKey: () => 'test',
    fetch: async (_url, options) => {
      forwarded.push(new Headers(options?.headers).get('language'));
      return Response.json({ text: 'ok' });
    },
  });
  for (const language of ['ja', '', 'invalid-language']) {
    const response = new FakeResponse();
    await handler(
      request('/speech_to_text', {
        headers: {
          host: '127.0.0.1:5173',
          'content-type': 'multipart/form-data; boundary=test',
          'x-morrow-client': '1',
          language,
        },
      }),
      response as unknown as ServerResponse,
      () => {},
    );
    assert.equal(response.status, language === 'invalid-language' ? 400 : 200);
  }
  assert.deepEqual(forwarded, ['ja', null]);
});

test('供应商错误正文不透传，未配置密钥时不发远端请求', async () => {
  const response = new FakeResponse();
  await createMiniMaxMiddleware({
    getApiKey: () => 'test',
    fetch: async () => new Response('secret', { status: 401 }),
  })(request('/chat/completions'), response as unknown as ServerResponse, () => {});
  assert.equal(response.status, 401);
  assert.ok(!response.body.includes('secret'));
  const missing = new FakeResponse();
  await createMiniMaxMiddleware({ getApiKey: () => '' })(
    request('/chat/completions'),
    missing as unknown as ServerResponse,
    () => {},
  );
  assert.equal(missing.status, 503);
});

test('慢速上传超时会释放请求体且不调用上游，槽位可以再次使用', async () => {
  let calls = 0;
  const handler = createMiniMaxMiddleware({
    getApiKey: () => 'test',
    requestTimeoutMs: 15,
    fetch: async () => {
      calls++;
      return Response.json({ ok: true });
    },
  });
  const source = request('/chat/completions');
  const slow = Object.assign(new Readable({ read() {} }), {
    url: source.url,
    method: source.method,
    headers: source.headers,
    socket: source.socket,
    complete: false,
  }) as unknown as IncomingMessage;
  const response = new FakeResponse();
  await handler(slow, response as unknown as ServerResponse, () => {});
  assert.equal(slow.destroyed, true);
  assert.equal(calls, 0);
  assert.equal(response.status, 504);
  const recovered = new FakeResponse();
  await handler(request('/chat/completions'), recovered as unknown as ServerResponse, () => {});
  assert.equal(recovered.status, 200);
});

test('上游响应体停滞仍受总超时限制，取消读取而不是无限占用连接', async () => {
  let cancelled = false;
  const handler = createMiniMaxMiddleware({
    getApiKey: () => 'test',
    requestTimeoutMs: 15,
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  const response = new FakeResponse();
  await handler(request('/chat/completions'), response as unknown as ServerResponse, () => {});
  assert.equal(cancelled, true);
  assert.equal(response.destroyed, true);
});

test('六个并发请求后拒绝新请求，完成后恢复，不妨碍只读状态接口', async () => {
  const releases: (() => void)[] = [];
  let shouldHold = true;
  let calls = 0;
  const handler = createMiniMaxMiddleware({
    getApiKey: () => 'test',
    fetch: async () => {
      calls++;
      if (shouldHold) await new Promise<void>((resolve) => releases.push(resolve));
      return Response.json({ ok: true });
    },
  });
  const pending = Array.from({ length: 6 }, () =>
    handler(
      request('/chat/completions'),
      new FakeResponse() as unknown as ServerResponse,
      () => {},
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 6);
  const busy = new FakeResponse();
  await handler(request('/chat/completions'), busy as unknown as ServerResponse, () => {});
  assert.equal(busy.status, 429);
  assert.equal(calls, 6);
  const status = new FakeResponse();
  await handler(
    request('/status', { method: 'GET' }),
    status as unknown as ServerResponse,
    () => {},
  );
  assert.equal(status.status, 200);
  shouldHold = false;
  releases.forEach((release) => release());
  await Promise.all(pending);
  const recovered = new FakeResponse();
  await handler(request('/chat/completions'), recovered as unknown as ServerResponse, () => {});
  assert.equal(recovered.status, 200);
});

test('声明过大的请求体在读取前拒绝，客户端断开会终止未完成上传', async () => {
  let calls = 0;
  const handler = createMiniMaxMiddleware({
    getApiKey: () => 'test',
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  const source = request('/chat/completions');
  const large = request('/chat/completions', {
    headers: { ...source.headers, 'content-length': '99999999999' },
  });
  const oversized = new FakeResponse();
  await handler(large, oversized as unknown as ServerResponse, () => {});
  assert.equal(oversized.status, 413);
  const slow = Object.assign(new Readable({ read() {} }), {
    url: source.url,
    method: source.method,
    headers: source.headers,
    socket: source.socket,
    complete: false,
  }) as unknown as IncomingMessage;
  const disconnected = new FakeResponse();
  const pending = handler(slow, disconnected as unknown as ServerResponse, () => {});
  disconnected.emit('close');
  await pending;
  assert.equal(slow.destroyed, true);
  assert.equal(calls, 0);
});
