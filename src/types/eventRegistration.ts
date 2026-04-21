// Coleccion Firestore sugerida: event_registrations
import type {
  estado_inscripcion_evento_type,
  id_type,
  timestamp_type,
  tipo_cliente_type,
} from './common';

export type event_registration_type = {
  // ID del documento de inscripcion
  id: id_type;

  // ID del evento
  event_id: id_type;

  // Tipo de cliente inscripto
  customer_type: tipo_cliente_type;

  // ID del socio, si corresponde
  member_id?: id_type;

  // Nombre de cliente externo, si corresponde
  external_customer_name?: string;

  // DNI del cliente externo
  external_customer_dni?: string;

  // Fecha de inscripcion
  registration_date: timestamp_type;

  // Monto de la inscripcion
  amount: number;

  // Estado de la inscripcion
  status: estado_inscripcion_evento_type;

  // ID del pago asociado, si existe
  payment_id?: id_type;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
