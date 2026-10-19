import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Flame,
  Headphones,
  History,
  Languages,
  MessageCircle,
  Settings2,
  Sparkles,
  Target,
  UserRound,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Settings } from '../lib/core';
import { APP_NAME } from '../lib/brand';
import { COURSE_UNITS, LESSONS, LESSON_TURN_GOAL } from '../lib/lessons';
import type { Lesson } from '../lib/lessons';
import {
  createStudyItems,
  dueStudyItems,
  learningStats,
  readCorrections,
  readLearningPreferences,
  scheduleReview,
} from '../lib/learning';
import type { LearningPreferences, StudyItem } from '../lib/learning';
import { languageName } from '../lib/languages';
import type { SavedPhrase, Session } from '../lib/storage';
import { writeLocal } from '../lib/storage';
import { Modal } from './Modal';
import { StudySession } from './StudySession';

export type LearningView = 'courses' | 'review' | 'profile';
type LearningHubProps = {
  view: LearningView;
  settings: Settings;
  sessions: Session[];
  phrases: SavedPhrase[];
  canSpeak: boolean;
  onNavigate: (view: LearningView | 'conversation') => void;
  onStartLesson: (lesson: Lesson) => void;
  onOpenSettings: () => void;
  onOpenLanguages: () => void;
  onOpenPhrases: () => void;
  onOpenHistory: () => void;
  onSpeak: (text: string, language: string) => void;
  onStopSpeaking: () => void;
  notify: (message: string) => void;
};
const NAV_ITEMS: { id: LearningView | 'conversation'; title: string; icon: LucideIcon }[] = [
  { id: 'courses', title: '课程', icon: BookOpen },
  { id: 'conversation', title: '对话', icon: Headphones },
  { id: 'review', title: '复习', icon: Zap },
  { id: 'profile', title: '我的', icon: UserRound },
];

/** 学习中心承载课程与积累；对话仍进入原有的独立陪练屏幕。 */
export function LearningHub({
  view,
  settings,
  sessions,
  phrases,
  canSpeak,
  onNavigate,
  onStartLesson,
  onOpenSettings,
  onOpenLanguages,
  onOpenPhrases,
  onOpenHistory,
  onSpeak,
  onStopSpeaking,
  notify,
}: LearningHubProps) {
  const [preferences, setPreferences] = useState<LearningPreferences>(readLearningPreferences);
  const corrections = readCorrections();
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [studyItems, setStudyItems] = useState<StudyItem[] | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState(preferences.name);
  const [dailyMinutes, setDailyMinutes] = useState(preferences.dailyMinutes);
  const stats = learningStats(sessions, preferences, settings);
  const items = createStudyItems(phrases, corrections, settings);
  const dueItems = dueStudyItems(items, preferences);
  const currentUnit =
    COURSE_UNITS.find((unit) => unit.lessons.some((lesson) => lesson.id === stats.nextLesson.id)) ||
    COURSE_UNITS[0];
  const updatePreferences = (next: LearningPreferences) => {
    setPreferences(next);
    if (!writeLocal('learning', next)) notify('已在当前页面生效，但浏览器未能保存学习进度。');
  };
  const startReview = (entries: StudyItem[]) => {
    if (!entries.length) {
      notify('这里还没有表达，可以在对话中收藏词句，或完成一次有改进建议的点评。');
      return;
    }
    setStudyItems(entries.slice(0, 20));
  };
  const closeReview = () => {
    onStopSpeaking();
    setStudyItems(null);
  };
  const title = {
    courses: '每天，向前一句',
    review: '把会说变成习惯',
    profile: '你的语言足迹',
  }[view];
  return (
    <div className="learning-shell">
      <header className="learning-header">
        <div>
          <span className="learning-brand">{APP_NAME}</span>
          <p>{title}</p>
        </div>
        <button className="header-button" onClick={onOpenSettings} aria-label="打开学习设置">
          <Settings2 size={22} />
        </button>
      </header>
      <button className="learning-language" onClick={onOpenLanguages}>
        <Languages size={14} />
        {languageName(settings.supportLanguage)}
        <span>↔</span>
        {languageName(settings.practiceLanguage)}
        <ChevronRight size={14} />
      </button>
      <main className="learning-content">
        {view === 'courses' && (
          <>
            <div className="learning-section-title">
              <h1>开口，从这里开始</h1>
              <span className="streak-pill">
                <Flame size={17} />
                {stats.streak} 天
              </span>
            </div>
            <section className="course-hero">
              <div className="learning-row">
                <span className="eyebrow">你的下一小步</span>
                <span className="lesson-level">{stats.nextLesson.level} · 约 3–5 分钟</span>
              </div>
              <span className="hero-symbol">
                <MessageCircle size={35} />
                <Sparkles size={19} />
              </span>
              <h2>{stats.nextLesson.title}</h2>
              <p>{stats.nextLesson.subtitle}</p>
              <button
                className="button primary"
                onClick={() => setSelectedLesson(stats.nextLesson)}
              >
                继续学习
                <ArrowRight size={16} />
              </button>
              <div className="course-overall">
                <progress
                  value={stats.completedLessonIds.size}
                  max={LESSONS.length}
                  aria-label="全部课程进度"
                />
                <span>
                  {stats.completedLessonIds.size} / {LESSONS.length} 节
                </span>
              </div>
            </section>
            <button className="learning-banner" onClick={() => onNavigate('conversation')}>
              <span className="learning-symbol">
                <Headphones size={23} />
              </span>
              <div>
                <strong>今天想随便聊聊？</strong>
                <p>熟悉的两个小帮手，一直陪你</p>
              </div>
              <ArrowRight size={19} />
            </button>
            <div className="learning-section-title">
              <h2>我的课程路径</h2>
              <span className="muted small">可自由选课</span>
            </div>
            <div className="course-path">
              {COURSE_UNITS.map((unit, unitIndex) => (
                <section
                  key={unit.id}
                  className={`course-unit ${unit.id === currentUnit.id ? 'current' : ''}`}
                >
                  <div className="unit-heading">
                    <span>0{unitIndex + 1}</span>
                    <div>
                      <h3>{unit.title}</h3>
                      <p>{unit.description}</p>
                    </div>
                    <span className="unit-count">
                      {
                        unit.lessons.filter((lesson) => stats.completedLessonIds.has(lesson.id))
                          .length
                      }
                      /3
                    </span>
                  </div>
                  {unit.lessons.map((lesson, lessonIndex) => {
                    const isCompleted = stats.completedLessonIds.has(lesson.id),
                      isNext = stats.nextLesson.id === lesson.id;
                    return (
                      <button
                        key={lesson.id}
                        className={`lesson-row ${isNext ? 'next' : ''} ${isCompleted ? 'completed' : ''}`}
                        onClick={() => setSelectedLesson(lesson)}
                      >
                        <span className="lesson-step">
                          {isCompleted ? (
                            <Check size={19} />
                          ) : (
                            `${unitIndex + 1}.${lessonIndex + 1}`
                          )}
                        </span>
                        <div>
                          <strong>{lesson.title}</strong>
                          <p>{lesson.subtitle}</p>
                        </div>
                        <span className="lesson-status">
                          {isCompleted ? '再练一次' : isNext ? '推荐' : lesson.level}
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          </>
        )}
        {view === 'review' && (
          <>
            <div className="learning-section-title">
              <h1>练过的，变成自己的</h1>
              <span className="streak-pill">
                <Bookmark size={16} />
                {items.length}
              </span>
            </div>
            <section className="review-hero">
              <span className="learning-symbol">
                <Zap size={27} />
              </span>
              <h2>
                {dueItems.length
                  ? `${dueItems.length} 个表达，等你再见`
                  : items.length
                    ? '今天的复习完成啦'
                    : '积累从一句好表达开始'}
              </h2>
              <p>先回想，再开口，按熟悉程度安排下一次复习。</p>
              <button
                className="button primary"
                disabled={!dueItems.length}
                onClick={() => startReview(dueItems)}
              >
                智能复习
                <ArrowRight size={16} />
              </button>
            </section>
            <div className="learning-section-title">
              <h2>快速练习</h2>
              <span className="muted small">当前语言组合</span>
            </div>
            <div className="quick-practice-grid">
              <button onClick={() => startReview(items.filter((item) => item.kind === 'word'))}>
                <span className="learning-symbol">
                  <BookOpen size={24} />
                </span>
                <strong>词汇热身</strong>
                <small>{items.filter((item) => item.kind === 'word').length} 个词语</small>
                <ArrowRight size={17} />
              </button>
              <button
                onClick={() => startReview(items.filter((item) => item.kind === 'expression'))}
              >
                <span className="learning-symbol mint">
                  <MessageCircle size={24} />
                </span>
                <strong>实用表达</strong>
                <small>{items.filter((item) => item.kind === 'expression').length} 个词句</small>
                <ArrowRight size={17} />
              </button>
            </div>
            <div className="learning-section-title">
              <h2>从聊天中积累</h2>
            </div>
            <ActionRow
              icon={Bookmark}
              title="我的表达收藏"
              description="词语、例句和喜欢的聊天句子"
              count={items.filter((item) => item.kind !== 'correction').length}
              onClick={onOpenPhrases}
            />
            <ActionRow
              icon={Sparkles}
              title="错题回顾"
              description="原句、改进表达与原因一起复习"
              count={items.filter((item) => item.kind === 'correction').length}
              onClick={() => startReview(items.filter((item) => item.kind === 'correction'))}
            />
            <ActionRow
              icon={History}
              title="练习记录"
              description="回看每次对话，带走好表达"
              count={sessions.length}
              onClick={onOpenHistory}
            />
            <div className="learning-note">
              “词汇 / 表达”按长度初步整理；熟悉程度来自你的自评。示范点评不会加入错题本。
            </div>
          </>
        )}
        {view === 'profile' && (
          <>
            <section className="profile-heading">
              <span className="profile-avatar">
                <UserRound size={35} />
              </span>
              <h1>{preferences.name}</h1>
              <p>
                {languageName(settings.practiceLanguage)} · {settings.level}
              </p>
              <button className="text-button" onClick={() => setIsEditingProfile(true)}>
                编辑昵称与目标
                <ChevronRight size={13} />
              </button>
            </section>
            <div className="profile-stat-grid">
              <StatTile
                icon={MessageCircle}
                title="已完成对话"
                value={stats.totalTurns}
                unit="轮"
              />
              <StatTile
                icon={Clock3}
                title="累计练习"
                value={Math.floor(stats.totalSeconds / 60)}
                unit="分钟"
              />
            </div>
            <section className="learning-card daily-goal">
              <div className="learning-row">
                <h3>每天留一点时间给自己</h3>
                <Target size={20} />
              </div>
              <strong>
                {Math.floor(stats.todaySeconds / 60)}
                <small> / {preferences.dailyMinutes} 分钟</small>
              </strong>
              <progress
                value={Math.min(stats.todaySeconds, preferences.dailyMinutes * 60)}
                max={preferences.dailyMinutes * 60}
                aria-label="每日练习目标"
              />
              <WeekStrip days={stats.weekDays} />
            </section>
            <section className="learning-card">
              <div className="learning-row">
                <h3>词句的熟悉程度</h3>
                <span className="muted small">自己评，慢慢进步</span>
              </div>
              <div className="mastery-grid">
                {[
                  {
                    title: '新积累',
                    count: items.filter(
                      (item) =>
                        !preferences.schedules[item.id] ||
                        preferences.schedules[item.id].grade === 'again',
                    ).length,
                  },
                  {
                    title: '有印象',
                    count: items.filter(
                      (item) => preferences.schedules[item.id]?.grade === 'familiar',
                    ).length,
                  },
                  {
                    title: '记住了',
                    count: items.filter((item) => preferences.schedules[item.id]?.grade === 'known')
                      .length,
                  },
                ].map((entry) => (
                  <div key={entry.title}>
                    <strong>{entry.count}</strong>
                    <span>{entry.title}</span>
                  </div>
                ))}
              </div>
            </section>
            <ActionRow
              icon={BookOpen}
              title="我的课程"
              description={`已完成 ${stats.completedLessonIds.size} / ${LESSONS.length} 节`}
              onClick={() => onNavigate('courses')}
            />
            <ActionRow
              icon={History}
              title="练习记录与导出"
              description="保留每次开口的痕迹"
              onClick={onOpenHistory}
            />
            <ActionRow
              icon={Settings2}
              title="模型、语音与主题"
              description="选喜欢的声音，按自己的节奏练"
              onClick={onOpenSettings}
            />
            <div className="learning-note">
              资料与进度保存在当前浏览器，暂无登录和跨设备同步。示范会话不计入学习统计；点评基于转写文字，不评估发音。
            </div>
          </>
        )}
      </main>
      <nav className="learning-nav" aria-label="学习导航">
        {NAV_ITEMS.map(({ id, title: navTitle, icon: Icon }) => (
          <button
            key={id}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => {
              onStopSpeaking();
              onNavigate(id);
            }}
          >
            <Icon size={22} />
            <span>{navTitle}</span>
          </button>
        ))}
      </nav>
      {selectedLesson && (
        <Modal
          title={selectedLesson.title}
          description={selectedLesson.subtitle}
          onClose={() => setSelectedLesson(null)}
        >
          <div className="lesson-detail">
            <span className="lesson-level">
              建议 {selectedLesson.level} · {languageName(settings.practiceLanguage)}
            </span>
            <h3>这次试着完成</h3>
            <ol>
              {selectedLesson.objectives.map((objective) => (
                <li key={objective}>
                  <Target size={16} />
                  {objective}
                </li>
              ))}
            </ol>
            <p className="muted small">
              完成 {LESSON_TURN_GOAL}{' '}
              轮真实模型对话后记录为“已练习”，不代表通过能力评测。示范模式可以体验，但不累计进度。
            </p>
          </div>
          <div className="modal-actions">
            <span className="muted small">两个教练会随时陪你</span>
            <button
              className="button primary"
              onClick={() => {
                onStartLesson(selectedLesson);
                setSelectedLesson(null);
              }}
            >
              进入对话
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {studyItems && (
        <Modal title="给表达一次再见的机会" onClose={closeReview}>
          <StudySession
            items={studyItems}
            canSpeak={canSpeak}
            onSpeak={onSpeak}
            onClose={closeReview}
            onGrade={(item, grade) =>
              updatePreferences(scheduleReview(preferences, item.id, grade))
            }
          />
        </Modal>
      )}
      {isEditingProfile && (
        <Modal title="按你的节奏练习" onClose={() => setIsEditingProfile(false)}>
          <label className="field-label" htmlFor="learner-name">
            你的昵称
          </label>
          <input
            id="learner-name"
            className="text-input"
            maxLength={24}
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
          />
          <label className="field-label" htmlFor="daily-minutes">
            每天想练多久
          </label>
          <select
            id="daily-minutes"
            className="text-input"
            value={dailyMinutes}
            onChange={(event) => setDailyMinutes(Number(event.target.value))}
          >
            {[5, 10, 15, 20].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} 分钟
              </option>
            ))}
          </select>
          <div className="modal-actions">
            <span className="muted small">只保存在当前浏览器</span>
            <button
              className="button primary"
              onClick={() => {
                updatePreferences({
                  ...preferences,
                  name: profileName.trim() || '语言探索者',
                  dailyMinutes,
                });
                setIsEditingProfile(false);
              }}
            >
              保存
              <Check size={15} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

type ActionRowProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  count?: number;
  onClick: () => void;
};
function ActionRow({ icon: Icon, title, description, count, onClick }: ActionRowProps) {
  return (
    <button className="learning-action-row" onClick={onClick}>
      <span className="learning-symbol">
        <Icon size={22} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {count !== undefined && <span className="muted small">{count}</span>}
      <ChevronRight size={16} />
    </button>
  );
}
type StatTileProps = { icon: LucideIcon; title: string; value: number; unit: string };
function StatTile({ icon: Icon, title, value, unit }: StatTileProps) {
  return (
    <section className="stat-tile">
      <Icon size={23} />
      <span>{title}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </section>
  );
}
function WeekStrip({ days }: { days: ReturnType<typeof learningStats>['weekDays'] }) {
  return (
    <div className="week-strip" aria-label="本周练习日历">
      {days.map((day) => (
        <div
          key={day.label}
          className={`${day.active ? 'active' : ''} ${day.isToday ? 'today' : ''}`}
        >
          <span>周{day.label}</span>
          <i aria-label={day.active ? '已练习' : '未练习'}>
            {day.active ? <Check size={13} /> : '·'}
          </i>
        </div>
      ))}
    </div>
  );
}
