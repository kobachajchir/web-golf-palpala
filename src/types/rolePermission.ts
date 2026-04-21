// Coleccion Firestore sugerida: role_permissions
import type { id_type, timestamp_type } from './common';

export type role_permission_type = {
  // ID del documento de relacion
  id: id_type;

  // Referencia logica al rol
  role_id: id_type;

  // Referencia logica al permiso
  permission_id: id_type;

  // Fecha de creacion de la relacion
  created_at: timestamp_type;
};
