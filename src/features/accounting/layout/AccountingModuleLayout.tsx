import { Outlet } from 'react-router-dom';
import { AccountingSectionNav } from '../components/AccountingSectionNav';

export function AccountingModuleLayout() {
  return (
    <div className="page-container accounting-page accounting-module-page">
      <div className="accounting-module-shell">
        <AccountingSectionNav />
        <div className="accounting-module-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
