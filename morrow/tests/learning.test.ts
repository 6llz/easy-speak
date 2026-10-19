import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  completedTurns,
  createStudyItems,
  dueStudyItems,
  learningStats,
  localDay,
  readCorrections,
  readLearningPreferences,
  saveCorrection,
  sanitizeStoredCorrections,
  scheduleReview,
} from '../src/lib/learning.ts';
import { createLessonScene, LESSONS } from '../src/lib/lessons.ts';
import { DEFAULT_SETTINGS, mainPrompt } from '../src/lib/core.ts';
import type { Session } from '../src/lib/storage.ts';

class MemoryStorage {
  values = new Map<string, string>();
  writeCount = 0;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writeCount++;
    this.values.set(key, value);
  }
}
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
});
const now = new Date(2026, 9, 18, 12);

test('复习事件读取去除附加字段，不能通过嵌套记录保留凭据', () => {
  storage.setItem(
    'morrow:learning',
    JSON.stringify({
      reviewEvents: [{ id: 'review-1', date: now.toISOString(), apiKey: 'extra-event-secret' }],
    }),
  );
  const preferences = readLearningPreferences();
  assert.deepEqual(preferences.reviewEvents, [{ id: 'review-1', date: now.toISOString() }]);
  assert.equal(
    JSON.stringify(scheduleReview(preferences, 'item-1', 'known', now)).includes(
      'extra-event-secret',
    ),
    false,
  );
});
function session(id: string, day: number, turns = 3, extras: Partial<Session> = {}): Session {
  return {
    id,
    date: new Date(2026, 9, day, 10).toISOString(),
    scene: 'daily',
    title: '练习',
    duration: 120,
    words: 12,
    messages: Array.from({ length: turns }, (_, index) => [
      { id: `${id}-u${index}`, role: 'user' as const, content: 'Hello.' },
      { id: `${id}-a${index}`, role: 'assistant' as const, content: 'Hi there.' },
    ]).flat(),
    ...extras,
  };
}

test('课程共有十二个独立任务，课程提示仍遵循所选语言', () => {
  assert.equal(LESSONS.length, 12);
  assert.equal(new Set(LESSONS.map((lesson) => lesson.id)).size, 12);
  const scene = createLessonScene(LESSONS[5]);
  assert.equal(scene.lessonId, LESSONS[5].id);
  assert.equal(scene.goalTurns, 3);
  const prompt = mainPrompt(scene, 'A2', { supportLanguage: 'fr-FR', practiceLanguage: 'ja-JP' });
  assert.match(prompt, /ja-JP/);
  assert.match(prompt, /fr-FR/);
  assert.ok(prompt.includes(LESSONS[5].prompt));
});

test('统计只收录当前语言真实会话，课程至少完成三轮回答', () => {
  const stats = learningStats(
    [
      session('real', 18, 3, { lessonId: LESSONS[0].id, goalTurns: 3 }),
      session('short', 18, 2, { lessonId: LESSONS[1].id, goalTurns: 3 }),
      session('demo', 18, 20, { isDemo: true, lessonId: LESSONS[2].id }),
      session('other', 18, 20, { supportLanguage: 'fr-FR', practiceLanguage: 'ja-JP' }),
    ],
    readLearningPreferences(),
    DEFAULT_SETTINGS,
    now,
  );
  assert.equal(stats.totalTurns, 5);
  assert.equal(stats.totalSeconds, 240);
  assert.deepEqual([...stats.completedLessonIds], [LESSONS[0].id]);
  assert.equal(stats.weeklyXp, 45);
  assert.equal(stats.nextLesson.id, LESSONS[1].id);
});

test('未回复用户消息与空助手占位不计入已完成轮次', () => {
  const record = session('test', 18, 1);
  record.messages.push(
    { id: 'u', role: 'user', content: 'Still waiting.' },
    { id: 'a', role: 'assistant', content: ' ' },
  );
  assert.equal(completedTurns(record), 1);
});

test('连续天数采用本地日历，今天未练时昨天仍保留连续记录，周一重置周挑战', () => {
  const records = [session('fri', 16), session('sat', 17)];
  assert.equal(learningStats(records, readLearningPreferences(), DEFAULT_SETTINGS, now).streak, 2);
  const monday = new Date(2026, 9, 19, 12);
  assert.equal(
    learningStats(records, readLearningPreferences(), DEFAULT_SETTINGS, monday).streak,
    0,
  );
  assert.equal(
    learningStats(records, readLearningPreferences(), DEFAULT_SETTINGS, monday).weeklyXp,
    0,
  );
  assert.equal(localDay(new Date(2026, 9, 18, 0, 1)), '2026-10-18');
});

test('同一会话快照不会重复累计成长值', () => {
  const record = session('same', 18);
  const stats = learningStats([record, record], readLearningPreferences(), DEFAULT_SETTINGS, now);
  assert.equal(stats.totalTurns, 3);
  assert.equal(stats.totalSeconds, 120);
});

test('复习按自评排期，同一表达同一天只计一次挑战进度', () => {
  const preferences = readLearningPreferences();
  const item = {
    ...DEFAULT_SETTINGS,
    id: 'zh-CN|en-US:phrase:1',
    text: 'wind down',
    meaning: '放松',
    kind: 'word' as const,
  };
  const once = scheduleReview(preferences, item.id, 'known', now);
  assert.equal(Date.parse(once.schedules[item.id].dueAt) - now.getTime(), 3 * 86_400_000);
  const twice = scheduleReview(once, item.id, 'again', now);
  assert.equal(twice.reviewEvents.length, 1);
  assert.equal(twice.schedules[item.id].streak, 0);
  assert.deepEqual(dueStudyItems([item], twice, now), []);
  assert.equal(dueStudyItems([item], twice, new Date(now.getTime() + 600_000)).length, 1);
  assert.equal(learningStats([], twice, DEFAULT_SETTINGS, now).weekReviews, 1);
  assert.equal(
    learningStats([], twice, { supportLanguage: 'fr-FR', practiceLanguage: 'ja-JP' }, now)
      .weekReviews,
    0,
  );
});

test('错题按用户消息覆盖，只对实际改进建档，并隔离语言与示范', () => {
  const review = {
    positive: '不错',
    original: 'I go yesterday.',
    improved: 'I went yesterday.',
    explanation: '过去时',
    tag: '时态',
  };
  saveCorrection(review, 'same-user', DEFAULT_SETTINGS, false);
  saveCorrection({ ...review, explanation: '更新解释' }, 'same-user', DEFAULT_SETTINGS, false);
  saveCorrection(review, 'demo-user', DEFAULT_SETTINGS, true);
  saveCorrection({ ...review, original: '' }, 'natural', DEFAULT_SETTINGS, false);
  assert.equal(readCorrections().length, 2);
  assert.equal(
    readCorrections().find((entry) => entry.id === 'same-user')?.explanation,
    '更新解释',
  );
  const items = createStudyItems([], readCorrections(), DEFAULT_SETTINGS);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'correction');
  assert.equal(
    createStudyItems([], readCorrections(), { supportLanguage: 'fr-FR', practiceLanguage: 'ja-JP' })
      .length,
    0,
  );
});

test('完整设置作为语言对传入时，错题持久化和复习项只保留语言字段', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    supportLanguage: 'fr-fr',
    practiceLanguage: 'ja-jp',
    apiKey: 'dummy-main-secret',
    speechApiKey: 'dummy-speech-secret',
    baseUrl: 'https://dummy-provider.example/v1',
  };
  saveCorrection(
    {
      positive: '不错',
      original: '昨日に行く。',
      improved: '昨日行きました。',
      explanation: '过去时',
      tag: '时态',
    },
    'safe-user',
    settings,
    false,
  );
  const serialized = storage.getItem('morrow:corrections')!;
  const [stored] = JSON.parse(serialized) as Record<string, unknown>[];
  assert.deepEqual(Object.keys(stored).sort(), [
    'date',
    'explanation',
    'id',
    'improved',
    'isDemo',
    'original',
    'positive',
    'practiceLanguage',
    'supportLanguage',
    'tag',
  ]);
  assert.equal(stored.supportLanguage, 'fr-FR');
  assert.equal(stored.practiceLanguage, 'ja-JP');
  assert.ok(!serialized.includes('dummy-'));
  const writesBeforeRead = storage.writeCount;
  const items = createStudyItems([], readCorrections(), settings);
  assert.equal(storage.writeCount, writesBeforeRead);
  assert.equal(items.length, 1);
  assert.equal(items[0].practiceLanguage, 'ja-JP');
  assert.equal('apiKey' in items[0], false);
  assert.equal('speechApiKey' in items[0], false);
  assert.equal('baseUrl' in items[0], false);
});

test('读取旧错题会清理额外设置字段，已规范的记录不重复写入', () => {
  storage.setItem(
    'morrow:corrections',
    JSON.stringify([
      {
        id: 'old-user',
        date: now.toISOString(),
        positive: '不错',
        original: 'I go yesterday.',
        improved: 'I went yesterday.',
        explanation: '过去时',
        tag: '时态',
        ...DEFAULT_SETTINGS,
        apiKey: 'dummy-old-main-secret',
        speechApiKey: 'dummy-old-speech-secret',
      },
    ]),
  );
  const writesBefore = storage.writeCount;
  assert.equal(sanitizeStoredCorrections(), true);
  const result = readCorrections();
  assert.equal(result.length, 1);
  assert.equal('apiKey' in result[0], false);
  assert.equal('speechApiKey' in result[0], false);
  assert.ok(!storage.getItem('morrow:corrections')!.includes('dummy-old'));
  assert.equal(storage.writeCount, writesBefore + 1);
  readCorrections();
  assert.equal(storage.writeCount, writesBefore + 1);
});

test('旧错题清理写入失败时，读取仍返回安全白名单对象', () => {
  storage.setItem(
    'morrow:corrections',
    JSON.stringify([
      {
        id: 'old-user',
        date: now.toISOString(),
        positive: '不错',
        original: 'I go yesterday.',
        improved: 'I went yesterday.',
        explanation: '过去时',
        tag: '时态',
        apiKey: 'dummy-old-secret',
      },
    ]),
  );
  storage.setItem = () => {
    throw new Error('storage blocked');
  };
  assert.equal(sanitizeStoredCorrections(), false);
  const result = readCorrections();
  assert.equal(result.length, 1);
  assert.equal('apiKey' in result[0], false);
  assert.ok(!JSON.stringify(result).includes('dummy-old-secret'));
});

test('同一句的最新点评无需纠错时移除旧错题，并报告删除写入失败', () => {
  const review = {
    positive: '不错',
    original: 'I go yesterday.',
    improved: 'I went yesterday.',
    explanation: '过去时',
    tag: '时态',
  };
  saveCorrection(review, 'same-user', DEFAULT_SETTINGS, false);
  saveCorrection(review, 'another-user', DEFAULT_SETTINGS, false);
  assert.equal(
    saveCorrection({ ...review, original: '' }, 'same-user', DEFAULT_SETTINGS, false),
    true,
  );
  assert.deepEqual(
    readCorrections().map((entry) => entry.id),
    ['another-user'],
  );
  const same = { ...review, original: review.improved };
  storage.setItem = () => {
    throw new Error('storage blocked');
  };
  assert.equal(saveCorrection(same, 'another-user', DEFAULT_SETTINGS, false), false);
  assert.equal(readCorrections().length, 1);
});

test('损坏的复习与错题存储安全回退，不接受无效日期和非有限排期', () => {
  storage.setItem(
    'morrow:learning',
    JSON.stringify({
      dailyMinutes: 999,
      schedules: { bad: { streak: 'bad', dueAt: 'tomorrow', grade: 'known' } },
      reviewEvents: [null, { id: 'a', date: 'bad' }],
    }),
  );
  storage.setItem('morrow:corrections', '[null,{},17]');
  const preferences = readLearningPreferences();
  assert.equal(preferences.dailyMinutes, 10);
  assert.equal(Object.keys(preferences.schedules).length, 0);
  assert.deepEqual(preferences.reviewEvents, []);
  assert.deepEqual(readCorrections(), []);
});
