export const DEFAULT_SPEECH_PAUSE_MS = 3000;
export const SPEECH_PAUSE_OPTIONS = [
  { value: 2000, label: '2 秒 · 较快接话' },
  { value: 3000, label: '3 秒 · 留点思考时间（默认）' },
  { value: 5000, label: '5 秒 · 从容组织句子' },
] as const;

/** 统一旧设置与异常输入的停句时长，避免浏览器和录音实现使用不同阈值。 */
export function normalizeSpeechPauseMs(value: unknown): number {
  return typeof value === 'number' && SPEECH_PAUSE_OPTIONS.some((option) => option.value === value)
    ? value
    : DEFAULT_SPEECH_PAUSE_MS;
}
