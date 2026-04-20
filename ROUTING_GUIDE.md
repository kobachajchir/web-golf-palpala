# Sistema de Navegación con React Router

## Estructura General

Este proyecto implementa un sistema completo de navegación con rutas protegidas por roles usando React Router v6 y Context API.

## Archivos Creados

### 1. **Context - AuthContext.jsx**
- Proporciona el contexto de autenticación global
- Gestiona el estado del usuario y la sesión
- Verifica LocalStorage al montar para recuperar sesiones previas
- Métodos: `login()`, `logout()`, `isAuthenticated`

### 2. **Hooks - useAuth.js**
- Hook personalizado para acceder al contexto de autenticación
- Facilita el acceso a `user`, `loading`, `isAuthenticated`, `login`, `logout`

### 3. **Rutas Protegidas - RoleBasedRoute.jsx**

#### PublicRoute
- Acceso solo a usuarios no autenticados
- Redirige a `/home` si ya está logueado

#### ProtectedRoute
- Acceso solo a usuarios autenticados
- Redirige a `/login` si no está autenticado

#### AdminRoute
- Solo para usuarios con rol `admin`
- Redirige a `/home` si no tiene permiso

#### OwnerRoute
- Solo para usuarios con rol `owner`
- Redirige a `/home` si no tiene permiso

#### EmployeeRoute
- Solo para usuarios con rol `employee`
- Redirige a `/home` si no tiene permiso

#### MembersRoute
- Para usuarios con rol `member` o `admin`
- Redirige a `/home` si no tiene permiso

### 4. **Páginas**

#### Index.jsx
- Página inicial que verifica la sesión
- Si hay sesión válida → redirige a `/home`
- Si NO hay sesión → redirige a `/login`
- Se ejecuta automáticamente al acceder a `/`

#### Login.jsx
- Formulario de login
- Selector de rol para pruebas (admin, owner, member, employee)
- Simula login y guarda usuario en localStorage
- Redirige a `/home` después del login

#### Home.jsx
- Página principal después de login
- Muestra información del usuario (email y rol)
- Botón para cerrar sesión
- Accesible para todos los roles autenticados

### 5. **Constantes - roles.js**
- TODO: Cambiar los roles de strings hardcodeados a constantes
- Proporciona la estructura base para futuros cambios

### 6. **Estilos - pages.css**
- Estilos para Login y Home
- Diseño responsivo con gradiente de fondo
- Formularios estilizados

## Flujo de Navegación

```
/                  (Index)
├─→ Sin sesión   → /login     (PublicRoute)
└─→ Con sesión   → /home      (ProtectedRoute)

/login             (PublicRoute)
├─→ Loguearse    → /home
└─→ ya logueado  → redirige a /home

/home              (ProtectedRoute)
└─→ Cerrar sesión → /login

/*                 (Ruta no encontrada)
```

## Cómo Usar

### 1. **Primero acceso**
- Ir a `http://localhost:5173/`
- Se redirige automáticamente a `/login` (sin sesión)

### 2. **Login de Prueba**
- Email: cualquier email
- Contraseña: cualquier contraseña
- Rol: seleccionar de la lista (admin, owner, member, employee)
- Click en "Login"

### 3. **Sesión Persistente**
- El usuario se guarda en localStorage
- Recargar la página mantendrá la sesión
- Para cerrar sesión: click en "Cerrar sesión"

### 4. **Protección de Rutas**
- Intentar acceder directamente a `/home` sin sesión redirige a `/login`
- Las rutas específicas por rol rechazan a usuarios sin permiso

## TODO

1. **Cambiar roles de strings a constantes**
   - Ya existe `src/constants/roles.js`
   - Reemplazar `'admin'`, `'owner'`, etc. con `ROLES.ADMIN`, `ROLES.OWNER`
   - Usar en todas las comparaciones de rol

2. **Agregar más páginas específicas por rol**
   - `/admin` - Página solo para admins
   - `/owner` - Página solo para owners
   - `/employee` - Página solo para employees
   - `/members` - Página solo para miembros y admins

3. **Mejorar el manejo de errores**
   - Validar email y contraseña reales
   - Conectar con una API real de autenticación
   - Manejar errores de login

4. **Agregar más funcionalidades**
   - Recordar usuario
   - Recuperación de contraseña
   - Registro de usuarios
   - 2FA/MFA

## Instalación

```bash
npm install react-router-dom
```

## Scripts

```bash
npm run dev     # Iniciar servidor de desarrollo
npm run build   # Build para producción
npm run preview # Previsualizar build
```

## Estructura de Carpetas

```
src/
├── context/
│   └── AuthContext.jsx          # Contexto de autenticación
├── hooks/
│   └── useAuth.js               # Hook para useContext
├── components/
│   └── routes/
│       ├── ProtectedRoute.jsx    # Rutas protegidas (backup)
│       └── RoleBasedRoute.jsx    # Todas las rutas por rol
├── pages/
│   ├── Index.jsx                # Página inicial
│   ├── Login.jsx                # Página de login
│   └── Home.jsx                 # Página principal
├── constants/
│   └── roles.js                 # Constantes de roles (TODO)
├── styles/
│   └── pages.css                # Estilos de páginas
├── App.jsx                      # Configuración de rutas
└── main.jsx                     # Entry point con Router y AuthProvider
```

## LocalStorage

La aplicación guarda el usuario en localStorage con la clave `user`:

```javascript
{
  "id": "1",
  "email": "usuario@ejemplo.com",
  "role": "admin"
}
```

Para limpiar la sesión: `localStorage.removeItem('user')`
