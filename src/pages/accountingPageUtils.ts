import type { Timestamp } from 'firebase/firestore';
import type { AccountingPeriod, FinancialMovementDocument } from '../modules/accounting/domain/models';

export function getCurrentAccountingPeriod(date = new Date()): AccountingPeriod {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}` as AccountingPeriod;
}

export function normalizeAccountingPeriod(value: string): AccountingPeriod {
  return value ? (value as AccountingPeriod) : getCurrentAccountingPeriod();
}

export function formatCurrency(amountMinor: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
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
  const normalized = trimmed.replaceAll('.', '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return Number.NaN;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
}

/** Lee el valor de un <input type="number">: punto decimal, sin separador de miles. */
export function parseNumberInputToMinor(value: string): number {
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number.NaN;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) {
    return period;
  }

  return `${month}/${year}`;
}

export function timestampToDate(timestamp: Timestamp | null | undefined): Date | null {
  return timestamp ? timestamp.toDate() : null;
}

export function formatTimestamp(timestamp: Timestamp | null | undefined): string {
  const date = timestampToDate(timestamp);
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

export function getSignedMovementAmount(movement: Pick<FinancialMovementDocument, 'movementType' | 'netAmountMinor'>): number {
  return movement.movementType === 'income' ? movement.netAmountMinor : -movement.netAmountMinor;
}

export function getMovementLabel(movement: Pick<FinancialMovementDocument, 'categoryCodeSnapshot' | 'originType'>): string {
  return movement.categoryCodeSnapshot?.replaceAll('_', ' ') || movement.originType || 'Movimiento contable';
}
