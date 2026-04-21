// Coleccion Firestore sugerida: resources
import type { id_type, timestamp_type } from './common';

export type resource_type = {
  // ID del documento del recurso
  id: id_type;

  // ID del tipo de recurso
  resource_type_id: id_type;

  // Nombre denormalizado del tipo de recurso
  resource_type_nombre?: string;

  // Nombre del recurso
  nombre: string;

  // Descripcion
  descripcion?: string;

  // Precio base del recurso
  base_price: number;

  // Indica si requiere reserva previa
  requires_reservation: boolean;

  // Indica si el recurso esta activo
  active: boolean;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
