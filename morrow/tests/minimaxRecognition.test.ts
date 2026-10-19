import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  encodeMonoWav,
  MiniMaxRecognition,
  SpeechBoundaryDetector,
} from '../src/lib/minimaxRecognition.ts';

test('停说检测默认等3秒，初始静音和短噪声10秒后停止', () => {
  const detector = new SpeechBoundaryDetector(0);
  assert.equal(detector.update(0, 5000), 'continue');
  assert.equal(detector.update(0.05, 5100), 'continue');
  assert.equal(detector.update(0.04, 5400), 'continue');
  assert.equal(detector.update(0, 6300), 'continue');
  assert.equal(detector.update(0, 8399), 'continue');
  assert.equal(detector.update(0, 8400), 'finish');
  assert.equal(new SpeechBoundaryDetector(0).update(0, 10000), 'no-speech');
  const noise = new SpeechBoundaryDetector(0);
  noise.update(0.1, 100);
  assert.equal(noise.update(0, 10000), 'no-speech');
  const long = new SpeechBoundaryDetector(0);
  long.update(0.05, 1000);
  assert.equal(long.update(0.05, 60000), 'finish');
});

test('句中停顿后续说重新计时，5秒档不在旧900ms或3秒阈值发送', () => {
  const detector = new SpeechBoundaryDetector(0, 5000);
  detector.update(0.06, 100);
  detector.update(0.04, 500);
  assert.equal(detector.update(0, 3500), 'continue');
  assert.equal(detector.update(0.03, 4000), 'continue');
  assert.equal(detector.update(0, 5500), 'continue');
  assert.equal(detector.update(0, 8999), 'continue');
  assert.equal(detector.update(0, 9000), 'finish');
  const faster = new SpeechBoundaryDetector(0, 2000);
  faster.update(0.04, 100);
  faster.update(0.04, 500);
  assert.equal(faster.update(0, 2499), 'continue');
  assert.equal(faster.update(0, 2500), 'finish');
});

test('WAV 编码正确混合声道、写入长度与采样率并限制溢出', async () => {
  const wav = encodeMonoWav([new Float32Array([-2, 0, 2]), new Float32Array([-2, 1, 2])], 16000);
  assert.equal(wav.type, 'audio/wav');
  const bytes = await wav.arrayBuffer();
  const view = new DataView(bytes);
  assert.equal(bytes.byteLength, 50);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(4, true), 42);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 16384);
  assert.equal(view.getInt16(48, true), 32767);
  assert.throws(() => encodeMonoWav([], 16000), /无效/);
});

const original = new Map(
  ['navigator', 'AudioContext', 'MediaRecorder', 'fetch'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
afterEach(() => {
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
const config = { baseUrl: 'https://api.minimaxi.com/v1', apiKey: 'test-only-key' };
function setup(getMedia?: () => Promise<MediaStream>) {
  let stops = 0;
  const stream = {
    getTracks: () => [
      {
        stop() {
          stops++;
        },
      },
    ],
  } as unknown as MediaStream;
  class FakeContext {
    state = 'running';
    async resume() {}
    async close() {
      this.state = 'closed';
    }
    createAnalyser() {
      return {
        fftSize: 1024,
        getFloatTimeDomainData(array: Float32Array) {
          array.fill(0);
        },
      };
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    async decodeAudioData() {
      return {
        numberOfChannels: 1,
        sampleRate: 16000,
        getChannelData: () => new Float32Array([0, 0.5, -0.5]),
      };
    }
  }
  class FakeRecorder {
    static instances: FakeRecorder[] = [];
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      FakeRecorder.instances.push(this);
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['recording']) });
        this.onstop?.();
      });
    }
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: getMedia || (async () => stream) } },
  });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder });
  return { stream, stops: () => stops, recorders: FakeRecorder.instances };
}

test('权限在取消后返回时释放晚到麦克风，不能启动录音或发回调', async () => {
  let resolve!: (value: MediaStream) => void;
  const media = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const recognition = new MiniMaxRecognition(config);
  let callbacks = 0;
  recognition.onstart = recognition.onend = () => callbacks++;
  recognition.start();
  recognition.abort();
  resolve(media.stream);
  await flush();
  assert.equal(media.stops(), 1);
  assert.equal(media.recorders.length, 0);
  assert.equal(callbacks, 0);
});

test('停录后立即释放麦克风并转 WAV，转写成功只发一条最终结果和结束事件', async () => {
  const media = setup();
  let uploads = 0;
  globalThis.fetch = async (_input, init) => {
    uploads++;
    assert.equal(media.stops(), 1);
    const file = (init?.body as FormData).get('file') as File;
    assert.equal(file.type, 'audio/wav');
    assert.equal(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 4)), 'RIFF');
    return Response.json({ text: 'My day was good.' });
  };
  const recognition = new MiniMaxRecognition(config);
  const events: string[] = [];
  recognition.onstart = () => events.push('start');
  recognition.onprocessing = () => events.push('processing');
  recognition.onresult = (event) => events.push(event.results[0][0].transcript);
  recognition.onend = () => events.push('end');
  recognition.start();
  await flush();
  recognition.stop();
  assert.equal(media.stops(), 1);
  await flush();
  await flush();
  assert.equal(uploads, 1);
  assert.deepEqual(events, ['start', 'processing', 'My day was good.', 'end']);
  recognition.abort();
});

test('转写中挂断取消请求，供应商晚返回不得发送文字或结束回调', async () => {
  const media = setup();
  let resolve!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init) => {
    signal = init?.signal || undefined;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const recognition = new MiniMaxRecognition(config);
  let callbacks = 0;
  recognition.onresult = recognition.onend = () => callbacks++;
  recognition.start();
  await flush();
  recognition.stop();
  await flush();
  recognition.abort();
  resolve(Response.json({ text: 'late' }));
  await flush();
  assert.equal(signal?.aborted, true);
  assert.equal(media.stops(), 1);
  assert.equal(callbacks, 0);
});

test('权限拒绝只给可恢复错误，空白转写不能作为用户消息发送', async () => {
  setup(async () => {
    throw new DOMException('denied', 'NotAllowedError');
  });
  const denied = new MiniMaxRecognition(config);
  const errors: string[] = [];
  let ends = 0;
  denied.onerror = (event) => errors.push(event.error);
  denied.onend = () => ends++;
  denied.start();
  await flush();
  assert.deepEqual(errors, ['not-allowed']);
  assert.equal(ends, 1);
  setup();
  globalThis.fetch = async () => Response.json({ text: '' });
  const empty = new MiniMaxRecognition(config);
  let results = 0;
  empty.onerror = (event) => errors.push(event.error);
  empty.onresult = () => results++;
  empty.start();
  await flush();
  empty.stop();
  await flush();
  await flush();
  assert.equal(results, 0);
  assert.equal(errors.at(-1), 'no-speech');
});
