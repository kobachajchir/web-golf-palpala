// Coleccion Firestore sugerida: roles
import type { id_type, timestamp_type } from './common';

export type role_type = {
  // ID del documento del rol
  id: id_type;

  // Nombre tecnico o visible del rol
  nombre: string;

  // Descripcion funcional del rol dentro del sistema
  descripcion: string;

  // Indica si el rol sigue habilitado para nuevas asignaciones
  activo: boolean;

  // Fecha de creacion del documento
  created_at: timestamp_type;

  // Fecha de ultima modificacion
  updated_at: timestamp_type;
};
