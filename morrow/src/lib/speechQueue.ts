import type { Settings } from './core';
import { MiniMaxVoiceQueue } from './minimaxSpeech';
import { getSpeechConfig } from './speechSettings';
import { VoiceQueue } from './voice';
import type { SpeechQueue } from './voice';

/** 陪练与音色试听共用同一队列工厂，统一语言选择、取消与播放看门狗。 */
export function createSpeechQueue(
  settings: Settings,
  onStart: () => void,
  onDone: () => void,
  onError: (message?: string) => void,
  language = settings.practiceLanguage,
): SpeechQueue {
  return settings.speechProvider === 'minimax'
    ? new MiniMaxVoiceQueue(
        getSpeechConfig({ ...settings, practiceLanguage: language }),
        onStart,
        onDone,
        onError,
      )
    : new VoiceQueue(settings.rate, settings.voice, onStart, onDone, onError, language);
}
