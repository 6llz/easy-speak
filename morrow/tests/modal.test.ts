import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModalStack } from '../src/lib/modalStack.ts';

class TestDocument {
  body = { style: { overflow: 'clip' } };
  activeElement: TestElement | null = null;
  listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class TestElement {
  children: TestElement[] = [];
  parent: TestElement | null = null;
  isConnected = true;
  isControl = false;
  isVisible = true;
  disabled = false;
  hidden = false;
  inert = false;
  tabIndex = -1;
  style = { zIndex: '' };
  attributes = new Map<string, string>();

  constructor(private ownerDocument: TestDocument) {}

  append(child: TestElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  contains(target: TestElement): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }

  focus() {
    if (!this.isConnected || this.closest('[hidden], [inert]')) return;
    this.ownerDocument.activeElement = this;
    this.ownerDocument.dispatch('focusin', { target: this });
  }

  querySelectorAll(): TestElement[] {
    return this.children.flatMap((child) => [
      ...(child.isControl ? [child] : []),
      ...child.querySelectorAll(),
    ]);
  }

  matches(selector: string) {
    return selector === ':disabled' && this.disabled;
  }

  closest(_selector: string): TestElement | null {
    if (this.hidden || this.inert) return this;
    return this.parent?.closest(_selector) ?? null;
  }

  getClientRects() {
    return this.isVisible ? [{}] : [];
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

function keyEvent(key: string, shiftKey = false, isComposing = false) {
  return {
    key,
    shiftKey,
    isComposing,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
  };
}

function createFixture() {
  const document = new TestDocument();
  const stack = new ModalStack(document as unknown as Document);
  const trigger = new TestElement(document);
  trigger.focus();
  return { document, stack, trigger };
}

function createLayer(document: TestDocument, parentId: symbol | null = null) {
  const container = new TestElement(document);
  const panel = container.append(new TestElement(document));
  let closes = 0;
  const layer = {
    id: Symbol('test-modal'),
    parentId,
    container: container as unknown as HTMLElement,
    panel: panel as unknown as HTMLElement,
    onClose: () => closes++,
  };
  return { layer, container, panel, closeCount: () => closes };
}

function createControl(document: TestDocument, panel: TestElement) {
  const control = panel.append(new TestElement(document));
  control.isControl = true;
  control.tabIndex = 0;
  return control;
}

test('嵌套弹窗只由顶层响应 Escape 和关闭，逐层恢复触发按钮与滚动状态', async () => {
  const { document, stack, trigger } = createFixture();
  const outer = createLayer(document);
  const removeOuter = stack.register(outer.layer);
  await Promise.resolve();
  const childTrigger = createControl(document, outer.panel);
  childTrigger.focus();
  const inner = createLayer(document, outer.layer.id);
  const removeInner = stack.register(inner.layer);
  await Promise.resolve();

  assert.equal(document.activeElement, inner.panel);
  assert.equal(outer.container.inert, true);
  assert.equal(inner.container.inert, false);
  assert.equal(outer.panel.attributes.get('aria-modal'), 'false');
  assert.equal(inner.panel.attributes.get('aria-modal'), 'true');
  assert.ok(Number(inner.container.style.zIndex) > Number(outer.container.style.zIndex));
  stack.requestClose(outer.layer.id);
  assert.equal(outer.closeCount(), 0);
  const escape = keyEvent('Escape');
  document.dispatch('keydown', escape);
  assert.equal(inner.closeCount(), 1);
  assert.equal(outer.closeCount(), 0);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true);

  removeInner();
  assert.equal(document.activeElement, childTrigger);
  assert.equal(outer.container.inert, false);
  assert.equal(document.body.style.overflow, 'hidden');
  removeOuter();
  assert.equal(document.activeElement, trigger);
  assert.equal(document.body.style.overflow, 'clip');
  assert.equal(document.listeners.get('keydown')?.size, 0);
  assert.equal(document.listeners.get('focusin')?.size, 0);
});

test('React 子 effect 先于父 effect 登记时，层级与初始焦点仍属于子弹窗', async () => {
  const { document, stack, trigger } = createFixture();
  const outer = createLayer(document);
  const inner = createLayer(document, outer.layer.id);
  const removeInner = stack.register(inner.layer);
  const removeOuter = stack.register(outer.layer);
  await Promise.resolve();

  assert.equal(stack.isTop(inner.layer.id), true);
  assert.equal(document.activeElement, inner.panel);
  assert.equal(outer.container.inert, true);
  removeInner();
  assert.equal(document.activeElement, outer.panel);
  removeOuter();
  assert.equal(document.activeElement, trigger);
});

test('Tab 在顶层可操作元素之间循环，过滤禁用、隐藏与负 tabindex 元素', async () => {
  const { document, stack } = createFixture();
  const outer = createLayer(document);
  const disabled = createControl(document, outer.panel);
  disabled.disabled = true;
  const hidden = createControl(document, outer.panel);
  hidden.isVisible = false;
  const negativeTabIndex = createControl(document, outer.panel);
  negativeTabIndex.tabIndex = -1;
  const first = createControl(document, outer.panel);
  const last = createControl(document, outer.panel);
  const remove = stack.register(outer.layer);
  await Promise.resolve();

  const initialTab = keyEvent('Tab');
  document.dispatch('keydown', initialTab);
  assert.equal(document.activeElement, first);
  assert.equal(initialTab.defaultPrevented, true);
  document.dispatch('keydown', keyEvent('Tab', true));
  assert.equal(document.activeElement, last);
  document.dispatch('keydown', keyEvent('Tab'));
  assert.equal(document.activeElement, first);
  const interiorTab = keyEvent('Tab');
  document.dispatch('keydown', interiorTab);
  assert.equal(interiorTab.defaultPrevented, false);
  remove();
});

test('空弹窗及外部脚本移动焦点时，焦点保持在顶层；输入法 Escape 不关闭', async () => {
  const { document, stack, trigger } = createFixture();
  const modal = createLayer(document);
  const remove = stack.register(modal.layer);
  await Promise.resolve();

  const tab = keyEvent('Tab');
  document.dispatch('keydown', tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(document.activeElement, modal.panel);
  trigger.focus();
  assert.equal(document.activeElement, modal.panel);
  document.dispatch('keydown', keyEvent('Escape', false, true));
  assert.equal(modal.closeCount(), 0);
  remove();
});

test('整棵弹窗树按父到子卸载时，最终恢复外部触发按钮而不跳向已消失的父界面', async () => {
  const { document, stack, trigger } = createFixture();
  const outer = createLayer(document);
  const removeOuter = stack.register(outer.layer);
  await Promise.resolve();
  const childTrigger = createControl(document, outer.panel);
  childTrigger.focus();
  const inner = createLayer(document, outer.layer.id);
  const removeInner = stack.register(inner.layer);
  await Promise.resolve();

  removeOuter();
  childTrigger.isConnected = false;
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement, inner.panel);
  removeInner();
  assert.equal(document.activeElement, trigger);
  assert.equal(document.body.style.overflow, 'clip');
});

test('子弹窗触发按钮已删除时，关闭后回到存活父弹窗', async () => {
  const { document, stack } = createFixture();
  const outer = createLayer(document);
  const removeOuter = stack.register(outer.layer);
  await Promise.resolve();
  const childTrigger = createControl(document, outer.panel);
  childTrigger.focus();
  const inner = createLayer(document, outer.layer.id);
  const removeInner = stack.register(inner.layer);
  await Promise.resolve();

  childTrigger.isConnected = false;
  removeInner();
  assert.equal(document.activeElement, outer.panel);
  removeOuter();
});

test('StrictMode 式挂载清理再挂载以及重复清理，不泄露监听或移走当前焦点', async () => {
  const { document, stack, trigger } = createFixture();
  const modal = createLayer(document);
  const removeFirst = stack.register(modal.layer);
  removeFirst();
  const removeSecond = stack.register(modal.layer);
  removeFirst();
  await Promise.resolve();

  assert.equal(stack.isTop(modal.layer.id), true);
  assert.equal(document.activeElement, modal.panel);
  assert.equal(document.listeners.get('keydown')?.size, 1);
  removeSecond();
  removeSecond();
  assert.equal(document.activeElement, trigger);
  assert.equal(document.body.style.overflow, 'clip');
  assert.equal(document.listeners.get('keydown')?.size, 0);
});
