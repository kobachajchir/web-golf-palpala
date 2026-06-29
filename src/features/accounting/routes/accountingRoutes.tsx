import { Navigate, Route } from 'react-router-dom';
import { AccountingRoute } from '../../../components/routes/RoleBasedRoute';
import { AccountingModuleLayout } from '../layout/AccountingModuleLayout';
import { AccountingBankSettlementsPage } from '../pages/AccountingBankSettlementsPage';
import { AccountingCashPage } from '../pages/AccountingCashPage';
import { AccountingCollectionsPage } from '../pages/AccountingCollectionsPage';
import { AccountingEmployeeCyclePage } from '../pages/AccountingEmployeeCyclePage';
import { AccountingEmployeesPage } from '../pages/AccountingEmployeesPage';
import { AccountingExpensesPage } from '../pages/AccountingExpensesPage';
import { AccountingExternalDocsPage } from '../pages/AccountingExternalDocsPage';
import { AccountingMemberDuesPage } from '../pages/AccountingMemberDuesPage';
import { AccountingOverviewPage } from '../pages/AccountingOverviewPage';
import { AccountingPaymentMethodsPage } from '../pages/AccountingPaymentMethodsPage';
import { AccountingReportsPage } from '../pages/AccountingReportsPage';
import { LegacyAccountingRedirect } from './LegacyAccountingRedirect';

export function AccountingRoutes() {
  return (
    <Route
      path="/accounting"
      element={
        <AccountingRoute>
          <AccountingModuleLayout />
        </AccountingRoute>
      }
    >
      <Route index element={<LegacyAccountingRedirect />} />
      <Route path="overview" element={<AccountingOverviewPage />} />
      <Route path="collections" element={<AccountingCollectionsPage />} />
      <Route path="caja" element={<AccountingCashPage />} />
      <Route path="member-dues" element={<AccountingMemberDuesPage />} />
      <Route path="expenses" element={<AccountingExpensesPage />} />
      <Route path="employees" element={<AccountingEmployeesPage />} />
      <Route path="employees/:employeeId" element={<AccountingEmployeeCyclePage />} />
      <Route path="external-docs" element={<AccountingExternalDocsPage />} />
      <Route path="payment-methods" element={<AccountingPaymentMethodsPage />} />
      <Route path="bank-settlements" element={<AccountingBankSettlementsPage />} />
      <Route path="settings" element={<Navigate to="/accounting/member-dues?tab=config" replace />} />
      <Route path="reports" element={<AccountingReportsPage />} />
      <Route path="reports/:reportId" element={<AccountingReportsPage />} />
      <Route path="cash-closures" element={<Navigate to="/accounting/caja?tab=cierre" replace />} />
      <Route path="stats" element={<Navigate to="/accounting/reports?tab=stats" replace />} />
    </Route>
  );
}
