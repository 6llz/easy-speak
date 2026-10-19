import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  readPhrases,
  readSessions,
  readSettings,
  savePhrases,
  saveSessions,
  saveSettings,
} from '../src/lib/storage.ts';
import { DEFAULT_SETTINGS } from '../src/lib/core.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
let local: MemoryStorage, session: MemoryStorage;
beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
});

test('密钥只写入会话存储，不混入长期偏好', () => {
  assert.equal(saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'test-only-key' }), true);
  assert.equal(session.getItem('morrow:key'), 'test-only-key');
  assert.ok(!local.getItem('morrow:settings')?.includes('test-only-key'));
  assert.equal(readSettings().apiKey, 'test-only-key');
});

test('旧版本或被破坏的设置安全恢复默认值，限制语速范围', () => {
  local.setItem('morrow:settings', '{"provider":"unknown","rate":99,"level":{},"model":null}');
  const settings = readSettings();
  assert.equal(settings.provider, DEFAULT_SETTINGS.provider);
  assert.equal(settings.level, DEFAULT_SETTINGS.level);
  assert.equal(settings.model, DEFAULT_SETTINGS.model);
  assert.equal(settings.rate, 1.25);
  local.setItem('morrow:settings', 'null');
  assert.equal(readSettings().provider, DEFAULT_SETTINGS.provider);
});

test('旧设置迁移为3秒停顿，合法档位保留，异常值不会恢复900ms抢答', () => {
  assert.equal(readSettings().speechPauseMs, 3000);
  for (const speechPauseMs of [2000, 3000, 5000]) {
    saveSettings({ ...DEFAULT_SETTINGS, speechPauseMs });
    assert.equal(readSettings().speechPauseMs, speechPauseMs);
  }
  for (const speechPauseMs of [900, -1, null, '5000']) {
    local.setItem('morrow:settings', JSON.stringify({ speechPauseMs }));
    assert.equal(readSettings().speechPauseMs, 3000);
  }
});

test('格式损坏的本地记录不能使主界面崩溃', () => {
  local.setItem('morrow:sessions', 'broken');
  local.setItem('morrow:phrases', '[null,{"id":"bad"}]');
  assert.deepEqual(readSessions(), []);
  assert.deepEqual(readPhrases(), []);
});

test('新消息保留语伴称呼，旧记录和非法名字安全回退', () => {
  local.setItem(
    'morrow:sessions',
    JSON.stringify([
      {
        id: '1',
        date: new Date().toISOString(),
        title: '练习',
        scene: 'daily',
        words: 1,
        duration: 1,
        messages: [
          { id: 'named', role: 'assistant', content: 'Hello', companionName: 'Noah' },
          { id: 'old', role: 'assistant', content: 'Hello' },
          { id: 'bad', role: 'assistant', content: 'Hello', companionName: { wrong: true } },
        ],
      },
    ]),
  );
  const messages = readSessions()[0].messages;
  assert.equal(messages[0].companionName, 'Noah');
  assert.equal(messages[1].companionName, undefined);
  assert.equal(messages[2].companionName, undefined);
});

test('移除配置中的密钥会清空会话密钥', () => {
  saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'test-only-key' });
  saveSettings(DEFAULT_SETTINGS);
  assert.equal(readSettings().apiKey, '');
});

test('配置结构类型携带额外凭据时，长期保存仍只使用明确白名单', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    apiKey: 'session-only-key',
    speechApiKey: 'speech-session-key',
    credentials: { secret: 'extra-config-secret' },
    accessToken: 'extra-access-token',
  };
  assert.equal(saveSettings(settings), true);
  const saved = local.getItem('morrow:settings')!;
  for (const forbidden of [
    'session-only-key',
    'speech-session-key',
    'extra-config-secret',
    'extra-access-token',
  ])
    assert.equal(saved.includes(forbidden), false);
  assert.equal(readSettings().apiKey, 'session-only-key');
  assert.equal(readSettings().speechApiKey, 'speech-session-key');
});

test('历史记录、嵌套消息与收藏的读写都丢弃未知字段，合法翻译和课程字段保留', () => {
  const record = {
    id: 'safe',
    date: new Date().toISOString(),
    title: '练习',
    scene: 'daily',
    words: 2,
    duration: 5,
    lessonId: 'lesson-1',
    goalTurns: 3,
    isDemo: false,
    credentials: 'extra-history-secret',
    messages: [
      {
        id: 'm1',
        role: 'assistant' as const,
        content: 'Hello',
        translation: '你好',
        companionName: 'Noah',
        apiKey: 'extra-message-secret',
      },
    ],
  };
  const phrase = {
    id: 'p1',
    date: record.date,
    en: 'Hello',
    zh: '你好',
    apiKey: 'extra-phrase-secret',
  };
  local.setItem('morrow:sessions', JSON.stringify([record]));
  local.setItem('morrow:phrases', JSON.stringify([phrase]));
  assert.equal(JSON.stringify(readSessions()).includes('extra-'), false);
  assert.equal(JSON.stringify(readPhrases()).includes('extra-'), false);
  assert.equal(saveSessions([record]), true);
  assert.equal(savePhrases([phrase]), true);
  assert.equal(local.getItem('morrow:sessions')!.includes('extra-'), false);
  assert.equal(local.getItem('morrow:phrases')!.includes('extra-'), false);
  const restored = readSessions()[0];
  assert.equal(restored.messages[0].translation, '你好');
  assert.equal(restored.messages[0].companionName, 'Noah');
  assert.equal(restored.goalTurns, 3);
  assert.equal(restored.lessonId, 'lesson-1');
});
