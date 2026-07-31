import { useEffect, useRef, type ReactNode } from 'react';
import { validateReversalReason } from '../utils/accountingValidators';

export function DangerActionDialog({
  open,
  title,
  description,
  reason,
  confirmLabel = 'Confirmar',
  confirmVariant = 'danger',
  loading = false,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  reason: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'secondary';
  loading?: boolean;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const reasonTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const loadingRef = useRef(loading);
  const onCancelRef = useRef(onCancel);
  const reasonError = validateReversalReason(reason);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    reasonTextAreaRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadingRef.current) {
        onCancelRef.current();
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])'))
            .filter((element) => !element.hasAttribute('disabled'))
        : [];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="floating-card confirm-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="danger-action-title"
      >
        <div className="confirm-dialog-card__copy">
          <p className="eyebrow">Confirmacion sensible</p>
          <h2 id="danger-action-title">{title}</h2>
          <div className="profile-note">{description}</div>
        </div>
        <label className="form-field">
          <span>Motivo obligatorio</span>
          <textarea
            ref={reasonTextAreaRef}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            aria-invalid={Boolean(reasonError)}
            aria-describedby="danger-action-reason-help"
          />
          <small id="danger-action-reason-help">{reasonError ?? 'El motivo queda en auditoria.'}</small>
        </label>
        <div className="form-actions confirm-dialog-card__actions">
          <button type="button" className="btn-secondary" disabled={loading} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className={confirmVariant === 'secondary' ? 'btn-secondary' : 'btn-danger'} disabled={loading || Boolean(reasonError)} onClick={onConfirm}>
            {loading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
