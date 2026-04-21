// Tipos base compartidos para documentos Firestore.

// Identificador unico de documento en Firestore
export type id_type = string;

// Timestamp serializable; luego se puede reemplazar por Timestamp de Firebase
export type timestamp_type = string;

// Estados comunes para controlar vigencia logica
export type estado_activo_type = 'activo' | 'inactivo';

// Estado general de usuario en el sistema
export type estado_usuario_type = 'activo' | 'inactivo' | 'bloqueado';

// Estado general de socio dentro del club
export type estado_socio_type = 'activo' | 'suspendido' | 'baja';

// Estado general de empleado
export type estado_empleado_type = 'activo' | 'inactivo';

// Estado de grupo familiar
export type estado_grupo_familiar_type = 'activo' | 'inactivo';

// Estado de cuota
export type estado_cuota_type = 'pendiente' | 'pagada' | 'vencida' | 'anulada' | 'exenta';

// Estado de reserva
export type estado_reserva_type = 'reservada' | 'confirmada' | 'usada' | 'cancelada' | 'ausente';

// Estado de pago
export type estado_pago_type = 'pendiente' | 'aprobado' | 'rechazado' | 'anulado' | 'reintegrado';

// Estado de evento
export type estado_evento_type = 'borrador' | 'activo' | 'cerrado' | 'cancelado';

// Estado de inscripcion a evento
export type estado_inscripcion_evento_type = 'pendiente' | 'confirmada' | 'cancelada';

// Estado de gasto
export type estado_gasto_type = 'pendiente' | 'aprobado' | 'rechazado' | 'rendido';

// Tipo de movimiento de caja
export type tipo_movimiento_caja_type = 'ingreso' | 'egreso';

// Tipo de perfil al que apunta un usuario autenticado
export type tipo_perfil_usuario_type = 'socio' | 'empleado' | 'administrativo';

// Tipo de origen de pago
export type origen_pago_type = 'cuota' | 'reserva' | 'evento' | 'otro';

// Tipo de origen de movimiento de caja
export type origen_movimiento_caja_type = 'pago' | 'gasto' | 'ajuste_manual';

// Tipo de cliente en reserva o interaccion comercial
export type tipo_cliente_type = 'socio' | 'externo';

// Tipo de interaccion del socio con el club
export type tipo_interaccion_socio_type =
  | 'pago_cuota'
  | 'reserva'
  | 'evento'
  | 'deuda'
  | 'nota'
  | 'pago'
  | 'cancelacion';

// Tipo generico de entidad referenciada
export type entidad_referencia_type =
  | 'socio'
  | 'grupo_familiar'
  | 'cuota'
  | 'reserva'
  | 'pago'
  | 'evento'
  | 'inscripcion_evento'
  | 'gasto'
  | 'movimiento_caja'
  | 'otro';
