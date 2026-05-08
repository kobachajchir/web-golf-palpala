import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ROLES } from '../../constants/roles';
import { useAuth } from '../../hooks/useAuth';

interface RouteProps {
  children: ReactNode;
}

const ADMIN_ROUTE_MODES = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO] as const;
const MEMBERS_ROUTE_MODES = [ROLES.EMPLEADO, ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO] as const;

function RouteLoading() {
  return (
    <div className="loading-state">
      <span className="loading-spinner" />
      <strong>Obteniendo datos</strong>
    </div>
  );
}

export function PublicRoute({ children }: RouteProps) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return <RouteLoading />;
  }

  if (isAuthenticated) {
    if (user?.mustChangePassword) {
      return <Navigate to="/cambiar-contrasena" replace />;
    }

    return <Navigate to="/home" replace />;
  }

  return children;
}

export function AdminRoute({ children }: RouteProps) {
  const { isAuthenticated, hasAnyRole, interfaceMode, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.mustChangePassword && location.pathname !== '/cambiar-contrasena') {
    return <Navigate to="/cambiar-contrasena" replace />;
  }

  if (!hasAnyRole(ADMIN_ROUTE_MODES) || !(ADMIN_ROUTE_MODES as readonly string[]).includes(interfaceMode)) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function OwnerRoute({ children }: RouteProps) {
  const { isAuthenticated, hasRole, interfaceMode, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.mustChangePassword && location.pathname !== '/cambiar-contrasena') {
    return <Navigate to="/cambiar-contrasena" replace />;
  }

  if (!hasRole(ROLES.DIRECTIVO) || interfaceMode !== ROLES.DIRECTIVO) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function AccountingRoute({ children }: RouteProps) {
  const { isAuthenticated, hasAnyRole, interfaceMode, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.mustChangePassword && location.pathname !== '/cambiar-contrasena') {
    return <Navigate to="/cambiar-contrasena" replace />;
  }

  if (!hasAnyRole(ADMIN_ROUTE_MODES) || !(ADMIN_ROUTE_MODES as readonly string[]).includes(interfaceMode)) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function EmployeeRoute({ children }: RouteProps) {
  const { isAuthenticated, hasRole, interfaceMode, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.mustChangePassword && location.pathname !== '/cambiar-contrasena') {
    return <Navigate to="/cambiar-contrasena" replace />;
  }

  if (!hasRole(ROLES.EMPLEADO) || interfaceMode !== ROLES.EMPLEADO) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function MembersRoute({ children }: RouteProps) {
  const { isAuthenticated, hasAnyRole, interfaceMode, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.mustChangePassword && location.pathname !== '/cambiar-contrasena') {
    return <Navigate to="/cambiar-contrasena" replace />;
  }

  if (!hasAnyRole(MEMBERS_ROUTE_MODES) || !(MEMBERS_ROUTE_MODES as readonly string[]).includes(interfaceMode)) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function ProtectedRoute({ children }: RouteProps) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.mustChangePassword && location.pathname !== '/cambiar-contrasena') {
    return <Navigate to="/cambiar-contrasena" replace />;
  }

  return children;
}

export function PasswordChangeRoute({ children }: RouteProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
