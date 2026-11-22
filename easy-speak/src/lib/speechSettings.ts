import { DEFAULT_SETTINGS, PROVIDERS, validateSettings } from './core';
import type { Settings } from './core';
import { readLocal, readSettings } from './storage';
import { miniMaxRecognitionLanguage, miniMaxSpeechLanguage } from './languages';
import { normalizeSpeechPauseMs } from './speechTiming';

export const LOCAL_MINIMAX_KEY = 'morrow-local-credential';
export const LOCAL_MINIMAX_PATH = '/api/v1/minimax';

/** 本机代理只接受同源受限路径；占位值不能被转发到远端充当真实密钥。 */
export function isLocalMiniMaxUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      ['http:', 'https:'].includes(url.protocol) &&
      url.pathname.replace(/\/+$/, '') === LOCAL_MINIMAX_PATH &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function getSpeechConfig(settings: Settings) {
  const isLocal = settings.useLocalMiniMax;
  return {
    baseUrl: isLocal ? settings.baseUrl : settings.speechBaseUrl,
    apiKey: isLocal
      ? LOCAL_MINIMAX_KEY
      : settings.speechApiKey.trim() ||
        (settings.provider === 'minimax' ? settings.apiKey.trim() : ''),
    model: settings.speechModel,
    voiceId: settings.speechVoice,
    rate: settings.rate,
    languageTag: settings.practiceLanguage,
    languageBoost: miniMaxSpeechLanguage(settings.practiceLanguage) || 'auto',
    recognitionLanguage: miniMaxRecognitionLanguage(settings),
    silenceDurationMs: normalizeSpeechPauseMs(settings.speechPauseMs),
  };
}

/** 语音与对话可选择不同供应商，分别验证它们的凭据和接口。 */
export function validateSpeechSettings(settings: Settings): string | null {
  if (settings.speechProvider !== 'minimax' && settings.recognitionProvider !== 'minimax')
    return null;
  const config = getSpeechConfig(settings);
  if (settings.useLocalMiniMax && !isLocalMiniMaxUrl(config.baseUrl))
    return '本机 MiniMax 连接地址无效，请重新选择本机配置。';
  return (
    validateSettings({
      ...settings,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: settings.speechProvider === 'minimax' ? config.model : 'asr-1.0',
    }) ||
    (settings.speechProvider === 'minimax' && !config.voiceId.trim()
      ? '请填写 MiniMax 音色 ID。'
      : null)
  );
}

export function withLocalMiniMax(settings: Settings, origin: string): Settings {
  return {
    ...settings,
    provider: 'minimax',
    baseUrl: `${origin}${LOCAL_MINIMAX_PATH}`,
    model: PROVIDERS.minimax.model,
    apiKey: LOCAL_MINIMAX_KEY,
    hintModel: '',
    reviewModel: '',
    speechProvider: 'minimax',
    recognitionProvider: 'minimax',
    speechModel: DEFAULT_SETTINGS.speechModel,
    speechVoice: DEFAULT_SETTINGS.speechVoice,
    speechApiKey: '',
    useLocalMiniMax: true,
  };
}

/** 首次本地运行读取服务状态；真实密钥始终留在服务端，不进入页面或构建产物。 */
export async function loadInitialSettings(allowLocalMiniMax = true): Promise<Settings> {
  const settings = readSettings();
  if (!allowLocalMiniMax)
    return settings.useLocalMiniMax
      ? {
          ...settings,
          baseUrl: PROVIDERS.minimax.baseUrl,
          apiKey: '',
          speechProvider: 'browser',
          recognitionProvider: 'browser',
          useLocalMiniMax: false,
        }
      : settings;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return settings;
  const stored = readLocal<Record<string, unknown> | null>('settings', null);
  const shouldConnect =
    settings.useLocalMiniMax ||
    (!settings.apiKey &&
      !stored?.useLocalMiniMax &&
      !Object.hasOwn(stored || {}, 'useLocalMiniMax'));
  if (!shouldConnect) return settings;
  try {
    const response = await fetch(`${LOCAL_MINIMAX_PATH}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok && (await response.json()).configured === true)
      return settings.useLocalMiniMax
        ? {
            ...settings,
            baseUrl: `${location.origin}${LOCAL_MINIMAX_PATH}`,
            apiKey: LOCAL_MINIMAX_KEY,
          }
        : withLocalMiniMax(settings, location.origin);
  } catch {
    // 静态托管与未配置本机代理均保留用户偏好，不阻止应用启动。
  }
  return settings;
}
