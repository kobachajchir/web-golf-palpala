// Coleccion Firestore sugerida: member_interactions
import type {
  entidad_referencia_type,
  id_type,
  timestamp_type,
  tipo_interaccion_socio_type,
} from './common';

export type member_interaction_type = {
  // ID del documento de interaccion
  id: id_type;

  // ID del socio involucrado
  member_id: id_type;

  // Tipo de interaccion registrada
  interaction_type: tipo_interaccion_socio_type;

  // Tipo de entidad de referencia
  reference_type: entidad_referencia_type;

  // ID del documento relacionado
  reference_id?: id_type;

  // Fecha de la interaccion
  interaction_date: timestamp_type;

  // Descripcion breve del hecho registrado
  description: string;

  // Usuario que genero el registro
  created_by_user_id?: id_type;

  // Fecha de creacion del registro
  created_at: timestamp_type;
};
