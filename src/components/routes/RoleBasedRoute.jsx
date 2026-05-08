import { Navigate } from 'react-router-dom';
import { ROLES } from '../../constants/roles';
import { useAuth } from '../../hooks/useAuth';

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
  const { isAuthenticated, hasAnyRole, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAnyRole([ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO])) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function OwnerRoute({ children }) {
  const { isAuthenticated, hasRole, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasRole(ROLES.DIRECTIVO)) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function AccountingRoute({ children }) {
  const { isAuthenticated, hasAnyRole, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAnyRole([ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO])) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function EmployeeRoute({ children }) {
  const { isAuthenticated, hasRole, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasRole(ROLES.EMPLEADO)) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function MembersRoute({ children }) {
  const { isAuthenticated, hasAnyRole, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAnyRole([ROLES.SOCIO, ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO])) {
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
