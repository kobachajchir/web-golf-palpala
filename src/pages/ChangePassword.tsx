import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PasswordChangePanel } from '../components/PasswordChangePanel';
import { useAuth } from '../hooks/useAuth';

export function ChangePassword() {
  const navigate = useNavigate();
  const { firebaseUser, logout, refreshUser, user } = useAuth();
  const [passwordChanged, setPasswordChanged] = useState(false);

  const handleChanged = async () => {
    await refreshUser();
    setPasswordChanged(true);
  };

  const handleStartSession = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="page-container login-page">
      <section className="auth-card">
        <div className="auth-card__intro">
          <p className="eyebrow">Golf Palpalá</p>
          <h1>Cambiá tu contraseña</h1>
          <p>
            {user?.mustChangePassword
              ? 'Estás usando una contraseña temporal. Para continuar, definí una nueva.'
              : 'Actualizá tu contraseña de acceso a la app.'}
          </p>
        </div>

        {passwordChanged ? (
          <div className="auth-form">
            <div className="accounting-success">Contrasena actualizada.</div>
            <button type="button" className="btn-primary form-submit" onClick={() => void handleStartSession()}>
              Iniciar sesion
            </button>
          </div>
        ) : (
          <PasswordChangePanel firebaseUser={firebaseUser} onChanged={handleChanged} />
        )}
      </section>
    </div>
  );
}
