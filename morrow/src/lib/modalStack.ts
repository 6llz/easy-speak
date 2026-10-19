type ModalLayer = {
  id: symbol;
  parentId: symbol | null;
  container: HTMLElement;
  panel: HTMLElement;
  onClose: () => void;
};

type RegisteredLayer = ModalLayer & { returnFocus: HTMLElement | null };

const FOCUSABLE_SELECTOR =
  'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"], summary';

/**
 * 统一管理弹窗层级、焦点与页面滚动；只有最上层能响应键盘和关闭操作。
 * 子弹窗可能先执行 React effect，因此按父子关系插入，不能依赖 effect 执行顺序。
 */
export class ModalStack {
  private layers: RegisteredLayer[] = [];
  private previousOverflow = '';

  constructor(private ownerDocument: Document) {}

  register(layer: ModalLayer): () => void {
    const entry: RegisteredLayer = {
      ...layer,
      returnFocus: this.ownerDocument.activeElement as HTMLElement | null,
    };
    if (!this.layers.length) {
      this.previousOverflow = this.ownerDocument.body.style.overflow;
      this.ownerDocument.body.style.overflow = 'hidden';
      this.ownerDocument.addEventListener('keydown', this.handleKeyDown);
      this.ownerDocument.addEventListener('focusin', this.handleFocusIn);
    }
    const childIndex = this.layers.findIndex((item) => item.parentId === entry.id);
    this.layers.splice(childIndex < 0 ? this.layers.length : childIndex, 0, entry);
    this.updateLayers();

    // 等同一提交里的父、子弹窗全部登记后再移焦，避免父弹窗夺走子弹窗焦点。
    queueMicrotask(() => {
      if (this.layers.includes(entry) && this.isTop(entry.id)) entry.panel.focus();
    });

    return () => {
      const index = this.layers.indexOf(entry);
      if (index < 0) return;
      const wasTop = this.isTop(entry.id);
      this.layers.splice(index, 1);
      for (const remaining of this.layers) {
        if (remaining.parentId === entry.id) remaining.parentId = entry.parentId;
        // 整棵弹窗树一起卸载时，子弹窗的触发按钮也会消失，继续向外恢复焦点。
        if (remaining.returnFocus && entry.panel.contains(remaining.returnFocus))
          remaining.returnFocus = entry.returnFocus;
      }
      this.updateLayers();
      if (!this.layers.length) {
        this.ownerDocument.body.style.overflow = this.previousOverflow;
        this.ownerDocument.removeEventListener('keydown', this.handleKeyDown);
        this.ownerDocument.removeEventListener('focusin', this.handleFocusIn);
      }
      if (!wasTop) return;
      const next = this.layers.at(-1);
      if (entry.returnFocus?.isConnected && (!next || next.panel.contains(entry.returnFocus)))
        entry.returnFocus.focus();
      else next?.panel.focus();
    };
  }

  isTop(id: symbol): boolean {
    return this.layers.at(-1)?.id === id;
  }

  requestClose(id: symbol): void {
    if (this.isTop(id)) this.layers.at(-1)?.onClose();
  }

  private updateLayers() {
    const top = this.layers.at(-1);
    this.layers.forEach((layer, index) => {
      layer.container.inert = layer !== top;
      layer.container.style.zIndex = String(100 + index);
      layer.panel.setAttribute('aria-modal', layer === top ? 'true' : 'false');
    });
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const top = this.layers.at(-1);
    if (!top || event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.requestClose(top.id);
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = Array.from(top.panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[hidden], [inert]') &&
        element.getClientRects().length > 0,
    );
    const first = elements[0];
    const last = elements.at(-1);
    const active = this.ownerDocument.activeElement;
    if (!first || !last) {
      event.preventDefault();
      top.panel.focus();
    } else if (!elements.includes(active as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private handleFocusIn = (event: FocusEvent) => {
    const top = this.layers.at(-1);
    if (top && event.target && !top.panel.contains(event.target as Node)) top.panel.focus();
  };
}
