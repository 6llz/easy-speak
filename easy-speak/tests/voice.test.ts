import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { VoiceQueue, VOICE_START_TIMEOUT_MS } from '../src/lib/voice.ts';

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  onstart?: () => void;
  onend?: () => void;
  onerror?: () => void;
  constructor(text: string) {
    this.text = text;
  }
}
let utterances: FakeUtterance[];
let cancelCount: number;
const queues: VoiceQueue[] = [];
beforeEach(() => {
  utterances = [];
  cancelCount = 0;
  const synthesis = {
    speak: (utterance: FakeUtterance) => utterances.push(utterance),
    cancel: () => cancelCount++,
    getVoices: () => [],
  };
  Object.assign(globalThis, {
    window: { speechSynthesis: synthesis },
    speechSynthesis: synthesis,
    SpeechSynthesisUtterance: FakeUtterance,
  });
});
afterEach(() => {
  queues.forEach((queue) => queue.cancel());
  queues.length = 0;
});
function createQueue(onStart = () => {}, onDone = () => {}, onError = () => {}) {
  const queue = new VoiceQueue(0.9, '', onStart, onDone, onError);
  queues.push(queue);
  return queue;
}

test('设备朗读跟随语言，忽略旧英语音色并逐句处理日文标点', () => {
  const french = { voiceURI: 'french', lang: 'fr-FR' };
  speechSynthesis.getVoices = () =>
    [{ voiceURI: 'english', lang: 'en-US' }, french] as SpeechSynthesisVoice[];
  const queue = new VoiceQueue(
    0.9,
    'english',
    () => {},
    () => {},
    () => {},
    'fr-FR',
  );
  queues.push(queue);
  queue.push('Bonjour.');
  assert.equal(utterances[0].lang, 'fr-FR');
  assert.equal((utterances[0] as unknown as SpeechSynthesisUtterance).voice, french);
  const japanese = new VoiceQueue(
    0.9,
    '',
    () => {},
    () => {},
    () => {},
    'ja-JP',
  );
  queues.push(japanese);
  japanese.push('こんにちは。元気ですか？');
  assert.equal(utterances.length, 3);
  assert.equal(utterances[1].text, 'こんにちは。');
  assert.equal(utterances[2].lang, 'ja-JP');
});

test('无空格的长日文朗读按分词估算时长，不会十几秒就被误判卡住', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let done = 0;
  const queue = new VoiceQueue(
    0.9,
    '',
    () => {},
    () => done++,
    () => {},
    'ja-JP',
  );
  queues.push(queue);
  queue.push('今日はとても忙しい一日でしたが、散歩をして気分がよくなりました'.repeat(5));
  queue.finish();
  utterances[0].onstart?.();
  context.mock.timers.tick(20000);
  assert.equal(done, 0);
  utterances[0].onend?.();
  assert.equal(done, 1);
});

test('首句尽早播放，全文完成前不能释放说话状态', () => {
  let started = 0,
    done = 0;
  const queue = createQueue(
    () => started++,
    () => done++,
  );
  queue.push('Hello.');
  assert.equal(utterances.length, 1);
  utterances[0].onstart?.();
  utterances[0].onend?.();
  assert.equal(started, 1);
  assert.equal(done, 0);
  queue.push('Hello. How are you');
  assert.equal(utterances.length, 1);
  queue.finish();
  assert.equal(utterances.length, 2);
  assert.equal(utterances[1].text, 'How are you');
  assert.equal(done, 0);
  utterances[1].onend?.();
  assert.equal(done, 1);
});

test('流式重复累计内容不会重复入队，完成后只回调一次', () => {
  let done = 0;
  const queue = createQueue(
    () => {},
    () => done++,
  );
  queue.push('Hi there. Nice to');
  queue.push('Hi there. Nice to');
  queue.push('Hi there. Nice to see you!');
  queue.finish();
  assert.equal(utterances.length, 2);
  utterances[0].onend?.();
  assert.equal(done, 0);
  utterances[1].onend?.();
  utterances[1].onend?.();
  assert.equal(done, 1);
});

test('取消语音后旧的播放回调不会改变新会话状态', () => {
  let done = 0,
    started = 0;
  const queue = createQueue(
    () => started++,
    () => done++,
  );
  queue.push('Hello!');
  queue.finish();
  queue.cancel();
  utterances[0].onstart?.();
  utterances[0].onend?.();
  assert.equal(cancelCount, 1);
  assert.equal(started, 0);
  assert.equal(done, 0);
});

test('浏览器没有语音能力时可恢复到文字对话', () => {
  Object.assign(globalThis, { window: {} });
  let done = 0,
    errors = 0;
  const queue = createQueue(
    () => {},
    () => done++,
    () => errors++,
  );
  queue.push('Hello!');
  queue.finish();
  assert.equal(errors, 1);
  assert.equal(done, 1);
});

test('播放失败同样释放队列，不让麦克风永远锁住', () => {
  let done = 0,
    errors = 0;
  const queue = createQueue(
    () => {},
    () => done++,
    () => errors++,
  );
  queue.push('Hello!');
  queue.finish();
  utterances[0].onerror?.();
  assert.equal(errors, 1);
  assert.equal(done, 1);
});

test('自动播放被拦截且无事件时快速恢复，不等待一分钟', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let done = 0,
    errors = 0;
  const queue = createQueue(
    () => {},
    () => done++,
    () => errors++,
  );
  queue.push('Hello there.');
  queue.finish();
  context.mock.timers.tick(VOICE_START_TIMEOUT_MS - 1);
  assert.equal(done, 0);
  context.mock.timers.tick(1);
  assert.equal(errors, 1);
  assert.equal(done, 1);
  utterances[0].onstart?.();
  utterances[0].onend?.();
  assert.equal(done, 1);
});

test('低语速长句仍在正常播放时不会被全局60秒定时器截断', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let done = 0,
    errors = 0;
  const queue = createQueue(
    () => {},
    () => done++,
    () => errors++,
  );
  queue.push(`${'word '.repeat(300)}finished.`);
  queue.finish();
  utterances[0].onstart?.();
  context.mock.timers.tick(61000);
  assert.equal(errors, 0);
  assert.equal(done, 0);
  utterances[0].onend?.();
  assert.equal(done, 1);
});

test('设备语音接口同步抛错时仍能恢复且不会把异常冒泡到页面', () => {
  let done = 0,
    errors = 0;
  speechSynthesis.speak = () => {
    throw new Error('speaker unavailable');
  };
  const queue = createQueue(
    () => {},
    () => done++,
    () => errors++,
  );
  assert.doesNotThrow(() => queue.push('Hello.'));
  assert.equal(errors, 1);
  assert.equal(done, 1);
});
