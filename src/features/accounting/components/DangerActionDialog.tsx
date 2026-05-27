import { useEffect, useRef } from 'react';
import { validateReversalReason } from '../utils/accountingValidators';

export function DangerActionDialog({
  open,
  title,
  description,
  reason,
  confirmLabel = 'Confirmar',
  loading = false,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  reason: string;
  confirmLabel?: string;
  loading?: boolean;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);
  const reasonError = validateReversalReason(reason);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousActiveElement = document.activeElement as HTMLElement | null;
    firstButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) {
        onCancel();
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
      previousActiveElement?.focus?.();
    };
  }, [loading, onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) {
        onCancel();
      }
    }}>
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
          <p className="profile-note">{description}</p>
        </div>
        <label className="form-field">
          <span>Motivo obligatorio</span>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            aria-invalid={Boolean(reasonError)}
            aria-describedby="danger-action-reason-help"
          />
          <small id="danger-action-reason-help">{reasonError ?? 'El motivo queda en auditoria.'}</small>
        </label>
        <div className="form-actions confirm-dialog-card__actions">
          <button ref={firstButtonRef} type="button" className="btn-secondary" disabled={loading} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn-danger" disabled={loading || Boolean(reasonError)} onClick={onConfirm}>
            {loading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
