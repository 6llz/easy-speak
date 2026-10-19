import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { MINIMAX_ASR_LANGUAGES } from '../src/lib/languages';

const API_PREFIX = '/api/v1/minimax';
const UPSTREAM = 'https://api.minimaxi.com/v1';
const ROUTES = new Set(['/chat/completions', '/t2a_v2', '/speech_to_text']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_CHAT_BODY_BYTES = 4 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 6;
const REQUEST_TIMEOUT_MS = 35_000;

type ProxyOptions = {
  getApiKey: () => string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
};

function respond(response: ServerResponse, status: number, code: string, configured?: boolean) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(configured === undefined ? { error: { code } } : { configured }));
}

/** 仅供本机开发：固定 MiniMax 路由，密钥留在进程内；拒绝远端连接、跨站请求和任意代理目标。 */
export function createMiniMaxMiddleware(options: ProxyOptions) {
  let activeRequests = 0;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith(API_PREFIX)) {
      next();
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url, `http://${request.headers.host || ''}`);
      if (
        !LOOPBACK_HOSTS.has(url.hostname) ||
        !LOOPBACK_ADDRESSES.has(request.socket.remoteAddress || '')
      )
        throw new Error('remote');
      if (request.headers.origin && request.headers.origin !== url.origin)
        throw new Error('origin');
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new Error('cross-site');
    } catch {
      respond(response, 403, 'LOCAL_ONLY');
      return;
    }
    const route = url.pathname.slice(API_PREFIX.length);
    if (url.search || url.hash) {
      respond(response, 400, 'INVALID_ROUTE');
      return;
    }
    if (request.method === 'GET' && route === '/status') {
      respond(response, 200, '', !!options.getApiKey());
      return;
    }
    if (request.method !== 'POST' || !ROUTES.has(route)) {
      respond(response, 404, 'NOT_FOUND');
      return;
    }
    if (request.headers['x-morrow-client'] !== '1') {
      respond(response, 403, 'CLIENT_REQUIRED');
      return;
    }
    const apiKey = options.getApiKey().trim();
    if (!apiKey) {
      respond(response, 503, 'MINIMAX_NOT_CONFIGURED');
      return;
    }
    const recognitionLanguage = request.headers.language;
    if (
      route === '/speech_to_text' &&
      recognitionLanguage !== undefined &&
      (typeof recognitionLanguage !== 'string' ||
        (recognitionLanguage !== '' && !MINIMAX_ASR_LANGUAGES.has(recognitionLanguage)))
    ) {
      respond(response, 400, 'INVALID_LANGUAGE');
      return;
    }
    const contentType = request.headers['content-type'] || '';
    if (
      route === '/speech_to_text'
        ? !contentType.startsWith('multipart/form-data;')
        : contentType.split(';')[0] !== 'application/json'
    ) {
      respond(response, 415, 'INVALID_CONTENT_TYPE');
      return;
    }
    const maxBodyBytes =
      route === '/speech_to_text'
        ? MAX_UPLOAD_BYTES
        : route === '/chat/completions'
          ? MAX_CHAT_BODY_BYTES
          : 128 * 1024;
    const contentLength = request.headers['content-length'];
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBodyBytes)) {
      respond(response, 413, 'REQUEST_TOO_LARGE');
      return;
    }
    if (activeRequests >= MAX_ACTIVE_REQUESTS) {
      respond(response, 429, 'LOCAL_BUSY');
      return;
    }
    activeRequests++;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    const abortUpload = () => {
      // fetch 的取消不能打断慢速请求体；超时或断开时一并释放尚未读完的上传。
      if (!request.complete && !request.destroyed) request.destroy();
    };
    controller.signal.addEventListener('abort', abortUpload, { once: true });
    const onDisconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', onDisconnect);
    response.once('close', onDisconnect);
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        if (length > maxBodyBytes) {
          respond(response, 413, 'REQUEST_TOO_LARGE');
          return;
        }
        chunks.push(bytes);
      }
      controller.signal.throwIfAborted();
      const upstream = await (options.fetch || fetch)(`${UPSTREAM}${route}`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': contentType,
          ...(route === '/speech_to_text' &&
          typeof recognitionLanguage === 'string' &&
          recognitionLanguage
            ? { language: recognitionLanguage }
            : {}),
        },
        body: Buffer.concat(chunks),
      });
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => undefined);
        respond(response, upstream.status, 'MINIMAX_REJECTED');
        return;
      }
      response.writeHead(200, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      const reader = upstream.body?.getReader();
      if (!reader) throw new Error('body');
      const cancelRead = () => {
        void reader.cancel().catch(() => undefined);
      };
      controller.signal.addEventListener('abort', cancelRead, { once: true });
      let responseLength = 0;
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const chunk = await reader.read();
          controller.signal.throwIfAborted();
          if (chunk.done) break;
          responseLength += chunk.value.byteLength;
          if (responseLength > 20 * 1024 * 1024) throw new Error('response-size');
          if (!response.write(chunk.value))
            await new Promise<void>((resolve, reject) => {
              const clean = () => {
                response.off('drain', onDrain);
                controller.signal.removeEventListener('abort', onAbort);
              };
              const onDrain = () => {
                clean();
                resolve();
              };
              const onAbort = () => {
                clean();
                reject(new Error('cancelled'));
              };
              response.once('drain', onDrain);
              controller.signal.addEventListener('abort', onAbort, { once: true });
              if (controller.signal.aborted) onAbort();
            });
        }
      } finally {
        controller.signal.removeEventListener('abort', cancelRead);
        cancelRead();
        reader.releaseLock();
      }
      response.end();
    } catch {
      if (!response.headersSent)
        respond(response, controller.signal.aborted ? 504 : 502, 'MINIMAX_UNAVAILABLE');
      else response.destroy();
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abortUpload);
      request.off('aborted', onDisconnect);
      response.off('close', onDisconnect);
      activeRequests--;
    }
  };
}

export function miniMaxProxy(getApiKey: () => string): Plugin {
  const middleware = createMiniMaxMiddleware({ getApiKey });
  return {
    name: 'morrow-local-minimax',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
