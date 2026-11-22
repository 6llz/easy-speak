import {
  ArrowDownToLine,
  ArrowRight,
  Bookmark,
  BookOpen,
  Clock3,
  Headphones,
  MessageCircle,
  Search,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useState } from 'react';
import { SCENES } from '../lib/core';
import { downloadText } from '../lib/storage';
import type { SavedPhrase, Session } from '../lib/storage';
import { formatTime, messageSpeakerName } from '../lib/format';
import { languageName } from '../lib/languages';
import { Modal } from './Modal';
import { APP_NAME } from '../lib/brand';

type HistoryPageProps = {
  sessions: Session[];
  currentSessionId?: string;
  onDelete: (id: string) => void;
  onStart: () => void;
};
export function HistoryPage({ sessions, currentSessionId, onDelete, onStart }: HistoryPageProps) {
  const [selected, setSelected] = useState<Session | null>(null);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const filtered = sessions.filter(
    (s) =>
      s.title.includes(search) ||
      s.messages.some((m) => m.content.toLowerCase().includes(search.toLowerCase())),
  );
  const totalWords = sessions.reduce((n, s) => n + s.words, 0);
  return (
    <div className="inner-page">
      <div className="page-eyebrow">EVERY CONVERSATION COUNTS</div>
      <h1>每一步，都算数。</h1>
      <p className="page-subtitle">回头看看，你已经表达了这么多。</p>
      <div className="stat-grid">
        <div>
          <MessageCircle size={20} />
          <strong>
            {sessions.length}
            <span>次</span>
          </strong>
          <p>开口练习</p>
        </div>
        <div>
          <Clock3 size={20} />
          <strong>
            {Math.floor(sessions.reduce((n, s) => n + s.duration, 0) / 60)}
            <span>分钟</span>
          </strong>
          <p>投入的时间</p>
        </div>
        <div>
          <Sparkles size={20} />
          <strong>
            {totalWords}
            <span>词</span>
          </strong>
          <p>说过的词</p>
        </div>
      </div>
      <div className="section-toolbar">
        <h2>
          我的练习记录 <span>{sessions.length}</span>
        </h2>
        <label className="search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索对话内容"
            aria-label="搜索练习记录"
          />
        </label>
      </div>
      {!filtered.length ? (
        <EmptyState
          icon="history"
          title={search ? '还没有找到这段对话' : '你的故事，从下一句话开始'}
          description={
            search ? '换一个关键词再试试。' : '完成一轮对话后，练习记录就会自动保存在这里。'
          }
          onStart={onStart}
        />
      ) : (
        <div className="history-list">
          {filtered.map((session) => (
            <div className="history-row" key={session.id}>
              <div
                className={`history-scene-icon ${SCENES.find((s) => s.id === session.scene)?.color}`}
              >
                <MessageCircle size={21} />
              </div>
              <button className="history-details" onClick={() => setSelected(session)}>
                <strong>{session.title}</strong>
                <span>
                  {new Date(session.date).toLocaleString('zh-CN', {
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · {session.messages.filter((m) => m.role === 'user').length} 轮对话
                  <span className="history-language">
                    {languageName(session.supportLanguage || 'zh-CN')} ↔{' '}
                    {languageName(session.practiceLanguage || 'en-US')}
                  </span>
                </span>
              </button>
              <span className="history-duration">
                {formatTime(session.duration)}
                <small>{session.words} 个词</small>
              </span>
              <button
                className="icon-button"
                aria-label="删除练习记录"
                onClick={() => setPendingDelete(session.id)}
              >
                <Trash2 size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="查看练习记录"
                onClick={() => setSelected(session)}
              >
                <ArrowRight size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <Modal
          title={selected.title}
          description={`${new Date(selected.date).toLocaleDateString('zh-CN')} · ${selected.words} 个词`}
          onClose={() => setSelected(null)}
        >
          <div className="history-transcript">
            {selected.messages.map((m) => (
              <div className={`transcript-message ${m.role}`} key={m.id}>
                <span>{messageSpeakerName(m)}</span>
                <p>{m.content}</p>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <span className="muted small">记录仅保存在当前浏览器</span>
            <button
              className="button primary"
              onClick={() =>
                downloadText(
                  `${APP_NAME}-${selected.id.slice(0, 8)}.txt`,
                  selected.messages
                    .map((m) => `${messageSpeakerName(m, '我')}：${m.content}`)
                    .join('\n\n'),
                )
              }
            >
              <ArrowDownToLine size={16} />
              导出对话
            </button>
          </div>
        </Modal>
      )}
      {pendingDelete && (
        <Modal
          title="删除这次练习？"
          description={
            pendingDelete === currentSessionId
              ? '删除后无法恢复。这段对话将停止自动保存，开始新对话后会恢复保存。'
              : '删除后无法恢复。你也可以先导出对话。'
          }
          onClose={() => setPendingDelete(null)}
        >
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setPendingDelete(null)}>
              保留记录
            </button>
            <button
              className="button danger"
              onClick={() => {
                onDelete(pendingDelete);
                setPendingDelete(null);
              }}
            >
              删除记录
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

type PhrasePageProps = {
  phrases: SavedPhrase[];
  onRemove: (id: string) => void;
  onSpeak: (text: string, language?: string) => void;
  onStart: () => void;
  isReady: boolean;
  onReview: () => void;
};
export function PhrasePage({
  phrases,
  onRemove,
  onSpeak,
  onStart,
  isReady,
  onReview,
}: PhrasePageProps) {
  const [search, setSearch] = useState('');
  const filtered = phrases.filter((p) =>
    `${p.en} ${p.zh}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="inner-page">
      <div className="page-eyebrow">WORDS THAT BECOME YOURS</div>
      <h1>好表达，慢慢攒。</h1>
      <p className="page-subtitle">把喜欢的表达留下来，下次聊天就用得上。</p>
      <div className="collection-banner">
        <div className="collection-art">
          <Bookmark size={36} />
          <span>✦</span>
        </div>
        <div>
          <span className="eyebrow">YOUR POCKET PHRASEBOOK</span>
          <h2>从认识，到脱口而出</h2>
          <p>收藏的 {phrases.length} 个表达，正在成为你的语言。</p>
        </div>
        <button className="button primary" disabled={!phrases.length} onClick={onReview}>
          进入智能复习
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="section-toolbar">
        <h2>
          我的表达收藏 <span>{phrases.length}</span>
        </h2>
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="搜索收藏表达"
            placeholder="搜索表达或释义"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {!filtered.length ? (
        <EmptyState
          icon="phrases"
          title={search ? '换个词找找看' : '遇到喜欢的表达，就留下它'}
          description="点击灵感教练中表达旁的收藏按钮，在这里收集属于你的词句。"
          onStart={onStart}
        />
      ) : (
        <div className="phrase-grid">
          {filtered.map((p) => (
            <article className="saved-phrase-card" key={p.id}>
              <div>
                <span className="phrase-date">
                  {new Date(p.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </span>
                <button
                  className="icon-button is-saved"
                  aria-label={`取消收藏 ${p.en}`}
                  onClick={() => onRemove(p.id)}
                >
                  <Bookmark size={16} fill="currentColor" />
                </button>
              </div>
              <h3 lang={p.practiceLanguage || 'en-US'} dir="auto">
                {p.en}
              </h3>
              <p lang={p.supportLanguage || 'zh-CN'} dir="auto">
                {p.zh}
              </p>
              <span className="muted small">{languageName(p.practiceLanguage || 'en-US')}</span>
              <button
                className="text-button"
                disabled={!isReady}
                onClick={() => onSpeak(p.en, p.practiceLanguage || 'en-US')}
              >
                <Volume2 size={14} />
                听一听
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  title,
  description,
  onStart,
  icon,
}: {
  title: string;
  description: string;
  onStart: () => void;
  icon: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        {icon === 'phrases' ? <BookOpen size={30} /> : <Headphones size={30} />}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="button primary" onClick={onStart}>
        去聊一会儿
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
