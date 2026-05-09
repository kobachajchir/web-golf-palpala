import { Route, Routes, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { AccountingRoute, AdminRoute, MembersRoute, PasswordChangeRoute, ProtectedRoute, PublicRoute } from './components/routes/RoleBasedRoute';
import { useAuth } from './hooks/useAuth';
import { AccountingDashboard } from './pages/AccountingDashboard';
import { AdminUserProfile } from './pages/AdminUserProfile';
import { ChangePassword } from './pages/ChangePassword';
import { CourtRequests } from './pages/CourtRequests';
import { ForgotPassword } from './pages/ForgotPassword';
import { Home } from './pages/Home';
import { ExecutiveBoardAdmin } from './pages/ExecutiveBoardAdmin';
import { Index } from './pages/Index';
import { Login } from './pages/Login';
import { MemberMembershipProfile } from './pages/MemberMembershipProfile';
import { MembersAdmin } from './pages/MembersAdmin';
import { EmployeesAdmin } from './pages/EmployeesAdmin';
import { NotFound } from './pages/NotFound';
import { Profile } from './pages/Profile';
import { SignUp } from './pages/SignUp';
import { TournamentRegistration } from './pages/TournamentRegistration';
import './styles/pages.css';

function App() {
  const location = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const showNavbar =
    !loading &&
    isAuthenticated &&
    location.pathname !== '/login' &&
    location.pathname !== '/signup' &&
    location.pathname !== '/olvide-contrasena' &&
    location.pathname !== '/cambiar-contrasena';

  return (
    <>
      <main className={showNavbar ? 'app-shell' : 'app-shell app-shell--full'}>
        {showNavbar && <Navbar />}
        <Routes>
          <Route path="/" element={<Index />} />

          <Route
            path="/login"
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            }
          />

          <Route
            path="/signup"
            element={
              <PublicRoute>
                <SignUp />
              </PublicRoute>
            }
          />

          <Route
            path="/olvide-contrasena"
            element={
              <PublicRoute>
                <ForgotPassword />
              </PublicRoute>
            }
          />

          <Route
            path="/cambiar-contrasena"
            element={
              <PasswordChangeRoute>
                <ChangePassword />
              </PasswordChangeRoute>
            }
          />

          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />

          <Route
            path="/users/:id"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />

          <Route
            path="/perfil"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />

          <Route
            path="/mi-membresia"
            element={
              <ProtectedRoute>
                <MemberMembershipProfile />
              </ProtectedRoute>
            }
          />

          <Route
            path="/canchas"
            element={
              <ProtectedRoute>
                <CourtRequests />
              </ProtectedRoute>
            }
          />

          <Route
            path="/torneos"
            element={
              <ProtectedRoute>
                <TournamentRegistration />
              </ProtectedRoute>
            }
          />

          <Route
            path="/accounting"
            element={
              <AccountingRoute>
                <AccountingDashboard />
              </AccountingRoute>
            }
          />

          <Route
            path="/admin/users/:id"
            element={
              <AdminRoute>
                <AdminUserProfile />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/members"
            element={
              <MembersRoute>
                <MembersAdmin />
              </MembersRoute>
            }
          />

          <Route
            path="/admin/members/:memberId"
            element={
              <MembersRoute>
                <MemberMembershipProfile />
              </MembersRoute>
            }
          />

          <Route
            path="/admin/employees"
            element={
              <AccountingRoute>
                <EmployeesAdmin />
              </AccountingRoute>
            }
          />

          <Route
            path="/admin/directiva"
            element={
              <ProtectedRoute>
                <ExecutiveBoardAdmin />
              </ProtectedRoute>
            }
          />

          <Route
            path="/club"
            element={
              <ProtectedRoute>
                <ExecutiveBoardAdmin />
              </ProtectedRoute>
            }
          />

          <Route
            path="/directiva"
            element={
              <ProtectedRoute>
                <ExecutiveBoardAdmin />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
