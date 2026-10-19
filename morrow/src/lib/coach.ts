import {
  CoachResponseError,
  CompletionTruncatedError,
  parseHint,
  parseReview,
  requestChatCompletion,
  REQUEST_TIMEOUT_MS,
} from './core';
import type { Hint, Review, Settings } from './core';

type CoachKind = 'hint' | 'review';
type CoachOptions = { signal?: AbortSignal; model?: string; kind: CoachKind };
type CoachMessage = { role: string; content: string };

const OUTPUT_LIMITS = {
  hint: { initial: 1200, retry: 2000 },
  review: { initial: 1800, retry: 2800 },
};

function coachMessages(
  messages: CoachMessage[],
  kind: CoachKind,
  isFormatRetry: boolean,
): CoachMessage[] {
  const schema =
    kind === 'hint'
      ? '{"angle":"string","words":[{"en":"string","zh":"string"}],"example":"string"}'
      : '{"positive":"string","original":"string","improved":"string","explanation":"string","tag":"string"}';
  const formatRule = `${isFormatRetry ? 'The previous coaching attempt did not pass output validation. Recreate only this coaching result from the same context. ' : ''}Return exactly one complete JSON object matching this structure: ${schema}. Keep every field concise, escape JSON strings correctly, and close all quotes, arrays and objects. Do not add reasoning, code fences, examples of the schema, or text before/after the JSON. Preserve the coaching task and languages in the instructions above.`;
  const systemIndex = messages.findIndex((message) => message.role === 'system');
  if (systemIndex < 0) return [{ role: 'system', content: formatRule }, ...messages];
  return messages.map((message, index) =>
    index === systemIndex ? { ...message, content: `${message.content}\n${formatRule}` } : message,
  );
}

export function requestCoachCompletion(
  settings: Settings,
  messages: CoachMessage[],
  options: CoachOptions & { kind: 'hint' },
): Promise<Hint>;
export function requestCoachCompletion(
  settings: Settings,
  messages: CoachMessage[],
  options: CoachOptions & { kind: 'review' },
): Promise<Review>;
export function requestCoachCompletion(
  settings: Settings,
  messages: CoachMessage[],
  options: CoachOptions,
): Promise<Hint | Review>;
/**
 * 请求独立教练结果并做字段校验；仅格式/截断失败允许一次有限重试。
 * 重试复用同一用户上下文，不把坏回复回传、不追加用户发言；HTTP、超时和取消直接传递。
 * 不强制未知兼容接口接受供应商专有的 JSON/schema 参数。
 */
export async function requestCoachCompletion(
  settings: Settings,
  messages: CoachMessage[],
  options: CoachOptions,
): Promise<Hint | Review> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  for (const isFormatRetry of [false, true]) {
    try {
      signal.throwIfAborted();
      const content = await requestChatCompletion(
        settings,
        coachMessages(messages, options.kind, isFormatRetry),
        {
          signal,
          model: options.model,
          maxTokens: OUTPUT_LIMITS[options.kind][isFormatRetry ? 'retry' : 'initial'],
          ensureComplete: true,
        },
      );
      signal.throwIfAborted();
      return options.kind === 'hint' ? parseHint(content) : parseReview(content);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (timeout.aborted) throw new Error('辅导整理超时，请重试；可以继续对话。');
      if (!(error instanceof CoachResponseError || error instanceof CompletionTruncatedError))
        throw error;
      if (isFormatRetry) {
        const label = options.kind === 'hint' ? '表达提示' : '点评';
        throw new CoachResponseError(`${label}未能完整整理好，请重试；可以继续对话。`);
      }
    }
  }
  throw new CoachResponseError();
}
