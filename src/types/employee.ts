// Coleccion Firestore sugerida: employees
import type { estado_empleado_type, id_type, timestamp_type } from './common';

export type employee_type = {
  // ID del documento del empleado
  id: id_type;

  // Nombre del empleado
  first_name: string;

  // Apellido del empleado
  last_name: string;

  // DNI del empleado
  dni: string;

  // Telefono
  phone?: string;

  // Email
  email?: string;

  // Cargo o puesto que ocupa
  position: string;

  // Fecha de ingreso al club
  hire_date?: string;

  // Estado actual del empleado
  status: estado_empleado_type;

  // ID del usuario autenticado asociado, si corresponde
  user_id?: id_type;

  // Observaciones
  notes?: string;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
