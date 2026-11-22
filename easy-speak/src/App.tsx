import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Coffee,
  Keyboard,
  Lightbulb,
  Languages,
  Mic,
  Plane,
  Plus,
  Settings2,
  Sparkles,
  X,
  BriefcaseBusiness,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PracticeScreen } from './components/PracticeScreen';
import { DeferredFeature } from './components/DeferredFeature';
import type { LearningView } from './components/LearningHub';
import { createLessonScene, LESSONS } from './lib/lessons';
import type { Lesson } from './lib/lessons';
import { completedTurns, sanitizeStoredCorrections } from './lib/learning';
import { LanguageDialog } from './components/LanguageDialog';
import { languageName, isDefaultLanguagePair } from './lib/languages';
import type { LanguagePair } from './lib/languages';
import { Modal } from './components/Modal';
import type { SettingsTab } from './components/SettingsDialog';
import { usePractice } from './hooks/usePractice';
import { MAX_SAVED_PHRASES, SCENES } from './lib/core';
import type { Settings } from './lib/core';
import { downloadText, readPhrases, readSettings, savePhrases, saveSettings } from './lib/storage';
import type { SavedPhrase } from './lib/storage';
import {
  applyTheme,
  parseThemePreference,
  readTheme,
  saveTheme,
  THEME_STORAGE_KEY,
} from './lib/theme';
import type { ThemeId } from './lib/theme';
import { applyVoiceChoice, selectedVoiceName } from './lib/voicePresets';
import type { VoiceChoice } from './lib/voicePresets';
import { messageSpeakerName } from './lib/format';
import { createTrainingScene } from './lib/customTraining';
import type { CustomTraining } from './lib/customTraining';
import { APP_NAME } from './lib/brand';

const loadLearningHub = () =>
  import('./components/LearningHub').then((module) => ({ default: module.LearningHub }));
const loadSettingsDialog = () =>
  import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog }));
const loadHistoryPage = () =>
  import('./components/LibraryPages').then((module) => ({ default: module.HistoryPage }));
const loadPhrasePage = () =>
  import('./components/LibraryPages').then((module) => ({ default: module.PhrasePage }));
const loadCustomTrainingDialog = () =>
  import('./components/CustomTrainingDialog').then((module) => ({
    default: module.CustomTrainingDialog,
  }));

type Sheet =
  | 'scenes'
  | 'custom-training'
  | 'languages'
  | 'history'
  | 'phrases'
  | 'transcript'
  | 'help'
  | 'task'
  | null;
const SCENE_ICONS: Record<string, LucideIcon> = {
  coffee: Coffee,
  briefcase: BriefcaseBusiness,
  plane: Plane,
  sparkles: Sparkles,
};

/** 单屏语音 App：次要功能通过弹层进入，陪练界面保持固定布局。 */
export default function App({
  initialSettings,
  allowLocalMiniMax = true,
}: {
  initialSettings?: Settings;
  allowLocalMiniMax?: boolean;
}) {
  const [settings, setSettings] = useState<Settings>(initialSettings || readSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('models');
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>(readTheme);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [view, setView] = useState<LearningView | 'conversation'>('conversation');
  const [toast, setToast] = useState('');
  const [phrases, setPhrases] = useState<SavedPhrase[]>(readPhrases);
  const notify = useCallback((message: string) => setToast(message), []);
  const practice = usePractice(settings, notify, view === 'conversation');
  const isDemo = !settings.apiKey.trim();
  const SceneIcon = SCENE_ICONS[practice.scene.icon];
  useEffect(() => {
    if (!sanitizeStoredCorrections())
      notify('浏览器未能清理旧学习记录中的多余字段，请允许本地存储后刷新。');
  }, [notify]);
  useLayoutEffect(() => applyTheme(selectedTheme), [selectedTheme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handleThemeStorage = (event: StorageEvent) => {
      if (!event.key || event.key === THEME_STORAGE_KEY) {
        setSelectedTheme(parseThemePreference(event.newValue));
      }
    };
    window.addEventListener('storage', handleThemeStorage);
    return () => window.removeEventListener('storage', handleThemeStorage);
  }, []);
  const handleThemeChange = (themeId: ThemeId) => {
    setSelectedTheme(themeId);
    if (!saveTheme(themeId)) notify('配色已生效，但浏览器未能保存，下次打开可能恢复默认。');
  };
  const handleOpenSettings = (tab: SettingsTab = 'models') => {
    if (view !== 'conversation') practice.stopSpeaking();
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  };
  const handleSavePhrase = (en: string, zh: string) => {
    if (
      phrases.some(
        (phrase) =>
          phrase.en === en &&
          (phrase.practiceLanguage || 'en-US') === settings.practiceLanguage &&
          (phrase.supportLanguage || 'zh-CN') === settings.supportLanguage,
      )
    ) {
      notify('这个表达已经收藏过了。');
      return;
    }
    const next = [
      {
        id: crypto.randomUUID(),
        en,
        zh,
        date: new Date().toISOString(),
        practiceLanguage: settings.practiceLanguage,
        supportLanguage: settings.supportLanguage,
      },
      ...phrases,
    ].slice(0, MAX_SAVED_PHRASES);
    setPhrases(next);
    notify(savePhrases(next) ? '已收藏这个表达。' : '已加入当前收藏，但浏览器未能保存。');
  };
  const handleSaveSettings = (nextSettings: Settings) => {
    if (
      nextSettings.apiKey &&
      (practice.scene.training || !isDefaultLanguagePair(nextSettings)) &&
      !practice.messages.some((message) => message.content.trim())
    )
      practice.newSession(practice.scene, nextSettings);
    else practice.abort();
    setSettings(nextSettings);
    notify(
      saveSettings(nextSettings)
        ? '设置已保存，下一句话使用新设置。'
        : '设置已生效，但浏览器未能保存。',
    );
    setIsSettingsOpen(false);
  };
  const handleSelectScene = (scene: (typeof SCENES)[number]) => {
    practice.newSession(scene);
    setSheet(null);
  };
  const handleApplyLanguages = (pair: LanguagePair) => {
    if (
      pair.supportLanguage === settings.supportLanguage &&
      pair.practiceLanguage === settings.practiceLanguage
    ) {
      setSheet(null);
      return;
    }
    const nextSettings = { ...settings, ...pair, voice: '' };
    practice.newSession(practice.scene, nextSettings);
    setSettings(nextSettings);
    const persisted = saveSettings(nextSettings);
    setSheet(null);
    notify(persisted ? '语言已切换，开始一段新的对话。' : '语言已生效，但浏览器未能保存偏好。');
  };
  const handleExportConversation = () =>
    downloadText(
      `${APP_NAME}-对话-${new Date().toISOString().slice(0, 10)}.txt`,
      practice.messages
        .map((message) => `${messageSpeakerName(message, '我')}：${message.content}`)
        .join('\n\n'),
    );
  const handleToggleAudio = () => {
    if (settings.autoSpeak) practice.stopSpeaking();
    const next = { ...settings, autoSpeak: !settings.autoSpeak };
    setSettings(next);
    saveSettings(next);
  };
  const handleNavigate = (nextView: LearningView | 'conversation') => {
    if (nextView === view) return;
    practice.suspend();
    practice.saveSession();
    setSheet(null);
    setView(nextView);
  };
  const handleStartLesson = (lesson: Lesson) => {
    practice.newSession(createLessonScene(lesson));
    setSheet(null);
    setView('conversation');
  };
  const handleStartTraining = (training: CustomTraining) => {
    if (!settings.apiKey.trim()) {
      handleOpenSettings('models');
      return;
    }
    practice.newSession(createTrainingScene(training));
    setSheet(null);
    setView('conversation');
  };
  const activeLesson = LESSONS.find((lesson) => lesson.id === practice.scene.lessonId);
  const handleSelectVoice = (choice: VoiceChoice) => {
    const nextSettings = applyVoiceChoice(settings, choice);
    practice.updateSpeechSettings(nextSettings);
    setSettings(nextSettings);
    const isPersisted = saveSettings(nextSettings);
    setSheet(null);
    notify(
      isPersisted
        ? `已切换为${selectedVoiceName(nextSettings)}，下次朗读生效。`
        : '音色已生效，但浏览器未能保存。',
    );
  };
  return (
    <div className={`voice-app ${practice.phase}`}>
      <div className="ambient-glow glow-one" aria-hidden="true" />
      <div className="ambient-glow glow-two" aria-hidden="true" />
      <div className="app-canvas" hidden={view !== 'conversation'}>
        <header className="voice-header">
          <button
            className="header-button"
            aria-label="返回主界面"
            onClick={() => handleNavigate('courses')}
          >
            <ArrowLeft size={23} />
          </button>
          <button className="scene-pill" onClick={() => setSheet('scenes')}>
            <SceneIcon size={16} />
            <span>{practice.scene.id === 'daily' ? '自由对话' : practice.scene.title}</span>
            <ChevronDown size={14} />
          </button>
          <button
            className="header-button"
            aria-label="打开音色、模型与偏好设置"
            onClick={() => handleOpenSettings('voices')}
          >
            <Settings2 size={23} />
          </button>
        </header>
        <button
          className="language-pair-button"
          onClick={() => setSheet('languages')}
          aria-label="选择两种交流语言"
        >
          <Languages size={13} />
          <span>{languageName(settings.supportLanguage)}</span>
          <span aria-hidden="true">↔</span>
          <span>{languageName(settings.practiceLanguage)}</span>
          <ChevronDown size={12} />
        </button>
        {activeLesson && (
          <button className="lesson-session-banner" onClick={() => setSheet('task')}>
            <BookOpen size={13} />
            <span>{activeLesson.title}</span>
            <span>
              {Math.min(
                practice.scene.goalTurns || 3,
                completedTurns({ messages: practice.messages }),
              )}{' '}
              / {practice.scene.goalTurns || 3} 轮
            </span>
            <ChevronDown size={12} />
          </button>
        )}
        <PracticeScreen
          practice={practice}
          isDemo={isDemo}
          isAutoSpeak={settings.autoSpeak}
          onToggleAudio={handleToggleAudio}
          onSavePhrase={handleSavePhrase}
          savedPhrases={phrases
            .filter(
              (phrase) =>
                (phrase.practiceLanguage || 'en-US') === settings.practiceLanguage &&
                (phrase.supportLanguage || 'zh-CN') === settings.supportLanguage,
            )
            .map((phrase) => phrase.en)}
          onOpenTranscript={() => setSheet('transcript')}
          onEndSession={() => handleNavigate('courses')}
          notify={notify}
          isOverlayOpen={isSettingsOpen || sheet !== null || view !== 'conversation'}
          isScreenActive={view === 'conversation'}
          preserveReplyOnOverlay={isSettingsOpen}
        />
      </div>
      {view !== 'conversation' && (
        <DeferredFeature
          load={loadLearningHub}
          title="学习中心"
          presentation="page"
          onClose={() => handleNavigate('conversation')}
          featureProps={{
            view,
            settings,
            sessions: practice.sessions,
            phrases,
            canSpeak: practice.phase === 'ready',
            onNavigate: handleNavigate,
            onStartLesson: handleStartLesson,
            onOpenSettings: () => handleOpenSettings(),
            onOpenLanguages: () => {
              practice.stopSpeaking();
              setSheet('languages');
            },
            onOpenPhrases: () => {
              practice.stopSpeaking();
              setSheet('phrases');
            },
            onOpenHistory: () => {
              practice.stopSpeaking();
              setSheet('history');
            },
            onOpenHelp: () => setSheet('help'),
            onSpeak: practice.replay,
            onStopSpeaking: practice.stopSpeaking,
            notify,
          }}
        />
      )}
      {isSettingsOpen && (
        <DeferredFeature
          load={loadSettingsDialog}
          title="音色与偏好设置"
          presentation="modal"
          onClose={() => setIsSettingsOpen(false)}
          featureProps={{
            settings,
            allowLocalMiniMax,
            selectedTheme,
            initialTab: settingsTab,
            onThemeChange: handleThemeChange,
            onSave: handleSaveSettings,
            onSelectVoice: handleSelectVoice,
            onClose: () => setIsSettingsOpen(false),
          }}
        />
      )}
      {sheet === 'languages' && (
        <LanguageDialog
          settings={settings}
          onApply={handleApplyLanguages}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'scenes' && (
        <Modal
          title="今天想聊点什么？"
          description="换个话题，开始一段新的对话。当前记录会保留。"
          onClose={() => setSheet(null)}
        >
          <div className="scene-picker-grid">
            {SCENES.map((scene) => {
              const Icon = SCENE_ICONS[scene.icon];
              return (
                <button
                  className={`scene-picker-item ${scene.id === practice.scene.id ? 'selected' : ''}`}
                  key={scene.id}
                  onClick={() => handleSelectScene(scene)}
                >
                  <span className={`scene-icon ${scene.color}`}>
                    <Icon size={22} />
                  </span>
                  <strong>{scene.id === 'daily' ? '自由对话' : scene.title}</strong>
                  <p>{scene.desc}</p>
                  <span>
                    {scene.id === practice.scene.id ? (
                      <Check size={16} />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                  </span>
                </button>
              );
            })}
            <button
              className={`scene-picker-item custom-training-entry ${practice.scene.training ? 'selected' : ''}`}
              onClick={() => setSheet('custom-training')}
            >
              <span className="scene-icon lavender">
                <Plus size={22} />
              </span>
              <strong>自定义训练</strong>
              <p>输入你想练的内容，或添加文件、图片</p>
              <span>
                <ArrowRight size={16} />
              </span>
            </button>
          </div>
        </Modal>
      )}
      {sheet === 'custom-training' && (
        <DeferredFeature
          load={loadCustomTrainingDialog}
          title="自定义训练"
          presentation="modal"
          onClose={() => setSheet(null)}
          featureProps={{
            settings,
            initialTraining: practice.scene.training,
            onStart: handleStartTraining,
            onOpenSettings: () => handleOpenSettings('models'),
            onClose: () => setSheet(null),
            notify,
          }}
        />
      )}
      {sheet === 'transcript' && (
        <Modal
          title="我们刚刚聊了什么"
          description="每一次开口，都值得留下。"
          onClose={() => setSheet(null)}
        >
          <div className="history-transcript">
            {practice.messages
              .filter((message) => message.content)
              .map((message) => (
                <div className={`transcript-message ${message.role}`} key={message.id}>
                  <span>{messageSpeakerName(message)}</span>
                  <p>{message.content}</p>
                </div>
              ))}
          </div>
          <div className="modal-actions">
            <span className="muted small">文字记录不会包含密钥</span>
            <button className="button primary" onClick={handleExportConversation}>
              <ArrowDownToLine size={16} />
              导出对话
            </button>
          </div>
        </Modal>
      )}
      {sheet === 'task' && activeLesson && (
        <Modal
          title={activeLesson.title}
          description="聊够三轮后记录为已练习；也可以继续深入聊下去。"
          onClose={() => setSheet(null)}
        >
          <div className="lesson-detail">
            <h3>这次的交际目标</h3>
            <ol>
              {activeLesson.objectives.map((objective) => (
                <li key={objective}>
                  <Check size={15} />
                  {objective}
                </li>
              ))}
            </ol>
            <p className="muted small">
              这些是练习方向，不会因为聊天轮数达标就判断你已掌握。示范模式不累计课程进度。
            </p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => handleNavigate('courses')}>
              返回课程
            </button>
            <button className="button primary" onClick={() => setSheet(null)}>
              继续聊
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {sheet === 'history' && (
        <Modal title="练习记录" onClose={() => setSheet(null)} className="library-modal">
          <DeferredFeature
            load={loadHistoryPage}
            title="练习记录"
            onClose={() => setSheet(null)}
            featureProps={{
              sessions: practice.sessions,
              currentSessionId: practice.sessionId,
              onDelete: practice.deleteSession,
              onStart: () => {
                setSheet(null);
                handleNavigate('conversation');
              },
            }}
          />
        </Modal>
      )}
      {sheet === 'phrases' && (
        <Modal title="表达收藏" onClose={() => setSheet(null)} className="library-modal">
          <DeferredFeature
            load={loadPhrasePage}
            title="表达收藏"
            onClose={() => setSheet(null)}
            featureProps={{
              phrases,
              onRemove: (id) => {
                const next = phrases.filter((phrase) => phrase.id !== id);
                setPhrases(next);
                if (!savePhrases(next)) notify('已从当前页面移除，但浏览器未能保存更改。');
              },
              onSpeak: practice.replay,
              isReady: practice.phase === 'ready',
              onStart: () => {
                setSheet(null);
                handleNavigate('conversation');
              },
              onReview: () => {
                setSheet(null);
                handleNavigate('review');
              },
            }}
          />
          {phrases.length > 0 && (
            <div className="modal-actions">
              <span className="muted small">把好表达带走</span>
              <button
                className="button secondary"
                onClick={() =>
                  downloadText(
                    `${APP_NAME}-表达收藏.txt`,
                    phrases.map((phrase) => `${phrase.en}\n${phrase.zh}`).join('\n\n'),
                  )
                }
              >
                <ArrowDownToLine size={15} />
                导出收藏
              </button>
            </div>
          )}
        </Modal>
      )}
      {sheet === 'help' && (
        <Modal
          title="像聊天一样，练口语"
          description="不用准备完美的句子，想说什么就说。"
          onClose={() => setSheet(null)}
        >
          <div className="help-steps">
            <div>
              <span>
                <Mic size={18} />
              </span>
              <div>
                <h3>一句你，一句{practice.companionName}</h3>
                <p>
                  进入页面就可以聊，听完{practice.companionName}
                  说话后自动轮到你。停说后继续下一轮；需要休息时可以暂停，聊完点红色挂断按钮返回主界面。
                </p>
              </div>
            </div>
            <div>
              <span>
                <Lightbulb size={18} />
              </span>
              <div>
                <h3>两个小帮手，一直在中间</h3>
                <p>
                  上面的辅导框帮你想“接下来怎么说”；下面只点评你刚说完的话。它们各自更新，不抢位置。
                </p>
              </div>
            </div>
            <div>
              <span>
                <Keyboard size={18} />
              </span>
              <div>
                <h3>按舒服的方式聊</h3>
                <p>
                  随时切换文字输入，设置语速和难度。场景在顶部选择；点左上角箭头回到主界面，查看记录与收藏。
                </p>
              </div>
            </div>
            <div className="tip-note">
              建议使用 Chrome / Edge
              并允许麦克风权限。识别服务可能需要联网。示范模式使用本地规则；设置密钥后才连接真实
              AI。点评基于转写文字，不评估发音。
            </div>
          </div>
          <div className="modal-actions">
            <span className="muted small">Alt + M 开始或结束录音</span>
            <button className="button primary" onClick={() => setSheet(null)}>
              开始聊聊
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button aria-label="关闭提示" className="icon-button" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
