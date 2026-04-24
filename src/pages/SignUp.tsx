import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { isDniAlreadyRegistered, registerMockUser } from '../mocks/userDirectory';

type SignUpFormState = {
  first_name: string;
  last_name: string;
  dni: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
};

export function SignUp() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState<SignUpFormState>({
    first_name: '',
    last_name: '',
    dni: '',
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

    if (
      !formData.first_name ||
      !formData.last_name ||
      !formData.dni ||
      !formData.password ||
      !formData.confirmPassword
    ) {
      setError('Por favor completa todos los campos.');
      return;
    }

    if (!/^\d{7,8}$/.test(formData.dni.trim())) {
      setError('El DNI debe tener 7 u 8 numeros.');
      return;
    }

    if (isDniAlreadyRegistered(formData.dni)) {
      setError('Ya existe un usuario registrado con ese DNI.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Las contrasenas no coinciden.');
      return;
    }

    if (formData.password.length < 6) {
      setError('La contrasena debe tener al menos 6 caracteres.');
      return;
    }

    if (!formData.acceptTerms) {
      setError('Debes aceptar los terminos y condiciones.');
      return;
    }

    const userData = registerMockUser({
      first_name: formData.first_name,
      last_name: formData.last_name,
      dni: formData.dni,
      password: formData.password,
    });

    console.log('Mock Firebase Auth signup', {
      user_number: userData.user_number,
      first_name: userData.first_name,
      last_name: userData.last_name,
      dni: userData.dni,
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
          <p className="eyebrow">Golf Palpala</p>
          <h1>Registro</h1>
          <p>Crea tu cuenta con nombre, apellido y DNI. El numero de usuario se genera automaticamente.</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="first_name">
            <span>Nombre</span>
            <input
              id="first_name"
              name="first_name"
              type="text"
              autoComplete="given-name"
              value={formData.first_name}
              onChange={handleChange}
              placeholder="Tu nombre"
            />
          </label>

          <label className="form-field" htmlFor="last_name">
            <span>Apellido</span>
            <input
              id="last_name"
              name="last_name"
              type="text"
              autoComplete="family-name"
              value={formData.last_name}
              onChange={handleChange}
              placeholder="Tu apellido"
            />
          </label>

          <label className="form-field" htmlFor="dni">
            <span>DNI</span>
            <input
              id="dni"
              name="dni"
              type="text"
              inputMode="numeric"
              value={formData.dni}
              onChange={handleChange}
              placeholder="Solo numeros"
            />
          </label>

          <label className="form-field" htmlFor="password">
            <span>Contrasena</span>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Minimo 6 caracteres"
            />
          </label>

          <label className="form-field" htmlFor="confirmPassword">
            <span>Confirmar contrasena</span>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Repite tu contrasena"
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
            <span>Acepto los terminos y condiciones</span>
          </label>

          <button type="submit" className="btn-primary form-submit">
            Registrarse
          </button>
        </form>

        <div className="auth-card__footer">
          <p>
            Ya tenes cuenta?{' '}
            <Link to="/login" className="auth-link">
              Ingresar
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
