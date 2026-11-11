/**
 * Claves de idempotencia ligadas a una operacion de cobro (por ejemplo "cobro de cuotas del
 * socio X" o "abono del plan Y"), no al contenido de la solicitud.
 *
 * - Se guardan en localStorage para sobrevivir a recargas y cortes de red.
 * - Se reutilizan en cada reintento de la misma operacion, aunque la respuesta anterior haya
 *   llegado tarde o nunca. El servidor devuelve el resultado ya registrado en vez de duplicarlo.
 * - Solo la pantalla que recibio el exito (o un rechazo definitivo) la libera con
 *   `releaseOperationKey`. Una respuesta tardia, posterior al timeout de la interfaz, no la borra.
 */
const STORAGE_PREFIX = 'accounting:pending-operation:';
const memoryFallback = new Map<string, string>();

function storageKey(scope: string) {
  return STORAGE_PREFIX + scope;
}

function readStored(scope: string): string | null {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (raw) return raw;
  } catch {
    // localStorage puede no estar disponible (modo privado, bloqueos); usamos memoria.
  }
  return memoryFallback.get(scope) ?? null;
}

export function getOrCreateOperationKey(scope: string): string {
  const existing = readStored(scope);
  if (existing) return existing;
  const key = crypto.randomUUID();
  memoryFallback.set(scope, key);
  try {
    window.localStorage.setItem(storageKey(scope), key);
  } catch {
    // Sin persistencia disponible: queda la copia en memoria.
  }
  return key;
}

export function peekOperationKey(scope: string): string | null {
  return readStored(scope);
}

/** Libera la clave solo si sigue siendo la misma que uso la operacion que termino. */
export function releaseOperationKey(scope: string, key: string) {
  if (readStored(scope) !== key) return;
  memoryFallback.delete(scope);
  try {
    window.localStorage.removeItem(storageKey(scope));
  } catch {
    // Nada que limpiar.
  }
}

/**
 * Errores que confirman que el servidor rechazo la operacion sin registrarla (la transaccion
 * se revirtio). Tras ellos es seguro liberar la clave. Los timeouts y cortes de red no entran:
 * en esos casos el cobro pudo haberse registrado.
 */
export function isDefinitiveServerRejection(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  return [
    'functions/invalid-argument',
    'functions/failed-precondition',
    'functions/not-found',
    'functions/permission-denied',
    'functions/unauthenticated',
    'functions/already-exists',
  ].includes(code);
}

export function memberFeePaymentOperationScope(memberId: string) {
  return `member-fee-payment:${memberId}`;
}

export function installmentPaymentOperationScope(installmentPlanId: string) {
  return `installment-payment:${installmentPlanId}`;
}
