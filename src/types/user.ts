// Coleccion Firestore sugerida: users
import type {
  estado_usuario_type,
  id_type,
  timestamp_type,
  tipo_perfil_usuario_type,
} from './common';

export type user_type = {
  // ID del documento del usuario
  id: id_type;

  // UID de Firebase Auth asociado a este usuario
  auth_uid: string;

  // Numero unico de usuario utilizado para iniciar sesion
  user_number: string;

  // Nombre del usuario
  first_name: string;

  // Apellido del usuario
  last_name: string;

  // Documento nacional de identidad
  dni: string;

  // ID del rol asignado al usuario
  role_id: id_type;

  // Tipo de perfil enlazado a este usuario
  profile_type: tipo_perfil_usuario_type;

  // ID del perfil vinculado; puede ser socio, empleado o administrativo
  profile_id: id_type;

  // Estado del usuario dentro del sistema
  status: estado_usuario_type;

  // Si es true, el usuario debe cambiar contrasena al ingresar
  must_change_password: boolean;

  // Fecha del ultimo acceso conocido
  last_login_at?: timestamp_type;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de ultima modificacion
  updated_at: timestamp_type;
};
