import { useState } from 'react';
import { ArrowLeftRight, Check, Languages } from 'lucide-react';
import { Modal } from './Modal';
import type { Settings } from '../lib/core';
import {
  LANGUAGE_OPTIONS,
  languageName,
  miniMaxRecognitionLanguage,
  miniMaxSpeechLanguage,
  normalizeLanguage,
  validateLanguagePair,
} from '../lib/languages';
import type { LanguagePair } from '../lib/languages';

type LanguagePairPickerProps = { settings: Settings; onApply: (pair: LanguagePair) => void };

/** 应用语言时由页面保存旧会话并启动新组合，表单不接触凭据或媒体。 */
export function LanguagePairPicker({ settings, onApply }: LanguagePairPickerProps) {
  const [pair, setPair] = useState<LanguagePair>({
    supportLanguage: settings.supportLanguage,
    practiceLanguage: settings.practiceLanguage,
  });
  const [error, setError] = useState('');
  const updateLanguage = (key: keyof LanguagePair, value: string) => {
    setPair((previous) => ({ ...previous, [key]: value }));
    setError('');
  };
  const handleApply = () => {
    const validation = validateLanguagePair(pair);
    if (validation) {
      setError(validation);
      return;
    }
    onApply({
      supportLanguage: normalizeLanguage(pair.supportLanguage)!,
      practiceLanguage: normalizeLanguage(pair.practiceLanguage)!,
    });
  };
  return (
    <>
      <div className="settings-body language-picker">
        <LanguageField
          id="support-language"
          label="我熟悉的语言"
          value={pair.supportLanguage}
          description="两个辅导框用这种语言解释和给建议。"
          onChange={(value) => updateLanguage('supportLanguage', value)}
        />
        <button
          className="language-swap"
          aria-label="互换两种语言"
          onClick={() => {
            setPair({
              supportLanguage: pair.practiceLanguage,
              practiceLanguage: pair.supportLanguage,
            });
            setError('');
          }}
        >
          <ArrowLeftRight size={17} />
          互换语言
        </button>
        <LanguageField
          id="practice-language"
          label="想练习的语言"
          value={pair.practiceLanguage}
          description="语伴、表达词组和例句以这种语言交流；你也可以用熟悉的语言求助。"
          onChange={(value) => updateLanguage('practiceLanguage', value)}
        />
        <div className="tip-note">
          <Languages size={16} />
          切换后会保留当前练习记录，并开始一段新对话。语言偏好会在本机保存。
        </div>
        {settings.recognitionProvider === 'browser' ? (
          <p className="field-help">
            浏览器按练习语言识别，可用语言取决于设备。两种语言都可以打字输入。
          </p>
        ) : (
          <p className="field-help">
            {miniMaxRecognitionLanguage(pair) === undefined
              ? 'MiniMax 尚未覆盖这个练习语言的转写，可改用浏览器识别或打字聊。'
              : miniMaxRecognitionLanguage(pair) === ''
                ? 'MiniMax 将自动识别两种语言及混合表达。'
                : 'MiniMax 将按练习语言识别，熟悉的语言仍可打字输入。'}
          </p>
        )}
        {settings.speechProvider === 'minimax' && !miniMaxSpeechLanguage(pair.practiceLanguage) && (
          <p className="field-help">
            MiniMax 尚未覆盖这个语言的朗读，可在语音设置中改选设备声音。文字交流仍可使用。
          </p>
        )}
        {!settings.apiKey.trim() && (
          <p className="field-help">
            本地示范仅支持中文辅助练英语；其他组合需连接模型，效果以所选模型的语言能力为准。
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <span className="muted small">按舒服的方式交流</span>
        <button className="button primary" onClick={handleApply}>
          应用语言
          <Check size={16} />
        </button>
      </div>
    </>
  );
}

function LanguageField({
  id,
  label,
  value,
  description,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  description: string;
  onChange: (value: string) => void;
}) {
  const isCustom = !LANGUAGE_OPTIONS.includes(value);
  return (
    <div className="language-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={isCustom ? 'custom' : value}
        onChange={(event) => onChange(event.target.value === 'custom' ? '' : event.target.value)}
      >
        {LANGUAGE_OPTIONS.map((language) => (
          <option key={language} value={language}>
            {languageName(language)}
          </option>
        ))}
        <option value="custom">其他语言…</option>
      </select>
      {isCustom && (
        <>
          <label className="field-label" htmlFor={`${id}-custom`}>
            语言代码
          </label>
          <input
            id={`${id}-custom`}
            value={value}
            maxLength={64}
            placeholder="例如 sw-KE（斯瓦希里语）"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby={`${id}-description`}
          />
          {normalizeLanguage(value) && <p className="field-help">{languageName(value)}</p>}
        </>
      )}
      <p id={`${id}-description`} className="field-help">
        {description}
      </p>
    </div>
  );
}

export function LanguageDialog({
  settings,
  onApply,
  onClose,
}: LanguagePairPickerProps & { onClose: () => void }) {
  return (
    <Modal
      title="用哪两种语言聊？"
      description="熟悉的语言给你支持，新的语言慢慢说。"
      onClose={onClose}
      className="settings-modal"
    >
      <LanguagePairPicker settings={settings} onApply={onApply} />
    </Modal>
  );
}
