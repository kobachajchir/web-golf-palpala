import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { DEV_USER_NUMBER, DEV_USER_PASSWORD } from '../mocks/devUser';
import { findUserByLogin, updateMockUserTimestamps } from '../mocks/userDirectory';
import '../styles/pages.css';

type LoginFormState = {
  user_number: string;
  password: string;
};

function toDatetimeLocal(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState<LoginFormState>({
    user_number: '',
    password: '',
  });
  const [error, setError] = useState('');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError('');

    if (!formData.user_number || !formData.password) {
      setError('Por favor completa numero de usuario y contrasena.');
      return;
    }

    const now = toDatetimeLocal();
    const normalizedUserNumber = formData.user_number.trim();
    const foundUser = findUserByLogin(normalizedUserNumber, formData.password);

    if (!foundUser) {
      setError('El numero de usuario o la contrasena no coinciden.');
      return;
    }

    const userData =
      updateMockUserTimestamps(foundUser.id, now) || {
        ...foundUser,
        last_login_at: now,
        updated_at: now,
      };

    console.log('Mock Firebase Auth login', {
      user_number: normalizedUserNumber,
      is_dev_user: normalizedUserNumber === DEV_USER_NUMBER && formData.password === DEV_USER_PASSWORD,
      role_id: userData.role_id,
    });
    console.log('Mock Firestore users document', userData);

    login(userData);
    navigate('/home', { replace: true });
  };

  return (
    <div className="page-container login-page">
      <section className="auth-card">
        <div className="auth-card__intro">
          <p className="eyebrow">Golf Palpala</p>
          <h1>Ingreso</h1>
          <p>Ingresa con tu numero de usuario y contrasena.</p>
          <p className="auth-dev-note">
            Dev: <strong>{DEV_USER_NUMBER}</strong> / <strong>{DEV_USER_PASSWORD}</strong>
          </p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="user_number">
            <span>Numero de usuario</span>
            <input
              id="user_number"
              name="user_number"
              type="text"
              autoComplete="username"
              value={formData.user_number}
              onChange={handleChange}
              placeholder="Ej. 100001"
            />
          </label>

          <label className="form-field" htmlFor="password">
            <span>Contrasena</span>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Tu contrasena"
            />
          </label>

          <button type="submit" className="btn-primary form-submit">
            Entrar
          </button>
        </form>

        <div className="auth-card__footer">
          <p>
            No tenes usuario?{' '}
            <Link to="/signup" className="auth-link">
              Registrarte
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
