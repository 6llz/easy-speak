import { transcribeMiniMaxSpeech } from './minimaxSpeech';
import type { Recognition } from './voice';
import { normalizeSpeechPauseMs } from './speechTiming';

type RecognitionConfig = {
  baseUrl: string;
  apiKey: string;
  recognitionLanguage?: string;
  languageTag?: string;
  silenceDurationMs?: number;
};
const MAX_RECORDING_MS = 60000;
const MAX_RECORDING_BYTES = 12 * 1024 * 1024;

/** 简单停说检测只决定切句；不依据音量评价用户发音或流利度。 */
export class SpeechBoundaryDetector {
  private firstSpeechAt: number | null = null;
  private lastSpeechAt: number | null = null;
  private silenceDurationMs: number;
  constructor(
    private startedAt: number,
    silenceDurationMs?: number,
  ) {
    this.silenceDurationMs = normalizeSpeechPauseMs(silenceDurationMs);
  }
  update(rms: number, now: number): 'continue' | 'finish' | 'no-speech' {
    if (rms >= 0.018) {
      this.firstSpeechAt ??= now;
      this.lastSpeechAt = now;
    }
    if (this.lastSpeechAt === null || this.lastSpeechAt - this.firstSpeechAt! < 150)
      return now - this.startedAt >= 10000 ? 'no-speech' : 'continue';
    if (now - this.startedAt >= MAX_RECORDING_MS) return 'finish';
    return now - this.lastSpeechAt >= this.silenceDurationMs &&
      this.lastSpeechAt - this.firstSpeechAt! >= 150
      ? 'finish'
      : 'continue';
  }
}

/** 浏览器录音容器先解码，再封装为 MiniMax 支持的单声道 PCM16 WAV，避免上传 WebM。 */
export function encodeMonoWav(channels: Float32Array[], sampleRate: number): Blob {
  if (
    !channels.length ||
    !channels[0].length ||
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000
  )
    throw new Error('录音格式无效，请重试。');
  const samples = channels[0].length;
  if (channels.some((channel) => channel.length !== samples))
    throw new Error('录音声道长度不一致。');
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) {
    const average = channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length;
    const sample = Math.max(-1, Math.min(1, Number.isFinite(average) ? average : 0));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

/** 每轮单独录音和转写；abort 覆盖权限、录音、解码及网络各阶段的晚到结果。 */
export class MiniMaxRecognition implements Recognition {
  lang = 'en-US';
  continuous = false;
  interimResults = false;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  onstart: Recognition['onstart'] = null;
  onprocessing: (() => void) | null = null;
  private version = 0;
  private isActive = false;
  private isStopping = false;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Blob[] = [];
  private size = 0;
  private timer?: ReturnType<typeof setInterval>;
  private permissionTimer?: ReturnType<typeof setTimeout>;
  private controller = new AbortController();

  constructor(private config: RecognitionConfig) {}

  start(): void {
    if (this.isActive) throw new Error('识别已经开始');
    this.isActive = true;
    this.isStopping = false;
    this.controller = new AbortController();
    const version = ++this.version;
    void this.capture(version).catch((error: unknown) => {
      if (!this.isCurrent(version)) return;
      this.fail(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'not-allowed'
          : 'audio-capture',
      );
    });
  }

  private isCurrent(version: number): boolean {
    return this.isActive && this.version === version;
  }

  private async capture(version: number): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.fail('audio-capture');
      return;
    }
    this.permissionTimer = setTimeout(() => {
      if (this.isCurrent(version))
        this.fail('audio-capture', '麦克风尚未就绪，请允许权限后点继续。');
    }, 20000);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (!this.isCurrent(version)) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    const context = new AudioContext();
    this.context = context;
    await context.resume();
    if (!this.isCurrent(version)) return;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    this.analyser = analyser;
    this.source = context.createMediaStreamSource(stream);
    this.source.connect(analyser);
    const recorder = new MediaRecorder(stream);
    this.recorder = recorder;
    const detector = new SpeechBoundaryDetector(Date.now(), this.config.silenceDurationMs);
    const waveform = new Float32Array(analyser.fftSize);
    this.chunks = [];
    this.size = 0;
    recorder.ondataavailable = (event) => {
      if (!this.isCurrent(version)) return;
      this.size += event.data.size;
      if (this.size > MAX_RECORDING_BYTES) {
        this.fail('audio-capture', '这段录音过大，请分成短句再说。');
        return;
      }
      if (event.data.size) this.chunks.push(event.data);
    };
    recorder.onerror = () => {
      if (this.isCurrent(version)) this.fail('audio-capture');
    };
    recorder.onstop = () => {
      if (this.isCurrent(version)) void this.transcribe(version, context);
    };
    recorder.start(250);
    clearTimeout(this.permissionTimer);
    this.onstart?.();
    this.timer = setInterval(() => {
      if (!this.isCurrent(version) || this.isStopping) return;
      analyser.getFloatTimeDomainData(waveform);
      const rms = Math.sqrt(
        waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length,
      );
      const boundary = detector.update(rms, Date.now());
      if (boundary === 'finish') this.stop();
      else if (boundary === 'no-speech') this.fail('no-speech');
    }, 100);
  }

  stop(): void {
    if (!this.isActive || this.isStopping) return;
    if (!this.recorder) {
      this.fail('audio-capture');
      return;
    }
    this.isStopping = true;
    clearInterval(this.timer);
    this.onprocessing?.();
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.releaseMicrophone();
  }

  private async transcribe(version: number, context: AudioContext): Promise<void> {
    clearInterval(this.timer);
    this.releaseMicrophone();
    try {
      const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
      this.chunks = [];
      if (!blob.size) {
        this.fail('no-speech');
        return;
      }
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (!this.isCurrent(version)) return;
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
        decoded.getChannelData(index),
      );
      const wav = encodeMonoWav(channels, decoded.sampleRate);
      await this.closeContext();
      if (!this.isCurrent(version)) return;
      const text = await transcribeMiniMaxSpeech(wav, this.config, this.controller.signal);
      if (!this.isCurrent(version)) return;
      if (!text) {
        this.fail('no-speech');
        return;
      }
      this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
      if (!this.isCurrent(version)) return;
      this.isActive = false;
      this.recorder = null;
      this.onend?.();
    } catch (error: unknown) {
      if (this.isCurrent(version))
        this.fail('network', error instanceof Error ? error.message : 'MiniMax 语音转写失败。');
    }
  }

  private releaseMicrophone(): void {
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private async closeContext(): Promise<void> {
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      try {
        await context.close();
      } catch {
        /* 设备已关闭时不覆盖转写结果。 */
      }
    }
  }

  private fail(error: string, message?: string): void {
    if (!this.isActive) return;
    this.abort();
    this.onerror?.({ error, message });
    this.onend?.();
  }

  abort(): void {
    this.isActive = false;
    this.version++;
    clearInterval(this.timer);
    clearTimeout(this.permissionTimer);
    this.controller.abort();
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = null;
    }
    this.chunks = [];
    this.releaseMicrophone();
    void this.closeContext();
  }
}
