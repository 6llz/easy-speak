import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { useMediaSession } from '../src/hooks/useMediaSession.ts';
import { usePractice } from '../src/hooks/usePractice.ts';
import { DEFAULT_SETTINGS } from '../src/lib/core.ts';
import type { ChatCompletionRequest, Review, Settings } from '../src/lib/core.ts';
import type { Recognition } from '../src/lib/voice.ts';
import { applyVoiceChoice } from '../src/lib/voicePresets.ts';
import type { VoiceChoice } from '../src/lib/voicePresets.ts';
import { createLessonScene, LESSONS } from '../src/lib/lessons.ts';
import { createTrainingDraft, createTrainingScene } from '../src/lib/customTraining.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class FakeUtterance {
  lang = '';
  rate = 1;
  voice = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  isCancelled = false;
  isFinished = false;
  constructor(public text: string) {}
}

class FakeRecognition implements Recognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  onstart: Recognition['onstart'] = null;
  startCount = 0;
  abortCount = 0;
  stopCount = 0;
  start() {
    this.startCount++;
    this.onstart?.();
  }
  abort() {
    this.abortCount++;
    this.onerror?.({ error: 'aborted' });
    this.onend?.();
  }
  stop() {
    this.stopCount++;
    this.onend?.();
  }
  emit(text: string, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  }
  finish() {
    this.onend?.();
  }
}

type PendingRequest = {
  body: ChatCompletionRequest;
  signal: AbortSignal;
  resolve: (response: Response) => void;
};
type HarnessProps = {
  settings: Settings;
  isTextMode: boolean;
  isOverlayOpen: boolean;
  isScreenActive?: boolean;
  preserveReplyOnOverlay?: boolean;
};
type HarnessState = {
  practice: ReturnType<typeof usePractice>;
  media: ReturnType<typeof useMediaSession>;
};

/** 内存 React 渲染器只验证 Hook 生命周期；不连接浏览器、真实权限或供应商。 */
async function mountSession(
  context: TestContext,
  options: Partial<HarnessProps> & { strictMode?: boolean } = {},
) {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const recognitions: FakeRecognition[] = [];
  const utterances: FakeUtterance[] = [];
  const requests: PendingRequest[] = [];
  const notifications: string[] = [];
  const notify = (message: string) => notifications.push(message);
  const synthesis = {
    getVoices: () => [],
    speak: (utterance: FakeUtterance) => utterances.push(utterance),
    cancel: () => utterances.forEach((utterance) => (utterance.isCancelled = true)),
  };
  const window = Object.assign(new EventTarget(), {
    speechSynthesis: synthesis,
    SpeechRecognition: class extends FakeRecognition {
      constructor() {
        super();
        recognitions.push(this);
      }
    },
  });
  const globals = {
    document,
    window,
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    speechSynthesis: synthesis,
    SpeechSynthesisUtterance: FakeUtterance,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        // 允许中止后的旧响应晚到，验证业务版本隔离，而不是依赖供应商必然服从取消。
        requests.push({
          body: JSON.parse(String(init.body)) as ChatCompletionRequest,
          signal: init.signal as AbortSignal,
          resolve,
        });
      }),
  };
  const originalGlobals = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.entries(globals).forEach(([key, value]) => {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  });
  let state: HarnessState | null = null;
  let renderer: ReactTestRenderer | null = null;
  let props: HarnessProps = {
    settings: { ...DEFAULT_SETTINGS, autoSpeak: false },
    isTextMode: false,
    isOverlayOpen: false,
    ...options,
  };
  function Harness(currentProps: HarnessProps) {
    const practice = usePractice(
      currentProps.settings,
      notify,
      currentProps.isScreenActive !== false,
    );
    const media = useMediaSession({
      practice,
      isTextMode: currentProps.isTextMode,
      isOverlayOpen: currentProps.isOverlayOpen,
      isScreenActive: currentProps.isScreenActive,
      preserveReplyOnOverlay: currentProps.preserveReplyOnOverlay,
      isAutoSpeak: currentProps.settings.autoSpeak,
      notify,
    });
    state = { practice, media };
    return null;
  }
  const render = () => {
    const element = createElement(Harness, props);
    return options.strictMode ? createElement(StrictMode, null, element) : element;
  };
  context.after(async () => {
    try {
      await act(async () => renderer?.unmount());
    } finally {
      originalGlobals.forEach((descriptor, key) => {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
  });
  await act(async () => {
    renderer = create(render());
  });
  return {
    document,
    window,
    recognitions,
    utterances,
    requests,
    notifications,
    get state(): HarnessState {
      assert.ok(state);
      return state;
    },
    async update(nextProps: Partial<HarnessProps>) {
      props = { ...props, ...nextProps };
      await act(async () => renderer?.update(render()));
    },
    async changeLanguages(nextSettings: Settings) {
      await act(async () => {
        assert.ok(state);
        state.practice.newSession(state.practice.scene, nextSettings);
        props = { ...props, settings: nextSettings };
        renderer?.update(render());
      });
    },
    async changeVoice(choice: VoiceChoice) {
      await act(async () => {
        assert.ok(state);
        const nextSettings = applyVoiceChoice(props.settings, choice);
        state.practice.updateSpeechSettings(nextSettings);
        props = { ...props, settings: nextSettings };
        renderer?.update(render());
      });
    },
    async advance(milliseconds: number) {
      await act(async () => context.mock.timers.tick(milliseconds));
    },
    async finishSpeech() {
      await act(async () => {
        utterances
          .filter((utterance) => !utterance.isCancelled && !utterance.isFinished)
          .forEach((utterance) => {
            utterance.onstart?.();
            utterance.isFinished = true;
            utterance.onend?.();
          });
      });
    },
    async complete(request: PendingRequest, content: string, status = 200) {
      await act(async () => {
        request.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });
    },
  };
}

const CONNECTED_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  provider: 'custom',
  baseUrl: 'https://model.example/v1',
  apiKey: 'test-only-key',
  model: 'main',
  hintModel: 'hint',
  reviewModel: 'review',
  autoSpeak: false,
};

const review = (label: string): Review => ({
  positive: label,
  original: 'I enjoy walk.',
  improved: 'I enjoy walking.',
  explanation: 'enjoy 后面用动词的 ing 形式。',
  tag: '语法',
});

test('默认语言的自由训练也生成真实开场，主回复和提示沿用材料，切换后旧请求作废', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS, isTextMode: true });
  const training = {
    ...createTrainingDraft(),
    title: '我的面试',
    instructions: '请当面试官，逐个追问我的项目。',
    material: 'Project Aurora: built a booking system.',
  };
  await act(async () => session.state.practice.newSession(createTrainingScene(training)));
  assert.equal(session.state.practice.phase, 'thinking');
  assert.equal(session.state.practice.messages[0].content, '');
  const opening = session.requests.find((request) => request.body.model === 'main')!;
  assert.match(opening.body.messages[0].content, /请当面试官/);
  assert.match(opening.body.messages[0].content, /Project Aurora/);
  assert.match(opening.body.messages[0].content, /en-US/);
  await session.complete(opening, 'What was your main responsibility on Project Aurora?');
  const hint = session.requests.find((request) => request.body.model === 'hint')!;
  assert.match(hint.body.messages[0].content, /Project Aurora/);
  assert.match(hint.body.messages[0].content, /expression coach/);
  await act(async () => session.state.practice.submit('I built the booking flow.'));
  const main = session.requests.filter((request) => request.body.model === 'main').at(-1)!;
  assert.match(main.body.messages[0].content, /Project Aurora/);
  assert.equal(session.requests.filter((request) => request.body.model === 'review').length, 1);
  await act(async () => session.state.practice.newSession());
  const resumed = session.requests.filter((request) => request.body.model === 'main').at(-1)!;
  assert.notEqual(resumed, main);
  assert.equal(main.signal.aborted, true);
  await session.complete(main, 'Outdated custom answer');
  assert.ok(
    !session.state.practice.messages.some((message) => message.content.includes('Outdated')),
  );
});

test('自由训练无模型时不冒充本地示范，连接模型后可重试开场', async (context) => {
  const session = await mountSession(context, { isTextMode: true });
  const training = { ...createTrainingDraft(), instructions: '请陪我聊聊宇宙旅行。' };
  await act(async () => session.state.practice.newSession(createTrainingScene(training)));
  assert.match(session.state.practice.error, /自定义训练需要连接模型/);
  await act(async () => session.state.practice.submit('Hello'));
  assert.equal(session.requests.length, 0);
  assert.equal(
    session.state.practice.messages.filter((message) => message.role === 'user').length,
    0,
  );
  await session.update({ settings: CONNECTED_SETTINGS });
  await act(async () => session.state.practice.retry());
  assert.equal(session.requests.length, 1);
  await session.complete(session.requests[0], 'Where would you travel in space?');
  assert.equal(session.state.practice.messages[0].content, 'Where would you travel in space?');
});

test('对话中开音色面板和切换声音不取消主回复或教练，不重建会话', async (context) => {
  const session = await mountSession(context, {
    settings: { ...CONNECTED_SETTINGS, provider: 'minimax' },
  });
  await act(async () => session.state.practice.submit('I enjoy walk.'));
  const sessionId = session.state.practice.sessionId;
  const userId = session.state.practice.messages.find((message) => message.role === 'user')!.id;
  const main = session.requests.find((request) => request.body.model === 'main')!;
  const coach = session.requests.find((request) => request.body.model === 'review')!;
  await session.update({ isOverlayOpen: true, preserveReplyOnOverlay: true });
  await session.changeVoice({ provider: 'minimax', voiceId: 'English_Graceful_Lady' });
  assert.equal(session.state.practice.companionName, 'Clara');
  assert.equal(main.signal.aborted, false);
  assert.equal(coach.signal.aborted, false);
  assert.equal(session.state.practice.sessionId, sessionId);
  assert.equal(session.state.practice.hasPendingReply, false);
  await session.complete(coach, JSON.stringify(review('点评保留')));
  await session.complete(main, 'What do you like about walking?');
  await session.advance(1000);
  assert.equal(session.recognitions.length, 0);
  assert.equal(session.state.practice.review?.positive, '点评保留');
  assert.equal(
    session.state.practice.messages.filter((message) => message.id === userId).length,
    1,
  );
  const requestCount = session.requests.length;
  await session.update({ isOverlayOpen: false, preserveReplyOnOverlay: false });
  assert.equal(session.requests.length, requestCount);
  assert.equal(session.state.practice.messages.at(-1)?.companionName, '轻松说');
  await act(async () => session.state.practice.submit('I also like hiking.'));
  assert.match(
    session.requests.findLast((request) => request.body.model === 'main')!.body.messages[0].content,
    /You are Clara,/,
  );
});

test('课程未开始的自我介绍随新音色改名，不重建会话或联网', async (context) => {
  const session = await mountSession(context, {
    settings: {
      ...CONNECTED_SETTINGS,
      provider: 'minimax',
      speechProvider: 'minimax',
      speechVoice: 'English_Gentle-voiced_man',
    },
  });
  await act(async () => session.state.practice.newSession(createLessonScene(LESSONS[0])));
  const sessionId = session.state.practice.sessionId;
  assert.match(session.state.practice.messages[0].content, /I’m Noah/);
  await session.changeVoice({ provider: 'minimax', voiceId: 'English_Graceful_Lady' });
  assert.equal(session.state.practice.sessionId, sessionId);
  assert.match(session.state.practice.messages[0].content, /I’m Clara/);
  assert.match(session.state.practice.messages[0].translation || '', /Clara/);
  assert.equal(session.requests.length, 0);
});

test('学习中心返回不撤销暂停和挂断，隐藏页面不重新开麦', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  assert.equal(session.recognitions.length, 1);
  await act(async () => session.state.media.pauseSession());
  await session.update({ isScreenActive: false });
  await session.update({ isScreenActive: true });
  await session.advance(1000);
  assert.equal(session.state.media.sessionState, 'paused');
  assert.equal(session.recognitions.length, 1);
  await act(async () => session.state.media.endSession());
  await session.update({ isScreenActive: false });
  await session.update({ isScreenActive: true });
  await session.advance(1000);
  assert.equal(session.state.media.sessionState, 'ended');
  assert.equal(session.recognitions.length, 1);
});

test('学习中心准备的多语言开场不在隐藏页播放，返回后只播一次再开麦', async (context) => {
  const session = await mountSession(context, {
    settings: {
      ...CONNECTED_SETTINGS,
      autoSpeak: true,
      supportLanguage: 'fr-FR',
      practiceLanguage: 'ja-JP',
    },
    isScreenActive: false,
  });
  await session.advance(0);
  await session.complete(session.requests[0], 'こんにちは。今日はどうでしたか？');
  assert.equal(session.utterances.length, 0);
  assert.equal(session.recognitions.length, 0);
  await session.update({ isScreenActive: true });
  await session.advance(0);
  assert.equal(
    session.utterances.map((utterance) => utterance.text).join(''),
    'こんにちは。今日はどうでしたか？',
  );
  const segmentCount = session.utterances.length;
  assert.equal(session.utterances[0].lang, 'ja-JP');
  await session.finishSpeech();
  await session.advance(400);
  assert.equal(session.utterances.length, segmentCount);
  assert.equal(session.recognitions.length, 1);
});

test('进入即激活陪练，StrictMode 不重复开场，完整开场语音结束后才自动开麦', async (context) => {
  const session = await mountSession(context, {
    settings: { ...DEFAULT_SETTINGS, autoSpeak: true },
    strictMode: true,
  });
  assert.equal(session.state.media.sessionState, 'active');
  assert.equal(session.recognitions.length, 0);
  await session.advance(0);
  assert.equal(session.state.practice.phase, 'speaking');
  assert.ok(session.utterances.length > 0);
  assert.equal(
    session.utterances.map((utterance) => utterance.text).join(' '),
    session.state.practice.scene.greeting,
  );
  await session.advance(800);
  assert.equal(session.recognitions.length, 0);
  await session.finishSpeech();
  assert.equal(session.state.practice.phase, 'ready');
  await session.advance(399);
  assert.equal(session.recognitions.length, 0);
  await session.advance(1);
  assert.equal(session.recognitions.length, 1);
  assert.equal(session.state.practice.phase, 'listening');
});

test('弹层临时中断录音，关闭后自动恢复；用户主动暂停不会被弹层撤销', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  const originalRecognition = session.recognitions[0];
  assert.equal(originalRecognition.startCount, 1);
  await session.update({ isOverlayOpen: true });
  assert.equal(session.state.media.sessionState, 'paused');
  assert.equal(originalRecognition.abortCount, 1);
  await session.advance(1000);
  assert.equal(session.recognitions.length, 1);
  await session.update({ isOverlayOpen: false });
  assert.equal(session.state.media.sessionState, 'active');
  await session.advance(400);
  assert.equal(session.recognitions.length, 2);

  await act(async () => session.state.media.pauseSession());
  await session.update({ isOverlayOpen: true });
  await session.update({ isOverlayOpen: false });
  await act(async () => {
    session.window.dispatchEvent(
      Object.assign(new Event('keydown', { cancelable: true }), { altKey: true, code: 'KeyM' }),
    );
  });
  await session.advance(1000);
  assert.equal(session.state.media.sessionState, 'paused');
  assert.equal(session.recognitions.length, 2);
});

test('结束与 Alt+M 同帧或晚到识别回调，都不会重新开麦或发送草稿', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  const recognition = session.recognitions[0];
  await act(async () => recognition.emit('I was about to say', false));
  const lateResult = recognition.onresult;
  const lateEnd = recognition.onend;
  const shortcut = () =>
    Object.assign(new Event('keydown', { cancelable: true }), { altKey: true, code: 'KeyM' });
  await act(async () => {
    session.state.media.endSession();
    session.window.dispatchEvent(shortcut());
  });
  await act(async () => {
    lateResult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'Late words.' } }],
    });
    lateEnd?.();
    session.window.dispatchEvent(shortcut());
  });
  await session.advance(1500);
  assert.equal(session.state.media.sessionState, 'ended');
  assert.equal(session.state.practice.phase, 'ready');
  assert.equal(session.state.practice.draft, '');
  assert.equal(session.recognitions.length, 1);
  assert.equal(
    session.state.practice.messages.filter((message) => message.role === 'user').length,
    0,
  );
  assert.equal(session.requests.length, 0);
});

test('暂停保留未发送转写，继续时不覆盖；放弃草稿后才重新自动开麦', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  await act(async () => session.recognitions[0].emit('I would like to', false));
  await act(async () => session.state.media.pauseSession());
  assert.equal(session.state.practice.draft, 'I would like to');
  await act(async () => session.state.media.resumeSession());
  await session.advance(800);
  assert.equal(session.recognitions.length, 1);
  assert.equal(session.state.practice.draft, 'I would like to');
  await act(async () => session.state.practice.setDraft(''));
  await session.advance(400);
  assert.equal(session.recognitions.length, 2);
  await act(async () => {
    session.recognitions[1].emit('I enjoy cooking.');
  });
  await session.advance(3000);
  assert.deepEqual(
    session.state.practice.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content),
    ['I enjoy cooking.'],
  );
});

test('文字模式停止录音并保留草稿，清空后切回语音自动续接', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  await act(async () => session.recognitions[0].emit('Let me think', false));
  await session.update({ isTextMode: true });
  assert.equal(session.state.media.sessionState, 'active');
  assert.equal(session.state.practice.phase, 'ready');
  assert.equal(session.state.practice.draft, 'Let me think');
  assert.equal(session.recognitions[0].abortCount, 1);
  await act(async () => session.state.practice.setDraft(''));
  await session.update({ isTextMode: false });
  await session.advance(400);
  assert.equal(session.recognitions.length, 2);
});

test('后台停止语音并阻止快捷键，回到前台恢复自动聆听', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  await act(async () => {
    session.document.visibilityState = 'hidden';
    session.document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(session.state.media.sessionState, 'paused');
  assert.equal(session.recognitions[0].abortCount, 1);
  await act(async () => {
    session.window.dispatchEvent(
      Object.assign(new Event('keydown', { cancelable: true }), { altKey: true, code: 'KeyM' }),
    );
  });
  await session.advance(1000);
  assert.equal(session.recognitions.length, 1);
  await act(async () => {
    session.document.visibilityState = 'visible';
    session.document.dispatchEvent(new Event('visibilitychange'));
  });
  await session.advance(400);
  assert.equal(session.state.media.sessionState, 'active');
  assert.equal(session.recognitions.length, 2);
});

test('pagehide 独立到达也会中断开麦，pageshow 后才允许恢复', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  await act(async () => session.window.dispatchEvent(new Event('pagehide')));
  await session.advance(1000);
  assert.equal(session.state.media.sessionState, 'paused');
  assert.equal(session.state.practice.phase, 'ready');
  assert.equal(session.recognitions[0].abortCount, 1);
  assert.equal(session.recognitions.length, 1);
  await act(async () => session.window.dispatchEvent(new Event('pageshow')));
  await session.advance(400);
  assert.equal(session.state.media.sessionState, 'active');
  assert.equal(session.recognitions.length, 2);
});

test('权限拒绝后保持暂停，用户点击继续在同次手势中重新申请开麦', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  await act(async () => {
    session.recognitions[0].onerror?.({ error: 'not-allowed' });
    session.recognitions[0].finish();
  });
  assert.equal(session.state.media.sessionState, 'paused');
  assert.equal(session.state.practice.recognitionError, 'not-allowed');
  await session.advance(1000);
  assert.equal(session.recognitions.length, 1);
  await act(async () => session.state.media.resumeSession());
  assert.equal(session.recognitions.length, 2);
  assert.equal(session.state.media.sessionState, 'active');
  assert.equal(session.state.practice.recognitionError, '');
  assert.equal(session.state.practice.phase, 'listening');
});

test('暂停中的请求恢复原用户轮次，取消的旧回复晚到也不会覆盖新回复', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS, isTextMode: true });
  await act(async () => session.state.practice.submit('I went for a walk.'));
  const originalMain = session.requests.find((request) => request.body.model === 'main');
  assert.ok(originalMain);
  assert.equal(session.state.practice.phase, 'thinking');
  await act(async () => session.state.media.pauseSession());
  assert.equal(originalMain.signal.aborted, true);
  assert.equal(session.state.practice.hasPendingReply, true);
  assert.equal(session.state.practice.messages.at(-1)?.role, 'user');
  assert.ok(session.state.practice.messages.every((message) => message.content.trim()));
  await act(async () => session.state.media.resumeSession());
  const mainRequests = session.requests.filter((request) => request.body.model === 'main');
  assert.equal(mainRequests.length, 2);
  const resumedMain = mainRequests[1];
  assert.equal(resumedMain.body.messages.filter((message) => message.role === 'user').length, 1);
  await session.complete(resumedMain, 'A fresh answer.');
  await session.complete(originalMain, 'An outdated answer.');
  assert.equal(session.state.practice.messages.at(-1)?.content, 'A fresh answer.');
  assert.equal(session.state.practice.hasPendingReply, false);
  assert.equal(
    session.state.practice.messages.filter((message) => message.role === 'user').length,
    1,
  );
  assert.equal(session.state.practice.phase, 'ready');
});

test('点评重试按最新请求独立更新，旧成功或旧失败不能清空加载态或覆盖点评', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS, isTextMode: true });
  await act(async () => session.state.practice.submit('I enjoy walk.'));
  await act(async () => {
    session.state.practice.retryReview();
    session.state.practice.retryReview();
  });
  const reviews = session.requests.filter((request) => request.body.model === 'review');
  assert.equal(reviews.length, 3);
  assert.equal(reviews[0].signal.aborted, true);
  assert.equal(reviews[1].signal.aborted, true);
  assert.equal(reviews[2].signal.aborted, false);
  assert.equal(
    session.requests.find((request) => request.body.model === 'main')!.signal.aborted,
    false,
  );
  await session.complete(reviews[0], JSON.stringify(review('旧点评')));
  assert.equal(session.state.practice.review, null);
  assert.equal(session.state.practice.isReviewLoading, true);
  await session.complete(reviews[1], 'bad response', 401);
  assert.equal(session.state.practice.reviewError, '');
  assert.equal(session.state.practice.isReviewLoading, true);
  await session.complete(reviews[2], JSON.stringify(review('最新点评')));
  assert.equal(session.state.practice.review?.positive, '最新点评');
  assert.equal(session.state.practice.isReviewLoading, false);
  assert.equal(session.state.practice.reviewError, '');
});

test('主回复失败后重试保留同轮点评，慢点评仍能完成且不重复用户发言', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS, isTextMode: true });
  await act(async () => session.state.practice.submit('I enjoy walk.'));
  const main = session.requests.find((request) => request.body.model === 'main')!;
  const coach = session.requests.find((request) => request.body.model === 'review')!;
  await session.complete(main, 'unavailable', 503);
  assert.ok(session.state.practice.error);
  assert.equal(session.state.practice.isReviewLoading, true);

  await act(async () => session.state.practice.retry());
  assert.equal(coach.signal.aborted, false);
  assert.equal(session.requests.filter((request) => request.body.model === 'review').length, 1);
  const retriedMain = session.requests.filter((request) => request.body.model === 'main').at(-1)!;
  await session.complete(retriedMain, 'Where do you like to walk?');
  await session.complete(coach, JSON.stringify(review('仍然有效的点评')));
  assert.equal(session.state.practice.review?.positive, '仍然有效的点评');
  assert.equal(session.state.practice.isReviewLoading, false);
  assert.equal(session.state.practice.error, '');
  assert.equal(
    session.state.practice.messages.filter((message) => message.role === 'user').length,
    1,
  );
});

test('提示重试取消上一条提示请求，保留独立点评且旧提示不能覆盖新内容', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS, isTextMode: true });
  await act(async () => session.state.practice.submit('I enjoy walking.'));
  const main = session.requests.find((request) => request.body.model === 'main')!;
  const coach = session.requests.find((request) => request.body.model === 'review')!;
  await session.complete(main, 'Where do you like to walk?');
  const originalHint = session.requests.find((request) => request.body.model === 'hint')!;
  await act(async () => session.state.practice.retryHint());
  const newHint = session.requests.filter((request) => request.body.model === 'hint').at(-1)!;
  assert.equal(originalHint.signal.aborted, true);
  assert.equal(newHint.signal.aborted, false);
  assert.equal(coach.signal.aborted, false);
  const hint = (angle: string) =>
    JSON.stringify({
      angle,
      words: [{ en: 'nearby', zh: '附近' }],
      example: 'I like the nearby park.',
    });
  await session.complete(originalHint, hint('旧提示'));
  assert.equal(session.state.practice.isHintLoading, true);
  await session.complete(newHint, hint('新提示'));
  await session.complete(coach, JSON.stringify(review('独立点评')));
  assert.equal(session.state.practice.hint.angle, '新提示');
  assert.equal(session.state.practice.isHintLoading, false);
  assert.equal(session.state.practice.review?.positive, '独立点评');
});

test('等待回复时静音只取消语音队列，保留主回复与两个辅导请求，生成结束后才重新开麦', async (context) => {
  const settings = { ...CONNECTED_SETTINGS, autoSpeak: true };
  const session = await mountSession(context, { settings });
  await session.advance(0);
  await session.finishSpeech();
  const greetingUtterances = session.utterances.length;
  await session.advance(400);
  await act(async () => {
    session.recognitions[0].emit('I took a walk.');
  });
  await session.advance(3000);
  assert.equal(session.state.practice.phase, 'thinking');
  const main = session.requests.find((request) => request.body.model === 'main');
  const reviewRequest = session.requests.find((request) => request.body.model === 'review');
  assert.ok(main);
  assert.ok(reviewRequest);

  // 对应 App 的静音操作：先取消本轮语音，再保存 autoSpeak=false；不取消内容请求。
  await act(async () => session.state.practice.stopSpeaking());
  await session.update({ settings: { ...settings, autoSpeak: false } });
  await session.advance(800);
  assert.equal(session.state.practice.phase, 'thinking');
  assert.equal(main.signal.aborted, false);
  assert.equal(reviewRequest.signal.aborted, false);
  assert.equal(session.recognitions.length, 1);
  assert.equal(session.utterances.length, greetingUtterances);

  await session.complete(main, 'That sounds lovely. Where did you go?');
  const hint = session.requests.find((request) => request.body.model === 'hint');
  assert.ok(hint);
  assert.equal(hint.signal.aborted, false);
  await session.complete(reviewRequest, JSON.stringify(review('点评正常更新')));
  await session.complete(
    hint,
    JSON.stringify({
      angle: '描述你散步经过的地方。',
      words: [
        { en: 'nearby park', zh: '附近公园' },
        { en: 'fresh air', zh: '新鲜空气' },
        { en: 'a quiet path', zh: '安静的小路' },
      ],
      example: 'I walked through a nearby park and enjoyed the fresh air.',
    }),
  );
  assert.equal(session.state.practice.phase, 'ready');
  assert.equal(session.state.practice.review?.positive, '点评正常更新');
  assert.equal(session.state.practice.hint.angle, '描述你散步经过的地方。');
  assert.equal(session.utterances.length, greetingUtterances);
  await session.advance(400);
  assert.equal(session.recognitions.length, 2);
  assert.equal(session.state.practice.phase, 'listening');
  await act(async () => session.state.practice.stopSpeaking());
  assert.equal(session.state.practice.phase, 'listening');
});

test('聆听时点示范只中断录音，保留未发送转写并拒绝旧识别回调', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  const recognition = session.recognitions[0];
  await act(async () => recognition.emit('My own unfinished thought', false));
  const lateResult = recognition.onresult,
    lateEnd = recognition.onend;
  let wasSpoken = false;
  await act(async () => {
    wasSpoken = session.state.media.speakOnDemand('A useful sample sentence.');
  });
  assert.equal(wasSpoken, true);
  assert.equal(recognition.abortCount, 1);
  assert.equal(session.state.practice.phase, 'speaking');
  assert.equal(session.state.practice.draft, 'My own unfinished thought');
  await act(async () => {
    lateResult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'Wrong late transcript.' } }],
    });
    lateEnd?.();
  });
  assert.equal(session.state.practice.draft, 'My own unfinished thought');
  assert.equal(
    session.state.practice.messages.filter((message) => message.role === 'user').length,
    0,
  );
  await session.finishSpeech();
  await session.advance(1000);
  assert.equal(session.recognitions.length, 1);
  await act(async () => session.state.practice.setDraft(''));
  await session.advance(400);
  assert.equal(session.recognitions.length, 2);
});

test('无草稿时听完示范自动回到聆听，结束后显式示范也不能重新播放', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  await act(async () => session.state.media.speakOnDemand('Listen to this example.'));
  await session.advance(800);
  assert.equal(session.recognitions.length, 1);
  await session.finishSpeech();
  await session.advance(399);
  assert.equal(session.recognitions.length, 1);
  await session.advance(1);
  assert.equal(session.recognitions.length, 2);
  await act(async () => session.state.media.endSession());
  const utteranceCount = session.utterances.length;
  let wasSpoken = true;
  await act(async () => {
    wasSpoken = session.state.media.speakOnDemand('Do not play after ending.');
  });
  assert.equal(wasSpoken, false);
  assert.equal(session.utterances.length, utteranceCount);
});

test('打开弹层打断示范后恢复相同例句，不意外换成主对话开场', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  await act(async () => session.state.media.speakOnDemand('The exact sample I was listening to.'));
  await session.update({ isOverlayOpen: true });
  await session.update({ isOverlayOpen: false });
  assert.equal(session.utterances.at(-1)?.text, 'The exact sample I was listening to.');
  await session.finishSpeech();
});

test('StrictMode 下单次保存只写入一次，存储失败只提示一次', async (context) => {
  const session = await mountSession(context, {
    settings: CONNECTED_SETTINGS,
    isTextMode: true,
    strictMode: true,
  });
  await act(async () => session.state.practice.submit('A draft session to preserve.'));
  const write = context.mock.method(localStorage, 'setItem', () => {
    throw new Error('quota');
  });
  await act(async () => session.state.practice.saveSession());
  assert.equal(write.mock.callCount(), 1);
  assert.equal(
    session.notifications.filter((message) => message.includes('存储空间不足')).length,
    1,
  );
  assert.equal(session.state.practice.sessions.length, 1);
});

test('主回复完成后的示范与暂停保留独立辅导请求，两区仍能各自更新', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS });
  await session.advance(400);
  await act(async () => {
    session.recognitions[0].emit('I enjoy cooking.');
  });
  await session.advance(3000);
  const main = session.requests.find((request) => request.body.model === 'main');
  const reviewRequest = session.requests.find((request) => request.body.model === 'review');
  assert.ok(main);
  assert.ok(reviewRequest);
  await session.complete(main, 'What do you like to cook?');
  const hint = session.requests.find((request) => request.body.model === 'hint');
  assert.ok(hint);
  await session.advance(400);
  await act(async () => session.state.media.speakOnDemand('I love making pasta.'));
  assert.equal(hint.signal.aborted, false);
  assert.equal(reviewRequest.signal.aborted, false);
  await session.finishSpeech();
  await act(async () => session.state.media.pauseSession());
  assert.equal(hint.signal.aborted, false);
  assert.equal(reviewRequest.signal.aborted, false);
  await session.complete(reviewRequest, JSON.stringify(review('暂停也保留这句点评')));
  await session.complete(
    hint,
    JSON.stringify({
      angle: '聊聊喜欢做的菜。',
      words: [{ en: 'homemade pasta', zh: '自制意面' }],
      example: 'I love making homemade pasta.',
    }),
  );
  assert.equal(session.state.practice.review?.positive, '暂停也保留这句点评');
  assert.equal(session.state.practice.hint.angle, '聊聊喜欢做的菜。');
  assert.equal(session.state.media.sessionState, 'paused');
});

test('识别服务静默结束时暂停而不是反复自动开麦', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  await act(async () => session.recognitions[0].finish());
  assert.equal(session.state.media.sessionState, 'paused');
  assert.equal(session.state.practice.recognitionError, 'no-speech');
  await session.advance(10000);
  assert.equal(session.recognitions.length, 1);
  assert.equal(session.notifications.filter((message) => message.includes('没有听到')).length, 1);
});

test('浏览器提前结束片段仍等待续说，合并成一条完整用户发言后才请求主回复', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS });
  await session.advance(400);
  await act(async () => {
    session.recognitions[0].emit('I would like');
    session.recognitions[0].finish();
  });
  assert.equal(session.requests.length, 0);
  assert.equal(session.state.practice.phase, 'listening');
  await session.advance(200);
  assert.equal(session.recognitions.length, 2);
  await act(async () => session.recognitions[1].emit('to travel to Rome.'));
  await session.advance(2999);
  assert.equal(session.requests.length, 0);
  assert.equal(session.state.practice.draft, 'I would like to travel to Rome.');
  await session.advance(1);
  assert.equal(session.state.practice.phase, 'thinking');
  assert.deepEqual(
    session.state.practice.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content),
    ['I would like to travel to Rome.'],
  );
  assert.equal(session.requests.filter((request) => request.body.model === 'main').length, 1);
  assert.equal(session.requests.filter((request) => request.body.model === 'review').length, 1);
});

test('新一句点评失败不会显示上一句的肯定或纠错，格式修复只重试点评', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS, isTextMode: true });
  await act(async () => session.state.practice.submit('I enjoy walk.'));
  await session.complete(
    session.requests.find((request) => request.body.model === 'review')!,
    JSON.stringify(review('上一句肯定')),
  );
  await session.complete(
    session.requests.find((request) => request.body.model === 'main')!,
    'Where do you walk?',
  );
  assert.equal(session.state.practice.review?.positive, '上一句肯定');
  await act(async () => session.state.practice.submit('Usually near home.'));
  assert.equal(session.state.practice.review, null);
  const current = session.requests.filter((request) => request.body.model === 'review').at(-1)!;
  await session.complete(current, 'not valid JSON');
  const repair = session.requests.filter((request) => request.body.model === 'review').at(-1)!;
  assert.notEqual(repair, current);
  assert.equal(session.state.practice.isReviewLoading, true);
  assert.equal(session.state.practice.reviewError, '');
  await session.complete(repair, 'still invalid');
  assert.equal(session.state.practice.review, null);
  assert.equal(session.state.practice.isReviewLoading, false);
  assert.match(session.state.practice.reviewError, /未能完整整理/);
  assert.equal(session.requests.filter((request) => request.body.model === 'main').length, 2);
});

test('超长发言保留完整草稿并提示精简，不静默截断后发送', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS, isTextMode: true });
  const longUtterance = 'An unabridged thought. '.repeat(200);
  await act(async () => session.state.practice.submit(longUtterance));
  assert.equal(session.state.practice.draft, longUtterance);
  assert.equal(session.requests.length, 0);
  assert.equal(
    session.state.practice.messages.filter((message) => message.role === 'user').length,
    0,
  );
  assert.ok(session.notifications.some((message) => message.includes('原文已保留')));
});

test('非默认语言以真实模型生成开场，StrictMode 只请求一次，识别跟随练习语言', async (context) => {
  const settings = { ...CONNECTED_SETTINGS, supportLanguage: 'fr-FR', practiceLanguage: 'ja-JP' };
  const session = await mountSession(context, { settings, strictMode: true });
  await session.advance(0);
  assert.equal(session.requests.length, 1);
  assert.equal(session.recognitions.length, 0);
  const opening = session.requests[0];
  assert.match(opening.body.messages[0].content, /ja-JP/);
  assert.match(opening.body.messages[0].content, /fr-FR/);
  await session.complete(opening, 'こんにちは。今日はどうですか？');
  assert.ok(session.state.practice.latency !== null && session.state.practice.latency < 5000);
  assert.equal(session.state.practice.messages.length, 1);
  assert.equal(session.state.practice.review, null);
  const hint = session.requests.find((request) => request.body.model === 'hint')!;
  assert.match(hint.body.messages[0].content, /French/);
  await session.complete(
    hint,
    JSON.stringify({
      angle: 'Parlez de votre journée.',
      words: [{ en: '散歩する', zh: 'se promener' }],
      example: '今日は散歩しました。',
    }),
  );
  assert.equal(session.state.practice.hint.words[0].zh, 'se promener');
  await session.advance(400);
  assert.equal(session.recognitions[0].lang, 'ja-JP');
});

test('切换语言保存原语言记录并隔离旧请求，旧回复不能污染新的两区辅导', async (context) => {
  const session = await mountSession(context, { settings: CONNECTED_SETTINGS });
  const oldId = session.state.practice.sessionId;
  await act(async () => session.state.practice.submit('I went for a walk.'));
  const oldMain = session.requests.find((request) => request.body.model === 'main')!;
  const oldReview = session.requests.find((request) => request.body.model === 'review')!;
  await session.changeLanguages({
    ...CONNECTED_SETTINGS,
    supportLanguage: 'en-US',
    practiceLanguage: 'ja-JP',
  });
  assert.notEqual(session.state.practice.sessionId, oldId);
  const record = session.state.practice.sessions.find((item) => item.id === oldId)!;
  assert.equal(record.practiceLanguage, 'en-US');
  assert.equal(record.supportLanguage, 'zh-CN');
  assert.equal(oldMain.signal.aborted, true);
  assert.equal(oldReview.signal.aborted, true);
  await session.complete(oldMain, 'Old English reply.');
  await session.complete(oldReview, JSON.stringify(review('Old review')));
  assert.ok(
    !session.state.practice.messages.some((message) => message.content.includes('Old English')),
  );
  assert.equal(session.state.practice.review, null);
  assert.equal(session.state.practice.hint.words.length, 0);
  const newMain = session.requests.filter((request) => request.body.model === 'main').at(-1)!;
  assert.match(newMain.body.messages[0].content, /Japanese/);
  await session.complete(newMain, 'こんにちは。');
  assert.equal(session.state.practice.messages[0].content, 'こんにちは。');
});

test('其他语言无密钥时明确提示连接模型，不继续伪造英语示范或自动开麦', async (context) => {
  const session = await mountSession(context, {
    settings: {
      ...DEFAULT_SETTINGS,
      autoSpeak: false,
      supportLanguage: 'fr-FR',
      practiceLanguage: 'ja-JP',
    },
  });
  await session.advance(0);
  await session.advance(1000);
  assert.match(session.state.practice.error, /需要连接模型/);
  await act(async () => session.state.practice.retry());
  assert.equal(session.requests.length, 0);
  assert.equal(session.recognitions.length, 0);
  assert.ok(!session.state.practice.messages.some((message) => message.content.includes('Hey!')));
});

test('同一帧到达的转写不会被示例按钮覆盖，确认放弃后才能填入示例', async (context) => {
  const session = await mountSession(context);
  await session.advance(400);
  let isPrepared = true;
  await act(async () => {
    session.recognitions[0].emit('Keep these original words', false);
    isPrepared = session.state.practice.prepareExampleDraft('A suggested replacement.');
  });
  assert.equal(isPrepared, false);
  assert.equal(session.state.practice.draft, 'Keep these original words');
  assert.equal(session.state.practice.phase, 'ready');
  assert.equal(session.recognitions[0].abortCount, 1);
  await act(async () => {
    session.state.practice.setDraft('');
    isPrepared = session.state.practice.prepareExampleDraft('A suggested replacement.');
  });
  assert.equal(isPrepared, true);
  assert.equal(session.state.practice.draft, 'A suggested replacement.');
  assert.equal(
    session.state.practice.messages.filter((message) => message.role === 'user').length,
    0,
  );
});
