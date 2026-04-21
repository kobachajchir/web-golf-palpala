// Coleccion Firestore sugerida: audit_logs
import type { id_type, timestamp_type } from './common';

export type audit_log_type = {
  // ID del documento de auditoria
  id: id_type;

  // Nombre de la entidad afectada
  entity_name: string;

  // ID del documento afectado
  entity_id: id_type;

  // Accion realizada sobre la entidad
  action: 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'login' | 'logout';

  // Snapshot previo serializado; util para trazabilidad
  old_value?: Record<string, unknown>;

  // Snapshot nuevo serializado; util para trazabilidad
  new_value?: Record<string, unknown>;

  // Usuario que ejecuto la accion
  performed_by_user_id?: id_type;

  // Fecha de ejecucion
  performed_at: timestamp_type;

  // Metadata adicional opcional
  metadata?: Record<string, unknown>;
};
