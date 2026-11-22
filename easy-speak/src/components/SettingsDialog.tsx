import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  LockKeyhole,
  Palette,
  SlidersHorizontal,
  Volume2,
  Zap,
} from 'lucide-react';
import { requestChatCompletion, PROVIDERS, validateSettings } from '../lib/core';
import type { Provider, Settings } from '../lib/core';
import type { ThemeId } from '../lib/theme';
import { Modal } from './Modal';
import { ThemePicker } from './ThemePicker';
import {
  getSpeechConfig,
  LOCAL_MINIMAX_PATH,
  validateSpeechSettings,
  withLocalMiniMax,
} from '../lib/speechSettings';
import { synthesizeMiniMaxSpeech } from '../lib/minimaxSpeech';
import { languageBase, languageName } from '../lib/languages';
import { useBrowserVoices } from '../hooks/useBrowserVoices';
import {
  applyVoiceChoice,
  companionName,
  voicePresetsFor,
  VOICE_PRESETS,
} from '../lib/voicePresets';
import type { VoiceChoice } from '../lib/voicePresets';
import { VoicePicker } from './VoicePicker';
import { normalizeSpeechPauseMs, SPEECH_PAUSE_OPTIONS } from '../lib/speechTiming';

export type SettingsTab = 'voices' | 'models' | 'voice' | 'theme';
const SETTINGS_TABS: SettingsTab[] = ['voices', 'models', 'voice', 'theme'];

type SettingsDialogProps = {
  settings: Settings;
  allowLocalMiniMax?: boolean;
  selectedTheme: ThemeId;
  initialTab?: SettingsTab;
  onThemeChange: (themeId: ThemeId) => void;
  onSave: (settings: Settings) => void;
  onSelectVoice: (choice: VoiceChoice) => void;
  onClose: () => void;
};

export function SettingsDialog({
  settings,
  allowLocalMiniMax = true,
  selectedTheme,
  initialTab = 'models',
  onThemeChange,
  onSave,
  onSelectVoice,
  onClose,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState(settings);
  const speakerName = companionName(settings);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [connection, setConnection] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const voices = useBrowserVoices(draft.practiceLanguage);
  const [isLocalConfigured, setIsLocalConfigured] = useState(false);
  const [voiceTest, setVoiceTest] = useState<'idle' | 'testing' | 'success'>('idle');
  const tabGroupId = useId();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!allowLocalMiniMax || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname))
      return;
    const statusController = new AbortController();
    void fetch(`${LOCAL_MINIMAX_PATH}/status`, {
      signal: AbortSignal.any([statusController.signal, AbortSignal.timeout(1500)]),
    })
      .then(async (response) => {
        if (response.ok) setIsLocalConfigured((await response.json()).configured === true);
      })
      .catch(() => {
        /* 静态部署没有本机服务，不显示本机密钥入口。 */
      });
    return () => statusController.abort();
  }, [allowLocalMiniMax]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    controller.current?.abort();
    setDraft((s) => ({ ...s, [key]: value }));
    setConnection('idle');
    setError('');
    setVoiceTest('idle');
  };
  const handleProviderChange = (provider: Provider) => {
    controller.current?.abort();
    const preset = PROVIDERS[provider];
    setDraft((s) => ({
      ...s,
      provider,
      baseUrl: preset.baseUrl,
      model: preset.model,
      hintModel: '',
      reviewModel: '',
      apiKey: '',
      useLocalMiniMax: false,
      ...(s.useLocalMiniMax ? { speechProvider: 'browser', recognitionProvider: 'browser' } : {}),
    }));
    setConnection('idle');
    setError('');
  };
  const handleTestConnection = async () => {
    const validation = validateSettings(draft);
    if (validation) {
      setError(validation);
      setConnection('error');
      return;
    }
    setConnection('testing');
    setError('');
    const requestController = new AbortController();
    controller.current?.abort();
    controller.current = requestController;
    try {
      await requestChatCompletion(
        draft,
        [{ role: 'user', content: 'Reply with the word hello.' }],
        { signal: requestController.signal },
      );
      if (!requestController.signal.aborted) setConnection('success');
    } catch (e) {
      if (!requestController.signal.aborted) {
        setError(e instanceof Error ? e.message : '连接失败，请检查供应商设置后重试。');
        setConnection('error');
      }
    }
  };
  const handleSave = () => {
    if (draft.apiKey.trim()) {
      const validation = validateSettings(draft);
      if (validation) {
        setError(validation);
        setTab('models');
        return;
      }
    }
    const speechError = validateSpeechSettings(draft);
    if (speechError) {
      setError(speechError);
      setTab('voice');
      return;
    }
    onSave(draft);
  };
  const handleTestVoice = async () => {
    const validation = validateSpeechSettings(draft);
    if (validation) {
      setError(validation);
      return;
    }
    const requestController = new AbortController();
    controller.current?.abort();
    controller.current = requestController;
    setVoiceTest('testing');
    setError('');
    try {
      await synthesizeMiniMaxSpeech(
        languageBase(draft.practiceLanguage) === 'en'
          ? 'Hello! Let’s practice together.'
          : languageName(draft.practiceLanguage, draft.practiceLanguage),
        getSpeechConfig(draft),
        requestController.signal,
      );
      if (!requestController.signal.aborted) setVoiceTest('success');
    } catch (error: unknown) {
      if (!requestController.signal.aborted) {
        setVoiceTest('idle');
        setError(error instanceof Error ? error.message : '语音连接失败。');
      }
    }
  };
  const handleSelectVoice = (choice: VoiceChoice) => {
    const selected = applyVoiceChoice(settings, choice);
    onSelectVoice(choice);
    // 音色即时保存，同时同步草稿，防止之后保存其他偏好时把音色改回旧值。
    setDraft((previous) => ({
      ...previous,
      speechProvider: selected.speechProvider,
      speechVoice: selected.speechVoice,
      voice: selected.voice,
    }));
    setError('');
  };
  return (
    <Modal
      title="让语伴更懂你"
      description="选择喜欢的模型，找到舒服的练习节奏。"
      onClose={onClose}
      className="settings-modal"
    >
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="陪练设置"
        onKeyDown={(event) => {
          const currentIndex = SETTINGS_TABS.indexOf(tab);
          let nextIndex = currentIndex;
          if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SETTINGS_TABS.length;
          else if (event.key === 'ArrowLeft')
            nextIndex = (currentIndex + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length;
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = SETTINGS_TABS.length - 1;
          else return;
          event.preventDefault();
          const nextTab = SETTINGS_TABS[nextIndex];
          setTab(nextTab);
          document.getElementById(`${tabGroupId}-${nextTab}`)?.focus();
        }}
      >
        <button
          role="tab"
          id={`${tabGroupId}-voices`}
          aria-controls={`${tabGroupId}-panel`}
          tabIndex={tab === 'voices' ? 0 : -1}
          aria-selected={tab === 'voices'}
          onClick={() => setTab('voices')}
          className={tab === 'voices' ? 'active' : ''}
        >
          <Volume2 size={16} />
          语伴音色
        </button>
        <button
          role="tab"
          id={`${tabGroupId}-models`}
          aria-controls={`${tabGroupId}-panel`}
          tabIndex={tab === 'models' ? 0 : -1}
          aria-selected={tab === 'models'}
          onClick={() => setTab('models')}
          className={tab === 'models' ? 'active' : ''}
        >
          <Zap size={16} />
          模型连接
        </button>
        <button
          role="tab"
          id={`${tabGroupId}-voice`}
          aria-controls={`${tabGroupId}-panel`}
          tabIndex={tab === 'voice' ? 0 : -1}
          aria-selected={tab === 'voice'}
          onClick={() => setTab('voice')}
          className={tab === 'voice' ? 'active' : ''}
        >
          <SlidersHorizontal size={16} />
          语音与偏好
        </button>
        <button
          role="tab"
          id={`${tabGroupId}-theme`}
          aria-controls={`${tabGroupId}-panel`}
          tabIndex={tab === 'theme' ? 0 : -1}
          aria-selected={tab === 'theme'}
          onClick={() => setTab('theme')}
          className={tab === 'theme' ? 'active' : ''}
        >
          <Palette size={16} />
          主题配色
        </button>
      </div>
      <div role="tabpanel" id={`${tabGroupId}-panel`} aria-labelledby={`${tabGroupId}-${tab}`}>
        {tab === 'voices' ? (
          <div className="settings-body">
            <VoicePicker
              settings={settings}
              onSelect={handleSelectVoice}
              onOpenSettings={() => setTab('voice')}
            />
          </div>
        ) : tab === 'models' ? (
          <div className="settings-body">
            <label className="field-label" htmlFor="provider">
              模型供应商
            </label>
            <div className="provider-options" id="provider">
              {Object.entries(PROVIDERS).map(([key, p]) => (
                <button
                  key={key}
                  className={draft.provider === key ? 'selected' : ''}
                  disabled={connection === 'testing'}
                  onClick={() => handleProviderChange(key as Provider)}
                >
                  <span className="provider-mark">{p.mark}</span>
                  {p.name}
                  {draft.provider === key && <Check size={14} />}
                </button>
              ))}
            </div>
            <label className="field-label" htmlFor="base-url">
              API Base URL
            </label>
            <input
              id="base-url"
              value={draft.baseUrl}
              disabled={connection === 'testing' || draft.useLocalMiniMax}
              onChange={(e) => update('baseUrl', e.target.value)}
              placeholder="https://your-provider.com/v1"
              autoComplete="off"
            />
            {draft.provider === 'minimax' && isLocalConfigured && !draft.useLocalMiniMax && (
              <button
                className="button secondary"
                onClick={() => {
                  controller.current?.abort();
                  setDraft(withLocalMiniMax(draft, location.origin));
                  setError('');
                  setConnection('idle');
                }}
              >
                <LockKeyhole size={15} />
                使用本机已配置的 MiniMax
              </button>
            )}
            {draft.useLocalMiniMax ? (
              <div className="tip-note">
                已连接本机 MiniMax。密钥由本机服务保管，不发送到页面；对话、转写和朗读可直接使用。
                <button
                  className="text-button"
                  onClick={() => {
                    controller.current?.abort();
                    setDraft((value) => ({
                      ...value,
                      useLocalMiniMax: false,
                      apiKey: '',
                      baseUrl: PROVIDERS.minimax.baseUrl,
                    }));
                    setConnection('idle');
                  }}
                >
                  改用自己的密钥
                </button>
              </div>
            ) : (
              <>
                <label className="field-label" htmlFor="api-key">
                  API Key{' '}
                  <span>
                    {allowLocalMiniMax ? '仅保留在当前标签页会话' : '仅保留在当前 App 会话'}
                  </span>
                </label>
                <div className="password-field">
                  <input
                    id="api-key"
                    type={isKeyVisible ? 'text' : 'password'}
                    value={draft.apiKey}
                    disabled={connection === 'testing'}
                    onChange={(e) => update('apiKey', e.target.value)}
                    placeholder="输入你的 API Key"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    className="icon-button"
                    aria-label={isKeyVisible ? '隐藏密钥' : '显示密钥'}
                    onClick={() => setIsKeyVisible(!isKeyVisible)}
                  >
                    {isKeyVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </>
            )}
            <label className="field-label" htmlFor="main-model">
              对话模型 <span>{speakerName} · 主陪练</span>
            </label>
            <input
              id="main-model"
              value={draft.model}
              disabled={connection === 'testing'}
              onChange={(e) => update('model', e.target.value)}
              placeholder="供应商提供的模型 ID"
            />
            <div className="field-grid">
              <div>
                <label className="field-label" htmlFor="hint-model">
                  表达提示模型 <span>可选</span>
                </label>
                <input
                  id="hint-model"
                  value={draft.hintModel}
                  onChange={(e) => update('hintModel', e.target.value)}
                  placeholder="跟随对话模型"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="review-model">
                  说后点评模型 <span>可选</span>
                </label>
                <input
                  id="review-model"
                  value={draft.reviewModel}
                  onChange={(e) => update('reviewModel', e.target.value)}
                  placeholder="跟随对话模型"
                />
              </div>
            </div>
            <p className="field-help">
              <LockKeyhole size={14} />
              练习文字会提交给所选供应商；选择 MiniMax
              识别时，录音片段也会提交转写。不填对话密钥可体验本地示范。
            </p>
            <p className="field-help">
              自定义接口需兼容 Chat
              Completions，并允许浏览器跨域访问。三个角色独立请求，按供应商规则计费。
            </p>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {connection === 'success' && (
              <p className="inline-success" role="status">
                <Check size={15} />
                对话模型连接成功。两个辅导模型将在首次使用时校验。
              </p>
            )}
          </div>
        ) : tab === 'voice' ? (
          <div className="settings-body preferences">
            <label className="field-label" htmlFor="english-level">
              我的练习水平
            </label>
            <select
              id="english-level"
              value={draft.level}
              onChange={(e) => update('level', e.target.value)}
            >
              <option value="A1">A1 · 从简单句开始</option>
              <option value="A2">A2 · 能聊熟悉的话题</option>
              <option value="B1">B1 · 日常沟通没问题</option>
              <option value="B2">B2 · 希望表达更自如</option>
              <option value="C1">C1 · 深入、精准地表达</option>
            </select>
            <label className="field-label" htmlFor="recognition-provider">
              听你说话
            </label>
            <select
              id="recognition-provider"
              value={draft.recognitionProvider}
              onChange={(event) =>
                update('recognitionProvider', event.target.value as Settings['recognitionProvider'])
              }
            >
              <option value="browser">浏览器语音识别</option>
              <option value="minimax">MiniMax · 多语言语音识别</option>
            </select>
            <label className="field-label" htmlFor="speech-provider">
              {speakerName} 的朗读
            </label>
            <select
              id="speech-provider"
              value={draft.speechProvider}
              onChange={(event) =>
                update('speechProvider', event.target.value as Settings['speechProvider'])
              }
            >
              <option value="browser">设备自带声音</option>
              <option value="minimax">MiniMax · 自然语音</option>
            </select>
            {(draft.speechProvider === 'minimax' || draft.recognitionProvider === 'minimax') && (
              <>
                {!draft.useLocalMiniMax && (
                  <>
                    <label className="field-label" htmlFor="speech-url">
                      MiniMax 语音接口
                    </label>
                    <input
                      id="speech-url"
                      value={draft.speechBaseUrl}
                      onChange={(event) => update('speechBaseUrl', event.target.value)}
                      autoComplete="off"
                    />
                    <label className="field-label" htmlFor="speech-key">
                      语音 API Key{' '}
                      <span>
                        {draft.provider === 'minimax' ? '留空复用对话密钥' : '仅保留在当前会话'}
                      </span>
                    </label>
                    <input
                      id="speech-key"
                      type="password"
                      value={draft.speechApiKey}
                      onChange={(event) => update('speechApiKey', event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </>
                )}
                {draft.speechProvider === 'minimax' && (
                  <>
                    <label className="field-label" htmlFor="speech-model">
                      语音模型
                    </label>
                    <input
                      id="speech-model"
                      value={draft.speechModel}
                      onChange={(event) => update('speechModel', event.target.value)}
                      placeholder="speech-2.8-turbo"
                    />
                    <label className="field-label" htmlFor="speech-voice">
                      音色 ID
                    </label>
                    <select
                      aria-label="选择预设音色"
                      value={
                        VOICE_PRESETS.some((voice) => voice.id === draft.speechVoice)
                          ? draft.speechVoice
                          : ''
                      }
                      onChange={(event) => {
                        if (event.target.value) update('speechVoice', event.target.value);
                      }}
                    >
                      <option value="">自定义音色（在下面填写 ID）</option>
                      {voicePresetsFor(draft.practiceLanguage).map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name} · {voice.description}
                        </option>
                      ))}
                    </select>
                    <input
                      id="speech-voice"
                      value={draft.speechVoice}
                      onChange={(event) => update('speechVoice', event.target.value)}
                      placeholder="English_expressive_narrator"
                    />
                    <button
                      className="button secondary"
                      disabled={voiceTest === 'testing'}
                      onClick={() => void handleTestVoice()}
                    >
                      {voiceTest === 'testing' ? (
                        <Loader2 size={15} className="spin" />
                      ) : (
                        <Link2 size={15} />
                      )}
                      {voiceTest === 'testing' ? '正在验证语音…' : '测试语音连接'}
                    </button>
                    {voiceTest === 'success' && (
                      <p className="inline-success" role="status">
                        语音合成接口已返回音频；实际播放与麦克风请在陪练中体验。
                      </p>
                    )}
                  </>
                )}
                <p className="field-help">
                  MiniMax
                  转写只上传当前录音片段，完成或取消后释放，不保存音频文件。语音与对话分别消耗供应商额度。
                </p>
              </>
            )}
            {draft.speechProvider === 'browser' && (
              <>
                <label className="field-label" htmlFor="voice-select">
                  {speakerName} 的声音 <Volume2 size={15} />
                </label>
                <select
                  id="voice-select"
                  value={draft.voice}
                  onChange={(e) => update('voice', e.target.value)}
                >
                  <option value="">自动选择{languageName(draft.practiceLanguage)}声音</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} · {v.lang}
                    </option>
                  ))}
                </select>
                <p className="field-help">可用声音由设备和浏览器决定。</p>
              </>
            )}
            <label className="field-label" htmlFor="speech-rate">
              说话速度 <strong>{draft.rate.toFixed(2)}×</strong>
            </label>
            <input
              id="speech-rate"
              type="range"
              min="0.65"
              max="1.25"
              step="0.05"
              value={draft.rate}
              onChange={(e) => update('rate', Number(e.target.value))}
            />
            <div className="range-labels">
              <span>慢一点，听清楚</span>
              <span>自然聊天</span>
            </div>
            <label className="field-label" htmlFor="speech-pause">
              停顿多久后接话
            </label>
            <select
              id="speech-pause"
              value={normalizeSpeechPauseMs(draft.speechPauseMs)}
              onChange={(event) =>
                update('speechPauseMs', normalizeSpeechPauseMs(Number(event.target.value)))
              }
            >
              {SPEECH_PAUSE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="field-help">
              停顿达到这个时长再接话，继续说会重新计时。需要较长时间组织句子时可以选 5 秒。
            </p>
            <Toggle
              title="自动朗读回复"
              description={`${speakerName} 回答时，自动播放练习语言的语音`}
              checked={draft.autoSpeak}
              onChange={(v) => update('autoSpeak', v)}
            />
            <Toggle
              title="停说后自动发送"
              description="等待设定的停顿时长，转写完成后继续下一轮对话"
              checked={draft.autoSubmit}
              onChange={(v) => update('autoSubmit', v)}
            />
            <div className="tip-note">
              半双工让对话更从容：{speakerName} 说话时，你可以安心听；轮到你时，麦克风才会开启。
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <ThemePicker selectedTheme={selectedTheme} onThemeChange={onThemeChange} />
        )}
      </div>
      <div className="modal-actions">
        {tab === 'models' ? (
          <button
            className="button secondary"
            onClick={() => void handleTestConnection()}
            disabled={connection === 'testing'}
          >
            {connection === 'testing' ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Link2 size={16} />
            )}
            {connection === 'testing' ? '正在连接…' : '测试连接'}
          </button>
        ) : (
          <span className="muted small">
            {tab === 'theme'
              ? '配色已即时生效'
              : tab === 'voices'
                ? '选用音色后即时保存'
                : '按你的节奏来就好'}
          </span>
        )}
        {tab === 'theme' || tab === 'voices' ? (
          <button className="button primary" onClick={onClose}>
            完成
            <Check size={16} />
          </button>
        ) : (
          <button
            className="button primary"
            onClick={handleSave}
            disabled={connection === 'testing'}
          >
            保存设置
            <Check size={16} />
          </button>
        )}
      </div>
    </Modal>
  );
}

function Toggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
