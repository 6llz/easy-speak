import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { BrowserRecognition } from '../src/lib/browserRecognition.ts';
import type { Recognition } from '../src/lib/voice.ts';

function setup(context: TestContext, pauseMs = 3000) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const natives: NativeRecognition[] = [];
  let shouldFailStart = false;
  class NativeRecognition implements Recognition {
    lang = '';
    continuous = false;
    interimResults = false;
    onstart: Recognition['onstart'] = null;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    onend: Recognition['onend'] = null;
    onspeechstart: (() => void) | null = null;
    onspeechend: (() => void) | null = null;
    stops = 0;
    aborts = 0;
    constructor() {
      natives.push(this);
    }
    start() {
      if (shouldFailStart) throw new Error('Device busy');
      this.onstart?.();
    }
    stop() {
      this.stops++;
      this.onend?.();
    }
    abort() {
      this.aborts++;
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    }
    result(text: string, isFinal = false) {
      this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
    }
    end() {
      this.onend?.();
    }
  }
  const recognition = new BrowserRecognition(NativeRecognition, pauseMs);
  const texts: { text: string; isFinal: boolean }[] = [];
  const errors: string[] = [];
  let starts = 0,
    ends = 0;
  recognition.onstart = () => starts++;
  recognition.onresult = (event) =>
    texts.push({ text: event.results[0][0].transcript, isFinal: event.results[0].isFinal });
  recognition.onerror = (event) => errors.push(event.error);
  recognition.onend = () => ends++;
  context.after(() => {
    recognition.abort();
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  recognition.start();
  return {
    recognition,
    natives,
    texts,
    errors,
    document,
    tick: (ms: number) => context.mock.timers.tick(ms),
    failNextStart: () => {
      shouldFailStart = true;
    },
    get starts() {
      return starts;
    },
    get ends() {
      return ends;
    },
  };
}

test('句中两秒停顿不提交，续说覆盖当前快照，最后等3秒仅结束一次', (context) => {
  const session = setup(context);
  const native = session.natives[0];
  assert.equal(native.continuous, true);
  assert.equal(native.interimResults, true);
  native.result('I would');
  session.tick(2000);
  assert.equal(session.ends, 0);
  native.result('I would like tea.', true);
  session.tick(2999);
  assert.equal(session.ends, 0);
  session.tick(1);
  assert.equal(session.ends, 1);
  assert.deepEqual(session.texts.at(-1), { text: 'I would like tea.', isFinal: true });
  assert.equal(native.stops, 1);
  session.tick(60000);
  assert.equal(session.ends, 1);
});

test('原生提前end跨片段续听，旧回调无效且拼接不重复', (context) => {
  const session = setup(context);
  const first = session.natives[0];
  first.result('I would like', true);
  const lateResult = first.onresult;
  first.end();
  assert.equal(session.ends, 0);
  session.tick(200);
  const next = session.natives[1];
  next.result('to travel');
  next.result('to travel to Rome.', true);
  lateResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'OLD' } }] });
  session.tick(3000);
  assert.deepEqual(session.texts.at(-1), {
    text: 'I would like to travel to Rome.',
    isFinal: true,
  });
  assert.equal(session.ends, 1);
  assert.equal(session.starts, 1);
});

test('5秒档及发声事件允许长思考和持续说话，停止发声后重新计时', (context) => {
  const session = setup(context, 5000);
  const native = session.natives[0];
  native.onspeechstart?.();
  native.result('Let me explain');
  session.tick(7000);
  assert.equal(session.ends, 0);
  native.onspeechend?.();
  session.tick(4000);
  native.onspeechstart?.();
  native.result('Let me explain my idea.');
  native.onspeechend?.();
  session.tick(4999);
  assert.equal(session.ends, 0);
  session.tick(1);
  assert.equal(session.ends, 1);
});

test('挂断取消待重启与定时提交，过期结果不能恢复识别', (context) => {
  const session = setup(context);
  const native = session.natives[0];
  native.result('Not finished');
  const lateEnd = native.onend;
  native.end();
  session.recognition.abort();
  lateEnd?.();
  session.tick(60000);
  assert.equal(session.natives.length, 1);
  assert.equal(session.ends, 0);
  assert.ok(!session.texts.some((text) => text.isFinal));
  assert.deepEqual(session.errors, []);
});

test('后台释放麦克风和等待，返回前台不自行重启', (context) => {
  const session = setup(context);
  session.natives[0].result('Thinking');
  session.document.visibilityState = 'hidden';
  session.document.dispatchEvent(new Event('visibilitychange'));
  session.tick(10000);
  session.document.visibilityState = 'visible';
  session.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(session.natives[0].aborts, 1);
  assert.equal(session.natives.length, 1);
  assert.equal(session.ends, 0);
});

test('初始10秒无话只结束一次，不反复开麦', (context) => {
  const session = setup(context);
  session.tick(10000);
  assert.deepEqual(session.errors, ['no-speech']);
  assert.equal(session.ends, 1);
  session.tick(60000);
  assert.equal(session.natives.length, 1);
});

test('重启设备失败保留已发出的草稿，错误结束且无重启循环', (context) => {
  const session = setup(context);
  session.natives[0].result('Keep my words');
  session.natives[0].end();
  session.failNextStart();
  session.tick(200);
  assert.equal(session.texts.at(-1)?.text, 'Keep my words');
  assert.deepEqual(session.errors, ['audio-capture']);
  assert.equal(session.ends, 1);
  session.tick(60000);
  assert.equal(session.natives.length, 2);
});

test('持续说话仍有60秒单轮上限', (context) => {
  const session = setup(context);
  session.natives[0].result('Long answer');
  session.natives[0].onspeechstart?.();
  session.tick(60000);
  assert.equal(session.ends, 1);
  assert.equal(session.texts.at(-1)?.isFinal, true);
});

test('人工stop立即提交已有转写，下一轮权限拒绝只报告一次并清理资源', (context) => {
  const session = setup(context);
  session.natives[0].result('My completed answer');
  session.recognition.stop();
  assert.equal(session.ends, 1);
  assert.deepEqual(session.texts.at(-1), { text: 'My completed answer', isFinal: true });
  session.recognition.start();
  const denied = session.natives[1];
  const lateError = denied.onerror;
  denied.onerror?.({ error: 'not-allowed' });
  lateError?.({ error: 'not-allowed' });
  session.tick(60000);
  assert.equal(session.ends, 2);
  assert.deepEqual(session.errors, ['not-allowed']);
  assert.equal(session.natives.length, 2);
});
