import { Route, Routes, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { AdminRoute, ProtectedRoute, PublicRoute } from './components/routes/RoleBasedRoute';
import { useAuth } from './hooks/useAuth';
import { AdminUserProfile } from './pages/AdminUserProfile';
import { Home } from './pages/Home';
import { Index } from './pages/Index';
import { Login } from './pages/Login';
import { MemberMembershipProfile } from './pages/MemberMembershipProfile';
import { MembersAdmin } from './pages/MembersAdmin';
import { Profile } from './pages/Profile';
import { SignUp } from './pages/SignUp';
import './styles/pages.css';

function App() {
  const location = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const showNavbar =
    !loading &&
    isAuthenticated &&
    location.pathname !== '/login' &&
    location.pathname !== '/signup';

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
              <AdminRoute>
                <MembersAdmin />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/members/:memberId"
            element={
              <AdminRoute>
                <MemberMembershipProfile />
              </AdminRoute>
            }
          />

          <Route path="*" element={<div className="empty-state">Pagina no encontrada</div>} />
        </Routes>
      </main>
    </>
  );
}

export default App;
