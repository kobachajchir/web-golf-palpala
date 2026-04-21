// Coleccion Firestore sugerida: cash_movements
import type {
  id_type,
  origen_movimiento_caja_type,
  timestamp_type,
  tipo_movimiento_caja_type,
} from './common';

export type cash_movement_type = {
  // ID del documento del movimiento de caja
  id: id_type;

  // Tipo de movimiento: ingreso o egreso
  movement_type: tipo_movimiento_caja_type;

  // Tipo de origen del movimiento
  origin_type: origen_movimiento_caja_type;

  // ID del documento origen
  origin_id: id_type;

  // ID del metodo de pago, si corresponde
  payment_method_id?: id_type;

  // Nombre denormalizado del metodo de pago
  payment_method_nombre?: string;

  // Monto del movimiento
  amount: number;

  // Fecha del movimiento
  movement_date: timestamp_type;

  // Descripcion operativa
  description: string;

  // Usuario que genero el movimiento
  created_by_user_id: id_type;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
