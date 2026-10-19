import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PracticeScreen } from '../src/components/PracticeScreen.tsx';
import { ThemePicker } from '../src/components/ThemePicker.tsx';
import type { usePractice } from '../src/hooks/usePractice.ts';
import { SCENES } from '../src/lib/core.ts';

test('首屏直接显示对话和两个辅导框，不再生成独立开始按钮', () => {
  Object.assign(globalThis, { document: { visibilityState: 'visible' } });
  const practice = {
    sessionId: 'test-session',
    scene: SCENES[0],
    phase: 'ready',
    messages: [{ id: 'hello', role: 'assistant', content: SCENES[0].greeting }],
    hint: SCENES[0],
    review: null,
    isHintLoading: false,
    isReviewLoading: false,
    hintError: '',
    reviewError: '',
    error: '',
    recognitionError: '',
    draft: '',
    hasPendingReply: false,
    companionName: 'Noah',
  } as ReturnType<typeof usePractice>;
  const markup = renderToStaticMarkup(
    createElement(PracticeScreen, {
      practice,
      isDemo: true,
      isAutoSpeak: true,
      savedPhrases: [],
      onToggleAudio: () => {},
      onSavePhrase: () => {},
      onOpenTranscript: () => {},
      notify: () => {},
      isOverlayOpen: false,
    }),
  );
  assert.ok(markup.includes('接下来，可以说'));
  assert.ok(markup.includes('刚才这句，说得怎么样'));
  assert.ok(markup.includes('开启摄像头'));
  assert.ok(markup.includes('挂断并结束陪练'));
  assert.ok(markup.includes('暂停陪练'));
  assert.ok(!markup.includes('开始陪练'));
  assert.ok(!markup.includes('点击说话'));
  assert.equal((markup.match(/class="coach-box /g) || []).length, 2);
  assert.ok(markup.includes('Noah'));
  assert.ok(markup.includes('重听 Noah 的话'));
  assert.ok(!markup.includes('Alex'));
});

test('主题设置实际生成四个可访问的单选项且只选中当前配色', () => {
  const markup = renderToStaticMarkup(
    createElement(ThemePicker, { selectedTheme: 'ocean', onThemeChange: () => {} }),
  );
  assert.equal((markup.match(/type="radio"/g) || []).length, 4);
  assert.equal((markup.match(/checked=""/g) || []).length, 1);
  assert.ok(markup.includes('role="radiogroup"'));
  for (const title of ['暮色紫', '海盐蓝', '森林绿', '奶油白']) assert.ok(markup.includes(title));
});
