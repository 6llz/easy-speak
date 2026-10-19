import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { act, create } from 'react-test-renderer';
import { DeferredFeature } from '../src/components/DeferredFeature.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type FeatureProps = { label: string };
type FeatureModule = { default: ComponentType<FeatureProps> };

function deferredModule() {
  let resolve!: (module: FeatureModule) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<FeatureModule>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function LoadedFeature({ label }: FeatureProps) {
  return createElement('h1', {}, label);
}

test('次要功能载入失败可真正重新请求，重试不会卸载对话组件', async (context) => {
  context.mock.method(console, 'error', () => {});
  const first = deferredModule();
  const second = deferredModule();
  let requests = 0;
  let practiceMounts = 0;
  let practiceUnmounts = 0;
  const load = () => (++requests === 1 ? first.promise : second.promise);
  function Practice() {
    useEffect(() => {
      practiceMounts++;
      return () => {
        practiceUnmounts++;
      };
    }, []);
    return createElement('span', { id: 'practice' }, '对话仍在');
  }
  function Harness({ label }: FeatureProps) {
    return createElement(
      'main',
      {},
      createElement(Practice),
      createElement(DeferredFeature<FeatureProps>, {
        load,
        featureProps: { label },
        title: '学习中心',
        presentation: 'page',
        onClose: () => {},
      }),
    );
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(Harness, { label: '最初的课程' }));
  });
  context.after(async () => {
    await act(async () => renderer.unmount());
  });
  assert.equal(requests, 1);
  assert.equal(
    renderer.root.findByProps({ role: 'status' }).findByType('h2').children[0],
    '正在打开学习中心…',
  );
  await act(async () => first.reject(new Error('Internal chunk path with sensitive details')));
  assert.equal(
    renderer.root.findByProps({ role: 'alert' }).findByType('h2').children[0],
    '学习中心暂时无法打开',
  );
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('sensitive details'));
  await act(async () => {
    renderer.update(createElement(Harness, { label: '更新后的课程' }));
    renderer.root
      .findAllByType('button')
      .find((button) => button.children[0] === '重新尝试')!
      .props.onClick();
  });
  assert.equal(requests, 2);
  await act(async () => second.resolve({ default: LoadedFeature }));
  assert.equal(renderer.root.findByType('h1').children[0], '更新后的课程');
  assert.equal(renderer.root.findByProps({ id: 'practice' }).children[0], '对话仍在');
  assert.equal(practiceMounts, 1);
  assert.equal(practiceUnmounts, 0);
});

test('取消正在加载的功能后，迟到的模块不会重新打开界面', async (context) => {
  context.mock.method(console, 'error', () => {});
  const pending = deferredModule();
  const load = () => pending.promise;
  function Harness() {
    const [isOpen, setIsOpen] = useState(true);
    return isOpen
      ? createElement(DeferredFeature<FeatureProps>, {
          load,
          featureProps: { label: '不应出现' },
          title: '收藏',
          onClose: () => setIsOpen(false),
        })
      : createElement('p', {}, '已返回对话');
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  context.after(async () => {
    await act(async () => renderer.unmount());
  });
  await act(async () => renderer.root.findByType('button').props.onClick());
  await act(async () => pending.resolve({ default: LoadedFeature }));
  assert.equal(renderer.root.findAllByType('h1').length, 0);
  assert.equal(renderer.root.findByType('p').children[0], '已返回对话');
});

test('已载入功能的渲染错误局限在当前面板，仍可关闭', async (context) => {
  context.mock.method(console, 'error', () => {});
  let closeCount = 0;
  function BrokenFeature(): never {
    throw new Error('Render failed');
  }
  const load = async () => ({ default: BrokenFeature });
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      createElement(DeferredFeature<FeatureProps>, {
        load,
        featureProps: { label: '' },
        title: '练习记录',
        onClose: () => closeCount++,
      }),
    );
  });
  context.after(async () => {
    await act(async () => renderer.unmount());
  });
  assert.equal(
    renderer.root.findByProps({ role: 'alert' }).findByType('h2').children[0],
    '练习记录暂时无法打开',
  );
  await act(async () => {
    renderer.root
      .findAllByType('button')
      .find((button) => button.children[0] === '取消')!
      .props.onClick();
  });
  assert.equal(closeCount, 1);
});
