import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ROLES, type RoleType } from '../../constants/roles';
import { useAuth } from '../../hooks/useAuth';

interface RouteProps {
  children: ReactNode;
}

function canAccess(userRoleId: string | undefined, allowedRoles: readonly RoleType[]) {
  return allowedRoles.includes(userRoleId as RoleType);
}

export function PublicRoute({ children }: RouteProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="empty-state">Cargando...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function AdminRoute({ children }: RouteProps) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div className="empty-state">Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccess(user?.role_id, [ROLES.ADMIN])) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function OwnerRoute({ children }: RouteProps) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div className="empty-state">Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccess(user?.role_id, [ROLES.OWNER])) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function EmployeeRoute({ children }: RouteProps) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div className="empty-state">Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccess(user?.role_id, [ROLES.EMPLOYEE])) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function MembersRoute({ children }: RouteProps) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div className="empty-state">Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccess(user?.role_id, [ROLES.MEMBER, ROLES.ADMIN])) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function ProtectedRoute({ children }: RouteProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="empty-state">Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
