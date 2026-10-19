import { useState } from 'react';
import { ArrowRight, Check, Headphones, Loader2, Square, Volume2 } from 'lucide-react';
import type { Settings } from '../lib/core';
import { languageBase, languageName, miniMaxSpeechLanguage } from '../lib/languages';
import { applyVoiceChoice, selectedVoiceName, voicePresetsFor } from '../lib/voicePresets';
import type { VoiceChoice } from '../lib/voicePresets';
import { useVoicePreview } from '../hooks/useVoicePreview';
import { useBrowserVoices } from '../hooks/useBrowserVoices';

type VoicePickerProps = {
  settings: Settings;
  onSelect: (choice: VoiceChoice) => void;
  onOpenSettings: () => void;
};

/** 选用与试听分离；只有选用才应用音色，试听沿用独立可取消的队列。 */
export function VoicePicker({ settings, onSelect, onOpenSettings }: VoicePickerProps) {
  const preview = useVoicePreview();
  const deviceVoices = useBrowserVoices(settings.practiceLanguage);
  const [selectionError, setSelectionError] = useState('');
  const selectVoice = (choice: VoiceChoice) => {
    try {
      applyVoiceChoice(settings, choice);
      preview.stop();
      onSelect(choice);
    } catch (error) {
      preview.stop();
      setSelectionError(
        error instanceof Error ? error.message : '音色暂时不可用，请检查语音设置。',
      );
    }
  };
  const previewVoice = (choice: VoiceChoice, selectionId: string) => {
    try {
      const next = applyVoiceChoice(settings, choice);
      setSelectionError('');
      preview.play(next, selectionId);
    } catch (error) {
      preview.stop();
      setSelectionError(error instanceof Error ? error.message : '请先连接语音服务。');
    }
  };
  const voices = voicePresetsFor(settings.practiceLanguage);
  const canUseCloud = !!miniMaxSpeechLanguage(settings.practiceLanguage);
  const hasMatchingPresets = voices.some(
    (voice) => voice.language === languageBase(settings.practiceLanguage),
  );
  return (
    <div className="voice-picker">
      <div className="voice-picker-current">
        <Headphones size={18} />
        <div>
          <span>正在使用</span>
          <strong>{selectedVoiceName(settings)}</strong>
        </div>
        <span>{languageName(settings.practiceLanguage)}</span>
      </div>
      <div className="voice-picker-heading">
        <h3>MiniMax 预设音色</h3>
        <span>{hasMatchingPresets ? '当前语种优先' : '可试听其他音色'}</span>
      </div>
      <p className="voice-picker-note">
        点名称直接切换，点喇叭先试听。试听按当前练习语言朗读，音色原始语种标在卡片上。
      </p>
      {!canUseCloud && (
        <p className="voice-picker-error" role="status">
          MiniMax 暂未支持当前练习语言，可选择下面的设备声音。
        </p>
      )}
      <div className="voice-preset-grid">
        {voices.map((voice, index) => {
          const isSelected =
            settings.speechProvider === 'minimax' && settings.speechVoice === voice.id;
          const choice: VoiceChoice = { provider: 'minimax', voiceId: voice.id };
          return (
            <div className={`voice-preset-card ${isSelected ? 'selected' : ''}`} key={voice.id}>
              <button
                className="voice-preset-select"
                aria-pressed={isSelected}
                disabled={!canUseCloud}
                onClick={() => selectVoice(choice)}
                aria-label={`使用${voice.name}，${voice.description}，${voice.traits.join('、')}，适合${voice.bestFor}`}
              >
                <span className={`voice-avatar voice-avatar-${index % 4}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <strong>{voice.name}</strong>
                  <small>{voice.description}</small>
                  <span className="voice-traits">
                    {voice.traits.map((trait) => (
                      <span key={trait}>{trait}</span>
                    ))}
                  </span>
                  <span className="voice-best-for">适合{voice.bestFor}</span>
                </span>
                {isSelected && <Check size={14} />}
              </button>
              {canUseCloud && (
                <VoicePreviewButton
                  preview={preview}
                  choice={choice}
                  selectionId={voice.id}
                  name={`${voice.name}，${voice.description}`}
                  onPreview={previewVoice}
                />
              )}
            </div>
          );
        })}
      </div>
      {settings.speechProvider === 'minimax' &&
        !voices.some((voice) => voice.id === settings.speechVoice) && (
          <div className="voice-custom-current">
            <span>当前自定义音色</span>
            <code>{settings.speechVoice}</code>
            <VoicePreviewButton
              preview={preview}
              choice={{ provider: 'minimax', voiceId: settings.speechVoice }}
              selectionId={settings.speechVoice}
              name="当前自定义音色"
              onPreview={previewVoice}
            />
          </div>
        )}
      <div className="voice-picker-heading">
        <h3>设备自带声音</h3>
        <span>跟随当前语种</span>
      </div>
      <div className="device-voice-list">
        {[
          { voiceURI: '', name: '自动选择设备声音', lang: settings.practiceLanguage },
          ...deviceVoices,
        ].map((voice) => {
          const choice: VoiceChoice = { provider: 'browser', voiceURI: voice.voiceURI };
          return (
            <div className="device-voice-row" key={voice.voiceURI || 'automatic'}>
              <button
                onClick={() => selectVoice(choice)}
                aria-pressed={
                  settings.speechProvider === 'browser' && settings.voice === voice.voiceURI
                }
              >
                <span>
                  {voice.name}
                  <small>{voice.lang}</small>
                </span>
                {settings.speechProvider === 'browser' && settings.voice === voice.voiceURI && (
                  <Check size={14} />
                )}
              </button>
              <VoicePreviewButton
                preview={preview}
                choice={choice}
                selectionId={`browser:${voice.voiceURI || 'automatic'}`}
                name={voice.name}
                onPreview={previewVoice}
              />
            </div>
          );
        })}
      </div>
      {(selectionError || preview.error) && (
        <p className="voice-picker-error" role="alert">
          {selectionError || preview.error}
        </p>
      )}
      <button
        className="voice-advanced-link"
        onClick={() => {
          preview.stop();
          onOpenSettings();
        }}
      >
        自定义音色与语音设置
        <ArrowRight size={15} />
      </button>
      <p className="voice-picker-note">
        切换只影响后续朗读，聊天记录保留。MiniMax 试听会使用你的语音服务额度。
      </p>
    </div>
  );
}

type VoicePreviewButtonProps = {
  preview: Pick<ReturnType<typeof useVoicePreview>, 'previewingId' | 'isLoading'>;
  choice: VoiceChoice;
  selectionId: string;
  name: string;
  onPreview: (choice: VoiceChoice, selectionId: string) => void;
};
function VoicePreviewButton({
  preview,
  choice,
  selectionId,
  name,
  onPreview,
}: VoicePreviewButtonProps) {
  const isPreviewing = preview.previewingId === selectionId;
  return (
    <button
      className={`voice-preview-button ${isPreviewing ? 'playing' : ''}`}
      aria-label={`${isPreviewing ? '停止试听' : '试听'}${name}`}
      onClick={() => onPreview(choice, selectionId)}
    >
      {isPreviewing ? (
        preview.isLoading ? (
          <Loader2 size={17} className="spin" />
        ) : (
          <Square size={15} />
        )
      ) : (
        <Volume2 size={17} />
      )}
    </button>
  );
}
