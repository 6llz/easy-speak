import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canStartListening, getSessionState } from '../src/lib/sessionPolicy.ts';
import type { SessionPolicy } from '../src/lib/sessionPolicy.ts';

const readyPolicy: SessionPolicy = {
  intent: 'active',
  isOverlayOpen: false,
  isHidden: false,
  isTextMode: false,
  phase: 'ready',
  hasError: false,
  hasRecognitionError: false,
  hasDraft: false,
  hasPendingReply: false,
};

test('进入页面已是可自动聆听状态，无需独立开始动作', () => {
  assert.equal(getSessionState(readyPolicy), 'active');
  assert.equal(canStartListening(readyPolicy), true);
});

test('弹层或后台只是临时中断，不改写用户原有的暂停和结束意图', () => {
  assert.equal(getSessionState({ ...readyPolicy, isOverlayOpen: true }), 'paused');
  assert.equal(getSessionState({ ...readyPolicy, isHidden: true }), 'paused');
  assert.equal(
    getSessionState({ ...readyPolicy, intent: 'paused', isOverlayOpen: false }),
    'paused',
  );
  assert.equal(getSessionState({ ...readyPolicy, intent: 'ended', isOverlayOpen: true }), 'ended');
});

test('暂停、结束、后台、弹层、文字模式都不能由定时器或快捷键重新开麦', () => {
  const blocked = [
    { intent: 'paused' as const },
    { intent: 'ended' as const },
    { isHidden: true },
    { isOverlayOpen: true },
    { isTextMode: true },
  ];
  for (const state of blocked) assert.equal(canStartListening({ ...readyPolicy, ...state }), false);
});

test('听说互斥，未确认的转写和未完成的回复都必须先处理', () => {
  for (const phase of ['listening', 'thinking', 'speaking'] as const)
    assert.equal(canStartListening({ ...readyPolicy, phase }), false);
  for (const state of [
    { hasDraft: true },
    { hasPendingReply: true },
    { hasError: true },
    { hasRecognitionError: true },
  ])
    assert.equal(canStartListening({ ...readyPolicy, ...state }), false);
});
