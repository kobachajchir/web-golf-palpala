import { Link } from 'react-router-dom';

export function SignUp() {
  return (
    <div className="page-container signup-page">
      <section className="auth-card">
        <div className="auth-card__intro">
          <p className="eyebrow">Golf Palpala</p>
          <h1>Alta controlada</h1>
          <p>
            Las cuentas se crean desde administracion con numero de socio y Firebase Auth. No hay
            autorregistro publico para socios, empleados, administrativos ni directivos.
          </p>
        </div>

        <div className="auth-card__footer">
          <p>
            Ya tenes tu numero de socio?{' '}
            <Link to="/login" className="auth-link">
              Ingresar
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
