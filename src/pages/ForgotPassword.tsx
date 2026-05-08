import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createUsersCallables } from '../modules/users/functions/users.callables';

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
      setError('Ingresá tu número de socio.');
      return;
    }

    setSubmitting(true);

    try {
      await createUsersCallables().requestMemberPasswordReset({ memberNumber });
      setMessage('Solicitud enviada. Administración o Junta Directiva revisará el restablecimiento.');
      setMemberNumber('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No pudimos registrar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container login-page">
      <section className="auth-card">
        <div className="auth-card__intro">
          <p className="eyebrow">Golf Palpalá</p>
          <h1>Recuperar contraseña</h1>
          <p>Ingresá tu número de socio para solicitar un restablecimiento.</p>
        </div>

        {error && <div className="error-message">{error}</div>}
        {message && <div className="accounting-success">{message}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Número de socio</span>
            <input
              type="text"
              autoComplete="username"
              value={memberNumber}
              onChange={(event) => setMemberNumber(event.target.value)}
              placeholder="Ej. 999"
            />
          </label>

          <button type="submit" className="btn-primary form-submit" disabled={submitting}>
            {submitting ? 'Enviando...' : 'Solicitar restablecimiento'}
          </button>
        </form>

        <div className="auth-card__footer">
          <Link to="/login" className="auth-link">
            Volver al ingreso
          </Link>
        </div>
      </section>
    </div>
  );
}
