import { ModalCloseIcon } from '../../../components/ModalCloseIcon';
import { useEffect, type ReactNode } from 'react';

export function AccountingOperationModal({
  title,
  meta,
  onClose,
  children,
}: {
  title: string;
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal-overlay quick-actions-modal-overlay" role="presentation">
      <section
        className="member-modal-card quick-actions-modal accounting-operation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounting-operation-modal-title"
      >
        <div className="member-modal__header quick-actions-modal__header">
          <div className="accounting-operation-modal__title-block">
            <h2 id="accounting-operation-modal-title" className="accounting-operation-modal__title">{title}</h2>
            {meta && <strong className="accounting-operation-modal__meta">{meta}</strong>}
          </div>
          <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={onClose}>
            <ModalCloseIcon />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
