import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  MiniMaxVoiceQueue,
  synthesizeMiniMaxSpeech,
  transcribeMiniMaxSpeech,
} from '../src/lib/minimaxSpeech.ts';
import { LOCAL_MINIMAX_KEY } from '../src/lib/speechSettings.ts';

const originalFetch = globalThis.fetch;
const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio);
  else Reflect.deleteProperty(globalThis, 'Audio');
});
const config = {
  baseUrl: 'https://api.minimaxi.com/v1',
  apiKey: 'test-only-key',
  model: 'speech-2.8-turbo',
  voiceId: 'English_expressive_narrator',
  rate: 0.95,
};
const audioResponse = () =>
  Response.json({ data: { audio: '494433', status: 2 }, base_resp: { status_code: 0 } });

test('MiniMax 合成使用独立协议和受限 hex 音频，不转发密钥到 URL', async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(input, `${config.baseUrl}/t2a_v2`);
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-only-key');
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, config.model);
    assert.equal(body.stream, false);
    assert.equal(body.output_format, 'hex');
    assert.equal(body.voice_setting.voice_id, config.voiceId);
    assert.equal(body.voice_setting.speed, 0.95);
    return audioResponse();
  };
  const audio = await synthesizeMiniMaxSpeech('Hello.', config);
  assert.equal(audio.type, 'audio/mpeg');
  assert.deepEqual(new Uint8Array(await audio.arrayBuffer()), new Uint8Array([73, 68, 51]));
});

test('语音转写上传 WAV multipart，返回空白交由录音层决定不发送', async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(input, `${config.baseUrl}/speech_to_text`);
    assert.equal(new Headers(init?.headers).get('language'), 'en');
    assert.equal(new Headers(init?.headers).get('content-type'), null);
    const form = init?.body as FormData;
    assert.equal(form.get('model'), 'asr-1.0');
    assert.equal(form.get('stream'), 'false');
    assert.equal((form.get('file') as File).name, 'speech.wav');
    return Response.json({ text: '  Hello there.  ', duration: 1.2 });
  };
  assert.equal(await transcribeMiniMaxSpeech(new Blob(['wav']), config), 'Hello there.');
  globalThis.fetch = async () => Response.json({ text: ' ' });
  assert.equal(await transcribeMiniMaxSpeech(new Blob(['wav']), config), '');
});

test('拒绝异常、超限或供应商失败响应，错误不包含原始正文', async () => {
  for (const payload of [
    null,
    { data: null },
    { data: { audio: 'abc', status: 2 } },
    { data: { audio: 'zz', status: 2 } },
    { data: { audio: '00', status: 1 } },
    { base_resp: { status_code: 1004, status_msg: 'test-only-key' } },
  ]) {
    globalThis.fetch = async () => Response.json(payload);
    await assert.rejects(
      synthesizeMiniMaxSpeech('Hello.', config),
      (error: Error) => !error.message.includes('test-only-key'),
    );
  }
  globalThis.fetch = async () => new Response('test-only-key{');
  await assert.rejects(synthesizeMiniMaxSpeech('Hello.', config), /格式异常/);
  globalThis.fetch = async () => new Response('test-only-key', { status: 401 });
  await assert.rejects(synthesizeMiniMaxSpeech('Hello.', config), /密钥无效/);
  await assert.rejects(synthesizeMiniMaxSpeech('a'.repeat(10000), config), /过长/);
});

test('取消覆盖读取正文，预取消不发请求；本机占位密钥不能流向外部', async () => {
  let calls = 0;
  let wasCancelled = false;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      new ReadableStream({
        cancel() {
          wasCancelled = true;
        },
      }),
    );
  };
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(synthesizeMiniMaxSpeech('Hello.', config, aborted.signal), {
    name: 'AbortError',
  });
  assert.equal(calls, 0);
  await assert.rejects(
    synthesizeMiniMaxSpeech('Hello.', { ...config, apiKey: LOCAL_MINIMAX_KEY }),
    /本机/,
  );
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = synthesizeMiniMaxSpeech('Hello.', config, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(wasCancelled, true);
});

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  duration = 1;
  paused = false;
  preload = '';
  volume = 0.4;
  muted = true;
  playCalls = 0;
  loadCalls = 0;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  async play() {
    this.playCalls++;
    this.onplaying?.();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = '';
  }
  load() {
    this.loadCalls++;
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('语音逐句顺序播放并预取下一句，取消释放播放器与请求，晚回调不结束新轮次', async () => {
  FakeAudio.instances = [];
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeAudio });
  const texts: string[] = [];
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init) => {
    texts.push(JSON.parse(init?.body as string).text);
    requestSignal = init?.signal || undefined;
    return audioResponse();
  };
  let starts = 0,
    dones = 0;
  const errors: string[] = [];
  const queue = new MiniMaxVoiceQueue(
    config,
    () => starts++,
    () => dones++,
    (message) => errors.push(message),
  );
  queue.push('First. Second. Third.');
  queue.finish();
  await flush();
  assert.equal(FakeAudio.instances.length, 1);
  assert.deepEqual(texts, ['First.', 'Second.']);
  assert.equal(starts, 1);
  assert.equal(dones, 0);
  const audio = FakeAudio.instances[0];
  assert.equal(audio.volume, 1);
  assert.equal(audio.muted, false);
  assert.equal(audio.preload, 'auto');
  const firstUrl = audio.src;
  const firstEnd = audio.onended!;
  const firstError = audio.onerror!;
  const firstPlaying = audio.onplaying!;
  firstEnd();
  await flush();
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(audio.playCalls, 2);
  assert.notEqual(audio.src, firstUrl);
  assert.equal(audio.paused, false);
  assert.equal(audio.loadCalls, 0);
  assert.deepEqual(texts, ['First.', 'Second.', 'Third.']);
  firstEnd();
  firstError();
  firstPlaying();
  await flush();
  assert.equal(audio.playCalls, 2);
  assert.equal(starts, 1);
  assert.deepEqual(errors, []);
  const lateEnd = audio.onended!;
  queue.cancel();
  lateEnd();
  await flush();
  assert.equal(requestSignal?.aborted, true);
  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  assert.equal(audio.loadCalls, 1);
  assert.equal(dones, 0);
  assert.deepEqual(errors, []);
});

test('完整队列只回调一次完成；播放拒绝可恢复且不偷偷改用系统声音', async () => {
  FakeAudio.instances = [];
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeAudio });
  globalThis.fetch = async () => audioResponse();
  let dones = 0;
  const errors: string[] = [];
  const queue = new MiniMaxVoiceQueue(
    config,
    () => {},
    () => dones++,
    (message) => errors.push(message),
  );
  queue.push('One.');
  queue.finish();
  await flush();
  const onend = FakeAudio.instances[0].onended!;
  onend();
  onend();
  queue.finish();
  assert.equal(dones, 1);
  assert.equal(FakeAudio.instances[0].paused, true);
  assert.equal(FakeAudio.instances[0].src, '');
  assert.equal(FakeAudio.instances[0].loadCalls, 1);
  assert.deepEqual(errors, []);
  class RejectedAudio extends FakeAudio {
    async play() {
      throw new Error('blocked');
    }
  }
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: RejectedAudio });
  const rejected = new MiniMaxVoiceQueue(
    config,
    () => {},
    () => dones++,
    (message) => errors.push(message),
  );
  rejected.push('One.');
  rejected.finish();
  await flush();
  assert.equal(dones, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /暂停了声音/);
});

test('复用播放器时，上一片段迟到的播放拒绝不会中断当前片段', async () => {
  FakeAudio.instances = [];
  let rejectFirst!: (error: Error) => void;
  class DeferredAudio extends FakeAudio {
    play(): Promise<void> {
      this.playCalls++;
      this.onplaying?.();
      if (this.playCalls === 1)
        return new Promise((_resolve, reject) => {
          rejectFirst = reject;
        });
      return Promise.resolve();
    }
  }
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: DeferredAudio });
  globalThis.fetch = async () => audioResponse();
  let dones = 0;
  const errors: string[] = [];
  const queue = new MiniMaxVoiceQueue(
    config,
    () => {},
    () => dones++,
    (message) => errors.push(message),
  );
  queue.push('First. Second.');
  queue.finish();
  await flush();
  const audio = FakeAudio.instances[0];
  audio.onended?.();
  await flush();
  rejectFirst(new Error('late playback rejection'));
  await flush();
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(audio.playCalls, 2);
  assert.equal(audio.paused, false);
  assert.deepEqual(errors, []);
  assert.equal(dones, 0);
  audio.onended?.();
  assert.equal(dones, 1);
  assert.equal(audio.src, '');
});

test('下一句合成未完成时保留已结束的播放器，取消后迟到音频不再播放', async () => {
  FakeAudio.instances = [];
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeAudio });
  let calls = 0;
  let resolveNext!: (response: Response) => void;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return audioResponse();
    return new Promise((resolve) => {
      resolveNext = resolve;
    });
  };
  let dones = 0;
  const errors: string[] = [];
  const queue = new MiniMaxVoiceQueue(
    config,
    () => {},
    () => dones++,
    (message) => errors.push(message),
  );
  queue.push('First. Second.');
  queue.finish();
  await flush();
  const audio = FakeAudio.instances[0];
  const lateEnd = audio.onended!;
  lateEnd();
  assert.equal(audio.loadCalls, 0);
  assert.equal(audio.paused, false);
  assert.equal(dones, 0);
  queue.cancel();
  resolveNext(audioResponse());
  lateEnd();
  await flush();
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  assert.equal(dones, 0);
  assert.deepEqual(errors, []);
});
