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
const payloadFallback = new Map<string, string>();

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

export function getOrCreateOperationKey(scope: string, payload?: unknown): string {
  const existing = readStored(scope);
  if (payload !== undefined) {
    const fingerprint = JSON.stringify(payload);
    let previous: string | null = payloadFallback.get(scope) ?? null;
    try { previous = window.localStorage.getItem(storageKey(scope) + ':payload') ?? previous; } catch { /* memoria disponible */ }
    if (existing && previous && previous !== fingerprint) throw new Error('Hay un cobro anterior pendiente de confirmar. Consultá su estado antes de cambiar los datos.');
    payloadFallback.set(scope, fingerprint);
    try { window.localStorage.setItem(storageKey(scope) + ':payload', fingerprint); } catch { /* conserva clave en memoria */ }
  }
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

export function getPendingOperationPayload<T>(scope: string): T | null {
  let raw = payloadFallback.get(scope) ?? null;
  try { raw = window.localStorage.getItem(storageKey(scope) + ':payload') ?? raw; } catch { /* usa memoria */ }
  if (!raw || !readStored(scope)) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** Libera la clave solo si sigue siendo la misma que uso la operacion que termino. */
export function releaseOperationKey(scope: string, key: string) {
  if (readStored(scope) !== key) return;
  memoryFallback.delete(scope);
  payloadFallback.delete(scope);
  try {
    window.localStorage.removeItem(storageKey(scope));
    window.localStorage.removeItem(storageKey(scope) + ':payload');
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
  ].includes(code);
}

export function memberFeePaymentOperationScope(memberId: string) {
  return `member-fee-payment:${memberId}`;
}

export function installmentPaymentOperationScope(installmentPlanId: string) {
  return `installment-payment:${installmentPlanId}`;
}
