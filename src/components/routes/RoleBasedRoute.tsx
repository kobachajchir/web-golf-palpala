import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface RouteProps {
  children: ReactNode;
}

export function PublicRoute({ children }: RouteProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function AdminRoute({ children }: RouteProps) {
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

export function OwnerRoute({ children }: RouteProps) {
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

export function EmployeeRoute({ children }: RouteProps) {
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

export function MembersRoute({ children }: RouteProps) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // TODO: Cambiar a constante
  // Acceso para members y admins
  const allowedRoles = ['member', 'admin'] as const;
  if (!allowedRoles.includes(user?.role as any)) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

export function ProtectedRoute({ children }: RouteProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
