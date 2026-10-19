import { languageBase, takeSpeechSentence } from './languages';
import { BrowserRecognition } from './browserRecognition';
import { DEFAULT_SPEECH_PAUSE_MS } from './speechTiming';

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onprocessing?: (() => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export const VOICE_START_TIMEOUT_MS = 2500;

export type SpeechQueue = { push: (text: string) => void; finish: () => void; cancel: () => void };

/** 创建包含停顿等待与片段合并的浏览器识别；缺少设备能力时返回 null。 */
export function createRecognition(
  language = 'en-US',
  pauseMs = DEFAULT_SPEECH_PAUSE_MS,
): Recognition | null {
  const browser = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const RecognitionConstructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  if (!RecognitionConstructor) return null;
  const recognition = new BrowserRecognition(RecognitionConstructor, pauseMs);
  recognition.lang = language;
  return recognition;
}

/**
 * 逐句朗读流式回复。自动播放被浏览器拦截时快速恢复；正常长回复按正在播放的句子计时。
 * 只有生成完成且全部语句结束，才释放本轮；cancel 后的旧回调不会进入下一轮。
 */
export class VoiceQueue {
  private pendingCount = 0;
  private isSealed = false;
  private isActive = true;
  private buffer = '';
  private receivedLength = 0;
  private hasStarted = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private startTimer?: ReturnType<typeof setTimeout>;
  private progressTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private rate: number,
    private voice: string,
    private onStart: () => void,
    private onDone: () => void,
    private onError: () => void,
    private language = 'en-US',
  ) {}

  push(fullText: string): void {
    if (!this.isActive) return;
    this.buffer += fullText.slice(this.receivedLength);
    this.receivedLength = fullText.length;
    let sentence: ReturnType<typeof takeSpeechSentence>;
    while ((sentence = takeSpeechSentence(this.buffer))) {
      this.speak(sentence.sentence);
      this.buffer = sentence.rest;
    }
  }

  finish(): void {
    if (!this.isActive) return;
    if (this.buffer.trim()) this.speak(this.buffer);
    this.buffer = '';
    this.isSealed = true;
    this.checkCompletion();
  }

  private armStartTimeout(): void {
    if (!this.isActive || this.currentUtterance || this.startTimer || !this.pendingCount) return;
    this.startTimer = setTimeout(() => this.fail(), VOICE_START_TIMEOUT_MS);
  }

  private speak(text: string): void {
    if (!this.isActive) return;
    if (!('speechSynthesis' in window)) {
      this.fail();
      return;
    }
    try {
      const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#]/g, '').trim());
      utterance.lang = this.language;
      utterance.rate = this.rate;
      const voices = speechSynthesis.getVoices();
      const matching = voices.filter(
        (candidate) => languageBase(candidate.lang) === languageBase(this.language),
      );
      const selected =
        matching.find((candidate) => candidate.voiceURI === this.voice) ||
        matching.find(
          (candidate) => candidate.lang.toLowerCase() === this.language.toLowerCase(),
        ) ||
        matching[0];
      if (selected) utterance.voice = selected;
      this.pendingCount++;
      let isSettled = false;
      utterance.onstart = () => {
        if (!this.isActive || isSettled) return;
        clearTimeout(this.startTimer);
        this.startTimer = undefined;
        this.currentUtterance = utterance;
        if (!this.hasStarted) {
          this.hasStarted = true;
          this.onStart();
        }
        clearTimeout(this.progressTimer);
        const wordCount =
          typeof Intl.Segmenter === 'function'
            ? Array.from(
                new Intl.Segmenter(this.language, { granularity: 'word' }).segment(utterance.text),
              ).filter((segment) => segment.isWordLike).length
            : Math.max(utterance.text.split(/\s+/).length, utterance.text.length / 4);
        const expectedDuration = (wordCount / (2.2 * Math.max(0.5, this.rate))) * 1000;
        this.progressTimer = setTimeout(
          () => this.fail(),
          Math.max(12000, expectedDuration + 12000),
        );
      };
      const settle = () => {
        if (!this.isActive || isSettled) return;
        isSettled = true;
        this.pendingCount--;
        if (this.currentUtterance === utterance) {
          this.currentUtterance = null;
          clearTimeout(this.progressTimer);
        }
        this.checkCompletion();
        this.armStartTimeout();
      };
      utterance.onend = settle;
      utterance.onerror = () => {
        if (this.isActive && !isSettled) this.fail();
      };
      this.armStartTimeout();
      speechSynthesis.speak(utterance);
    } catch {
      this.fail();
    }
  }

  private checkCompletion(): void {
    if (!this.isActive || !this.isSealed || this.pendingCount !== 0) return;
    this.isActive = false;
    this.clearTimers();
    this.onDone();
  }

  private fail(): void {
    if (!this.isActive) return;
    this.cancel();
    this.onError();
    this.onDone();
  }

  private clearTimers(): void {
    clearTimeout(this.startTimer);
    clearTimeout(this.progressTimer);
    this.startTimer = undefined;
    this.progressTimer = undefined;
  }

  cancel(): void {
    this.isActive = false;
    this.clearTimers();
    this.currentUtterance = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
