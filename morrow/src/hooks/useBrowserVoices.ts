import { useEffect, useState } from 'react';
import { languageBase } from '../lib/languages';

/** 音色面板与设置共用设备音色订阅，切换语言或卸载时释放原监听。 */
export function useBrowserVoices(language: string): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const synthesis = window.speechSynthesis;
    const update = () =>
      setVoices(
        synthesis
          .getVoices()
          .filter((voice) => languageBase(voice.lang) === languageBase(language)),
      );
    update();
    synthesis.addEventListener('voiceschanged', update);
    return () => synthesis.removeEventListener('voiceschanged', update);
  }, [language]);
  return voices;
}
