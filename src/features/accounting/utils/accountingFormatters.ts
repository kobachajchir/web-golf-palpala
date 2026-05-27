import type { Timestamp } from 'firebase/firestore';
import type { AccountingPeriod, FinancialMovementDocument } from '../../../modules/accounting/domain/models';

export function getCurrentAccountingPeriod(date = new Date()): AccountingPeriod {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
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

export function formatCurrency(amountMinor: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export function parseAmountInputToMinor(value: string): number {
  const normalized = value.trim().replaceAll('.', '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
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

export function timestampToDate(value: Timestamp | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : value.toDate();
}

export function formatTimestamp(value: Timestamp | Date | null | undefined): string {
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
