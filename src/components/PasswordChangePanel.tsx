import { useState, type FormEvent } from 'react';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  type User as FirebaseAuthUser,
} from 'firebase/auth';
import { createUsersCallables } from '../modules/users/functions/users.callables';

type PasswordChangePanelProps = {
  firebaseUser: FirebaseAuthUser | null;
  requireCurrentPassword?: boolean;
  onChanged?: () => Promise<void> | void;
};

const DEFAULT_TEMPORARY_PASSWORD = 'password';

export function PasswordChangePanel({
  firebaseUser,
  requireCurrentPassword = false,
  onChanged,
}: PasswordChangePanelProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visibleFields, setVisibleFields] = useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!firebaseUser) {
      setError('No hay una sesión activa.');
      return;
    }

    if (newPassword.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    if (newPassword.trim().toLowerCase() === DEFAULT_TEMPORARY_PASSWORD) {
      setError('La nueva contrasena no puede ser la clave temporal por defecto.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);

    try {
      if (requireCurrentPassword) {
        if (!currentPassword || !firebaseUser.email) {
          throw new Error('Ingresá tu contraseña actual.');
        }

        await reauthenticateWithCredential(
          firebaseUser,
          EmailAuthProvider.credential(firebaseUser.email, currentPassword),
        );
      }

      await updatePassword(firebaseUser, newPassword);
      await createUsersCallables().completeOwnPasswordChange();
      await onChanged?.();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Contraseña actualizada.');
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'No pudimos cambiar la contraseña.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFieldVisibility = (field: keyof typeof visibleFields) => {
    setVisibleFields((current) => ({ ...current, [field]: !current[field] }));
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {requireCurrentPassword && (
        <label className="form-field">
          <span>Contraseña actual</span>
          <span className="password-input-wrap">
            <input
              type={visibleFields.current ? 'text' : 'password'}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <button type="button" className="password-visibility-button" onClick={() => toggleFieldVisibility('current')}>
              {visibleFields.current ? 'Ocultar' : 'Ver'}
            </button>
          </span>
        </label>
      )}

      <label className="form-field">
        <span>Nueva contraseña</span>
        <span className="password-input-wrap">
          <input
            type={visibleFields.next ? 'text' : 'password'}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <button type="button" className="password-visibility-button" onClick={() => toggleFieldVisibility('next')}>
            {visibleFields.next ? 'Ocultar' : 'Ver'}
          </button>
        </span>
      </label>

      <label className="form-field">
        <span>Repetir nueva contraseña</span>
        <span className="password-input-wrap">
          <input
            type={visibleFields.confirm ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <button type="button" className="password-visibility-button" onClick={() => toggleFieldVisibility('confirm')}>
            {visibleFields.confirm ? 'Ocultar' : 'Ver'}
          </button>
        </span>
      </label>

      {error && <div className="error-message">{error}</div>}
      {message && <div className="accounting-success">{message}</div>}

      <button type="submit" className="btn-primary form-submit" disabled={submitting}>
        {submitting ? 'Guardando...' : 'Cambiar contraseña'}
      </button>
    </form>
  );
}
