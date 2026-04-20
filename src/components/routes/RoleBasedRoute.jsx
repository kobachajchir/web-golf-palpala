import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

// TODO: Cambiar roles de strings a constantes
// ROLES_CONST = { ADMIN: 'admin', OWNER: 'owner', MEMBER: 'member', EMPLOYEE: 'employee' }

export function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function AdminRoute({ children }) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // TODO: Cambiar a constante
  if (user?.role !== 'admin') {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function OwnerRoute({ children }) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // TODO: Cambiar a constante
  if (user?.role !== 'owner') {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function EmployeeRoute({ children }) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // TODO: Cambiar a constante
  if (user?.role !== 'employee') {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function MembersRoute({ children }) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // TODO: Cambiar a constante
  // Acceso para members y admins
  const allowedRoles = ['member', 'admin'];
  if (!allowedRoles.includes(user?.role)) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
