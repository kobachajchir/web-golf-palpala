// Coleccion Firestore sugerida: fee_concepts
import type { id_type, timestamp_type } from './common';

export type fee_concept_type = {
  // ID del documento
  id: id_type;

  // Nombre del concepto cobrable
  nombre: string;

  // Descripcion funcional del concepto
  descripcion: string;

  // Define a que aplica este concepto
  applies_to: 'socio' | 'grupo_familiar' | 'tipo_socio';

  // Indica si el concepto es recurrente
  recurring: boolean;

  // Indica si el concepto esta activo
  active: boolean;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
