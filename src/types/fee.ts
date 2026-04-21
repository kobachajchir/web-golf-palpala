// Coleccion Firestore sugerida: fees
import type { estado_cuota_type, id_type, timestamp_type } from './common';

export type fee_type = {
  // ID del documento de la cuota
  id: id_type;

  // ID del socio asociado, si aplica
  member_id?: id_type;

  // ID del grupo familiar asociado, si aplica
  family_group_id?: id_type;

  // ID del concepto que origino la cuota
  fee_concept_id: id_type;

  // Nombre denormalizado del concepto para lectura rapida
  fee_concept_nombre?: string;

  // Periodo de la cuota en formato YYYY-MM
  period: string;

  // Fecha de emision
  issue_date: string;

  // Fecha de vencimiento
  due_date: string;

  // Monto a pagar
  amount: number;

  // Estado actual de la cuota
  status: estado_cuota_type;

  // Usuario que genero la cuota
  generated_by_user_id: id_type;

  // Observaciones administrativas
  notes?: string;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
