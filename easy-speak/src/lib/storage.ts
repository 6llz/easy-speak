import { DEFAULT_SETTINGS, isRecord, MAX_SAVED_PHRASES, MAX_SESSIONS, PROVIDERS } from './core';
import type { Message, Settings } from './core';
import { readLanguagePair } from './languages';
import type { LanguagePair } from './languages';
import { normalizeSpeechPauseMs } from './speechTiming';

export type Session = Partial<LanguagePair> & {
  id: string;
  date: string;
  scene: string;
  title: string;
  duration: number;
  messages: Message[];
  words: number;
  lessonId?: string;
  goalTurns?: number;
  isDemo?: boolean;
};
export type SavedPhrase = Partial<LanguagePair> & {
  id: string;
  en: string;
  zh: string;
  date: string;
};
/**
 * 读取命名空间内的 JSON，损坏或禁用存储时返回默认值。
 * 泛型不提供运行时校验；外部数据的调用方应使用 unknown 并在领域入口规范化。
 */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`morrow:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
/** 底层 JSON 存储；传入值须先经过对应领域的白名单，不直接保存 Settings 或第三方响应。 */
export function writeLocal(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(`morrow:${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
/** 读取与写入共用字段白名单；未定义的配置或凭据字段不能进入长期偏好。 */
function normalizePreferences(storedValue: unknown): Omit<Settings, 'apiKey' | 'speechApiKey'> {
  const value = isRecord(storedValue) ? storedValue : {};
  return {
    ...readLanguagePair(value),
    provider:
      typeof value.provider === 'string' && Object.hasOwn(PROVIDERS, value.provider)
        ? (value.provider as Settings['provider'])
        : DEFAULT_SETTINGS.provider,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : DEFAULT_SETTINGS.baseUrl,
    model: typeof value.model === 'string' ? value.model : DEFAULT_SETTINGS.model,
    hintModel: typeof value.hintModel === 'string' ? value.hintModel : '',
    reviewModel: typeof value.reviewModel === 'string' ? value.reviewModel : '',
    level:
      typeof value.level === 'string' && ['A1', 'A2', 'B1', 'B2', 'C1'].includes(value.level)
        ? value.level
        : DEFAULT_SETTINGS.level,
    rate:
      typeof value.rate === 'number' && Number.isFinite(value.rate)
        ? Math.min(1.25, Math.max(0.65, value.rate))
        : DEFAULT_SETTINGS.rate,
    voice: typeof value.voice === 'string' ? value.voice : '',
    autoSpeak: typeof value.autoSpeak === 'boolean' ? value.autoSpeak : DEFAULT_SETTINGS.autoSpeak,
    autoSubmit:
      typeof value.autoSubmit === 'boolean' ? value.autoSubmit : DEFAULT_SETTINGS.autoSubmit,
    speechPauseMs: normalizeSpeechPauseMs(value.speechPauseMs),
    speechProvider: value.speechProvider === 'minimax' ? 'minimax' : 'browser',
    recognitionProvider: value.recognitionProvider === 'minimax' ? 'minimax' : 'browser',
    speechBaseUrl:
      typeof value.speechBaseUrl === 'string'
        ? value.speechBaseUrl
        : DEFAULT_SETTINGS.speechBaseUrl,
    speechModel:
      typeof value.speechModel === 'string' ? value.speechModel : DEFAULT_SETTINGS.speechModel,
    speechVoice:
      typeof value.speechVoice === 'string' ? value.speechVoice : DEFAULT_SETTINGS.speechVoice,
    useLocalMiniMax: value.useLocalMiniMax === true,
  };
}

/** 供应商密钥只从当前会话读取，旧长期存储中的额外字段不参与恢复。 */
export function readSettings(): Settings {
  let apiKey = '';
  let speechApiKey = '';
  try {
    apiKey = sessionStorage.getItem('morrow:key') || '';
    speechApiKey = sessionStorage.getItem('morrow:speech-key') || '';
  } catch {
    // 隐私模式可能禁用存储；没有密钥时安全地进入示范模式。
  }
  return { ...normalizePreferences(readLocal<unknown>('settings', {})), apiKey, speechApiKey };
}

/** 凭据与长期偏好分开保存，拒绝结构类型携带的任意附加字段。 */
export function saveSettings(value: Settings): boolean {
  try {
    sessionStorage.setItem('morrow:key', value.apiKey);
    sessionStorage.setItem('morrow:speech-key', value.speechApiKey);
  } catch {
    return false;
  }
  return writeLocal('settings', normalizePreferences(value));
}

function normalizeSessions(data: unknown): Session[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (s) =>
        isRecord(s) &&
        typeof s.id === 'string' &&
        typeof s.date === 'string' &&
        typeof s.title === 'string' &&
        typeof s.scene === 'string' &&
        typeof s.words === 'number' &&
        Number.isFinite(s.words) &&
        typeof s.duration === 'number' &&
        Number.isFinite(s.duration) &&
        Array.isArray(s.messages) &&
        s.messages.every(
          (m: unknown) =>
            isRecord(m) &&
            typeof m.id === 'string' &&
            typeof m.content === 'string' &&
            (m.role === 'user' || m.role === 'assistant'),
        ),
    )
    .slice(0, MAX_SESSIONS)
    .map((session) => ({
      id: session.id,
      date: session.date,
      title: session.title,
      scene: session.scene,
      words: Math.max(0, session.words),
      duration: Math.max(0, session.duration),
      ...readLanguagePair(session),
      messages: session.messages.map((message: Message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        translation: typeof message.translation === 'string' ? message.translation : undefined,
        companionName:
          typeof message.companionName === 'string' && message.companionName.trim()
            ? message.companionName.trim().slice(0, 40)
            : undefined,
      })),
      lessonId: typeof session.lessonId === 'string' ? session.lessonId.slice(0, 80) : undefined,
      goalTurns:
        typeof session.goalTurns === 'number' && Number.isFinite(session.goalTurns)
          ? Math.max(1, Math.min(20, Math.round(session.goalTurns)))
          : undefined,
      isDemo: session.isDemo === true,
    }));
}

/** 历史记录经白名单重建，嵌套消息的附加字段也不会进入显示与导出。 */
export function readSessions(): Session[] {
  return normalizeSessions(readLocal<unknown>('sessions', []));
}

/** 所有会话写入复用读取校验，防止未知字段再次持久化。 */
export function saveSessions(sessions: Session[]): boolean {
  return writeLocal('sessions', normalizeSessions(sessions));
}

function normalizePhrases(data: unknown): SavedPhrase[] {
  return Array.isArray(data)
    ? data
        .filter(
          (p) =>
            isRecord(p) &&
            typeof p.id === 'string' &&
            typeof p.en === 'string' &&
            typeof p.zh === 'string' &&
            typeof p.date === 'string',
        )
        .slice(0, MAX_SAVED_PHRASES)
        .map((phrase) => ({
          id: phrase.id,
          en: phrase.en,
          zh: phrase.zh,
          date: phrase.date,
          ...readLanguagePair(phrase),
        }))
    : [];
}

/** 收藏读取与写入均只保留表达、日期及语言字段。 */
export function readPhrases(): SavedPhrase[] {
  return normalizePhrases(readLocal<unknown>('phrases', []));
}

/** 收藏写入使用同一白名单，浏览器配额 / 权限失败时返回 false，由界面报告。 */
export function savePhrases(phrases: SavedPhrase[]): boolean {
  return writeLocal('phrases', normalizePhrases(phrases));
}

/** 导出用户选择的纯文本，稍后撤销 Blob URL；原生包装后的保存 / 分享仍需设备验收。 */
export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
