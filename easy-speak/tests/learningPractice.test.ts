import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { usePractice } from '../src/hooks/usePractice.ts';
import { DEFAULT_SETTINGS, SCENES } from '../src/lib/core.ts';
import type { Review } from '../src/lib/core.ts';
import { createLessonScene, LESSONS } from '../src/lib/lessons.ts';
import { readCorrections } from '../src/lib/learning.ts';

const review: Review = {
  positive: '意思很清楚',
  original: 'I go yesterday.',
  improved: 'I went yesterday.',
  explanation: '过去时',
  tag: '时态',
};
type PendingRequest = {
  messages: { role: string; content: string }[];
  signal: AbortSignal;
  resolve: (response: Response) => void;
};
const response = (content: string) => Response.json({ choices: [{ message: { content } }] });

async function mountPractice(context: TestContext) {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    document: { visibilityState: 'visible' },
  });
  const requests: PendingRequest[] = [],
    notifications: string[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        requests.push({
          messages: JSON.parse(String(init.body)).messages,
          signal: init.signal as AbortSignal,
          resolve,
        });
      }),
  );
  let practice!: ReturnType<typeof usePractice>;
  function Harness() {
    practice = usePractice(
      {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        autoSpeak: false,
      },
      (message) => notifications.push(message),
    );
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  return {
    get practice() {
      return practice;
    },
    requests,
    notifications,
    unmount: async () => {
      await act(async () => renderer.unmount());
    },
  };
}

test('独立重练只点评用户新尝试，不追加聊天、不推进课程、不污染错题本', async (context) => {
  const harness = await mountPractice(context);
  try {
    const before = harness.practice.messages;
    await act(async () => {
      assert.equal(harness.practice.beginRehearsal('I went yesterday.'), true);
    });
    await act(async () => harness.practice.submit('I went yesterday.'));
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.practice.phase, 'thinking');
    assert.match(harness.requests[0].messages[0].content, /separate rehearsal/);
    assert.equal(harness.requests[0].messages.at(-1)?.content, 'I went yesterday.');
    await act(async () =>
      harness.requests[0].resolve(
        response(JSON.stringify({ ...review, original: '', improved: '' })),
      ),
    );
    assert.deepEqual(harness.practice.messages, before);
    assert.equal(harness.practice.phase, 'ready');
    assert.equal(harness.practice.rehearsal?.result?.positive, review.positive);
    assert.deepEqual(harness.practice.sessions, []);
    assert.deepEqual(readCorrections(), []);
  } finally {
    await harness.unmount();
  }
});

test('取消重练立即恢复，迟到点评不得覆盖后续状态；不覆盖未发送草稿', async (context) => {
  const harness = await mountPractice(context);
  try {
    await act(async () => {
      harness.practice.setDraft('my unfinished draft');
    });
    await act(async () => {
      assert.equal(harness.practice.beginRehearsal('Example.'), false);
    });
    assert.equal(harness.practice.draft, 'my unfinished draft');
    await act(async () => {
      harness.practice.setDraft('');
      harness.practice.beginRehearsal('Example.');
    });
    await act(async () => harness.practice.submit('My attempt.'));
    await act(async () => harness.practice.cancelRehearsal());
    assert.equal(harness.requests[0].signal.aborted, true);
    assert.equal(harness.practice.rehearsal, null);
    assert.equal(harness.practice.phase, 'ready');
    await act(async () => harness.requests[0].resolve(response(JSON.stringify(review))));
    assert.equal(harness.practice.rehearsal, null);
    assert.equal(harness.practice.review, null);
    assert.equal(harness.practice.messages.length, 1);
  } finally {
    await harness.unmount();
  }
});

test('翻译按消息缓存且重复点击不重复请求，切换会话后旧翻译作废', async (context) => {
  const harness = await mountPractice(context);
  try {
    await act(async () => harness.practice.newSession({ ...SCENES[0], translation: '' }));
    const messageId = harness.practice.messages[0].id;
    await act(async () => {
      void harness.practice.translateMessage(messageId);
      void harness.practice.translateMessage(messageId);
    });
    assert.equal(harness.requests.length, 1);
    await act(async () => harness.requests[0].resolve(response('今天过得怎么样？')));
    assert.equal(harness.practice.messages[0].translation, '今天过得怎么样？');
    await act(async () => harness.practice.translateMessage(messageId));
    assert.equal(harness.requests.length, 1);
    await act(async () => harness.practice.newSession({ ...SCENES[0], translation: '' }));
    await act(async () => {
      void harness.practice.translateMessage(harness.practice.messages[0].id);
    });
    await act(async () => harness.practice.newSession(SCENES[1]));
    await act(async () => harness.requests[1].resolve(response('旧的翻译')));
    assert.equal(harness.practice.messages[0].translation, SCENES[1].translation);
    assert.equal(harness.practice.translationLoadingId, '');
  } finally {
    await harness.unmount();
  }
});

test('课程真实会话保存任务信息，点评自动建错题且不会重复录入', async (context) => {
  const harness = await mountPractice(context);
  try {
    await act(async () => harness.practice.newSession(createLessonScene(LESSONS[0])));
    await act(async () => harness.practice.submit('I go yesterday.'));
    const coaching = harness.requests.find((request) =>
      request.messages[0].content.includes('Review ONLY'),
    )!;
    const main = harness.requests.find((request) =>
      request.messages[0].content.includes('a warm, curious adult conversation partner'),
    )!;
    await act(async () => {
      coaching.resolve(response(JSON.stringify(review)));
      main.resolve(response('Thanks for sharing. What happened next?'));
    });
    assert.equal(readCorrections().length, 1);
    const hint = harness.requests.find((request) =>
      request.messages[0].content.includes('LAST ASSISTANT QUESTION'),
    )!;
    await act(async () =>
      hint.resolve(
        response(
          JSON.stringify({
            angle: '继续说说',
            words: [{ en: 'then', zh: '然后' }],
            example: 'Then I went home.',
          }),
        ),
      ),
    );
    assert.equal(harness.practice.sessions[0].lessonId, LESSONS[0].id);
    assert.equal(harness.practice.sessions[0].goalTurns, 3);
    assert.equal(harness.practice.sessions[0].isDemo, false);
    assert.equal(harness.practice.review?.explanation, review.explanation);
  } finally {
    await harness.unmount();
  }
});
