// Coleccion Firestore sugerida: expenses
import type { estado_gasto_type, id_type, timestamp_type } from './common';

export type expense_type = {
  // ID del documento del gasto
  id: id_type;

  // ID de la categoria del gasto
  expense_category_id: id_type;

  // Nombre denormalizado de la categoria
  expense_category_nombre?: string;

  // ID del empleado que rindio el gasto, si aplica
  employee_id?: id_type;

  // Usuario que registro el gasto
  reported_by_user_id: id_type;

  // Fecha del gasto
  expense_date: string;

  // Monto del gasto
  amount: number;

  // Descripcion breve del gasto
  description: string;

  // Proveedor relacionado, si se conoce
  supplier?: string;

  // Litros consumidos, por ejemplo para combustible
  liters?: number;

  // URL del archivo o foto del ticket en Firebase Storage
  receipt_file_url?: string;

  // Estado del gasto
  status: estado_gasto_type;

  // Usuario que reviso o aprobo el gasto
  reviewed_by_user_id?: id_type;

  // Observaciones
  notes?: string;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
