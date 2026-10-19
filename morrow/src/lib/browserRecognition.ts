import { DEFAULT_SPEECH_PAUSE_MS, normalizeSpeechPauseMs } from './speechTiming';
import type { Recognition } from './voice';

type NativeRecognition = Recognition & {
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
};
export type NativeRecognitionConstructor = new () => NativeRecognition;

const MAX_TURN_MS = 60000;
const NO_SPEECH_TIMEOUT_MS = 10000;
const RESTART_DELAY_MS = 200;

/**
 * 将浏览器可能自行结束的多个识别片段合并成一轮发言。
 * 只依据服务的发声、转写和结束事件等待停顿，不推断用户是否说完一句话。
 * 每次结果都返回单条完整转写；abort 静默撤销整轮及所有晚到回调。
 */
export class BrowserRecognition implements Recognition {
  lang = 'en-US';
  continuous = true;
  interimResults = true;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  onstart: Recognition['onstart'] = null;

  private isActive = false;
  private hasStarted = false;
  private isSpeechActive = false;
  private version = 0;
  private completedText = '';
  private segmentText = '';
  private native: NativeRecognition | null = null;
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private maxTurnTimer?: ReturnType<typeof setTimeout>;
  private noSpeechTimer?: ReturnType<typeof setTimeout>;
  private visibilityDocument: Document | null = null;
  private readonly pauseMs: number;

  constructor(
    private readonly NativeConstructor: NativeRecognitionConstructor,
    pauseMs = DEFAULT_SPEECH_PAUSE_MS,
  ) {
    this.pauseMs = normalizeSpeechPauseMs(pauseMs);
  }

  start(): void {
    if (this.isActive) throw new Error('识别已经开始');
    this.isActive = true;
    this.hasStarted = false;
    this.completedText = '';
    this.segmentText = '';
    const version = ++this.version;
    if (typeof document !== 'undefined') {
      this.visibilityDocument = document;
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (this.isHidden()) {
      this.fail('audio-capture', '请返回页面后继续语音练习。');
      return;
    }
    this.maxTurnTimer = setTimeout(() => this.finish(), MAX_TURN_MS);
    this.noSpeechTimer = setTimeout(() => {
      if (this.isCurrent(version) && !this.transcript()) this.fail('no-speech');
    }, NO_SPEECH_TIMEOUT_MS);
    this.startSegment(version);
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.isHidden()) this.abort();
  };

  private isHidden(): boolean {
    return this.visibilityDocument?.visibilityState === 'hidden';
  }

  private isCurrent(version: number, native?: NativeRecognition): boolean {
    return this.isActive && this.version === version && (!native || this.native === native);
  }

  private transcript(): string {
    return [this.completedText, this.segmentText].filter(Boolean).join(' ').trim();
  }

  private emitResult(isFinal: boolean): void {
    const transcript = this.transcript();
    if (transcript) this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript } }] });
  }

  private waitForPause(): void {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
    if (!this.isActive || this.isSpeechActive || !this.transcript()) return;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = undefined;
      this.finish();
    }, this.pauseMs);
  }

  private startSegment(version: number): void {
    if (!this.isCurrent(version)) return;
    if (this.isHidden()) {
      this.abort();
      return;
    }
    try {
      const native = new this.NativeConstructor();
      this.native = native;
      this.segmentText = '';
      this.isSpeechActive = false;
      native.lang = this.lang;
      native.continuous = true;
      native.interimResults = true;
      native.onstart = () => {
        if (!this.isCurrent(version, native) || this.hasStarted) return;
        this.hasStarted = true;
        this.onstart?.();
      };
      native.onspeechstart = () => {
        if (!this.isCurrent(version, native)) return;
        this.isSpeechActive = true;
        clearTimeout(this.silenceTimer);
        this.silenceTimer = undefined;
      };
      native.onspeechend = () => {
        if (!this.isCurrent(version, native)) return;
        this.isSpeechActive = false;
        this.waitForPause();
      };
      native.onresult = (event) => {
        if (!this.isCurrent(version, native)) return;
        // 原生 results 是当前片段的累计快照，必须替换，不能把 interim/final 再次追加。
        this.segmentText = Array.from(event.results)
          .map((result) => result[0].transcript.trim())
          .filter(Boolean)
          .join(' ');
        if (this.transcript()) clearTimeout(this.noSpeechTimer);
        this.emitResult(false);
        if (this.isCurrent(version, native)) this.waitForPause();
      };
      native.onerror = (event) => {
        if (!this.isCurrent(version, native)) return;
        // 某些服务在已识别片段之后发 no-speech；仍保留停顿窗口等待续说。
        if (event.error === 'no-speech' && this.transcript()) this.endSegment(version, native);
        else this.fail(event.error, event.message);
      };
      native.onend = () => this.endSegment(version, native);
      native.start();
    } catch (error: unknown) {
      if (!this.isCurrent(version)) return;
      this.fail(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'not-allowed'
          : 'audio-capture',
        this.transcript() ? '语音识别未能继续，已保留文字，可以重试或直接发送。' : undefined,
      );
    }
  }

  private endSegment(version: number, native: NativeRecognition): void {
    if (!this.isCurrent(version, native)) return;
    this.completedText = this.transcript();
    this.segmentText = '';
    this.releaseNative('abort');
    this.isSpeechActive = false;
    if (!this.completedText) {
      this.fail('no-speech');
      return;
    }
    // 不以原生 onend 作为用户轮次结束，也不反复延长已有的静默期限。
    if (!this.silenceTimer) this.waitForPause();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.startSegment(version);
    }, RESTART_DELAY_MS);
  }

  /** 人工停止立即使用当前转写结束；暂停或挂断应调用 abort。 */
  stop(): void {
    this.finish();
  }

  private finish(): void {
    if (!this.isActive) return;
    if (!this.transcript()) {
      this.fail('no-speech');
      return;
    }
    this.emitResult(true);
    if (!this.isActive) return;
    this.cleanup('stop');
    this.onend?.();
  }

  private fail(error: string, message?: string): void {
    if (!this.isActive) return;
    this.cleanup('abort');
    this.onerror?.({ error, message });
    this.onend?.();
  }

  private releaseNative(method: 'stop' | 'abort'): void {
    const native = this.native;
    this.native = null;
    if (!native) return;
    native.onstart = native.onresult = native.onerror = native.onend = null;
    native.onspeechstart = native.onspeechend = null;
    try {
      native[method]();
    } catch {
      // 部分浏览器在服务已结束时再次 stop/abort 会抛错；回调与定时器已撤销。
    }
  }

  private cleanup(method: 'stop' | 'abort'): void {
    this.isActive = false;
    this.version++;
    clearTimeout(this.silenceTimer);
    clearTimeout(this.restartTimer);
    clearTimeout(this.maxTurnTimer);
    clearTimeout(this.noSpeechTimer);
    this.silenceTimer = this.restartTimer = this.maxTurnTimer = this.noSpeechTimer = undefined;
    this.isSpeechActive = false;
    this.visibilityDocument?.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.visibilityDocument = null;
    this.releaseNative(method);
  }

  abort(): void {
    this.cleanup('abort');
  }
}
