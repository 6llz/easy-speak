import { useEffect, useRef, useState } from 'react';
import type { usePractice, Phase } from './usePractice';
import { CameraController } from '../lib/camera';
import { canStartListening, getSessionState } from '../lib/sessionPolicy';
import type { SessionIntent, SessionPolicy } from '../lib/sessionPolicy';

type MediaSessionOptions = {
  practice: ReturnType<typeof usePractice>;
  isTextMode: boolean;
  isOverlayOpen: boolean;
  isAutoSpeak: boolean;
  isScreenActive?: boolean;
  preserveReplyOnOverlay?: boolean;
  notify: (message: string) => void;
};
const LISTEN_DELAY_MS = 400;

/**
 * 进入页面即陪练；用户暂停意图与弹层、后台等临时中断分别管理。
 * 摄像头只提供本机预览，结束或离开页面后释放媒体资源。
 */
export function useMediaSession({
  practice,
  isTextMode,
  isOverlayOpen,
  isAutoSpeak,
  notify,
  isScreenActive = true,
  preserveReplyOnOverlay = false,
}: MediaSessionOptions) {
  const [intent, setIntent] = useState<SessionIntent>('active');
  const [isHidden, setIsHidden] = useState(() => document.visibilityState === 'hidden');
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraVersion = useRef(0);
  const cameraController = useRef(new CameraController());
  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const previousSession = useRef(practice.sessionId);
  const greetedSession = useRef<string | null>(null);
  const interruptedPhase = useRef<Phase>('ready');
  const requestedSpeech = useRef<string | null>(null);
  const isMediaOverlayOpen = isOverlayOpen || !isScreenActive;
  const sessionState = getSessionState({ intent, isHidden, isOverlayOpen: isMediaOverlayOpen });
  const previousState = useRef(sessionState);
  const policy: SessionPolicy = {
    intent,
    isOverlayOpen: isMediaOverlayOpen,
    isHidden,
    isTextMode,
    phase: practice.phase,
    hasError: !!practice.error || !!practice.rehearsal?.result,
    hasRecognitionError: !!practice.recognitionError,
    hasDraft: !!practice.draft.trim(),
    hasPendingReply: practice.hasPendingReply,
  };
  const policyRef = useRef(policy);
  policyRef.current = policy;

  /** 释放预览与轨道；当前摄像头链路不采样画面，也不向 usePractice 传递视觉上下文。 */
  const stopCamera = () => {
    cameraVersion.current++;
    cameraController.current.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraOn(false);
    setIsCameraLoading(false);
  };
  /** 用户主动点击才请求相机；权限晚到时以最新版本为准，不能在挂断后恢复镜头。 */
  const handleToggleCamera = async () => {
    if (isCameraOn || isCameraLoading) {
      stopCamera();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('当前浏览器无法使用摄像头，请使用 HTTPS 或本机地址打开。');
      return;
    }
    const version = ++cameraVersion.current;
    setIsCameraLoading(true);
    try {
      const stream = await cameraController.current.open();
      if (!stream) return;
      if (version !== cameraVersion.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setIsCameraOn(true);
    } catch (error) {
      if (version === cameraVersion.current)
        notify(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? '摄像头权限未开启，可以在浏览器中允许后再试。'
            : '无法开启摄像头，请检查设备是否被占用。',
        );
    } finally {
      if (version === cameraVersion.current) setIsCameraLoading(false);
    }
  };
  useEffect(() => {
    if (isScreenActive) return;
    cameraVersion.current++;
    cameraController.current.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraOn(false);
    setIsCameraLoading(false);
  }, [isScreenActive]);
  useEffect(() => {
    if (!isCameraOn || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch(() => notify('摄像头已开启，浏览器暂停了预览播放。'));
  }, [isCameraOn, notify]);

  // 开场只执行一次；在定时器真正运行时标记，兼容 StrictMode 的挂载检查。
  useEffect(() => {
    if (sessionState !== 'active' || isTextMode || greetedSession.current === practice.sessionId)
      return;
    const timer = setTimeout(() => {
      if (getSessionState(policyRef.current) !== 'active') return;
      const greeting = practiceRef.current.messages.findLast(
        (message) => message.role === 'assistant',
      );
      // 从课程页进入的多语言开场可能仍在生成，等到有完整回复再决定是否补播。
      if (practiceRef.current.phase === 'thinking' || practiceRef.current.hasPendingReply) return;
      greetedSession.current = practiceRef.current.sessionId;
      if (
        isAutoSpeak &&
        greeting?.content &&
        !practiceRef.current.error &&
        practiceRef.current.phase === 'ready'
      )
        practiceRef.current.replay(greeting.content);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    sessionState,
    isTextMode,
    isAutoSpeak,
    practice.sessionId,
    practice.phase,
    practice.messages,
  ]);

  // 播放后留出尾音间隔；回调执行前再次校验，避免点击结束和计时器同一帧竞态。
  useEffect(() => {
    if (!canStartListening(policyRef.current)) return;
    const timer = setTimeout(() => {
      if (canStartListening(policyRef.current)) practiceRef.current.startListening();
    }, LISTEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    sessionState,
    intent,
    isTextMode,
    isOverlayOpen,
    isScreenActive,
    isHidden,
    practice.phase,
    practice.error,
    practice.recognitionError,
    practice.draft,
    practice.hasPendingReply,
    practice.rehearsal,
    practice.messages,
  ]);

  useEffect(() => {
    const before = previousState.current;
    previousState.current = sessionState;
    if (before === 'active' && sessionState === 'paused') {
      if (practiceRef.current.phase !== 'ready')
        interruptedPhase.current = practiceRef.current.phase;
      if (preserveReplyOnOverlay) interruptedPhase.current = 'ready';
      practiceRef.current.suspend(preserveReplyOnOverlay ? { preserveReply: true } : undefined);
    } else if (before === 'paused' && sessionState === 'active') {
      const phaseToResume = interruptedPhase.current;
      interruptedPhase.current = 'ready';
      if (practiceRef.current.resumePendingReply()) return;
      const lastAssistant = practiceRef.current.messages.findLast(
        (message) => message.role === 'assistant',
      );
      const interruptedText = requestedSpeech.current || lastAssistant?.content;
      if (
        phaseToResume === 'speaking' &&
        interruptedText &&
        (requestedSpeech.current || (isAutoSpeak && !isTextMode))
      )
        practiceRef.current.replay(interruptedText);
    }
  }, [sessionState, isAutoSpeak, isTextMode, preserveReplyOnOverlay]);

  useEffect(() => {
    if (practice.phase === 'listening' || practice.phase === 'thinking')
      requestedSpeech.current = null;
  }, [practice.phase]);

  useEffect(() => {
    if (intent === 'active' && practice.recognitionError) {
      policyRef.current.intent = 'paused';
      setIntent('paused');
    }
  }, [intent, practice.recognitionError]);

  useEffect(() => {
    if (isTextMode && practice.phase === 'listening') practiceRef.current.interruptListening();
  }, [isTextMode, practice.phase]);

  useEffect(() => {
    if (previousSession.current !== practice.sessionId) {
      previousSession.current = practice.sessionId;
      interruptedPhase.current = 'ready';
      requestedSpeech.current = null;
      policyRef.current.intent = 'active';
      setIntent('active');
    }
  }, [practice.sessionId]);

  useEffect(() => {
    const controller = cameraController.current;
    const versionRef = cameraVersion;
    const handleVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      policyRef.current.isHidden = hidden;
      setIsHidden(hidden);
      if (hidden) {
        versionRef.current++;
        controller.stop();
        streamRef.current = null;
        setIsCameraOn(false);
        setIsCameraLoading(false);
      }
    };
    const handlePageHide = () => {
      if (getSessionState(policyRef.current) === 'active')
        interruptedPhase.current = practiceRef.current.phase;
      policyRef.current.isHidden = true;
      setIsHidden(true);
      versionRef.current++;
      controller.stop();
      streamRef.current = null;
      setIsCameraOn(false);
      setIsCameraLoading(false);
      practiceRef.current.abort();
      practiceRef.current.saveSession();
    };
    const handlePageShow = () => handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      versionRef.current++;
      controller.stop();
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.code !== 'KeyM' ||
        getSessionState(policyRef.current) !== 'active' ||
        isTextMode
      )
        return;
      event.preventDefault();
      if (practiceRef.current.phase === 'listening') practiceRef.current.stopListening();
      else if (canStartListening(policyRef.current)) practiceRef.current.startListening();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [isTextMode]);

  /** 显式暂停写入用户意图，关闭弹层或返回前台不能自行撤销这一意图。 */
  const pauseSession = () => {
    policyRef.current.intent = 'paused';
    setIntent('paused');
  };
  /** 恢复受用户手势与开麦门控约束；已结束的会话通过新会话重新进入。 */
  const resumeSession = () => {
    practice.clearRecognitionError();
    if (intent === 'ended') practice.newSession();
    policyRef.current.intent = 'active';
    policyRef.current.hasRecognitionError = false;
    setIntent('active');
    // 权限恢复沿用“继续”的用户手势；正常播报后的自动轮次仍保留尾音间隔。
    if (
      intent !== 'ended' &&
      interruptedPhase.current !== 'speaking' &&
      canStartListening(policyRef.current)
    )
      practice.startListening();
  };
  /** 挂断取消全部会话任务、保存文本快照并关闭相机；不保留后台采集。 */
  const endSession = () => {
    requestedSpeech.current = null;
    policyRef.current.intent = 'ended';
    setIntent('ended');
    practice.abort();
    const record = practice.saveSession();
    practice.setDraft('');
    stopCamera();
    notifyRef.current(record ? '这次陪练结束了，练习记录已保留。' : '这次陪练结束了，休息一下吧。');
  };
  /** 听例句 / 改进表达前先停识别，保留草稿；挂断、后台与待恢复主回复期间拒绝播放。 */
  const speakOnDemand = (text: string): boolean => {
    const currentPolicy = policyRef.current;
    if (
      getSessionState(currentPolicy) === 'ended' ||
      currentPolicy.isHidden ||
      currentPolicy.isOverlayOpen ||
      currentPolicy.hasPendingReply ||
      !text.trim() ||
      !['ready', 'listening'].includes(practiceRef.current.phase)
    )
      return false;
    // 只中断识别，独立教练的网络请求继续；保留转写，由用户确认后再发送。
    practiceRef.current.interruptListening();
    requestedSpeech.current = text;
    currentPolicy.phase = 'speaking';
    practiceRef.current.replay(text);
    return true;
  };
  return {
    sessionState,
    isCameraOn,
    isCameraLoading,
    videoRef,
    handleToggleCamera,
    pauseSession,
    resumeSession,
    endSession,
    speakOnDemand,
  };
}
