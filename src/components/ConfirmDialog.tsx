import { useEffect, type ReactNode } from 'react';

type ConfirmDialogTone = 'default' | 'danger';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string | null;
  tone?: ConfirmDialogTone;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  loading = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [loading, onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <section className="floating-card confirm-dialog-card" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="confirm-dialog-card__copy">
          <p className="eyebrow">Confirmacion</p>
          <h2 id="confirm-dialog-title">{title}</h2>
          {description && <div className="profile-note">{description}</div>}
        </div>

        <div className="form-actions confirm-dialog-card__actions">
          {cancelLabel !== null && (
            <button type="button" className="btn-danger" disabled={loading} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
