import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';
import { CustomTrainingForm } from '../src/components/CustomTrainingDialog.tsx';
import { DEFAULT_SETTINGS } from '../src/lib/core.ts';
import type { CustomTraining } from '../src/lib/customTraining.ts';
import { createTrainingDraft, readTrainings } from '../src/lib/customTraining.ts';

const CONNECTED_SETTINGS = { ...DEFAULT_SETTINGS, apiKey: 'test-only' };
type FormProps = ComponentProps<typeof CustomTrainingForm>;

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('');
}

async function mountForm(
  context: TestContext,
  initialProps: Partial<FormProps> = {},
  templates: CustomTraining[] = [],
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = new Map<string, string>();
  if (templates.length) stored.set('morrow:custom-trainings', JSON.stringify(templates));
  let shouldFailStorage = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (shouldFailStorage) throw new Error('QuotaExceededError');
        stored.set(key, value);
      },
    },
  });
  const started: CustomTraining[] = [];
  const notifications: string[] = [];
  let settingsOpened = 0;
  let closed = 0;
  let props: FormProps = {
    settings: CONNECTED_SETTINGS,
    onStart: (training) => started.push(training),
    onOpenSettings: () => {
      settingsOpened += 1;
    },
    onClose: () => {
      closed += 1;
    },
    notify: (message) => notifications.push(message),
    ...initialProps,
  };
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(CustomTrainingForm, props));
  });
  let isMounted = true;
  context.after(async () => {
    if (isMounted) await act(async () => renderer.unmount());
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const button = (title: string) =>
    renderer.root.findAllByType('button').find((entry) => textContent(entry) === title)!;
  const field = (suffix: string) =>
    renderer.root.findAll(
      (entry) => typeof entry.props.id === 'string' && entry.props.id.endsWith(`-${suffix}`),
    )[0];
  return {
    renderer,
    started,
    notifications,
    stored,
    button,
    field,
    settingsOpened: () => settingsOpened,
    closed: () => closed,
    failStorage: () => {
      shouldFailStorage = true;
    },
    change: async (suffix: string, value: string) => {
      await act(async () => field(suffix).props.onChange({ target: { value } }));
    },
    click: async (title: string) => {
      await act(async () => button(title).props.onClick());
    },
    start: async () => {
      await act(async () =>
        renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }),
      );
    },
    update: async (next: Partial<FormProps>) => {
      props = { ...props, ...next };
      await act(async () => renderer.update(createElement(CustomTrainingForm, props)));
    },
    importFile: async (file: File) => {
      await act(async () =>
        renderer.root
          .findByProps({ type: 'file' })
          .props.onChange({ currentTarget: { files: [file], value: file.name } }),
      );
    },
    unmount: async () => {
      await act(async () => renderer.unmount());
      isMounted = false;
    },
  };
}

function deferredTextFile(name = 'article.txt') {
  let resolve!: (buffer: ArrayBuffer) => void;
  const pending = new Promise<ArrayBuffer>((complete) => {
    resolve = complete;
  });
  return {
    file: { name, size: 20, arrayBuffer: () => pending } as File,
    complete: async (text: string) => {
      await act(async () => {
        resolve(new TextEncoder().encode(text).buffer);
        await new Promise<void>((done) => setImmediate(done));
      });
    },
  };
}

test('自定义训练是自由描述，不出现分类或角色表单，空白时不能开始', async (context) => {
  const form = await mountForm(context);
  const content = textContent(form.renderer.root);
  assert.ok(content.includes('你想怎么练？'));
  assert.ok(!content.includes('情景对话'));
  assert.ok(!content.includes('语伴角色'));
  assert.ok(!content.includes('我的角色'));
  assert.equal(form.renderer.root.findAllByProps({ role: 'tablist' }).length, 0);
  await form.start();
  assert.equal(form.started.length, 0);
  assert.ok(textContent(form.renderer.root.findByProps({ role: 'alert' })).includes('请描述'));
  assert.equal(form.stored.size, 0);
});

test('未连接时打开设置，连接后保留输入，开始使用快照且不会自动保存模板', async (context) => {
  const form = await mountForm(context, { settings: DEFAULT_SETTINGS });
  await form.change('instructions', ' 请当我的面试官，根据简历逐个追问。 ');
  await form.change('material', '项目经历：负责移动端开发。');
  await form.start();
  assert.equal(form.settingsOpened(), 1);
  assert.equal(form.started.length, 0);
  await form.update({ settings: { ...CONNECTED_SETTINGS, practiceLanguage: 'fr-FR' } });
  assert.ok(form.field('instructions').props.value.includes('面试官'));
  assert.ok(form.field('material').props.value.includes('移动端'));
  await form.start();
  assert.equal(form.started.length, 1);
  assert.equal(form.started[0].instructions, '请当我的面试官，根据简历逐个追问。');
  assert.deepEqual(
    Object.keys(form.started[0]).sort(),
    ['id', 'title', 'instructions', 'material', 'sourceName', 'createdAt', 'updatedAt'].sort(),
  );
  assert.equal(readTrainings().length, 0);
  await form.change('instructions', '换一个场景');
  assert.ok(form.started[0].instructions.includes('面试官'));
});

test('仅材料也能训练；显式保存、更新和二次确认删除模板', async (context) => {
  const form = await mountForm(context);
  await form.change('title', '');
  await form.change('material', 'resilience, curious, take a break');
  await form.click('保存模板');
  assert.equal(readTrainings().length, 1);
  assert.equal(readTrainings()[0].title, '自定义训练');
  await form.change('instructions', '用这些单词陪我聊一天的生活');
  await form.click('更新模板');
  assert.equal(readTrainings().length, 1);
  assert.ok(readTrainings()[0].instructions.includes('一天的生活'));
  const remove = form.renderer.root.findByProps({ 'aria-label': '删除模板 自定义训练' });
  await act(async () => remove.props.onClick());
  assert.equal(readTrainings().length, 1);
  await form.click('确认删除');
  assert.equal(readTrainings().length, 0);
  assert.ok(form.field('material').props.value.includes('resilience'));
});

test('存储失败不显示保存或删除成功，草稿和模板保留', async (context) => {
  const form = await mountForm(context);
  await form.change('instructions', '陪我练开会表达');
  form.failStorage();
  await form.click('保存模板');
  assert.equal(form.notifications.length, 0);
  assert.ok(textContent(form.renderer.root.findByProps({ role: 'alert' })).includes('未能保存'));
  assert.equal(form.field('instructions').props.value, '陪我练开会表达');
});

test('导入先预览再由用户采用，读取和确认期间不能开始或保存', async (context) => {
  const form = await mountForm(context);
  await form.change('instructions', '根据附件提问');
  await form.change('material', '已有材料');
  const upload = deferredTextFile();
  await form.importFile(upload.file);
  assert.equal(form.button('保存模板').props.disabled, true);
  await form.start();
  assert.equal(form.started.length, 0);
  await upload.complete('新文章内容');
  assert.equal(form.field('material').props.value, '已有材料');
  assert.equal(form.field('preview').props.value, '新文章内容');
  assert.equal(form.button('保存模板').props.disabled, true);
  await form.change('preview', '检查修改后的文章');
  await form.click('使用这份材料');
  assert.equal(form.field('material').props.value, '检查修改后的文章');
  assert.equal(form.button('保存模板').props.disabled, false);
  await form.start();
  assert.equal(form.started[0].material, '检查修改后的文章');
  assert.equal(form.started[0].sourceName, 'article.txt');
});

test('新导入替代旧请求，材料编辑与取消读取均挡住迟到结果', async (context) => {
  const form = await mountForm(context);
  const oldFile = deferredTextFile('old.txt');
  const newFile = deferredTextFile('new.txt');
  await form.importFile(oldFile.file);
  await form.importFile(newFile.file);
  await oldFile.complete('不应出现的旧内容');
  assert.equal(
    form.renderer.root.findAllByProps({ className: 'training-import-preview' }).length,
    0,
  );
  await form.change('material', '用户正在写的新材料');
  await newFile.complete('不应覆盖用户输入');
  assert.equal(form.field('material').props.value, '用户正在写的新材料');
  assert.equal(
    form.renderer.root.findAllByProps({ className: 'training-import-preview' }).length,
    0,
  );
  const canceled = deferredTextFile('cancel.txt');
  await form.importFile(canceled.file);
  await form.click('取消读取');
  await canceled.complete('已取消的内容');
  assert.equal(form.field('material').props.value, '用户正在写的新材料');
  assert.equal(
    form.renderer.root.findAllByProps({ className: 'training-import-preview' }).length,
    0,
  );
});

test('从材料区打开模型设置保留草稿，并取消尚未完成的图片或文件读取', async (context) => {
  const form = await mountForm(context);
  await form.change('instructions', '请围绕图片向我提问');
  await form.change('material', '原有材料');
  const upload = deferredTextFile();
  await form.importFile(upload.file);
  await form.click('模型设置');
  assert.equal(form.settingsOpened(), 1);
  await upload.complete('切换设置前的迟到内容');
  assert.equal(form.field('instructions').props.value, '请围绕图片向我提问');
  assert.equal(form.field('material').props.value, '原有材料');
  assert.equal(
    form.renderer.root.findAllByProps({ className: 'training-import-preview' }).length,
    0,
  );
});

test('新建、清空、关闭与卸载都会取消旧导入，不回写草稿或通知成功', async (context) => {
  const form = await mountForm(context);
  await form.change('material', '将被清空');
  const first = deferredTextFile('clear.txt');
  await form.importFile(first.file);
  await form.click(' 清空材料');
  await first.complete('迟到内容');
  assert.equal(form.field('material').props.value, '');
  const second = deferredTextFile('new.txt');
  await form.importFile(second.file);
  await form.click(' 新建空白训练');
  await second.complete('另一个迟到结果');
  assert.equal(form.field('material').props.value, '');
  const third = deferredTextFile('close.txt');
  await form.importFile(third.file);
  await form.click('取消');
  await third.complete('关闭后结果');
  assert.equal(form.closed(), 1);
  assert.equal(
    form.renderer.root.findAllByProps({ className: 'training-import-preview' }).length,
    0,
  );
  const fourth = deferredTextFile('unmount.txt');
  await form.importFile(fourth.file);
  await form.unmount();
  await fourth.complete('卸载后结果');
  assert.equal(form.notifications.length, 0);
});

test('读取模板可继续编辑；失败的删除不能移除原模板或产生成功通知', async (context) => {
  const training = { ...createTrainingDraft(), title: '我的点餐', instructions: '模拟咖啡店点餐' };
  const loaded = await mountForm(context, {}, [training]);
  const template = loaded.renderer.root.findByProps({ className: 'training-template-select' });
  await act(async () => template.props.onClick());
  assert.equal(loaded.field('instructions').props.value, '模拟咖啡店点餐');
  await loaded.change('instructions', '继续练习点餐');
  await loaded.click('更新模板');
  assert.ok(readTrainings()[0].instructions.includes('继续练习'));
  loaded.failStorage();
  const remove = loaded.renderer.root.findByProps({ 'aria-label': '删除模板 我的点餐' });
  await act(async () => remove.props.onClick());
  await loaded.click('确认删除');
  assert.equal(readTrainings().length, 1);
  assert.equal(loaded.notifications.length, 1);
  assert.ok(
    textContent(
      loaded.renderer.root
        .findAllByProps({ role: 'alert' })
        .find((entry) => textContent(entry).includes('未能删除'))!,
    ).includes('未能删除'),
  );
});
