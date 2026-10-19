import { createContext, useContext, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ModalStack } from '../lib/modalStack';

type ModalProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
};

const ModalParent = createContext<symbol | null>(null);
let modalStack: ModalStack | null = null;

/** 将弹窗挂到页面顶层，统一限制焦点，并在关闭后恢复到当前层的触发按钮。 */
export function Modal({ title, description, children, onClose, className = '' }: ModalProps) {
  const parentId = useContext(ModalParent);
  const layerId = useRef(Symbol('modal'));
  const titleId = useId();
  const descriptionId = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!panel.current || !backdrop.current) return;
    modalStack ??= new ModalStack(document);
    return modalStack.register({
      id: layerId.current,
      parentId,
      container: backdrop.current,
      panel: panel.current,
      onClose: () => closeRef.current(),
    });
  }, [parentId]);
  const handleClose = () => modalStack?.requestClose(layerId.current);
  return createPortal(
    <ModalParent.Provider value={layerId.current}>
      <div
        className="modal-backdrop"
        ref={backdrop}
        onMouseDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) handleClose();
        }}
      >
        <div
          className={`modal ${className}`}
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
        >
          <div className="modal-heading">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description && <p id={descriptionId}>{description}</p>}
            </div>
            <button className="icon-button" onClick={handleClose} aria-label="关闭弹窗">
              <X size={20} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </ModalParent.Provider>,
    document.body,
  );
}
