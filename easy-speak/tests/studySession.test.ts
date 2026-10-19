import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudySession } from '../src/components/StudySession.tsx';
import { LearningHub } from '../src/components/LearningHub.tsx';
import { DEFAULT_SETTINGS } from '../src/lib/core.ts';
import type { ReviewGrade } from '../src/lib/learning.ts';

test('复习先回忆再自评，完成后显示总结，不重复循环最后一张', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const grades: ReviewGrade[] = [];
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      createElement(StudySession, {
        items: [
          {
            id: '1',
            text: 'Bonjour',
            meaning: '你好',
            kind: 'word',
            supportLanguage: 'zh-CN',
            practiceLanguage: 'fr-FR',
          },
        ],
        onGrade: (_item, grade) => grades.push(grade),
        onSpeak: () => {},
        onClose: () => {},
        canSpeak: true,
      }),
    );
  });
  try {
    const gradeButtons = () =>
      renderer.root.findByProps({ 'aria-label': '自评熟悉程度' }).findAllByType('button');
    assert.ok(gradeButtons().every((button) => button.props.disabled));
    await act(async () =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.props.className === 'button secondary')!
        .props.onClick(),
    );
    assert.ok(gradeButtons().every((button) => !button.props.disabled));
    await act(async () => gradeButtons()[2].props.onClick());
    assert.deepEqual(grades, ['known']);
    assert.equal(renderer.root.findAllByProps({ className: 'study-complete' }).length, 1);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': '自评熟悉程度' }).length, 0);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('学习中心保留课程、对话、复习和我的四项导航，不显示挑战或自定义训练导航', () => {
  for (const view of ['courses', 'review', 'profile'] as const) {
    const markup = renderToStaticMarkup(
      createElement(LearningHub, {
        view,
        settings: DEFAULT_SETTINGS,
        sessions: [],
        phrases: [],
        canSpeak: true,
        onNavigate: () => {},
        onStartLesson: () => {},
        onOpenSettings: () => {},
        onOpenLanguages: () => {},
        onOpenPhrases: () => {},
        onOpenHistory: () => {},
        onSpeak: () => {},
        onStopSpeaking: () => {},
        notify: () => {},
      }),
    );
    assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
    const navigation = markup.match(/<nav[^>]*aria-label="学习导航"[^>]*>(.*?)<\/nav>/)?.[1];
    assert.ok(navigation);
    assert.equal((navigation.match(/<button/g) || []).length, 4);
    for (const title of ['课程', '对话', '复习', '我的']) {
      assert.ok(navigation.includes(`<span>${title}</span>`));
    }
    assert.ok(!markup.includes('挑战'));
    assert.ok(!navigation.includes('自定义训练'));
    if (view === 'courses') assert.equal((markup.match(/class="lesson-row /g) || []).length, 12);
    if (view === 'profile') {
      assert.ok(markup.includes('累计练习'));
      assert.ok(markup.includes('aria-label="每日练习目标"'));
      assert.ok(markup.includes('aria-label="本周练习日历"'));
      assert.ok(markup.includes('词句的熟悉程度'));
    }
  }
});
