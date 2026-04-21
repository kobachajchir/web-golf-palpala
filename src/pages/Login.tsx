import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLES } from '../constants/roles';
import type { User } from '../context/AuthContext';
import { useAuth } from '../hooks/useAuth';
import { DEV_USER, DEV_USER_EMAIL, DEV_USER_PASSWORD } from '../mocks/devUser';
import '../styles/pages.css';

type LoginFormState = {
  email: string;
  password: string;
};

// Valores por defecto para un usuario nuevo.
export const initialDefaultUser: User = {
  id: '',
  auth_uid: '',
  email: '',
  role_id: ROLES.MEMBER,
  profile_type: 'socio',
  profile_id: '',
  status: 'activo',
  must_change_password: false,
  created_at: '',
  updated_at: '',
};

function toDatetimeLocal(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState<LoginFormState>({
    email: '',
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

    if (!formData.email || !formData.password) {
      setError('Por favor completa email y contrasena.');
      return;
    }

    const now = toDatetimeLocal();
    const normalizedEmail = formData.email.trim().toLowerCase();

    if (normalizedEmail === DEV_USER_EMAIL && formData.password !== DEV_USER_PASSWORD) {
      setError('La contrasena del usuario dev no coincide.');
      return;
    }

    if (normalizedEmail === DEV_USER_EMAIL && formData.password === DEV_USER_PASSWORD) {
      const userData: User = {
        ...DEV_USER,
        last_login_at: now,
        updated_at: now,
      };

      console.log('Mock Firebase Auth login dev', {
        email: DEV_USER_EMAIL,
        role_id: userData.role_id,
      });
      console.log('Mock Firestore users document', userData);

      login(userData);
      navigate('/home', { replace: true });
      return;
    }

    const userData: User = {
      ...initialDefaultUser,
      id: `user-${Date.now()}`,
      auth_uid: `firebase-uid-${Date.now()}`,
      email: normalizedEmail,
      created_at: now,
      updated_at: now,
    };

    console.log('Mock Firebase Auth login', {
      email: normalizedEmail,
      password_length: formData.password.length,
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
          <p>Ingresa con tu email y contrasena.</p>
          <p className="auth-dev-note">
            Dev: <strong>{DEV_USER_EMAIL}</strong> / <strong>{DEV_USER_PASSWORD}</strong>
          </p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="email">
            <span>Email</span>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="tu@email.com"
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
