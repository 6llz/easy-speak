import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../src/lib/core.ts';
import {
  applyVoiceChoice,
  companionName,
  personalizeGreeting,
  selectedVoiceName,
  VOICE_PRESETS,
  voicePresetsFor,
  voicePreviewText,
} from '../src/lib/voicePresets.ts';
import { getSpeechConfig, withLocalMiniMax } from '../src/lib/speechSettings.ts';
import { readSettings, saveSettings } from '../src/lib/storage.ts';
import { messageSpeakerName } from '../src/lib/format.ts';
import { mainPrompt, SCENES } from '../src/lib/core.ts';

test('语伴名字跟随音色，设备及自定义回退轻松说，历史保留发言时称呼', () => {
  const noah = {
    ...DEFAULT_SETTINGS,
    speechProvider: 'minimax' as const,
    speechVoice: 'English_Gentle-voiced_man',
  };
  assert.equal(companionName(noah), 'Noah');
  assert.equal(personalizeGreeting('Hi, I’m {companion}.', noah), 'Hi, I’m Noah.');
  assert.match(mainPrompt(SCENES[0], 'B1', noah, companionName(noah)), /You are Noah,/);
  assert.equal(companionName({ ...noah, speechVoice: 'my-custom' }), '轻松说');
  assert.equal(companionName({ ...noah, speechProvider: 'browser' }), '轻松说');
  assert.equal(
    messageSpeakerName({ id: '1', role: 'assistant', content: 'Hello', companionName: 'Noah' }),
    'Noah',
  );
  assert.equal(messageSpeakerName({ id: 'old', role: 'assistant', content: 'Hello' }), '语伴');
});

test('音色快捷选择只修改朗读字段，保留对话、两种语言与关闭自动朗读的意图', () => {
  const before = {
    ...withLocalMiniMax(DEFAULT_SETTINGS, 'http://localhost:5173'),
    autoSpeak: false,
    supportLanguage: 'fr-FR',
    practiceLanguage: 'ja-JP',
    rate: 0.8,
  };
  const next = applyVoiceChoice(before, { provider: 'minimax', voiceId: 'Japanese_KindLady' });
  assert.deepEqual(next, {
    ...before,
    speechProvider: 'minimax',
    speechVoice: 'Japanese_KindLady',
  });
  assert.equal(getSpeechConfig(next).voiceId, 'Japanese_KindLady');
  assert.equal(next.apiKey, before.apiKey);
  assert.deepEqual(applyVoiceChoice(next, { provider: 'browser', voiceURI: 'device-ja' }), {
    ...next,
    speechProvider: 'browser',
    voice: 'device-ja',
  });
});

test('未连接 MiniMax 时不能静默启用云端音色，设备声音仍可选择', () => {
  assert.throws(
    () => applyVoiceChoice(DEFAULT_SETTINGS, { provider: 'minimax', voiceId: VOICE_PRESETS[0].id }),
    /密钥|Key/,
  );
  assert.equal(
    applyVoiceChoice(DEFAULT_SETTINGS, { provider: 'browser', voiceURI: '' }).speechProvider,
    'browser',
  );
});

test('音色列表按当前语言优先，保留已有自定义 ID 与各语种试听文字', () => {
  const ordered = voicePresetsFor('ja-JP');
  assert.equal(ordered[0].language, 'ja');
  assert.equal(new Set(ordered.map((voice) => voice.id)).size, ordered.length);
  assert.equal(
    selectedVoiceName({
      ...DEFAULT_SETTINGS,
      speechProvider: 'minimax',
      speechVoice: 'my-custom-voice',
    }),
    '自定义音色',
  );
  assert.match(voicePreviewText('ja-JP') || '', /こんにちは/);
  assert.match(voicePreviewText('fr-FR') || '', /Bonjour/);
  assert.equal(voicePreviewText('sw-KE'), null);
});

test('快捷音色使用现有持久化约定，刷新保留且密钥不进入长期偏好', () => {
  const local = new Map<string, string>(),
    session = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
    },
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => session.set(key, value),
    },
  });
  const next = applyVoiceChoice(
    { ...DEFAULT_SETTINGS, provider: 'minimax', apiKey: 'test-secret' },
    { provider: 'minimax', voiceId: 'English_Graceful_Lady' },
  );
  assert.equal(saveSettings(next), true);
  assert.equal(readSettings().speechVoice, 'English_Graceful_Lady');
  assert.ok(!local.get('morrow:settings')?.includes('test-secret'));
});
