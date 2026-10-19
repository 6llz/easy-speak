import { isRecord } from './core';
import { isLocalMiniMaxUrl, LOCAL_MINIMAX_KEY } from './speechSettings';
import type { SpeechQueue } from './voice';
import {
  languageName,
  languageBase,
  miniMaxSpeechLanguage,
  MINIMAX_ASR_LANGUAGES,
  takeSpeechSentence,
} from './languages';

export type MiniMaxSpeechConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  voiceId: string;
  rate: number;
  languageTag?: string;
  languageBoost?: string;
  recognitionLanguage?: string;
};
type MiniMaxConnection = Pick<
  MiniMaxSpeechConfig,
  'baseUrl' | 'apiKey' | 'recognitionLanguage' | 'languageTag'
>;
const REQUEST_TIMEOUT_MS = 35000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const INVALID_RESPONSE = 'MiniMax 语音返回格式异常，请重试。';

function requestHeaders(config: MiniMaxConnection): Record<string, string> {
  const url = new URL(config.baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !isLocalMiniMaxUrl(config.baseUrl))
  )
    throw new Error('请使用有效的 HTTPS 语音接口地址。');
  if (!config.apiKey.trim()) throw new Error('请在语音设置中填写 MiniMax 密钥。');
  if (config.apiKey === LOCAL_MINIMAX_KEY && !isLocalMiniMaxUrl(config.baseUrl))
    throw new Error('本机语音连接地址无效，请重新选择本机配置。');
  return {
    Authorization: `Bearer ${config.apiKey.trim()}`,
    ...(isLocalMiniMaxUrl(config.baseUrl) ? { 'X-Morrow-Client': '1' } : {}),
  };
}

async function requestSpeechJson(
  config: MiniMaxConnection,
  path: string,
  body: BodyInit,
  headers: Record<string, string>,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/${path}`, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { ...requestHeaders(config), ...headers },
      body,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const messages: Record<number, string> = {
        401: 'MiniMax 密钥无效或已过期。',
        403: 'MiniMax 密钥没有语音访问权限。',
        429: 'MiniMax 语音请求受限，请检查额度或稍后重试。',
      };
      throw new Error(
        messages[response.status] || `MiniMax 语音服务暂时不可用（${response.status}）。`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error(INVALID_RESPONSE);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error('MiniMax 语音响应过大，请缩短本次内容。');
        chunks.push(chunk.value);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      cancel();
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let result: unknown;
    try {
      result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new Error(INVALID_RESPONSE);
    }
    if (!isRecord(result)) throw new Error(INVALID_RESPONSE);
    if (
      result.base_resp !== undefined &&
      (!isRecord(result.base_resp) || result.base_resp.status_code !== 0)
    )
      throw new Error('MiniMax 语音请求失败，请检查密钥、模型权限和可用额度。');
    return result;
  } catch (error) {
    if (signal.aborted) {
      if (externalSignal?.aborted) throw externalSignal.reason;
      throw new Error('MiniMax 语音响应超时，请重试。');
    }
    if (error instanceof TypeError)
      throw new Error('无法连接 MiniMax 语音服务，请检查网络和接口地址。');
    throw error;
  }
}

/** 按所选语言合成一句话；只接受受限的十六进制音频，不使用外部下载地址。 */
export async function synthesizeMiniMaxSpeech(
  text: string,
  config: MiniMaxSpeechConfig,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!text.trim() || text.length >= 10000) throw new Error('语音内容为空或过长，请缩短后重试。');
  if (config.languageTag && !miniMaxSpeechLanguage(config.languageTag))
    throw new Error(
      `MiniMax 暂未支持${languageName(config.languageTag)}朗读，可以改用设备声音或文字交流。`,
    );
  const result = await requestSpeechJson(
    config,
    't2a_v2',
    JSON.stringify({
      model: config.model,
      text,
      stream: false,
      output_format: 'hex',
      language_boost: config.languageBoost || 'English',
      voice_setting: { voice_id: config.voiceId, speed: config.rate, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
    { 'Content-Type': 'application/json' },
    signal,
  );
  if (
    !isRecord(result) ||
    !isRecord(result.data) ||
    result.data.status !== 2 ||
    typeof result.data.audio !== 'string'
  )
    throw new Error(INVALID_RESPONSE);
  const hex = result.data.audio;
  if (!hex.length || hex.length % 2 || hex.length > MAX_AUDIO_BYTES * 2 || !/^[\da-f]+$/i.test(hex))
    throw new Error(INVALID_RESPONSE);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return new Blob([bytes], { type: 'audio/mpeg' });
}

/** 按语言提示或混合识别转写内存 WAV；调用方负责停说检测和麦克风释放。 */
export async function transcribeMiniMaxSpeech(
  audio: Blob,
  config: MiniMaxConnection,
  signal?: AbortSignal,
): Promise<string> {
  if (!audio.size || audio.size > 20 * 1024 * 1024)
    throw new Error('录音为空或过大，请重新说一句。');
  if (config.languageTag && !MINIMAX_ASR_LANGUAGES.has(languageBase(config.languageTag)))
    throw new Error(
      `MiniMax 暂未支持${languageName(config.languageTag)}转写，可以改用浏览器识别或文字交流。`,
    );
  const form = new FormData();
  form.set('model', 'asr-1.0');
  form.set('response_format', 'json');
  form.set('stream', 'false');
  form.set('file', audio, 'speech.wav');
  const result = await requestSpeechJson(
    config,
    'speech_to_text',
    form,
    {
      language:
        config.recognitionLanguage ??
        (config.languageTag ? languageBase(config.languageTag) : 'en'),
    },
    signal,
  );
  if (!isRecord(result) || typeof result.text !== 'string' || result.text.length > 20000)
    throw new Error(INVALID_RESPONSE);
  return result.text.trim();
}

/** 同一回复复用播放器逐句朗读，最多预取下一句；结束或取消释放请求、播放器和临时 URL。 */
export class MiniMaxVoiceQueue implements SpeechQueue {
  private isActive = true;
  private isSealed = false;
  private hasStarted = false;
  private receivedLength = 0;
  private buffer = '';
  private pending: string[] = [];
  private ready: Blob | null = null;
  private isFetching = false;
  private isPlaying = false;
  private playbackVersion = 0;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private config: MiniMaxSpeechConfig,
    private onStart: () => void,
    private onDone: () => void,
    private onError: (message: string) => void,
  ) {}

  /** 接收流式累计全文，只把新增后缀切句，避免每个增量重复合成已朗读的句子。 */
  push(fullText: string): void {
    if (!this.isActive) return;
    this.buffer += fullText.slice(this.receivedLength);
    this.receivedLength = fullText.length;
    let sentence: ReturnType<typeof takeSpeechSentence>;
    while ((sentence = takeSpeechSentence(this.buffer))) {
      this.pending.push(sentence.sentence);
      this.buffer = sentence.rest;
    }
    this.pump();
  }

  /** 标记文字生成完成并提交无句号的尾段；等待所有合成与播放结束后才通知 onDone。 */
  finish(): void {
    if (!this.isActive) return;
    if (this.buffer.trim()) this.pending.push(this.buffer.trim());
    this.buffer = '';
    this.isSealed = true;
    this.pump();
  }

  /** 当前播放与一份预取分离，限制内存 / 合成并发；未封口时不能提前释放整轮。 */
  private pump(): void {
    if (!this.isActive) return;
    if (!this.isPlaying && this.ready) {
      const blob = this.ready;
      this.ready = null;
      this.play(blob);
    }
    if (!this.isActive) return;
    if (!this.isFetching && !this.ready && this.pending.length) {
      const text = this.pending.shift()!.replace(/[*_#]/g, '').trim();
      this.isFetching = true;
      void synthesizeMiniMaxSpeech(text, this.config, this.controller.signal)
        .then((blob) => {
          if (!this.isActive) return;
          this.isFetching = false;
          this.ready = blob;
          this.pump();
        })
        .catch((error: unknown) => {
          if (this.isActive)
            this.fail(error instanceof Error ? error.message : 'MiniMax 语音生成失败，请重试。');
        });
    }
    if (
      this.isSealed &&
      !this.pending.length &&
      !this.isPlaying &&
      !this.ready &&
      !this.isFetching
    ) {
      this.isActive = false;
      this.releaseAudio();
      this.onDone();
    }
  }

  private play(blob: Blob): void {
    try {
      const audio = this.audio ?? new Audio();
      this.audio = audio;
      const playbackVersion = ++this.playbackVersion;
      const isCurrent = () =>
        this.isActive && this.audio === audio && this.playbackVersion === playbackVersion;
      this.isPlaying = true;
      audio.preload = 'auto';
      audio.volume = 1;
      audio.muted = false;
      const previousUrl = this.audioUrl;
      this.audioUrl = URL.createObjectURL(blob);
      audio.src = this.audioUrl;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      this.timer = setTimeout(() => {
        if (isCurrent()) this.fail('浏览器未能启动播放，请点击重听或继续。');
      }, 2500);
      audio.onplaying = () => {
        if (!isCurrent()) return;
        clearTimeout(this.timer);
        if (!this.hasStarted) {
          this.hasStarted = true;
          this.onStart();
        }
        if (!isCurrent()) return;
        const duration = Number.isFinite(audio.duration) ? audio.duration * 1000 : 60000;
        this.timer = setTimeout(
          () => {
            if (isCurrent()) this.fail('语音播放中断，请重听或继续。');
          },
          Math.max(12000, duration + 12000),
        );
      };
      audio.onended = () => {
        if (!isCurrent()) return;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.isPlaying = false;
        // 复用元素时必须按片段作废旧回调，不能只比较播放器对象。
        this.playbackVersion++;
        audio.onplaying = null;
        audio.onended = null;
        audio.onerror = null;
        this.pump();
      };
      audio.onerror = () => {
        if (isCurrent()) this.fail('无法播放 MiniMax 语音，请重试。');
      };
      void audio.play().catch(() => {
        if (isCurrent()) this.fail('浏览器暂停了声音，请点击重听。');
      });
    } catch {
      this.fail('当前设备无法播放语音，可以先阅读文字。');
    }
  }

  /** 只在整轮结束、失败或取消时释放播放器；句间换源由片段版本保护。 */
  private releaseAudio(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.isPlaying = false;
    this.playbackVersion++;
    if (this.audio) {
      this.audio.onplaying = null;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  private fail(message: string): void {
    if (!this.isActive) return;
    this.cancel();
    this.onError(message);
    this.onDone();
  }

  cancel(): void {
    this.isActive = false;
    this.controller.abort();
    this.pending = [];
    this.ready = null;
    this.releaseAudio();
  }
}
