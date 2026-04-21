// Coleccion Firestore sugerida: events
import type { estado_evento_type, id_type, timestamp_type } from './common';

export type event_type = {
  // ID del documento del evento
  id: id_type;

  // ID del tipo de evento
  event_type_id: id_type;

  // Nombre denormalizado del tipo de evento
  event_type_nombre?: string;

  // Nombre del evento
  nombre: string;

  // Descripcion del evento
  descripcion?: string;

  // Fecha de inicio
  start_date: string;

  // Fecha de fin
  end_date: string;

  // Costo de inscripcion
  registration_fee: number;

  // Cupo maximo, si aplica
  max_capacity?: number;

  // Estado actual del evento
  status: estado_evento_type;

  // Usuario creador
  created_by_user_id: id_type;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
