import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { usePractice } from '../src/hooks/usePractice.ts';
import { DEFAULT_SETTINGS } from '../src/lib/core.ts';
import { MiniMaxRecognition } from '../src/lib/minimaxRecognition.ts';
import { MiniMaxVoiceQueue } from '../src/lib/minimaxSpeech.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
test('MiniMax 录音进入独立转写状态，转写中不接受例句覆盖，最终文字等待确认', async (context) => {
  let recognition!: MiniMaxRecognition;
  context.mock.method(MiniMaxRecognition.prototype, 'start', function (this: MiniMaxRecognition) {
    recognition = this;
  });
  context.mock.method(MiniMaxRecognition.prototype, 'abort', () => {});
  let practice!: ReturnType<typeof usePractice>;
  const messages: string[] = [];
  function Harness() {
    practice = usePractice(
      { ...DEFAULT_SETTINGS, recognitionProvider: 'minimax', autoSubmit: false },
      (message) => messages.push(message),
    );
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  try {
    await act(async () => practice.startListening());
    assert.equal(practice.phase, 'listening');
    await act(async () => recognition.onprocessing?.());
    assert.equal(practice.phase, 'transcribing');
    assert.equal(practice.isTranscribing, true);
    assert.equal(practice.prepareExampleDraft('Example.'), false);
    assert.equal(practice.draft, '');
    await act(async () => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'I had a good day.' } }],
      });
      recognition.onend?.();
    });
    assert.equal(practice.phase, 'ready');
    assert.equal(practice.isTranscribing, false);
    assert.equal(practice.draft, 'I had a good day.');
    assert.equal(practice.messages.length, 1);
    assert.deepEqual(messages, []);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('MiniMax 声音选择进入对应队列，中断会取消该队列', async (context) => {
  const pushed: string[] = [];
  let cancels = 0;
  context.mock.method(MiniMaxVoiceQueue.prototype, 'push', (text: string) => {
    pushed.push(text);
  });
  context.mock.method(MiniMaxVoiceQueue.prototype, 'finish', () => {});
  context.mock.method(MiniMaxVoiceQueue.prototype, 'cancel', () => {
    cancels++;
  });
  let practice!: ReturnType<typeof usePractice>;
  function Harness() {
    practice = usePractice({ ...DEFAULT_SETTINGS, speechProvider: 'minimax' }, () => {});
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  try {
    await act(async () => practice.replay('Hello from MiniMax.'));
    assert.deepEqual(pushed, ['Hello from MiniMax.']);
    assert.equal(practice.phase, 'speaking');
    await act(async () => practice.abort());
    assert.equal(cancels, 1);
    assert.equal(practice.phase, 'ready');
  } finally {
    await act(async () => renderer.unmount());
  }
});
