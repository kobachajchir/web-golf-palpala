// Coleccion Firestore sugerida: reservation_statuses
import type { estado_reserva_type, id_type } from './common';

export type reservation_status_type = {
  // ID del documento del estado
  id: id_type;

  // Codigo tecnico del estado
  codigo: estado_reserva_type;

  // Nombre visible del estado
  nombre: string;

  // Descripcion administrativa
  descripcion?: string;
};
