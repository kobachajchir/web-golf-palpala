// Coleccion Firestore sugerida: members
import type { estado_socio_type, id_type, timestamp_type } from './common';

export type member_type = {
  // ID del documento del socio
  id: id_type;

  // Numero interno de socio
  member_number: string;

  // Nombre del socio
  first_name: string;

  // Apellido del socio
  last_name: string;

  // Documento nacional de identidad
  dni: string;

  // Fecha de nacimiento
  birth_date?: string;

  // Telefono principal
  phone?: string;

  // Email de contacto
  email?: string;

  // Direccion del socio
  address?: string;

  // Fecha de asociacion al club
  join_date: string;

  // ID del tipo de socio
  member_type_id: id_type;

  // Nombre denormalizado del tipo de socio para lectura rapida
  member_type_nombre?: string;

  // ID del grupo familiar, si pertenece a uno
  family_group_id?: id_type;

  // Indica si es titular del grupo familiar
  is_family_holder: boolean;

  // Estado actual del socio
  status: estado_socio_type;

  // ID del usuario autenticado asociado, si existe
  user_id?: id_type;

  // Observaciones generales
  notes?: string;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de ultima modificacion
  updated_at: timestamp_type;
};
