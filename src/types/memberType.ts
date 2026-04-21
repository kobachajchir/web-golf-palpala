// Coleccion Firestore sugerida: member_types
import type { id_type, timestamp_type } from './common';

export type member_type_type = {
  // ID del documento
  id: id_type;

  // Nombre del tipo de socio
  nombre: string;

  // Descripcion del comportamiento del tipo
  descripcion: string;

  // Indica si este tipo paga cuota periodica
  requires_fee: boolean;

  // Monto base sugerido para este tipo
  default_fee_amount: number;

  // Define si este tipo puede reservar recursos
  allows_reservations: boolean;

  // Indica si el tipo sigue vigente
  active: boolean;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
