import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../lib/core';
import { createSpeechQueue } from '../lib/speechQueue';
import { languageName } from '../lib/languages';
import { voicePreviewText } from '../lib/voicePresets';
import type { SpeechQueue } from '../lib/voice';

/** 试听只保留一个队列；切换、关弹层、后台与卸载全部取消旧合成及播放器。 */
export function useVoicePreview() {
  const queue = useRef<SpeechQueue | null>(null);
  const version = useRef(0);
  const [previewingId, setPreviewingId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const release = useCallback(() => {
    version.current++;
    queue.current?.cancel();
    queue.current = null;
  }, []);
  const stop = useCallback(() => {
    release();
    setPreviewingId('');
    setIsLoading(false);
  }, [release]);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', stop);
    return () => {
      release();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', stop);
    };
  }, [release, stop]);
  const play = (settings: Settings, selectionId: string) => {
    if (selectionId === previewingId) {
      stop();
      return;
    }
    release();
    const currentVersion = version.current;
    setPreviewingId(selectionId);
    setIsLoading(true);
    setError('');
    const player = createSpeechQueue(
      settings,
      () => {
        if (version.current === currentVersion) setIsLoading(false);
      },
      () => {
        if (version.current !== currentVersion) return;
        queue.current = null;
        setPreviewingId('');
        setIsLoading(false);
      },
      (message) => {
        if (version.current === currentVersion)
          setError(message || '当前设备未能播放试听，请允许声音后重试。');
      },
    );
    queue.current = player;
    player.push(
      voicePreviewText(settings.practiceLanguage) ||
        languageName(settings.practiceLanguage, settings.practiceLanguage),
    );
    player.finish();
  };
  return { previewingId, isLoading, error, play, stop };
}
