import { Navigate, useLocation } from 'react-router-dom';
import { legacyAccountingQueryToRoute } from './legacyAccountingQueryToRoute';

export function LegacyAccountingRedirect() {
  const location = useLocation();
  return <Navigate to={legacyAccountingQueryToRoute(location.search)} replace />;
}
