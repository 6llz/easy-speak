import { isRecord } from './core';
import type { Review } from './core';
import { DEFAULT_LANGUAGE_PAIR, readLanguagePair } from './languages';
import type { LanguagePair } from './languages';
import { LESSONS, LESSON_TURN_GOAL } from './lessons';
import { readLocal, writeLocal } from './storage';
import type { SavedPhrase, Session } from './storage';

export type Correction = LanguagePair & Review & { id: string; date: string; isDemo: boolean };
export type ReviewGrade = 'again' | 'familiar' | 'known';
export type ReviewSchedule = { streak: number; dueAt: string; grade: ReviewGrade };
export type ReviewEvent = { id: string; date: string };
export type LearningPreferences = {
  name: string;
  dailyMinutes: number;
  joinedAt: string;
  schedules: Record<string, ReviewSchedule>;
  reviewEvents: ReviewEvent[];
};
export type StudyItem = LanguagePair & {
  id: string;
  text: string;
  meaning: string;
  original?: string;
  explanation?: string;
  kind: 'word' | 'expression' | 'correction';
};
const DAY_MS = 86_400_000;
const MAX_CORRECTIONS = 300;
const MAX_REVIEW_EVENTS = 1000;
const LESSON_IDS = new Set(LESSONS.map((lesson) => lesson.id));

export function languagePairKey(pair: Partial<LanguagePair>): string {
  return `${pair.supportLanguage || DEFAULT_LANGUAGE_PAIR.supportLanguage}|${pair.practiceLanguage || DEFAULT_LANGUAGE_PAIR.practiceLanguage}`;
}

/** 使用本地日历日期统计，避免 UTC 日期偏移与夏令时导致断签。 */
export function localDay(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 规范化个人目标与复习排期；事件与词条逐字段读取，未知字段不进入后续保存。 */
export function readLearningPreferences(): LearningPreferences {
  const raw = readLocal<unknown>('learning', {});
  const value = isRecord(raw) ? raw : {};
  const schedules: Record<string, ReviewSchedule> = Object.create(null);
  if (isRecord(value.schedules)) {
    for (const [key, schedule] of Object.entries(value.schedules).slice(0, 1500)) {
      if (
        isRecord(schedule) &&
        typeof schedule.streak === 'number' &&
        Number.isFinite(schedule.streak) &&
        typeof schedule.dueAt === 'string' &&
        localDay(schedule.dueAt) &&
        ['again', 'familiar', 'known'].includes(String(schedule.grade))
      ) {
        schedules[key] = {
          streak: Math.max(0, Math.min(10, schedule.streak)),
          dueAt: schedule.dueAt,
          grade: schedule.grade as ReviewGrade,
        };
      }
    }
  }
  return {
    name: typeof value.name === 'string' ? value.name.slice(0, 24) : '语言探索者',
    dailyMinutes: [5, 10, 15, 20].includes(Number(value.dailyMinutes))
      ? Number(value.dailyMinutes)
      : 10,
    joinedAt:
      typeof value.joinedAt === 'string' && localDay(value.joinedAt)
        ? value.joinedAt
        : new Date().toISOString(),
    schedules,
    reviewEvents: Array.isArray(value.reviewEvents)
      ? value.reviewEvents
          .filter(
            (event): event is ReviewEvent =>
              isRecord(event) &&
              typeof event.id === 'string' &&
              event.id.length <= 4000 &&
              typeof event.date === 'string' &&
              !!localDay(event.date),
          )
          .slice(-MAX_REVIEW_EVENTS)
          .map((event) => ({ id: event.id, date: event.date }))
      : [],
  };
}

/** 自评决定复习间隔，不以自评冒充自动口语或发音评分。 */
export function scheduleReview(
  preferences: LearningPreferences,
  itemId: string,
  grade: ReviewGrade,
  now = new Date(),
): LearningPreferences {
  const previous = preferences.schedules[itemId];
  const streak = grade === 'again' ? 0 : Math.min(10, (previous?.streak || 0) + 1);
  const delay =
    grade === 'again'
      ? 10 * 60_000
      : (grade === 'familiar' ? 1 : Math.min(30, 3 * 2 ** (streak - 1))) * DAY_MS;
  // 同一表达同一天只计一次挑战进度，重复练习仍可调整到期时间。
  const reviewEvents = preferences.reviewEvents.filter(
    (event) => !(event.id === itemId && localDay(event.date) === localDay(now)),
  );
  return {
    ...preferences,
    schedules: {
      ...preferences.schedules,
      [itemId]: { streak, grade, dueAt: new Date(now.getTime() + delay).toISOString() },
    },
    reviewEvents: [...reviewEvents, { id: itemId, date: now.toISOString() }].slice(
      -MAX_REVIEW_EVENTS,
    ),
  };
}

function loadCorrections(): { corrections: Correction[]; isPersisted: boolean } {
  const raw = readLocal<unknown>('corrections', []);
  const corrections: Correction[] = (Array.isArray(raw) ? raw : [])
    .filter(
      (value) =>
        isRecord(value) &&
        ['id', 'date', 'positive', 'original', 'improved', 'explanation', 'tag'].every(
          (field) => typeof value[field] === 'string',
        ) &&
        value.original &&
        value.improved &&
        localDay(String(value.date)),
    )
    .slice(0, MAX_CORRECTIONS)
    .map((value) => ({
      id: String(value.id).slice(0, 100),
      date: String(value.date),
      ...readLanguagePair(value),
      positive: String(value.positive).slice(0, 1000),
      original: String(value.original).slice(0, 3000),
      improved: String(value.improved).slice(0, 3000),
      explanation: String(value.explanation).slice(0, 1500),
      tag: String(value.tag).slice(0, 100),
      isDemo: value.isDemo === true,
    }));
  // 旧版本可能把完整设置展开到错题中；首次读取时清除白名单外字段，避免密钥继续落盘。
  // 存储不可写时仍只向界面返回安全对象；后续读取会再次尝试迁移。
  const isPersisted =
    JSON.stringify(raw) === JSON.stringify(corrections) || writeLocal('corrections', corrections);
  return { corrections, isPersisted };
}

/** 启动时迁移旧错题，返回是否成功清除曾被展开写入的设置字段。 */
export function sanitizeStoredCorrections(): boolean {
  return loadCorrections().isPersisted;
}

/** 读取并迁移有效错题；模型说无需纠正时对应消息的旧错题由 saveCorrection 移除。 */
export function readCorrections(): Correction[] {
  return loadCorrections().corrections;
}

/** 点评按用户消息 ID 覆盖，重试点评不会反复新增错题。 */
export function saveCorrection(
  review: Review,
  messageId: string,
  pair: LanguagePair,
  isDemo: boolean,
): boolean {
  const saved = readCorrections();
  const remaining = saved.filter((entry) => entry.id !== messageId);
  if (
    !review.original.trim() ||
    !review.improved.trim() ||
    review.original.trim() === review.improved.trim()
  )
    return saved.length === remaining.length || writeLocal('corrections', remaining);
  const correction: Correction = {
    id: messageId,
    date: new Date().toISOString(),
    ...readLanguagePair(pair),
    positive: review.positive,
    original: review.original,
    improved: review.improved,
    explanation: review.explanation,
    tag: review.tag,
    isDemo,
  };
  return writeLocal('corrections', [correction, ...remaining].slice(0, MAX_CORRECTIONS));
}

/** 将当前语言的收藏和错题映射成复习项，不复制来源对象携带的其他配置。 */
export function createStudyItems(
  phrases: SavedPhrase[],
  corrections: Correction[],
  pair: LanguagePair,
): StudyItem[] {
  const languages = readLanguagePair(pair);
  const key = languagePairKey(languages);
  return [
    ...phrases
      .filter((phrase) => languagePairKey(phrase) === key)
      .map((phrase): StudyItem => ({
        ...languages,
        id: `${key}:phrase:${phrase.id}`,
        text: phrase.en,
        meaning: phrase.zh,
        kind:
          phrase.en.trim().split(/\s+/u).length <= 2 && phrase.en.length < 24
            ? 'word'
            : 'expression',
      })),
    ...corrections
      .filter((entry) => !entry.isDemo && languagePairKey(entry) === key)
      .map((entry): StudyItem => ({
        ...languages,
        id: `${key}:correction:${entry.id}`,
        text: entry.improved,
        meaning: entry.explanation,
        original: entry.original,
        explanation: entry.tag,
        kind: 'correction',
      })),
  ];
}

/** 未排期的表达与到期项优先进入复习；排期来自用户自评，不代表自动能力判断。 */
export function dueStudyItems(
  items: StudyItem[],
  preferences: LearningPreferences,
  now = new Date(),
): StudyItem[] {
  return items
    .filter(
      (item) =>
        !preferences.schedules[item.id] ||
        Date.parse(preferences.schedules[item.id].dueAt) <= now.getTime(),
    )
    .sort(
      (left, right) =>
        (Date.parse(preferences.schedules[left.id]?.dueAt) || 0) -
        (Date.parse(preferences.schedules[right.id]?.dueAt) || 0),
    );
}

/** 只把已经收到助手回答的用户轮次计为课程练习，失败及半截回复不计。 */
export function completedTurns(session: Pick<Session, 'messages'>): number {
  return session.messages.filter(
    (message, index) =>
      message.role === 'user' &&
      message.content.trim() &&
      session.messages[index + 1]?.role === 'assistant' &&
      session.messages[index + 1].content.trim(),
  ).length;
}

function isCompletedLesson(session: Session): boolean {
  return (
    !!session.lessonId &&
    LESSON_IDS.has(session.lessonId) &&
    completedTurns(session) >= Math.max(LESSON_TURN_GOAL, session.goalTurns || LESSON_TURN_GOAL)
  );
}

/** 按会话 ID 去重并排除示范与其他语言组合；删除历史会改变由快照推导的统计。 */
export function learningStats(
  sessions: Session[],
  preferences: LearningPreferences,
  pair: LanguagePair,
  now = new Date(),
) {
  const unique = [...new Map(sessions.map((session) => [session.id, session])).values()];
  const actual = unique.filter(
    (session) =>
      !session.isDemo &&
      languagePairKey(session) === languagePairKey(pair) &&
      !!localDay(session.date),
  );
  const today = localDay(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const days = new Set(
    actual
      .filter((session) => completedTurns(session) > 0)
      .map((session) => localDay(session.date)),
  );
  const completedLessonIds = new Set(
    actual.filter(isCompletedLesson).map((session) => session.lessonId!),
  );
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(today)) currentDay.setDate(currentDay.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(currentDay))) {
    streak++;
    currentDay.setDate(currentDay.getDate() - 1);
  }
  const reviewEvents = preferences.reviewEvents.filter((event) =>
    event.id.startsWith(`${languagePairKey(pair)}:`),
  );
  const week = actual.filter((session) => Date.parse(session.date) >= weekStart.getTime());
  const month = actual.filter((session) => Date.parse(session.date) >= monthStart.getTime());
  const weekReviews = reviewEvents.filter(
    (event) => Date.parse(event.date) >= weekStart.getTime(),
  ).length;
  const weeklyTurns = week.reduce((sum, session) => sum + completedTurns(session), 0);
  const weeklyLessons = new Set(week.filter(isCompletedLesson).map((session) => session.lessonId))
    .size;
  return {
    completedLessonIds,
    nextLesson: LESSONS.find((lesson) => !completedLessonIds.has(lesson.id)) || LESSONS[0],
    streak,
    totalTurns: actual.reduce((sum, session) => sum + completedTurns(session), 0),
    totalSeconds: actual.reduce((sum, session) => sum + Math.max(0, session.duration), 0),
    todaySeconds: actual
      .filter((session) => localDay(session.date) === today)
      .reduce((sum, session) => sum + Math.max(0, session.duration), 0),
    weeklyTurns,
    weeklyLessons,
    weekReviews,
    weeklyDays: new Set(
      week
        .filter((session) => completedTurns(session) > 0)
        .map((session) => localDay(session.date)),
    ).size,
    monthlyDays: new Set(
      month
        .filter((session) => completedTurns(session) > 0)
        .map((session) => localDay(session.date)),
    ).size,
    weeklyXp: weeklyTurns * 5 + weeklyLessons * 20 + weekReviews * 5,
    weekDays: Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + offset);
      return {
        label: ['一', '二', '三', '四', '五', '六', '日'][offset],
        active: days.has(localDay(date)),
        isToday: localDay(date) === today,
      };
    }),
  };
}
