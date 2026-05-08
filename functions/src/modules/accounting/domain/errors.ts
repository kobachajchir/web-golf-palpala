export type AppErrorCode =
  | 'already-exists'
  | 'failed-precondition'
  | 'invalid-argument'
  | 'not-found'
  | 'permission-denied'
  | 'unauthenticated';

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly details?: unknown;

  public constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function assertCondition(
  condition: unknown,
  code: AppErrorCode,
  message: string,
  details?: unknown,
): asserts condition {
  if (!condition) {
    throw new AppError(code, message, details);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
