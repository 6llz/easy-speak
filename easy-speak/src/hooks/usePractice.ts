import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestChatCompletion,
  demoReply,
  demoReview,
  hintPrompt,
  mainPrompt,
  reviewPrompt,
  translationPrompt,
  rehearsalPrompt,
  SCENES,
  MAX_INPUT_LENGTH,
  MAX_SESSIONS,
  wordsIn,
} from '../lib/core';
import type { Hint, Message, Review, Settings } from '../lib/core';
import { readSessions, saveSessions } from '../lib/storage';
import type { Session } from '../lib/storage';
import { createRecognition } from '../lib/voice';
import type { Recognition, SpeechQueue } from '../lib/voice';
import { createSpeechQueue } from '../lib/speechQueue';
import { MiniMaxRecognition } from '../lib/minimaxRecognition';
import { getSpeechConfig } from '../lib/speechSettings';
import { isDefaultLanguagePair, languageName, miniMaxRecognitionLanguage } from '../lib/languages';
import { saveCorrection } from '../lib/learning';
import { companionName, personalizeGreeting } from '../lib/voicePresets';
import { trainingHintContext } from '../lib/customTraining';
import { requestCoachCompletion } from '../lib/coach';

/** 半双工阶段；转写、生成和播放期间均不能开启下一轮麦克风。 */
export type Phase = 'ready' | 'listening' | 'transcribing' | 'thinking' | 'speaking';
const id = () => crypto.randomUUID();
const requiresModelOpening = (scene: (typeof SCENES)[number], settings: Settings) =>
  !!scene.training || !isDefaultLanguagePair(settings);
const connectionMessage = (scene: (typeof SCENES)[number]) =>
  scene.training
    ? '自定义训练需要连接模型，请在模型设置中配置后继续。'
    : '这个语言组合需要连接模型，请在模型设置中配置后继续。';
const initial = (scene: (typeof SCENES)[number], settings: Settings): Message => ({
  id: id(),
  role: 'assistant',
  content: !requiresModelOpening(scene, settings)
    ? personalizeGreeting(scene.greeting, settings)
    : '',
  translation: !requiresModelOpening(scene, settings)
    ? personalizeGreeting(scene.translation, settings)
    : undefined,
  companionName: companionName(settings),
});
const initialHint = (scene: (typeof SCENES)[number], settings: Settings): Hint =>
  !requiresModelOpening(scene, settings)
    ? scene
    : {
        angle: settings.apiKey.trim()
          ? scene.training
            ? '正在根据你的要求准备训练…'
            : '正在准备当前语言的表达提示…'
          : '连接模型后，这里会给你当前语言的表达提示。',
        words: [],
        example: '',
      };

/**
 * 编排一次练习的文本、录音、朗读、两个教练与本地记录；展示和自动开麦策略由上层管理。
 * @param settings 当前供应商、两种交流语言及语音偏好；请求读取最新引用，不依赖旧闭包。
 * @param notify 仅接收可展示的错误或保存结果，不传入原始供应商正文与凭据。
 * @param isConversationActive 隐藏的学习页面不能触发主对话自动朗读。
 * @returns 会话状态与明确的操作入口；卸载时取消请求和媒体。
 */
export function usePractice(
  settings: Settings,
  notify: (text: string) => void,
  isConversationActive = true,
) {
  const isConversationActiveRef = useRef(isConversationActive);
  isConversationActiveRef.current = isConversationActive;
  const [scene, setScene] = useState(SCENES[0]);
  const [phase, setPhase] = useState<Phase>(isDefaultLanguagePair(settings) ? 'ready' : 'thinking');
  const [messages, setMessages] = useState<Message[]>(() => [initial(SCENES[0], settings)]);
  const [hint, setHint] = useState<Hint>(() => initialHint(SCENES[0], settings));
  const [review, setReview] = useState<Review | null>(null);
  const [rehearsal, setRehearsal] = useState<{ target: string; result: Review | null } | null>(
    null,
  );
  const rehearsalRef = useRef(rehearsal);
  rehearsalRef.current = rehearsal;
  const rehearsalController = useRef<AbortController | null>(null);
  const rehearsalEpoch = useRef(0);
  const [translationLoadingId, setTranslationLoadingId] = useState('');
  const translationRequest = useRef<{ id: string; controller: AbortController } | null>(null);
  const [isHintLoading, setIsHintLoading] = useState(false);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [hintError, setHintError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [error, setError] = useState('');
  const [recognitionError, setRecognitionError] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [hasPendingReply, setHasPendingReply] = useState(false);
  const [draft, setDraftState] = useState('');
  const draftRef = useRef(draft);
  const setDraft = (value: string) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(elapsed);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [sessions, setSessionsState] = useState<Session[]>(readSessions);
  const sessionsRef = useRef(sessions);
  const setSessions = (next: Session[]) => {
    sessionsRef.current = next;
    setSessionsState(next);
  };
  // 整轮失效与任务内替换分别计数：重试一个教练不能作废另一个教练。
  const epoch = useRef(0);
  const hintEpoch = useRef(0);
  const reviewEpoch = useRef(0);
  const recognitionEpoch = useRef(0);
  // 保存生成前的历史前缀，挂起时可丢弃半截助手消息，从同一条用户发言继续。
  const activeReply = useRef<Message[] | null>(null);
  const pendingReply = useRef<Message[] | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const coachingControllers = useRef(new Map<'hint' | 'review', AbortController>());
  const voice = useRef<SpeechQueue | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const submitRef = useRef<(text: string) => void>(() => {});
  const sessionId = useRef(id());
  const lastSubmittedAt = useRef<string | null>(null);
  const lastSavedSnapshot = useRef<{ messages: Message[]; duration: number } | null>(null);
  const isCurrentSessionDeleted = useRef(false);
  // 流式片段只用于界面和朗读，完整回复才能进入可保存的会话内容。
  const currentMessages = useRef(messages);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const turnStart = useRef(0);
  const [latency, setLatency] = useState<number | null>(null);
  const needsInitialOpening = useRef(!isDefaultLanguagePair(settings));

  /** 作废当前异步结果并释放资源；未完成主回复保留为待恢复历史，不当作完整回答保存。 */
  const abort = useCallback(() => {
    epoch.current++;
    recognitionEpoch.current++;
    hintEpoch.current++;
    reviewEpoch.current++;
    rehearsalEpoch.current++;
    rehearsalController.current = null;
    rehearsalRef.current = null;
    setRehearsal(null);
    translationRequest.current = null;
    setTranslationLoadingId('');
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    coachingControllers.current.clear();
    voice.current?.cancel();
    voice.current = null;
    if (activeReply.current) {
      // 被打断的流式回复从用户发言处恢复，不把空占位或半截回复传入下一轮。
      const history = activeReply.current;
      activeReply.current = null;
      pendingReply.current = history;
      currentMessages.current = history;
      setMessages(history);
      setHasPendingReply(true);
    }
    if (recognition.current) {
      recognition.current.onend = null;
      recognition.current.abort();
      recognition.current = null;
    }
    phaseRef.current = 'ready';
    setPhase('ready');
    setIsHintLoading(false);
    setIsReviewLoading(false);
    setIsTimerRunning(false);
    setIsTranscribing(false);
  }, []);

  useEffect(() => () => abort(), [abort]);
  useEffect(() => {
    if (!isTimerRunning) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setElapsed(++elapsedRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [isTimerRunning]);

  /** 同一教练只保留最新请求；取消不影响另一教练或主回复，版本校验仍防御迟到响应。 */
  const withRequest = async <T>(
    fn: (signal: AbortSignal) => Promise<T>,
    coachingRole?: 'hint' | 'review',
  ): Promise<T> => {
    const controller = new AbortController();
    if (coachingRole) {
      const previous = coachingControllers.current.get(coachingRole);
      previous?.abort();
      if (previous) controllers.current.delete(previous);
      coachingControllers.current.set(coachingRole, controller);
    }
    controllers.current.add(controller);
    try {
      return await fn(controller.signal);
    } finally {
      controllers.current.delete(controller);
      if (coachingRole && coachingControllers.current.get(coachingRole) === controller)
        coachingControllers.current.delete(coachingRole);
    }
  };

  /** 播放回调受整轮版本保护；文字仍在流式生成时，播完已有句子只退回 thinking。 */
  const makeVoice = (version: number, language = settingsRef.current.practiceLanguage) => {
    let warned = false;
    const onStart = () => {
      if (epoch.current === version) {
        phaseRef.current = 'speaking';
        setPhase('speaking');
      }
    };
    const onDone = () => {
      if (epoch.current === version) {
        voice.current = null;
        const nextPhase = activeReply.current ? 'thinking' : 'ready';
        phaseRef.current = nextPhase;
        setPhase(nextPhase);
      }
    };
    const onError = (message = '浏览器未能播放语音，你可以阅读文字后继续，或点击重听。') => {
      if (!warned && epoch.current === version) {
        warned = true;
        notify(message);
      }
    };
    return createSpeechQueue(settingsRef.current, onStart, onDone, onError, language);
  };

  /** 上区只根据语伴当前问题给接话建议；完成、失败与取消均不改动下区点评。 */
  const updateHint = async (history: Message[], version: number) => {
    const requestVersion = ++hintEpoch.current;
    setIsHintLoading(true);
    setHintError('');
    try {
      const s = settingsRef.current;
      const result = await withRequest(
        (signal) =>
          requestCoachCompletion(
            s,
            [
              {
                role: 'system',
                content: `${hintPrompt(s)} Learner level: ${s.level}.${sceneRef.current.training ? `\n${trainingHintContext(sceneRef.current.training)}` : ''}`,
              },
              ...history.slice(-6).map(({ role, content }) => ({ role, content })),
            ],
            { signal, model: s.hintModel, kind: 'hint' },
          ),
        'hint',
      );
      if (epoch.current === version && hintEpoch.current === requestVersion) setHint(result);
    } catch (e) {
      if (epoch.current === version && hintEpoch.current === requestVersion)
        setHintError(e instanceof Error ? e.message : '表达提示暂时不可用，请重试。');
    } finally {
      if (epoch.current === version && hintEpoch.current === requestVersion)
        setIsHintLoading(false);
    }
  };

  /** 下区只点评最新用户转写，保存该消息的纠错；没有原始音频，不能据此评判发音。 */
  const updateReview = async (history: Message[], version: number) => {
    const requestVersion = ++reviewEpoch.current;
    setIsReviewLoading(true);
    setReviewError('');
    try {
      const s = settingsRef.current;
      const result = await withRequest(
        (signal) =>
          requestCoachCompletion(
            s,
            [
              { role: 'system', content: reviewPrompt(s) },
              ...history.slice(-3).map(({ role, content }) => ({ role, content })),
            ],
            { signal, model: s.reviewModel, kind: 'review' },
          ),
        'review',
      );
      if (epoch.current === version && reviewEpoch.current === requestVersion) {
        setReview(result);
        const message = history.findLast((entry) => entry.role === 'user');
        if (message && !saveCorrection(result, message.id, s, false))
          notify('点评已显示，但浏览器未能保存到错题本。');
      }
    } catch (e) {
      if (epoch.current === version && reviewEpoch.current === requestVersion)
        setReviewError(e instanceof Error ? e.message : '点评暂时不可用，请重试。');
    } finally {
      if (epoch.current === version && reviewEpoch.current === requestVersion)
        setIsReviewLoading(false);
    }
  };

  /**
   * 为主对话生成一条助手回复，流式文本同时进入朗读队列，完成后再更新上区。
   * 上下文来自选定场景、训练文字和聊天历史；此链路没有摄像头图像或视频帧。
   */
  const generate = async (history: Message[], version: number) => {
    if (!history.length) turnStart.current = Date.now();
    if (
      !settingsRef.current.apiKey.trim() &&
      requiresModelOpening(sceneRef.current, settingsRef.current)
    ) {
      setError(connectionMessage(sceneRef.current));
      phaseRef.current = 'ready';
      setPhase('ready');
      return;
    }
    activeReply.current = history;
    pendingReply.current = null;
    setHasPendingReply(false);
    const s = settingsRef.current;
    const responseId = id();
    const responseName = companionName(s);
    setMessages([
      ...history,
      { id: responseId, role: 'assistant', content: '', companionName: responseName },
    ]);
    phaseRef.current = 'thinking';
    setPhase('thinking');
    setError('');
    const q = s.autoSpeak && isConversationActiveRef.current ? makeVoice(version) : null;
    voice.current = q;
    let first = true;
    try {
      let response: string;
      if (!s.apiKey.trim()) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        response = demoReply(
          history.at(-1)?.content || '',
          history.filter((m) => m.role === 'user').length - 1,
          sceneRef.current.id,
        );
        if (epoch.current !== version) return;
        setLatency(Date.now() - turnStart.current);
        setMessages([
          ...history,
          { id: responseId, role: 'assistant', content: response, companionName: responseName },
        ]);
        q?.push(response);
      } else {
        response = await withRequest((signal) =>
          requestChatCompletion(
            s,
            [
              { role: 'system', content: mainPrompt(sceneRef.current, s.level, s, responseName) },
              ...(history.length
                ? []
                : [
                    {
                      role: 'user',
                      content:
                        'Start a new conversation in the selected practice language. Greet me briefly and ask one easy question about the current scene.',
                    },
                  ]),
              ...history.slice(-24).map(({ role, content }) => ({ role, content })),
            ],
            {
              signal,
              onChunk: (text) => {
                if (epoch.current !== version) return;
                if (first) {
                  setLatency(Date.now() - turnStart.current);
                  first = false;
                }
                setMessages([
                  ...history,
                  { id: responseId, role: 'assistant', content: text, companionName: responseName },
                ]);
                q?.push(text);
              },
            },
          ),
        );
      }
      if (epoch.current !== version) return;
      const complete = [
        ...history,
        {
          id: responseId,
          role: 'assistant' as const,
          content: response,
          companionName: responseName,
        },
      ];
      activeReply.current = null;
      currentMessages.current = complete;
      setMessages(complete);
      if (q && voice.current === q) q.finish();
      else {
        phaseRef.current = 'ready';
        setPhase('ready');
      }
      saveSession();
      if (s.apiKey.trim()) void updateHint(complete, version);
      else setHint(demoHint(response));
    } catch (e) {
      if (epoch.current !== version) return;
      q?.cancel();
      voice.current = null;
      activeReply.current = null;
      currentMessages.current = history;
      setMessages(history);
      setError(e instanceof Error ? e.message : '回复暂时不可用，请重试。');
      phaseRef.current = 'ready';
      setPhase('ready');
    }
  };

  /** 发送前检查阶段与长度，超限保留草稿；新用户发言清除旧点评，避免跨句误读。 */
  const submit = (value: string) => {
    const text = value.trim();
    if (!text || phaseRef.current !== 'ready') return;
    if (
      !settingsRef.current.apiKey.trim() &&
      requiresModelOpening(sceneRef.current, settingsRef.current)
    ) {
      setError(connectionMessage(sceneRef.current));
      notify(
        sceneRef.current.training
          ? '自定义训练需要连接模型，不会使用无关的示范回答。'
          : '本地示范仅支持中文辅助练英语；其他语言组合请连接模型。',
      );
      return;
    }
    if (text.length > MAX_INPUT_LENGTH) {
      setDraft(value);
      notify(`这句话超过 ${MAX_INPUT_LENGTH} 字符，先精简一下再发送；原文已保留。`);
      return;
    }
    if (rehearsalRef.current) {
      void submitRehearsal(text);
      return;
    }
    if (pendingReply.current) {
      notify('上一句的回答还没完成，点继续后接着聊。');
      return;
    }
    setIsTimerRunning(true);
    // 新轮次作废并取消上一轮较慢的辅导，两个面板保留旧内容直到各自更新。
    const version = ++epoch.current;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    coachingControllers.current.clear();
    setIsHintLoading(false);
    setIsReviewLoading(false);
    setHintError('');
    setReviewError('');
    setReview(null);
    const history = [
      ...currentMessages.current,
      { id: id(), role: 'user' as const, content: text },
    ];
    currentMessages.current = history;
    setMessages(history);
    setDraft('');
    turnStart.current = Date.now();
    lastSubmittedAt.current = new Date(turnStart.current).toISOString();
    if (settingsRef.current.apiKey.trim()) void updateReview(history, version);
    else setReview(demoReview(text));
    void generate(history, version);
  };
  submitRef.current = submit;

  /** 仅终止录音 / 转写并保留已识别草稿，不取消仍有价值的两个教练请求。 */
  const interruptListening = () => {
    const currentRecognition = recognition.current;
    if (!currentRecognition) return;
    recognitionEpoch.current++;
    recognition.current = null;
    currentRecognition.onresult = null;
    currentRecognition.onerror = null;
    currentRecognition.onend = null;
    currentRecognition.onstart = null;
    currentRecognition.abort();
    setIsTranscribing(false);
    phaseRef.current = 'ready';
    setPhase('ready');
  };
  /** 例句只进入草稿，不代替用户发送；已有不同草稿时拒绝覆盖。 */
  const prepareExampleDraft = (example: string): boolean => {
    if (!['ready', 'listening'].includes(phaseRef.current) || pendingReply.current) return false;
    interruptListening();
    if (draftRef.current.trim() && draftRef.current !== example) {
      notify('输入框里已有你刚才的话，先发送或放弃，再使用例句。');
      return false;
    }
    setDraft(example);
    return true;
  };

  /**
   * 在 ready 阶段选择识别适配器，等待整轮结束后按偏好提交或保留转写。
   * 麦克风授权由设备控制；错误交给媒体策略暂停，避免不断重新请求权限。
   */
  const startListening = () => {
    if (phaseRef.current !== 'ready' || error || pendingReply.current) return;
    setIsTimerRunning(true);
    if (
      settingsRef.current.recognitionProvider === 'minimax' &&
      miniMaxRecognitionLanguage(settingsRef.current) === undefined
    ) {
      setRecognitionError('unsupported-language');
      notify(
        `MiniMax 暂未支持${languageName(settingsRef.current.practiceLanguage)}转写，可以改用浏览器识别或文字交流。`,
      );
      return;
    }
    const r =
      settingsRef.current.recognitionProvider === 'minimax'
        ? new MiniMaxRecognition(getSpeechConfig(settingsRef.current))
        : createRecognition(
            settingsRef.current.practiceLanguage,
            settingsRef.current.speechPauseMs,
          );
    if (!r) {
      setRecognitionError('当前浏览器不支持语音识别');
      notify('当前浏览器不支持语音识别，请用 Chrome / Edge，或使用文字输入。');
      return;
    }
    voice.current?.cancel();
    setDraft('');
    setError('');
    setRecognitionError('');
    const version = epoch.current;
    const listeningVersion = ++recognitionEpoch.current;
    let transcript = '';
    let failed = false;
    recognition.current = r;
    r.lang = settingsRef.current.practiceLanguage;
    setIsTranscribing(false);
    phaseRef.current = 'listening';
    setPhase('listening');
    r.onprocessing = () => {
      if (epoch.current === version && recognitionEpoch.current === listeningVersion) {
        setIsTranscribing(true);
        phaseRef.current = 'transcribing';
        setPhase('transcribing');
      }
    };
    r.onresult = (e) => {
      if (epoch.current !== version || recognitionEpoch.current !== listeningVersion) return;
      transcript = Array.from(e.results)
        .map((result) => result[0].transcript)
        .join(' ');
      setDraft(transcript);
    };
    r.onerror = (e) => {
      if (
        epoch.current !== version ||
        recognitionEpoch.current !== listeningVersion ||
        e.error === 'aborted'
      )
        return;
      failed = true;
      setIsTranscribing(false);
      setRecognitionError(e.error);
      const errors: Record<string, string> = {
        'not-allowed': '请在浏览器中允许麦克风权限，然后重试。',
        'audio-capture': '没有找到可用的麦克风，请检查设备。',
        network: '语音识别服务连接失败，请检查网络，或使用文字输入。',
        'no-speech': '没有听到声音，再试一次吧。',
      };
      notify(e.message || errors[e.error] || '语音识别暂时不可用，可以先用文字聊天。');
      phaseRef.current = 'ready';
      setPhase('ready');
    };
    r.onend = () => {
      if (epoch.current !== version || recognitionEpoch.current !== listeningVersion) return;
      recognition.current = null;
      setIsTranscribing(false);
      phaseRef.current = 'ready';
      setPhase('ready');
      if (!failed && transcript.trim() && settingsRef.current.autoSubmit)
        submitRef.current(transcript);
      else if (transcript.trim()) setDraft(transcript);
      else if (!failed) {
        setRecognitionError('no-speech');
        notify('这次没有听到清晰的话，准备好后点继续，也可以打字聊。');
      }
    };
    try {
      r.start();
    } catch {
      recognition.current = null;
      setIsTranscribing(false);
      phaseRef.current = 'ready';
      setPhase('ready');
      setRecognitionError('无法启动麦克风');
      notify('无法启动麦克风，请刷新浏览器权限后重试。');
    }
  };

  /** 重听是独立播放操作，不追加消息、不重发模型请求；调用方需先中断正在进行的识别。 */
  const replay = (text: string, language = settingsRef.current.practiceLanguage) => {
    if (phaseRef.current !== 'ready') return;
    const version = epoch.current;
    voice.current?.cancel();
    const q = makeVoice(version, language);
    voice.current = q;
    phaseRef.current = 'speaking';
    setPhase('speaking');
    q.push(text);
    q.finish();
  };
  /** 跳过当前声音；主回复文字尚未完成时保留其生成过程与教练请求。 */
  const stopSpeaking = () => {
    if (!voice.current && !activeReply.current) return;
    voice.current?.cancel();
    voice.current = null;
    // 跳过声音不取消仍在生成的文字，也不抢走两个教练的请求。
    const nextPhase = activeReply.current ? 'thinking' : 'ready';
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  };
  /** 临时挂起媒体；普通后台中断保留续接前缀，指定保留回复时允许文字继续完成。 */
  const suspend = (options?: { preserveReply?: boolean }) => {
    if (activeReply.current && !options?.preserveReply) {
      abort();
      return;
    }
    // 主回复已结束时，暂停媒体不丢弃仍在完成的独立辅导结果。
    interruptListening();
    stopSpeaking();
    setIsTimerRunning(false);
  };
  /**
   * 保存已提交发言和完整回复；内容和时长都未变化时复用已持久化的快照。
   * @returns true 表示已保存，false 表示保存失败，null 表示当前会话没有可保存的记录。
   */
  const saveSession = (): boolean | null => {
    const date = lastSubmittedAt.current;
    if (!date || isCurrentSessionDeleted.current) return null;
    const messages = currentMessages.current;
    const duration = elapsedRef.current;
    if (
      lastSavedSnapshot.current?.messages === messages &&
      lastSavedSnapshot.current.duration === duration
    )
      return true;
    const record: Session = {
      id: sessionId.current,
      date,
      scene: sceneRef.current.id,
      title: sceneRef.current.title,
      duration,
      messages: messages.filter((m) => m.content.trim()),
      words: wordsIn(messages, settingsRef.current.practiceLanguage),
      supportLanguage: settingsRef.current.supportLanguage,
      practiceLanguage: settingsRef.current.practiceLanguage,
      lessonId: sceneRef.current.lessonId,
      goalTurns: sceneRef.current.goalTurns,
      isDemo: !settingsRef.current.apiKey.trim(),
    };
    const next = [
      record,
      ...sessionsRef.current.filter((session) => session.id !== record.id),
    ].slice(0, MAX_SESSIONS);
    const isPersisted = saveSessions(next);
    setSessions(next);
    if (isPersisted) lastSavedSnapshot.current = { messages, duration };
    else notify('浏览器未能保存练习记录，请先导出对话。');
    return isPersisted;
  };
  /** 删除当前会话的历史快照后，该会话结束前都不再自动写入。 */
  const deleteSession = (id: string) => {
    const remaining = sessionsRef.current.filter((session) => session.id !== id);
    if (!saveSessions(remaining)) {
      notify('浏览器未能删除练习记录，请重试。');
      return;
    }
    const isCurrentSession = id === sessionId.current;
    if (isCurrentSession) isCurrentSessionDeleted.current = true;
    setSessions(remaining);
    notify(isCurrentSession ? '练习记录已删除。开始新对话后会恢复自动保存。' : '练习记录已删除。');
  };
  /** 先保存旧会话再释放任务，按新场景和语言重置两区；自定义训练开场必须调用真实模型。 */
  const newSession = (nextScene = scene, nextSettings = settingsRef.current) => {
    saveSession();
    abort();
    settingsRef.current = nextSettings;
    needsInitialOpening.current = false;
    sessionId.current = id();
    lastSubmittedAt.current = null;
    lastSavedSnapshot.current = null;
    isCurrentSessionDeleted.current = false;
    sceneRef.current = nextScene;
    setScene(nextScene);
    const opening = initial(nextScene, nextSettings);
    currentMessages.current = [opening];
    setMessages([opening]);
    setHint(initialHint(nextScene, nextSettings));
    setReview(null);
    setHintError('');
    setReviewError('');
    setError('');
    setRecognitionError('');
    elapsedRef.current = 0;
    setElapsed(0);
    setDraft('');
    setLatency(null);
    activeReply.current = null;
    pendingReply.current = null;
    setHasPendingReply(false);
    if (requiresModelOpening(nextScene, nextSettings)) {
      if (nextSettings.apiKey.trim()) void generate([], epoch.current);
      else setError(connectionMessage(nextScene));
    }
  };

  /** 退出独立重练，取消其识别和点评；不把尝试追加到主聊天或课程进度。 */
  const cancelRehearsal = () => {
    if (!rehearsalRef.current) return;
    rehearsalEpoch.current++;
    const controller = rehearsalController.current;
    controller?.abort();
    if (controller) controllers.current.delete(controller);
    rehearsalController.current = null;
    interruptListening();
    rehearsalRef.current = null;
    setRehearsal(null);
    setDraft('');
    phaseRef.current = 'ready';
    setPhase('ready');
  };

  /** 重练仅更新当前练习结果，不追加聊天消息，也不推动课程或主陪练的下一轮。 */
  const submitRehearsal = async (text: string) => {
    const current = rehearsalRef.current;
    if (!current) return;
    const version = epoch.current,
      requestVersion = ++rehearsalEpoch.current;
    const controller = new AbortController();
    rehearsalController.current?.abort();
    rehearsalController.current = controller;
    controllers.current.add(controller);
    phaseRef.current = 'thinking';
    setPhase('thinking');
    setDraft('');
    try {
      const s = settingsRef.current;
      const result = s.apiKey.trim()
        ? await requestCoachCompletion(
            s,
            [
              { role: 'system', content: rehearsalPrompt(s, current.target) },
              { role: 'user', content: text },
            ],
            { signal: controller.signal, model: s.reviewModel, kind: 'review' },
          )
        : demoReview(text);
      if (epoch.current !== version || rehearsalEpoch.current !== requestVersion) return;
      const next = { ...current, result };
      rehearsalRef.current = next;
      setRehearsal(next);
    } catch (error) {
      if (epoch.current === version && rehearsalEpoch.current === requestVersion) {
        setDraft(text);
        notify(error instanceof Error ? error.message : '重练点评失败，请重试。');
      }
    } finally {
      controllers.current.delete(controller);
      if (epoch.current === version && rehearsalEpoch.current === requestVersion) {
        rehearsalController.current = null;
        phaseRef.current = 'ready';
        setPhase('ready');
      }
    }
  };

  /** 按消息缓存按需翻译；新会话或中断后，旧响应不得写回当前字幕。 */
  const translateMessage = async (messageId: string) => {
    const message = currentMessages.current.find(
      (entry) => entry.id === messageId && entry.role === 'assistant',
    );
    if (
      !message?.content.trim() ||
      message.translation ||
      translationRequest.current?.id === messageId
    )
      return;
    if (phaseRef.current === 'thinking' || activeReply.current) return;
    const s = settingsRef.current;
    if (!s.apiKey.trim()) {
      notify('示范模式只提供开场翻译，连接模型后可翻译每轮对话。');
      return;
    }
    translationRequest.current?.controller.abort();
    const controller = new AbortController();
    translationRequest.current = { id: messageId, controller };
    controllers.current.add(controller);
    setTranslationLoadingId(messageId);
    const version = epoch.current;
    try {
      const text = await requestChatCompletion(
        s,
        [
          { role: 'system', content: translationPrompt(s) },
          { role: 'user', content: message.content },
        ],
        { signal: controller.signal, model: s.hintModel },
      );
      if (epoch.current !== version || controller.signal.aborted) return;
      const next = currentMessages.current.map((entry) =>
        entry.id === messageId ? { ...entry, translation: text } : entry,
      );
      currentMessages.current = next;
      setMessages(next);
      saveSession();
    } catch (error) {
      if (epoch.current === version && !controller.signal.aborted)
        notify(error instanceof Error ? error.message : '翻译暂时不可用，请重试。');
    } finally {
      controllers.current.delete(controller);
      if (translationRequest.current?.controller === controller) {
        translationRequest.current = null;
        setTranslationLoadingId('');
      }
    }
  };

  useEffect(() => {
    if (!needsInitialOpening.current) return;
    const timer = setTimeout(() => {
      if (!needsInitialOpening.current) return;
      needsInitialOpening.current = false;
      if (settingsRef.current.apiKey.trim()) void generate([], epoch.current);
      else {
        setError('这个语言组合需要连接模型，请在模型设置中配置后继续。');
        phaseRef.current = 'ready';
        setPhase('ready');
      }
    }, 0);
    return () => clearTimeout(timer);
    // 初次非默认语言只生成一次开场；后续语言与场景切换通过 newSession 显式启动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sessionId: sessionId.current,
    scene,
    companionName: companionName(settings),
    supportLanguage: settings.supportLanguage,
    practiceLanguage: settings.practiceLanguage,
    phase,
    messages,
    hint,
    review,
    rehearsal,
    translationLoadingId,
    translateMessage,
    beginRehearsal: (target: string): boolean => {
      if (
        !target.trim() ||
        !['ready', 'listening'].includes(phaseRef.current) ||
        pendingReply.current
      )
        return false;
      if (draftRef.current.trim()) {
        notify('输入框里还有未发送的话，请先发送或放弃。');
        return false;
      }
      interruptListening();
      rehearsalEpoch.current++;
      const next = { target, result: null };
      rehearsalRef.current = next;
      setRehearsal(next);
      return true;
    },
    cancelRehearsal,
    isHintLoading,
    isReviewLoading,
    hintError,
    reviewError,
    error,
    recognitionError,
    isTranscribing,
    hasPendingReply,
    clearRecognitionError: () => setRecognitionError(''),
    draft,
    setDraft,
    elapsed,
    latency,
    sessions,
    deleteSession,
    submit,
    startListening,
    interruptListening,
    prepareExampleDraft,
    stopListening: () => recognition.current?.stop(),
    replay,
    stopSpeaking,
    updateSpeechSettings: (nextSettings: Settings) => {
      stopSpeaking();
      const previousSettings = settingsRef.current;
      const greeting = currentMessages.current[0];
      // 尚未开聊的预置自我介绍随名字更新；已发生的对话与模型生成文本保留原文。
      if (
        !requiresModelOpening(sceneRef.current, nextSettings) &&
        currentMessages.current.length === 1 &&
        greeting?.role === 'assistant' &&
        greeting.content === personalizeGreeting(sceneRef.current.greeting, previousSettings)
      ) {
        const opening = { ...initial(sceneRef.current, nextSettings), id: greeting.id };
        currentMessages.current = [opening];
        setMessages([opening]);
      }
      settingsRef.current = nextSettings;
    },
    suspend,
    newSession,
    saveSession,
    abort,
    resumePendingReply: () => {
      if (phaseRef.current !== 'ready' || !pendingReply.current) return false;
      const history = pendingReply.current;
      const version = ++epoch.current;
      turnStart.current = Date.now();
      setIsTimerRunning(true);
      if (settingsRef.current.apiKey.trim() && history.some((message) => message.role === 'user'))
        void updateReview(history, version);
      void generate(history, version);
      return true;
    },
    retry: () => {
      if (phaseRef.current !== 'ready') return;
      const history = currentMessages.current.filter((m) => m.content.trim());
      if (
        history.at(-1)?.role === 'user' ||
        (!history.length && requiresModelOpening(sceneRef.current, settingsRef.current))
      ) {
        // 重试仍属于同一句用户发言，不作废这轮尚未完成的独立点评。
        const version = epoch.current;
        turnStart.current = Date.now();
        void generate(history, version);
      }
    },
    retryHint: () => {
      if (settings.apiKey) void updateHint(currentMessages.current, epoch.current);
    },
    retryReview: () => {
      if (settings.apiKey) {
        const last = currentMessages.current.findLastIndex((m) => m.role === 'user');
        if (last >= 0) void updateReview(currentMessages.current.slice(0, last + 1), epoch.current);
      }
    },
  };
}

function demoHint(reply: string): Hint {
  if (/unwind|yourself|easier/.test(reply))
    return {
      angle: '分享一种让你放松的小习惯，再说说为什么喜欢它。',
      words: [
        { en: 'clear my mind', zh: '放空思绪' },
        { en: 'take a break', zh: '休息一下' },
        { en: 'recharge', zh: '恢复精力' },
      ],
      example:
        'I usually listen to music or go for a short walk. It helps me clear my mind and recharge.',
    };
  if (/place|adventure|explor/.test(reply))
    return {
      angle: '描述一个喜欢的地方，聊聊那里吸引你的原因。',
      words: [
        { en: 'peaceful', zh: '宁静的' },
        { en: 'scenery', zh: '风景' },
        { en: 'hidden gem', zh: '宝藏地点' },
      ],
      example:
        'There’s a little park near my home. It’s really peaceful, and I love going there in the evening.',
    };
  return {
    angle: '接着分享一个具体的小细节，让对话自然继续。',
    words: [
      { en: 'to be honest', zh: '说实话' },
      { en: 'I’d love to', zh: '我很想' },
      { en: 'what about you?', zh: '你呢？' },
    ],
    example:
      'To be honest, I’d love to try something new this week. Maybe cooking a new recipe. What about you?',
  };
}
