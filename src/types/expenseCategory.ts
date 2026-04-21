// Coleccion Firestore sugerida: expense_categories
import type { id_type, timestamp_type } from './common';

export type expense_category_type = {
  // ID del documento
  id: id_type;

  // Nombre de la categoria de gasto
  nombre: string;

  // Descripcion
  descripcion?: string;

  // Define si la categoria exige comprobante
  requires_receipt: boolean;

  // Indica si sigue activa
  active: boolean;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
