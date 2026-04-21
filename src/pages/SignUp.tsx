import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { initialDefaultUser } from './Login';
import type { User } from '../context/AuthContext';
import { useAuth } from '../hooks/useAuth';

type SignUpFormState = {
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
};

function toDatetimeLocal(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export function SignUp() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState<SignUpFormState>({
    email: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  });
  const [error, setError] = useState('');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = event.target;
    const nextValue = type === 'checkbox' ? (event.target as HTMLInputElement).checked : value;

    setFormData((current) => ({
      ...current,
      [name]: nextValue,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError('');

    if (!formData.email || !formData.password || !formData.confirmPassword) {
      setError('Por favor completa todos los campos.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    if (formData.password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (!formData.acceptTerms) {
      setError('Debes aceptar los términos y condiciones.');
      return;
    }

    const now = toDatetimeLocal();

    // Crear usuario con datos completos desde los valores por defecto
    const userData: User = {
      ...initialDefaultUser,
      id: `user-${Date.now()}`,
      auth_uid: `firebase-uid-${Date.now()}`,
      email: formData.email,
      status: 'activo',
      created_at: now,
      updated_at: now,
    };

    console.log('Mock Firebase Auth signup', {
      email: formData.email,
      password_length: formData.password.length,
    });
    console.log('Mock Firestore users document created', userData);

    login(userData);
    navigate('/home', { replace: true });
  };

  return (
    <div className="page-container signup-page">
      <section className="auth-card">
        <div className="auth-card__intro">
          <p className="eyebrow">Golf Palpalá</p>
          <h1>Registro</h1>
          <p>Crea tu cuenta para acceder.</p>
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
            <span>Contraseña</span>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Mínimo 6 caracteres"
            />
          </label>

          <label className="form-field" htmlFor="confirmPassword">
            <span>Confirmar contraseña</span>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Repite tu contraseña"
            />
          </label>

          <label className="check-field" htmlFor="acceptTerms">
            <input
              id="acceptTerms"
              name="acceptTerms"
              type="checkbox"
              checked={formData.acceptTerms}
              onChange={handleChange}
            />
            <span>Acepto los términos y condiciones</span>
          </label>

          <button type="submit" className="btn-primary form-submit">
            Registrarse
          </button>
        </form>

        <div className="auth-card__footer">
          <p>
            ¿Ya tenés cuenta?{' '}
            <Link to="/login" className="auth-link">
              Ingresar
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
