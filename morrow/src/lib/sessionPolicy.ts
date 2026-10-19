import type { Phase } from '../hooks/usePractice';

export type SessionIntent = 'active' | 'paused' | 'ended';
export type SessionPolicy = {
  intent: SessionIntent;
  isOverlayOpen: boolean;
  isHidden: boolean;
  isTextMode: boolean;
  phase: Phase;
  hasError: boolean;
  hasRecognitionError: boolean;
  hasDraft: boolean;
  hasPendingReply: boolean;
};

/** 用户意图与临时遮挡分开，关闭弹层不会撤销用户明确的暂停或结束。 */
export function getSessionState(
  policy: Pick<SessionPolicy, 'intent' | 'isOverlayOpen' | 'isHidden'>,
): SessionIntent {
  if (policy.intent === 'ended') return 'ended';
  if (policy.intent === 'paused' || policy.isOverlayOpen || policy.isHidden) return 'paused';
  return 'active';
}

/** 所有自动开麦与快捷键都经过同一门控，避免结束后被异步任务重新开启。 */
export function canStartListening(policy: SessionPolicy): boolean {
  return (
    getSessionState(policy) === 'active' &&
    !policy.isTextMode &&
    policy.phase === 'ready' &&
    !policy.hasError &&
    !policy.hasRecognitionError &&
    !policy.hasDraft &&
    !policy.hasPendingReply
  );
}
