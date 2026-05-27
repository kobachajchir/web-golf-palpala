import { Link } from 'react-router-dom';
import clubLogo from '../assets/ClubLogo.png';

function BackChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M14.8 5.4 8.2 12l6.6 6.6-1.6 1.6L5 12l8.2-8.2 1.6 1.6Z" fill="currentColor" />
    </svg>
  );
}

export function SignUp() {
  return (
    <div className="page-container signup-page">
      <div className="auth-stack">
        <section className="auth-card auth-card--signup">
          <Link to="/login" className="btn-secondary auth-back-button auth-back-button--top">
            <span className="auth-back-button__icon" aria-hidden="true">
              <BackChevronIcon />
            </span>
            Volver al Login
          </Link>

          <div className="auth-card__intro">
            <img src={clubLogo} alt="Palpala Golf Tenis Club" className="auth-card__logo" />
            <p className="eyebrow">Palpala Golf Tenis Club</p>
            <h1>Alta controlada</h1>
            <p>
              Las cuentas se crean desde administracion con numero de socio y Firebase Auth. No hay
              autorregistro publico para socios, empleados, administrativos ni Comite Ejecutivo.
            </p>
          </div>

          <div className="auth-card__footer">
            <p className="auth-signup-line">
              Ya tenes tu numero de socio?
              <Link to="/login" className="auth-link">
                Ingresar
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
