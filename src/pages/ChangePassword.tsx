import { useNavigate } from 'react-router-dom';
import { PasswordChangePanel } from '../components/PasswordChangePanel';
import { useAuth } from '../hooks/useAuth';

export function ChangePassword() {
  const navigate = useNavigate();
  const { firebaseUser, refreshUser, user } = useAuth();

  const handleChanged = async () => {
    await refreshUser();
    navigate('/home', { replace: true });
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

        <PasswordChangePanel firebaseUser={firebaseUser} onChanged={handleChanged} />
      </section>
    </div>
  );
}
