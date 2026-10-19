import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { useVoicePreview } from '../src/hooks/useVoicePreview.ts';
import { VoicePicker } from '../src/components/VoicePicker.tsx';
import { DEFAULT_SETTINGS } from '../src/lib/core.ts';
import type { Settings } from '../src/lib/core.ts';
import { VOICE_PRESETS } from '../src/lib/voicePresets.ts';
import type { VoiceChoice } from '../src/lib/voicePresets.ts';

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  duration = 1;
  paused = false;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  async play() {
    this.onplaying?.();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = '';
  }
  load() {}
}
function installEnvironment(context: TestContext) {
  FakeAudio.instances = [];
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  const globals = { document, window, Audio: FakeAudio, IS_REACT_ACT_ENVIRONMENT: true };
  const original = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.entries(globals).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }),
  );
  context.after(() =>
    original.forEach((descriptor, key) => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }),
  );
  return { document, window };
}
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  provider: 'minimax',
  apiKey: 'test-key',
  speechProvider: 'minimax',
  practiceLanguage: 'ja-JP',
  speechVoice: 'Japanese_KindLady',
};
const audioResponse = () =>
  Response.json({ base_resp: { status_code: 0 }, data: { status: 2, audio: '494433' } });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('切换试听取消旧合成，迟到音频不能覆盖新音色，后台关闭播放器', async (context) => {
  const environment = installEnvironment(context);
  const requests: {
    signal: AbortSignal;
    body: { voice_setting: { voice_id: string } };
    resolve: (response: Response) => void;
  }[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) =>
        requests.push({
          signal: init.signal as AbortSignal,
          body: JSON.parse(String(init.body)),
          resolve,
        }),
      ),
  );
  let preview!: ReturnType<typeof useVoicePreview>;
  function Harness() {
    preview = useVoicePreview();
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  try {
    await act(async () => preview.play(settings, 'first'));
    assert.equal(preview.isLoading, true);
    await act(async () =>
      preview.play({ ...settings, speechVoice: 'Japanese_GentleButler' }, 'second'),
    );
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(requests[1].body.voice_setting.voice_id, 'Japanese_GentleButler');
    await act(async () => {
      requests[0].resolve(audioResponse());
      await flush();
    });
    assert.equal(preview.previewingId, 'second');
    assert.equal(FakeAudio.instances.length, 0);
    await act(async () => {
      requests[1].resolve(audioResponse());
      await flush();
    });
    assert.equal(preview.isLoading, false);
    assert.equal(FakeAudio.instances.length, 1);
    const lateEnd = FakeAudio.instances[0].onended!;
    await act(async () => {
      environment.document.visibilityState = 'hidden';
      environment.document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(FakeAudio.instances[0].paused, true);
    assert.equal(FakeAudio.instances[0].src, '');
    assert.equal(preview.previewingId, '');
    await act(async () => lateEnd());
    assert.equal(preview.previewingId, '');
    assert.equal(preview.error, '');
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('音色按钮可直接选用，试听不触发选用，关闭面板取消进行中的请求', async (context) => {
  installEnvironment(context);
  let signal: AbortSignal | null = null;
  context.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const choices: VoiceChoice[] = [];
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      createElement(VoicePicker, {
        settings,
        onSelect: (choice) => choices.push(choice),
        onOpenSettings: () => {},
      }),
    );
  });
  try {
    const preset = VOICE_PRESETS.find((voice) => voice.id === 'Japanese_KindLady')!;
    await act(async () =>
      renderer.root
        .findByProps({ 'aria-label': `试听${preset.name}，${preset.description}` })
        .props.onClick(),
    );
    assert.deepEqual(choices, []);
    assert.ok(signal);
    await act(async () =>
      renderer.root
        .findByProps({
          'aria-label': `使用${preset.name}，${preset.description}，${preset.traits.join('、')}，适合${preset.bestFor}`,
        })
        .props.onClick(),
    );
    assert.deepEqual(choices, [{ provider: 'minimax', voiceId: 'Japanese_KindLady' }]);
    assert.equal(signal!.aborted, true);
    await act(async () =>
      renderer.root
        .findByProps({ 'aria-label': `试听${preset.name}，${preset.description}` })
        .props.onClick(),
    );
  } finally {
    await act(async () => renderer.unmount());
  }
  assert.equal(signal!.aborted, true);
});

test('音色卡片呈现独立名字、特点和适用场景，语音 ID 保持兼容', () => {
  const markup = renderToStaticMarkup(
    createElement(VoicePicker, { settings, onSelect: () => {}, onOpenSettings: () => {} }),
  );
  for (const voice of VOICE_PRESETS) {
    assert.ok(markup.includes(voice.name));
    assert.ok(markup.includes(`适合${voice.bestFor}`));
    for (const trait of voice.traits) assert.ok(markup.includes(trait));
  }
  assert.equal(new Set(VOICE_PRESETS.map((voice) => voice.name)).size, VOICE_PRESETS.length);
  assert.ok(VOICE_PRESETS.some((voice) => voice.id === DEFAULT_SETTINGS.speechVoice));
});
