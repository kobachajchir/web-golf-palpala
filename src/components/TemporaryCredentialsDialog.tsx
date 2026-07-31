import { useEffect } from 'react';

type TemporaryCredentialsDialogProps = {
  open: boolean;
  title: string;
  memberNumber: string;
  temporaryPassword: string;
  onClose: () => void;
};

export function TemporaryCredentialsDialog({
  open,
  title,
  memberNumber,
  temporaryPassword,
  onClose,
}: TemporaryCredentialsDialogProps) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <section className="floating-card credentials-dialog-card" role="dialog" aria-modal="true">
        <div className="confirm-dialog-card__copy">
          <p className="eyebrow">Credenciales de acceso</p>
          <h2>{title}</h2>
          <p className="profile-note">
            Informale estos datos al socio. La clave es temporal y el sistema pedira cambiarla en el primer ingreso.
          </p>
        </div>

        <div className="credentials-dialog-card__details">
          <div>
            <span>Numero de usuario</span>
            <strong>{memberNumber}</strong>
          </div>
          <div>
            <span>Contraseña temporal</span>
            <strong>{temporaryPassword}</strong>
          </div>
        </div>

        <div className="form-actions confirm-dialog-card__actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      </section>
    </div>
  );
}
