import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import '../styles/pages.css';

export function Home() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="page-container">
      <div className="home-container">
        <h1>Home</h1>

        <div className="user-info">
          <p>
            <strong>Email:</strong> {user?.email}
          </p>
          <p>
            <strong>Rol:</strong> {user?.role && user.role.charAt(0).toUpperCase() + user.role.slice(1)}
          </p>
        </div>

        <button onClick={handleLogout} className="btn-logout">
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
