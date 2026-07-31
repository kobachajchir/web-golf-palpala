// Coleccion Firestore sugerida: payment_methods
import type { id_type, timestamp_type } from './common';

export type payment_method_type = {
  // ID del documento
  id: id_type;

  // Nombre del medio de pago
  nombre: string;

  // Tipo tecnico del medio de pago
  tipo: 'efectivo' | 'transferencia' | 'debito' | 'credito' | 'otro';

  // Indica si el medio de pago esta activo
  active: boolean;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
