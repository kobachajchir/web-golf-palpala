import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import clubLogo from '../assets/ClubLogo.png';
import { createUsersCallables } from '../modules/users/functions/users.callables';

function BackChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M14.8 5.4 8.2 12l6.6 6.6-1.6 1.6L5 12l8.2-8.2 1.6 1.6Z" fill="currentColor" />
    </svg>
  );
}

export function ForgotPassword() {
  const [memberNumber, setMemberNumber] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setError('');

    if (!memberNumber.trim()) {
      setError('Ingresa tu numero de socio.');
      return;
    }

    setSubmitting(true);

    try {
      await createUsersCallables().requestMemberPasswordReset({ memberNumber });
      setMessage('Solicitud enviada. Administracion o Comite Ejecutivo revisara el restablecimiento.');
      setMemberNumber('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No pudimos registrar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container login-page">
      <div className="auth-stack">
        <section className="auth-card auth-card--forgot">
          <Link to="/login" className="btn-secondary auth-back-button auth-back-button--top">
            <span className="auth-back-button__icon" aria-hidden="true">
              <BackChevronIcon />
            </span>
            Volver al Login
          </Link>

          <div className="auth-card__intro">
            <img src={clubLogo} alt="Palpala Golf Tenis Club" className="auth-card__logo" />
            <p className="eyebrow">Palpala Golf Tenis Club</p>
            <h1>Recuperar contrasena</h1>
            <p>Ingresa tu numero de socio para solicitar un restablecimiento seguro.</p>
          </div>

          {error && <div className="error-message">{error}</div>}
          {message && <div className="accounting-success">{message}</div>}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-field auth-form-field">
              <label htmlFor="memberNumber">Numero de socio</label>
              <input
                id="memberNumber"
                type="text"
                autoComplete="username"
                value={memberNumber}
                onChange={(event) => setMemberNumber(event.target.value)}
                placeholder="Ej. 999"
              />
            </div>

            <div className="auth-submit-row">
              <button type="submit" className="btn-primary form-submit" disabled={submitting}>
                {submitting ? 'Enviando...' : 'Solicitar restablecimiento'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
