// Coleccion Firestore sugerida: event_types
import type { id_type, timestamp_type } from './common';

export type event_type_type = {
  // ID del documento
  id: id_type;

  // Nombre del tipo de evento
  nombre: string;

  // Descripcion funcional
  descripcion?: string;

  // Indica si este tipo sigue activo
  active: boolean;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
