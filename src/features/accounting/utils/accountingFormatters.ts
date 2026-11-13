import type { Timestamp } from 'firebase/firestore';
import type { AccountingPeriod, FinancialMovementDocument } from '../../../modules/accounting/domain/models';

export function getCurrentAccountingPeriod(date = new Date()): AccountingPeriod {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')!.value;
  const month = parts.find((part) => part.type === 'month')!.value;
  return `${year}-${month}` as AccountingPeriod;
}

export function normalizeAccountingPeriod(value: string | null | undefined): AccountingPeriod {
  return value ? (value as AccountingPeriod) : getCurrentAccountingPeriod();
}

export function shiftAccountingPeriod(period: AccountingPeriod, deltaMonths: number): AccountingPeriod {
  const [yearText, monthText] = period.split('-');
  const date = new Date(Number(yearText), Number(monthText) - 1 + deltaMonths, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` as AccountingPeriod;
}

export function formatCurrency(amountMinor: number | null | undefined): string {
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) return 'No disponible';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/**
 * Lee importes escritos en formato argentino ("1.500", "1.500,50", "100,5").
 * Si no hay coma y el punto va seguido de 1 o 2 digitos ("100.50"), se trata como
 * separador decimal: es el formato que entregan los campos numericos del navegador.
 */
export function parseAmountInputToMinor(value: string): number {
  const trimmed = value.trim().replace(/[\s$]/g, '');
  if (!trimmed) {
    return Number.NaN;
  }
  if (!trimmed.includes(',') && /^-?\d+\.\d{1,2}$/.test(trimmed)) {
    return parseNumberInputToMinor(trimmed);
  }
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const normalized = trimmed.replaceAll('.', '').replace(',', '.');
  const parsed = Number(normalized);
  const minor = Math.round(parsed * 100);
  return Number.isSafeInteger(minor) ? minor : Number.NaN;
}

/** Lee el valor de un <input type="number">: punto decimal, sin separador de miles. */
export function parseNumberInputToMinor(value: string): number {
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    return Number.NaN;
  }
  const parsed = Number(trimmed);
  const minor = Math.round(parsed * 100);
  return Number.isSafeInteger(minor) ? minor : Number.NaN;
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) {
    return period;
  }

  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(Number(year), Number(month) - 1, 1));
}

type SerializedTimestamp = { seconds?: number; nanoseconds?: number; _seconds?: number; _nanoseconds?: number };

export function timestampToDate(value: Timestamp | Date | SerializedTimestamp | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if ('toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  const serialized = value as SerializedTimestamp;
  const seconds = serialized.seconds ?? serialized._seconds;
  const nanoseconds = serialized.nanoseconds ?? serialized._nanoseconds ?? 0;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) {
    return null;
  }
  const date = new Date(seconds * 1000 + nanoseconds / 1_000_000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatTimestamp(value: Timestamp | Date | SerializedTimestamp | string | null | undefined): string {
  const date = timestampToDate(value);
  if (!date) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function buildArgentinaDateIso(dateValue: string): string {
  return new Date(`${dateValue}T00:00:00.000-03:00`).toISOString();
}

export function getSignedMovementAmount(movement: Pick<FinancialMovementDocument, 'movementType' | 'netAmountMinor'>) {
  return movement.movementType === 'income' ? movement.netAmountMinor : -movement.netAmountMinor;
}

export function getMovementLabel(movement: Pick<FinancialMovementDocument, 'categoryCodeSnapshot' | 'originType'>) {
  return movement.categoryCodeSnapshot?.replaceAll('_', ' ') || movement.originType || 'Movimiento contable';
}

export function getPersonDisplayName(person: { firstName: string; lastName: string } | null | undefined) {
  return person ? `${person.lastName}, ${person.firstName}` : 'Sin perfil';
}
