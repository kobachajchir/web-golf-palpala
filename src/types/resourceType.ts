// Coleccion Firestore sugerida: resource_types
import type { id_type, timestamp_type } from './common';

export type resource_type_type = {
  // ID del documento
  id: id_type;

  // Nombre del tipo de recurso
  nombre: string;

  // Descripcion del tipo
  descripcion?: string;

  // Indica si el tipo esta activo
  active: boolean;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
