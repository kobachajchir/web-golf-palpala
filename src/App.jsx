import { Routes, Route } from 'react-router-dom';
import { Index } from './pages/Index';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { PublicRoute, AdminRoute, OwnerRoute, EmployeeRoute, MembersRoute, ProtectedRoute } from './components/routes/RoleBasedRoute';

function App() {
  return (
    <Routes>
      {/* Ruta index - verifica sesión y redirige */}
      <Route path="/" element={<Index />} />

      {/* Rutas públicas */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />

      {/* Home accesible para todos los roles autenticados */}
      <Route
        path="/home"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />

      {/* TODO: Agregar rutas específicas por rol */}
      {/* 
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />

      <Route
        path="/owner"
        element={
          <OwnerRoute>
            <OwnerPage />
          </OwnerRoute>
        }
      />

      <Route
        path="/employee"
        element={
          <EmployeeRoute>
            <EmployeePage />
          </EmployeeRoute>
        }
      />

      <Route
        path="/members"
        element={
          <MembersRoute>
            <MembersPage />
          </MembersRoute>
        }
      />
      */}

      {/* Ruta 404 */}
      <Route path="*" element={<div style={{ textAlign: 'center', marginTop: '50px' }}>Página no encontrada</div>} />
    </Routes>
  );
}

export default App;
