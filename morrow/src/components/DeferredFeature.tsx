import { Component, Suspense, lazy, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Modal } from './Modal';

type DeferredFeatureProps<Props extends object> = {
  load: () => Promise<{ default: ComponentType<Props> }>;
  featureProps: Props;
  title: string;
  onClose: () => void;
  presentation?: 'page' | 'modal' | 'inline';
};

type FeatureBoundaryProps = { children: ReactNode; fallback: ReactNode };

class FeatureBoundary extends Component<FeatureBoundaryProps, { hasFailed: boolean }> {
  state = { hasFailed: false };

  static getDerivedStateFromError() {
    return { hasFailed: true };
  }

  render() {
    return this.state.hasFailed ? this.props.fallback : this.props.children;
  }
}

/**
 * 次要功能按需载入；失败只替换当前功能，并保留返回对话的入口。
 * load 使用模块级稳定函数。重试建立新的 lazy 实例，避开 React 对失败 Promise 的缓存。
 */
export function DeferredFeature<Props extends object>({
  load,
  featureProps,
  title,
  onClose,
  presentation = 'inline',
}: DeferredFeatureProps<Props>) {
  const [attempt, setAttempt] = useState(() => ({ Component: lazy(load), number: 0 }));
  const handleRetry = () =>
    setAttempt((previous) => ({ Component: lazy(load), number: previous.number + 1 }));
  const renderFallback = (hasFailed: boolean) => {
    const content = (
      <section className={presentation === 'page' ? 'course-hero' : 'tip-note'}>
        <div role={hasFailed ? 'alert' : 'status'}>
          <h2>{hasFailed ? `${title}暂时无法打开` : `正在打开${title}…`}</h2>
          <p>{hasFailed ? '可以重新尝试，也可以先回到对话。' : '马上就好，可以随时取消。'}</p>
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            {presentation === 'page' ? '返回对话' : '取消'}
          </button>
          {hasFailed && (
            <button className="button primary" onClick={handleRetry}>
              重新尝试
            </button>
          )}
        </div>
      </section>
    );
    if (presentation === 'modal') {
      return (
        <Modal title={title} onClose={onClose}>
          {content}
        </Modal>
      );
    }
    return presentation === 'page' ? <div className="learning-shell">{content}</div> : content;
  };
  const Feature = attempt.Component;
  return (
    <FeatureBoundary key={attempt.number} fallback={renderFallback(true)}>
      <Suspense fallback={renderFallback(false)}>
        <Feature {...featureProps} />
      </Suspense>
    </FeatureBoundary>
  );
}
