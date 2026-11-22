import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Keyboard,
  Lightbulb,
  Languages,
  Loader2,
  MessageCircle,
  Pause,
  PhoneOff,
  Play,
  RefreshCw,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { usePractice } from '../hooks/usePractice';
import { useMediaSession } from '../hooks/useMediaSession';
import { MAX_INPUT_LENGTH } from '../lib/core';
import { languageName, languageDirection } from '../lib/languages';
import { APP_NAME } from '../lib/brand';

type PracticeScreenProps = {
  practice: ReturnType<typeof usePractice>;
  isDemo: boolean;
  isAutoSpeak: boolean;
  savedPhrases: string[];
  onToggleAudio: () => void;
  onSavePhrase: (en: string, zh: string) => void;
  onOpenTranscript: () => void;
  onEndSession: () => void;
  notify: (message: string) => void;
  isOverlayOpen: boolean;
  isScreenActive?: boolean;
  preserveReplyOnOverlay?: boolean;
};

/** 只展示当前轮次与两个独立辅导区，完整会话收进记录弹层。 */
export function PracticeScreen({
  practice,
  isDemo,
  isAutoSpeak,
  savedPhrases,
  onToggleAudio,
  onSavePhrase,
  onOpenTranscript,
  onEndSession,
  notify,
  isOverlayOpen,
  isScreenActive = true,
  preserveReplyOnOverlay = false,
}: PracticeScreenProps) {
  const [isTextMode, setIsTextMode] = useState(false);
  const [isExampleVisible, setIsExampleVisible] = useState(false);
  const [isTranslationVisible, setIsTranslationVisible] = useState(false);
  const [isCaptionVisible, setIsCaptionVisible] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastAssistant = practice.messages.findLast((message) => message.role === 'assistant');
  const lastUser = practice.messages.findLast((message) => message.role === 'user');
  const isReady = practice.phase === 'ready';
  const isListening = practice.phase === 'listening';
  const isSpeaking = practice.phase === 'speaking';
  const practiceLanguage = practice.practiceLanguage || 'en-US';
  const supportLanguage = practice.supportLanguage || 'zh-CN';
  const speakerName = practice.companionName || APP_NAME;
  const phaseLabels = {
    ready: '轮到你了，慢慢说就好',
    listening: '正在听，你可以继续说…',
    transcribing: '正在把你刚才的话记下来…',
    thinking: `${speakerName} 正在想…`,
    speaking: `${speakerName} 正在说，安心听就好`,
  };
  const media = useMediaSession({
    practice,
    isTextMode,
    isOverlayOpen,
    isAutoSpeak,
    notify,
    isScreenActive,
    preserveReplyOnOverlay,
  });
  const canSend = isReady && media.sessionState === 'active' && !practice.hasPendingReply;
  const canUseCoaching =
    (isReady || isListening) &&
    media.sessionState !== 'ended' &&
    !isOverlayOpen &&
    !practice.hasPendingReply;
  useEffect(() => {
    if (isTextMode) input.current?.focus();
  }, [isTextMode]);
  useEffect(() => {
    setIsExampleVisible(false);
    setIsTranslationVisible(false);
    setIsCaptionVisible(true);
  }, [practice.sessionId]);
  useEffect(() => setIsTranslationVisible(false), [lastAssistant?.id]);
  const handleToggleTextMode = () => {
    setIsTextMode(!isTextMode);
  };
  const handleUseExample = () => {
    practice.prepareExampleDraft(practice.hint.example);
    setIsTextMode(true);
  };
  return (
    <>
      <section className="speaker-section" aria-label="当前对话">
        <div className={`speaker-orb ${practice.phase}`} aria-hidden="true">
          <div className="orb-core">
            <i />
            <i />
            <i />
            <i />
          </div>
          <span className="orb-ring" />
        </div>
        <div className="speaker-name">
          {speakerName} <span>你的{languageName(practiceLanguage)}语伴</span>
          <i />
          {isDemo ? '示范体验' : practice.phase === 'listening' ? '在听' : '在这里'}
        </div>
        <div className="live-caption">
          {lastUser && (
            <button className="last-user-caption" onClick={onOpenTranscript}>
              <span>你</span>
              <p dir="auto">{lastUser.content}</p>
              <ChevronRight size={13} />
            </button>
          )}
          <div className="assistant-caption" aria-live="polite">
            <p
              lang={practiceLanguage}
              dir="auto"
              className={isCaptionVisible ? '' : 'caption-hidden'}
            >
              {!isCaptionVisible
                ? '字幕已隐藏，专注听一听'
                : practice.hasPendingReply
                  ? '刚才的回答暂停了，继续后我会接着说。'
                  : lastAssistant?.content || (
                      <span className="thinking-caption">
                        嗯，让我想想
                        <span className="typing-dots">
                          <i />
                          <i />
                          <i />
                        </span>
                      </span>
                    )}
            </p>
            {lastAssistant?.content && (
              <button
                className="caption-audio icon-button"
                aria-label={`重听 ${speakerName} 的话`}
                disabled={!canUseCoaching}
                onClick={() => media.speakOnDemand(lastAssistant.content)}
              >
                <Volume2 size={16} />
              </button>
            )}
          </div>
          {lastAssistant?.content && (
            <div className="caption-tools">
              <button
                className="text-button"
                onClick={() => setIsCaptionVisible(!isCaptionVisible)}
                aria-pressed={!isCaptionVisible}
              >
                {isCaptionVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                {isCaptionVisible ? '隐藏字幕' : '显示字幕'}
              </button>
              <button
                className="translation-button"
                disabled={
                  practice.phase === 'thinking' ||
                  practice.translationLoadingId === lastAssistant.id
                }
                onClick={() => {
                  setIsTranslationVisible(!isTranslationVisible);
                  if (!lastAssistant.translation) void practice.translateMessage(lastAssistant.id);
                }}
                aria-expanded={isTranslationVisible}
              >
                <Languages size={13} />
                {practice.translationLoadingId === lastAssistant.id
                  ? '翻译中…'
                  : isTranslationVisible
                    ? '收起翻译'
                    : '翻译'}
              </button>
              <button
                className="text-button"
                onClick={() => onSavePhrase(lastAssistant.content, lastAssistant.translation || '')}
                aria-label="收藏当前句子"
                disabled={practice.phase === 'thinking'}
              >
                {savedPhrases.includes(lastAssistant.content) ? (
                  <Check size={13} />
                ) : (
                  <Bookmark size={13} />
                )}{' '}
                收藏
              </button>
            </div>
          )}
          {isTranslationVisible && lastAssistant?.translation && (
            <p className="caption-translation" lang={supportLanguage} dir="auto">
              {lastAssistant.translation}
            </p>
          )}
          {practice.error && (
            <div className="conversation-error" role="alert">
              <p>{practice.error}</p>
              <button
                className="text-button"
                disabled={media.sessionState !== 'active'}
                onClick={practice.retry}
              >
                <RefreshCw size={13} />
                重试回复
              </button>
            </div>
          )}
        </div>
      </section>
      <main className="coach-stack" aria-label="两个独立辅导对话框">
        <section className="coach-box inspiration" aria-labelledby="hint-heading">
          <header>
            <div>
              <span className="coach-symbol">
                <Lightbulb size={15} />
              </span>
              <h2 id="hint-heading">接下来，可以说</h2>
            </div>
            {practice.isHintLoading ? (
              <span className="coach-update">
                <Loader2 size={11} className="spin" />
                想点子中
              </span>
            ) : (
              <span className="coach-update">给你一点灵感</span>
            )}
          </header>
          <div className="coach-content" aria-live="polite">
            <p
              className={`hint-angle ${practice.isHintLoading ? 'updating' : ''}`}
              lang={supportLanguage}
              dir="auto"
            >
              {practice.hint.angle}
            </p>
            <div className="phrase-chips">
              {practice.hint.words.map((word) => (
                <button
                  key={word.en}
                  className={savedPhrases.includes(word.en) ? 'saved' : ''}
                  onClick={() => onSavePhrase(word.en, word.zh)}
                  aria-label={`收藏 ${word.en}`}
                  title={word.zh}
                >
                  <span lang={practiceLanguage} dir="auto">
                    {word.en}
                  </span>
                  <small lang={supportLanguage} dir="auto">
                    {word.zh}
                  </small>
                  {savedPhrases.includes(word.en) ? <Check size={11} /> : <Bookmark size={11} />}
                </button>
              ))}
            </div>
            <button
              className="example-toggle"
              disabled={!practice.hint.example}
              aria-expanded={isExampleVisible}
              onClick={() => setIsExampleVisible(!isExampleVisible)}
            >
              需要的话，看个完整例句
              <ChevronDown size={12} className={isExampleVisible ? 'rotated' : ''} />
            </button>
            {isExampleVisible && (
              <div className="example-content">
                <p lang={practiceLanguage} dir="auto">
                  {practice.hint.example}
                </p>
                <div>
                  <button
                    className="text-button"
                    disabled={!canUseCoaching}
                    onClick={() => media.speakOnDemand(practice.hint.example)}
                  >
                    <Volume2 size={12} />
                    听听看
                  </button>
                  <button
                    className="text-button"
                    disabled={!canUseCoaching}
                    onClick={handleUseExample}
                  >
                    试着用这句
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}
            {practice.hintError && (
              <div className="coach-error">
                <p>{practice.hintError}</p>
                <button
                  className="text-button"
                  disabled={media.sessionState !== 'active'}
                  onClick={practice.retryHint}
                >
                  <RefreshCw size={12} />
                  重试
                </button>
              </div>
            )}
          </div>
        </section>
        <section className="coach-box feedback" aria-labelledby="review-heading">
          <header>
            <div>
              <span className="coach-symbol">
                <Sparkles size={14} />
              </span>
              <h2 id="review-heading">
                {practice.rehearsal ? '再练一次，慢慢说' : '刚才这句，说得怎么样'}
              </h2>
            </div>
            {practice.isReviewLoading ? (
              <span className="coach-update">
                <Loader2 size={11} className="spin" />
                认真看一下
              </span>
            ) : (
              <span className="coach-update">
                {lastUser ? (isDemo ? '示范点评' : '只看你刚说的') : '说完后更新'}
              </span>
            )}
          </header>
          <div className="coach-content" aria-live="polite">
            {practice.rehearsal ? (
              <div className="rehearsal-card" aria-label="纠错后重练">
                <span>只点评这次尝试，不推进聊天</span>
                <p lang={practiceLanguage} dir="auto">
                  {practice.rehearsal.target}
                </p>
                {practice.rehearsal.result && (
                  <>
                    <p className="rehearsal-result" lang={supportLanguage} dir="auto">
                      {practice.rehearsal.result.positive} {practice.rehearsal.result.explanation}
                    </p>
                    {practice.rehearsal.result.improved && (
                      <p lang={practiceLanguage} dir="auto">
                        {practice.rehearsal.result.improved}
                      </p>
                    )}
                  </>
                )}
                <div className="correction-actions">
                  <button
                    className="text-button"
                    disabled={!canUseCoaching}
                    onClick={() => media.speakOnDemand(practice.rehearsal!.target)}
                  >
                    <Volume2 size={13} />
                    听示范
                  </button>
                  {practice.rehearsal.result && (
                    <button
                      className="text-button"
                      disabled={!isReady}
                      onClick={() => practice.beginRehearsal(practice.rehearsal!.target)}
                    >
                      再练一遍
                    </button>
                  )}
                  <button className="text-button" onClick={practice.cancelRehearsal}>
                    返回聊天
                  </button>
                </div>
              </div>
            ) : practice.review ? (
              <>
                <p className="review-positive" lang={supportLanguage} dir="auto">
                  <Check size={13} />
                  {practice.review.positive}
                </p>
                {practice.review.original && (
                  <div className="inline-correction">
                    <span dir="auto">{practice.review.original}</span>
                    <ChevronRight size={12} />
                    <strong lang={practiceLanguage} dir="auto">
                      {practice.review.improved}
                    </strong>
                    <button
                      className="icon-button"
                      aria-label="听听改进表达"
                      disabled={!canUseCoaching}
                      onClick={() => media.speakOnDemand(practice.review!.improved)}
                    >
                      <Volume2 size={13} />
                    </button>
                  </div>
                )}
                <p className="review-explanation" lang={supportLanguage} dir="auto">
                  {practice.review.explanation}
                </p>
                {practice.review.improved && !practice.rehearsal && (
                  <div className="correction-actions">
                    <button
                      className="text-button"
                      disabled={!canUseCoaching}
                      onClick={() => practice.beginRehearsal(practice.review!.improved)}
                    >
                      <RefreshCw size={13} />
                      再试一次
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        onSavePhrase(practice.review!.improved, practice.review!.explanation)
                      }
                    >
                      <Bookmark size={13} />
                      收藏改进表达
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="review-waiting">
                <span className="waiting-mark">
                  <MessageCircle size={21} />
                  <i />
                </span>
                <p>
                  {lastUser
                    ? practice.isReviewLoading
                      ? '正在整理你刚才这句话…'
                      : '这句点评还没准备好。'
                    : '先聊，不用担心对错。'}
                  <span>
                    {lastUser
                      ? '你可以继续聊，点评会在这里更新。'
                      : '你说完，我会在这里给一点小建议。'}
                  </span>
                </p>
              </div>
            )}
            {practice.reviewError && (
              <div className="coach-error">
                <p>{practice.reviewError}</p>
                <button
                  className="text-button"
                  disabled={media.sessionState !== 'active'}
                  onClick={practice.retryReview}
                >
                  <RefreshCw size={12} />
                  重试
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
      {media.isCameraOn && (
        <div className="camera-preview">
          <video ref={media.videoRef} autoPlay playsInline muted aria-label="本机摄像头预览" />
          <span>
            <i />
            AI 看不到画面
          </span>
          <button
            className="icon-button"
            aria-label="关闭摄像头"
            onClick={() => void media.handleToggleCamera()}
          >
            <VideoOff size={14} />
          </button>
        </div>
      )}
      <section className="voice-dock" aria-label="语音控制">
        {(isListening || practice.isTranscribing) && (
          <div className="live-transcript" aria-live="polite">
            {practice.isTranscribing
              ? '正在转写你刚才的话…'
              : practice.draft || '说点什么，我在听…'}
          </div>
        )}
        {(isTextMode || (practice.draft && isReady)) && (
          <form
            className="text-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSend) practice.submit(practice.draft);
            }}
          >
            <textarea
              ref={input}
              aria-label={`输入你想说的${languageName(practiceLanguage)}`}
              lang={practiceLanguage}
              dir={languageDirection(practiceLanguage)}
              rows={2}
              maxLength={MAX_INPUT_LENGTH}
              value={practice.draft}
              disabled={!isReady}
              onChange={(event) => practice.setDraft(event.target.value)}
              placeholder={`用${languageName(practiceLanguage)}或${languageName(supportLanguage)}写下想说的…`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (canSend) practice.submit(practice.draft);
                }
              }}
            />
            <button
              type="submit"
              className="send-button"
              aria-label="发送消息"
              disabled={!canSend || !practice.draft.trim()}
            >
              <ArrowUp size={18} />
            </button>
            <button
              type="button"
              className="text-button draft-discard"
              onClick={() => practice.setDraft('')}
            >
              放弃这句
            </button>
          </form>
        )}
        <div className={`turn-status ${practice.phase}`} role="status">
          <span className="voice-bars">
            {[0, 1, 2, 3, 4].map((index) => (
              <i key={index} style={{ animationDelay: `${index * 0.12}s` }} />
            ))}
          </span>
          {media.sessionState === 'ended'
            ? '这次先聊到这里，想聊时点继续'
            : media.isPausedForRecognition
              ? '语音识别已暂停。可以打字聊，或点继续重试。'
              : media.sessionState === 'paused'
                ? '已暂停，准备好再继续'
                : practice.draft.trim() && isReady && !isTextMode
                  ? '这句还没发送，确认或放弃后继续'
                  : practice.rehearsal
                    ? practice.phase === 'thinking'
                      ? '正在看这次尝试…'
                      : practice.rehearsal.result
                        ? '这一遍练完了，可以再试或返回聊天'
                        : '试着说一遍，也可以打字'
                    : isTextMode && isReady
                      ? '写下你想说的，我们接着聊'
                      : phaseLabels[practice.phase]}
          {isSpeaking && (
            <button className="skip-speech" onClick={practice.stopSpeaking}>
              跳过
            </button>
          )}
        </div>
        <div className="voice-controls session-controls">
          <div>
            <button
              className={`round-control ${media.isCameraOn ? 'selected' : ''}`}
              aria-label={media.isCameraOn ? '关闭摄像头预览' : '开启摄像头预览（画面不发送给 AI）'}
              title="仅本机预览，当前 AI 看不到摄像头画面"
              aria-pressed={media.isCameraOn}
              onClick={() => void media.handleToggleCamera()}
            >
              {media.isCameraLoading ? (
                <Loader2 size={21} className="spin" />
              ) : media.isCameraOn ? (
                <Video size={21} />
              ) : (
                <VideoOff size={21} />
              )}
            </button>
            <span>相机预览</span>
          </div>
          <div>
            <button
              className={`round-control ${isTextMode ? 'selected' : ''}`}
              aria-label={isTextMode ? '关闭文字输入' : '使用文字输入'}
              aria-pressed={isTextMode}
              onClick={handleToggleTextMode}
            >
              <Keyboard size={21} />
            </button>
            <span>打字聊</span>
          </div>
          <div>
            <button
              className="round-control"
              aria-label={media.sessionState !== 'active' ? '继续陪练' : '暂停陪练'}
              onClick={media.sessionState !== 'active' ? media.resumeSession : media.pauseSession}
            >
              {media.sessionState !== 'active' ? (
                <Play size={20} fill="currentColor" />
              ) : (
                <Pause size={21} />
              )}
            </button>
            <span>{media.sessionState !== 'active' ? '继续' : '暂停'}</span>
          </div>
          <div>
            <button
              className="round-control hangup-control"
              aria-label="挂断并结束陪练，返回主界面"
              disabled={
                media.sessionState === 'ended' && !media.isCameraOn && !media.isCameraLoading
              }
              onClick={() => {
                media.endSession();
                onEndSession();
              }}
            >
              <PhoneOff size={22} />
            </button>
            <span>挂断</span>
          </div>
        </div>
        <button
          className="quiet-audio-toggle"
          onClick={onToggleAudio}
          aria-label={isAutoSpeak ? '关闭自动朗读' : '开启自动朗读'}
        >
          {isAutoSpeak ? <Volume2 size={12} /> : <VolumeX size={12} />}
          {isAutoSpeak ? '声音已开启' : '声音已关闭'}
        </button>
      </section>
    </>
  );
}
