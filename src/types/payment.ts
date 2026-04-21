// Coleccion Firestore sugerida: payments
import type { estado_pago_type, id_type, origen_pago_type, timestamp_type } from './common';

export type payment_type = {
  // ID del documento del pago
  id: id_type;

  // Tipo de entidad que origino el pago
  source_type: origen_pago_type;

  // ID de la entidad origen del pago
  source_id: id_type;

  // ID del socio asociado, si corresponde
  member_id?: id_type;

  // ID del metodo de pago utilizado
  payment_method_id: id_type;

  // Nombre denormalizado del metodo de pago
  payment_method_nombre?: string;

  // Monto del pago
  amount: number;

  // Fecha efectiva del pago
  payment_date?: timestamp_type;

  // Estado del pago
  status: estado_pago_type;

  // Referencia externa del proveedor de pagos
  external_reference?: string;

  // Nombre del proveedor externo
  external_provider?: 'mercado_pago' | 'manual' | 'otro';

  // ID externo del pago, si existe
  external_payment_id?: string;

  // Usuario que registro el pago
  registered_by_user_id?: id_type;

  // Observaciones
  notes?: string;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
