// Coleccion Firestore sugerida: family_groups
import type { estado_grupo_familiar_type, id_type, timestamp_type } from './common';

export type family_group_type = {
  // ID del documento del grupo familiar
  id: id_type;

  // Codigo unico del grupo familiar
  code: string;

  // Nombre de referencia visible para administracion
  nombre_referencia: string;

  // ID del socio titular del grupo
  titular_member_id: id_type;

  // Estado del grupo familiar
  status: estado_grupo_familiar_type;

  // Observaciones administrativas
  notes?: string;

  // Fecha de creacion
  created_at: timestamp_type;

  // Fecha de actualizacion
  updated_at: timestamp_type;
};
