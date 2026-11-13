export function accountingErrorMessage(error: unknown): string {
  const value = error as { code?: string; message?: string; details?: { supportReference?: string; businessCode?: string } } | null;
  const code = value?.code ?? '';
  if (value?.details?.businessCode === 'QUOTE_CHANGED') return 'El saldo cambió desde la consulta. Actualizá los importes antes de confirmar.';
  if (value?.details?.businessCode === 'ACTIVE_PAYMENT_PLAN') return 'Esta cuota tiene un plan de pagos. Continuá desde su detalle.';
  if (value?.details?.businessCode === 'OPERATION_ALREADY_RECORDED') return 'Este cobro ya estaba registrado. Consultá su estado para ver el comprobante. No se generó otro movimiento.';
  if (/deadline-exceeded|unavailable|network/i.test(code)) return 'Todavía no pudimos confirmar el resultado. Consultá el estado antes de intentar otro cobro.';
  if (/unauthenticated/.test(code)) return 'Tu sesión venció. Volvé a ingresar para continuar.';
  if (/permission-denied/.test(code)) return 'Tu usuario no tiene permiso para realizar esta operación.';
  if (code === 'functions/internal') return 'No pudimos completar la operación.' + (value?.details?.supportReference ? ` Referencia de soporte: ${value.details.supportReference}.` : '');
  const message = value?.message ?? '';
  if (/paymentMethodId/.test(message)) return 'Seleccioná un medio de pago para continuar.';
  if (/memberId/.test(message)) return 'Seleccioná el socio para continuar.';
  if (/operationDate/.test(message)) return 'Revisá la fecha de cobro para continuar.';
  if (/cambio|cambió|desactualiz/i.test(message)) return 'El saldo cambió desde la consulta. Actualizá los importes antes de confirmar.';
  if (/plan.*activo|plan de pagos parciales/i.test(message)) return 'Esta cuota tiene un plan de pagos. Continuá desde su detalle.';
  if (message && !/INTERNAL|Firebase|firestore|[a-z]+_[a-z]+|posted|liquidated|stack|Error:|undefined|not-found|invalid-argument/i.test(message) && /[áéíóúñ]|seleccion|cuota|socio|importe|pago|saldo|no pudimos|referencia/i.test(message)) return message;
  return 'No pudimos completar la operación. Conservá los datos y consultá el estado antes de volver a confirmar.';
}
