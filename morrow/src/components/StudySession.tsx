import { useState } from 'react';
import { ArrowRight, Check, RotateCcw, Volume2 } from 'lucide-react';
import type { ReviewGrade, StudyItem } from '../lib/learning';
import { languageName } from '../lib/languages';

type StudySessionProps = {
  items: StudyItem[];
  onGrade: (item: StudyItem, grade: ReviewGrade) => void;
  onSpeak: (text: string, language: string) => void;
  canSpeak: boolean;
  onClose: () => void;
};

/** 一次复习使用固定快照；已完成后显示结果，不循环刷题或重算待复习列表。 */
export function StudySession({ items, onGrade, onSpeak, canSpeak, onClose }: StudySessionProps) {
  const [index, setIndex] = useState(0);
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [againCount, setAgainCount] = useState(0);
  const item = items[index];
  const handleGrade = (grade: ReviewGrade) => {
    if (!item || !isAnswerVisible) return;
    onGrade(item, grade);
    if (grade === 'again') setAgainCount((count) => count + 1);
    setIndex((current) => current + 1);
    setIsAnswerVisible(false);
  };
  if (!item)
    return (
      <div className="study-complete">
        <span className="learning-symbol">
          <Check size={32} />
        </span>
        <h3>这组复习完成了</h3>
        <p>
          复习了 {items.length} 个表达，{againCount} 个会稍后再见。
        </p>
        <p className="muted small">熟悉程度由你自评，下次会按间隔安排。</p>
        <button className="button primary" onClick={onClose}>
          完成
          <ArrowRight size={16} />
        </button>
      </div>
    );
  return (
    <div className="study-session">
      <div className="learning-row">
        <span className="eyebrow">
          {item.kind === 'correction' ? '从错题中进步' : '回想，再开口'}
        </span>
        <span className="muted small">
          {index + 1} / {items.length}
        </span>
      </div>
      <progress max={items.length} value={index} aria-label="本组复习进度" />
      <div className="study-prompt">
        <span className="muted small">
          {item.kind === 'correction'
            ? '这句话可以怎么说得更自然？'
            : `用${languageName(item.practiceLanguage)}怎么说？`}
        </span>
        <h3
          lang={item.kind === 'correction' ? item.practiceLanguage : item.supportLanguage}
          dir="auto"
        >
          {item.original || item.meaning || '先回想这句话的意思，再查看原文。'}
        </h3>
        {isAnswerVisible ? (
          <div className="study-answer">
            <p lang={item.practiceLanguage} dir="auto">
              {item.text}
            </p>
            {item.explanation && (
              <p className="muted small" lang={item.supportLanguage} dir="auto">
                {item.meaning}
              </p>
            )}
            <button
              className="text-button"
              disabled={!canSpeak}
              onClick={() => onSpeak(item.text, item.practiceLanguage)}
            >
              <Volume2 size={16} />
              听一听，再自己说一遍
            </button>
          </div>
        ) : (
          <button className="button secondary" onClick={() => setIsAnswerVisible(true)}>
            想好了，查看表达
            <ArrowRight size={15} />
          </button>
        )}
      </div>
      <p className="muted small">自己说一遍，再选择熟悉程度。这里不评估发音。</p>
      <div className="study-grades" aria-label="自评熟悉程度">
        <button disabled={!isAnswerVisible} onClick={() => handleGrade('again')}>
          <RotateCcw size={16} />
          再练练<small>10 分钟后</small>
        </button>
        <button disabled={!isAnswerVisible} onClick={() => handleGrade('familiar')}>
          有点印象<small>明天再见</small>
        </button>
        <button disabled={!isAnswerVisible} onClick={() => handleGrade('known')}>
          <Check size={16} />
          记住了<small>逐渐延长间隔</small>
        </button>
      </div>
    </div>
  );
}
