import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="not-found-icon">
      <path d="M12 2.5 1.7 20.25A1.5 1.5 0 0 0 3 22.5h18a1.5 1.5 0 0 0 1.3-2.25L12 2.5Zm1 15h-2v-2h2v2Zm0-4h-2v-6h2v6Z" />
    </svg>
  );
}

export function NotFound() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  return (
    <div className="page-container login-page">
      <section className="auth-card not-found-card">
        <div className="auth-card__intro">
          <WarningIcon />
          <p className="eyebrow">Página no encontrada</p>
          <h1>404</h1>
          <p>No encontramos la página que estás buscando.</p>
        </div>

        <button
          type="button"
          className="btn-primary form-submit"
          onClick={() => navigate(isAuthenticated ? '/home' : '/login', { replace: true })}
        >
          Volver
        </button>
      </section>
    </div>
  );
}
