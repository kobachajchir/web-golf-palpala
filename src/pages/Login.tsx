import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import '../styles/pages.css';

type LoginFormState = {
  memberNumber: string;
  password: string;
};

export function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState<LoginFormState>({
    memberNumber: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    if (!formData.memberNumber || !formData.password) {
      setError('Por favor completa numero de socio y contrasena.');
      setIsSubmitting(false);
      return;
    }

    try {
      await login(formData.memberNumber, formData.password);
      navigate('/home', { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No pudimos iniciar sesion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-container login-page">
      <section className="auth-card">
        <div className="auth-card__intro">
          <p className="eyebrow">Golf Palpala</p>
          <h1>Ingreso</h1>
          <p>Ingresa con tu numero de socio y contrasena.</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="memberNumber">
            <span>Numero de socio</span>
            <input
              id="memberNumber"
              name="memberNumber"
              type="text"
              autoComplete="username"
              value={formData.memberNumber}
              onChange={handleChange}
              placeholder="Ej. 123"
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

          <button type="submit" className="btn-primary form-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Ingresando...' : 'Entrar'}
          </button>
        </form>

        <div className="auth-card__footer">
          <Link to="/olvide-contrasena" className="auth-link">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        <div className="auth-card__footer">
          <p>
            Necesitas una cuenta?{' '}
            <Link to="/signup" className="auth-link">
              Solicitar alta
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
