// Coleccion Firestore sugerida: reservations
import type { estado_reserva_type, id_type, timestamp_type, tipo_cliente_type } from './common';

export type reservation_type = {
  // ID del documento de la reserva
  id: id_type;

  // ID del recurso reservado
  resource_id: id_type;

  // Nombre denormalizado del recurso
  resource_nombre?: string;

  // Tipo de cliente que realiza la reserva
  customer_type: tipo_cliente_type;

  // ID del socio, si quien reserva es socio
  member_id?: id_type;

  // Nombre del cliente externo, si no es socio
  external_customer_name?: string;

  // DNI del cliente externo
  external_customer_dni?: string;

  // Fecha reservada
  reservation_date: string;

  // Hora de inicio
  start_time: string;

  // Hora de fin
  end_time: string;

  // Monto calculado de la reserva
  amount: number;

  // Estado actual de la reserva
  status: estado_reserva_type;

  // Usuario que creo la reserva
  created_by_user_id: id_type;

  // Observaciones adicionales
  notes?: string;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
