import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DEFAULT_SETTINGS, requestChatCompletion, validateSettings } from '../src/lib/core.ts';
import {
  getSpeechConfig,
  loadInitialSettings,
  LOCAL_MINIMAX_KEY,
  validateSpeechSettings,
  withLocalMiniMax,
} from '../src/lib/speechSettings.ts';
import { readSettings, saveSettings } from '../src/lib/storage.ts';

const originalFetch = globalThis.fetch;
const keys = ['localStorage', 'sessionStorage', 'location'];
const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
afterEach(() => {
  globalThis.fetch = originalFetch;
  keys.forEach((key, index) => {
    const descriptor = descriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});
function setup() {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => local.get(key) || null,
      setItem: (key: string, value: string) => local.set(key, value),
    },
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => session.get(key) || null,
      setItem: (key: string, value: string) => session.set(key, value),
    },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:5173' },
  });
  return { local, session };
}
test('本机配置启动只取得占位值，保留用户主动选择的其他供应商', async () => {
  setup();
  globalThis.fetch = async () => Response.json({ configured: true });
  const settings = await loadInitialSettings();
  assert.equal(settings.provider, 'minimax');
  assert.equal(settings.apiKey, LOCAL_MINIMAX_KEY);
  assert.equal(settings.speechProvider, 'minimax');
  assert.equal(settings.recognitionProvider, 'minimax');
  saveSettings({ ...DEFAULT_SETTINGS, provider: 'qwen' });
  assert.equal((await loadInitialSettings()).provider, 'qwen');
});
test('独立语音密钥只写会话存储，旧设置回退默认，清空后不残留', () => {
  const { local, session } = setup();
  saveSettings({
    ...DEFAULT_SETTINGS,
    apiKey: 'chat-test-key',
    speechApiKey: 'speech-test-key',
    speechProvider: 'minimax',
  });
  assert.equal(session.get('morrow:speech-key'), 'speech-test-key');
  assert.ok(!local.get('morrow:settings')?.includes('speech-test-key'));
  assert.equal(readSettings().speechApiKey, 'speech-test-key');
  saveSettings(DEFAULT_SETTINGS);
  assert.equal(readSettings().speechApiKey, '');
  local.set(
    'morrow:settings',
    '{"speechProvider":"unknown","recognitionProvider":[],"speechModel":null}',
  );
  assert.equal(readSettings().speechProvider, 'browser');
  assert.equal(readSettings().speechModel, DEFAULT_SETTINGS.speechModel);
});
test('语音可复用 MiniMax 对话密钥，其他供应商必须单独填语音密钥，本机地址不能改到远端', () => {
  const minimax = {
    ...DEFAULT_SETTINGS,
    provider: 'minimax' as const,
    speechProvider: 'minimax' as const,
    apiKey: 'chat-test-key',
  };
  assert.equal(getSpeechConfig(minimax).apiKey, 'chat-test-key');
  assert.equal(validateSpeechSettings(minimax), null);
  assert.match(validateSpeechSettings({ ...minimax, provider: 'qwen' }) || '', /API Key/);
  const local = withLocalMiniMax(DEFAULT_SETTINGS, 'http://127.0.0.1:5173');
  assert.equal(validateSettings(local), null);
  assert.equal(validateSpeechSettings(local), null);
  assert.match(
    validateSettings({ ...local, baseUrl: 'https://evil.example/api/v1/minimax' }) || '',
    /本机/,
  );
});
test('MiniMax 聊天将思考字段与正文分离，使用相应token字段，不把推理送去朗读', async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string);
    assert.equal(body.reasoning_split, true);
    if (body.model === 'MiniMax-M3') assert.deepEqual(body.thinking, { type: 'disabled' });
    else assert.equal(body.thinking, undefined);
    assert.equal(body.max_completion_tokens, 650);
    assert.equal(body.max_tokens, undefined);
    return Response.json({
      choices: [{ message: { content: 'Hello!', reasoning_content: 'private reasoning' } }],
      base_resp: { status_code: 0 },
    });
  };
  assert.equal(
    await requestChatCompletion(
      { ...DEFAULT_SETTINGS, provider: 'minimax', model: 'MiniMax-M3', apiKey: 'test' },
      [{ role: 'user', content: 'hello' }],
    ),
    'Hello!',
  );
  assert.equal(
    await requestChatCompletion(
      { ...DEFAULT_SETTINGS, provider: 'minimax', model: 'MiniMax-M3', apiKey: 'test' },
      [{ role: 'user', content: 'hello' }],
      { model: 'MiniMax-M3.1-Flash-Preview' },
    ),
    'Hello!',
  );
});
