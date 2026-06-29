import {
  ACCOUNTING_EXPENSE_CATEGORY_IDS,
  ACCOUNTING_INCOME_CATEGORY_IDS,
} from '../../../modules/accounting/domain/constants';
import type {
  EntityWithId,
  FinancialExpenseCategoryDocument,
  FinancialIncomeCategoryDocument,
} from '../../../modules/accounting/domain/models';

export type IncomeCategoryOption = EntityWithId<FinancialIncomeCategoryDocument>;
export type ExpenseCategoryOption = EntityWithId<FinancialExpenseCategoryDocument>;

const INCOME_CATEGORY_LABELS: Record<string, string> = {
  [ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria]: 'Cuota societaria',
  [ACCOUNTING_INCOME_CATEGORY_IDS.greenFee]: 'Green fee',
  [ACCOUNTING_INCOME_CATEGORY_IDS.tournamentRegistration]: 'Inscripcion torneo',
  [ACCOUNTING_INCOME_CATEGORY_IDS.rentalTennis]: 'Alquiler tenis',
  [ACCOUNTING_INCOME_CATEGORY_IDS.rentalPadel]: 'Alquiler padel',
  [ACCOUNTING_INCOME_CATEGORY_IDS.rentalGym]: 'Alquiler gimnasio',
  [ACCOUNTING_INCOME_CATEGORY_IDS.concessionCantinero]: 'Concesion cantinero',
  [ACCOUNTING_INCOME_CATEGORY_IDS.concessionMonthly]: 'Concesion mensual',
  [ACCOUNTING_INCOME_CATEGORY_IDS.advertisingBoard]: 'Publicidad carteleria',
  [ACCOUNTING_INCOME_CATEGORY_IDS.advertisingAntenna]: 'Publicidad antena',
  [ACCOUNTING_INCOME_CATEGORY_IDS.handicap]: 'Handicap',
  [ACCOUNTING_INCOME_CATEGORY_IDS.rentalHall]: 'Alquiler salon',
  [ACCOUNTING_INCOME_CATEGORY_IDS.rentalGreenSpace]: 'Alquiler espacio verde',
};

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.sueldo]: 'Sueldo',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.f931]: 'F931',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.obraSocial]: 'Obra social',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.art]: 'ART',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.horasExtra]: 'Horas extra',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.proveedores]: 'Proveedores',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.insumosAgropecuarios]: 'Insumos agropecuarios',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.combustible]: 'Combustible',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.lubricantes]: 'Lubricantes',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.luz]: 'Luz',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.agua]: 'Agua',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.bancarios]: 'Bancarios',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.mantenimiento]: 'Mantenimiento',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.limpieza]: 'Limpieza',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.insumos]: 'Insumos',
  [ACCOUNTING_EXPENSE_CATEGORY_IDS.servidor]: 'SERVIDOR',
};

function auditFallback() {
  const now = { toDate: () => new Date() } as never;
  return {
    createdAt: now,
    createdBy: 'fallback',
    updatedAt: now,
    updatedBy: 'fallback',
  };
}

export function getIncomeCategoryLabel(categoryId: string | null | undefined): string {
  if (!categoryId) {
    return 'Sin categoria';
  }
  return INCOME_CATEGORY_LABELS[categoryId] ?? categoryId.replaceAll('_', ' ');
}

export function getExpenseCategoryLabel(categoryId: string | null | undefined): string {
  if (!categoryId) {
    return 'Sin categoria';
  }
  return EXPENSE_CATEGORY_LABELS[categoryId] ?? categoryId.replaceAll('_', ' ');
}

export function getCategoryLabel(categoryId: string | null | undefined): string {
  return getIncomeCategoryLabel(categoryId) !== (categoryId ?? '').replaceAll('_', ' ')
    ? getIncomeCategoryLabel(categoryId)
    : getExpenseCategoryLabel(categoryId);
}

export function getFallbackIncomeCategories(): IncomeCategoryOption[] {
  return Object.values(ACCOUNTING_INCOME_CATEGORY_IDS).map((id, index) => ({
    id,
    name: getIncomeCategoryLabel(id),
    description: null,
    originType: id,
    active: true,
    sortOrder: (index + 1) * 10,
    ...auditFallback(),
  }));
}

export function getFallbackExpenseCategories(): ExpenseCategoryOption[] {
  return Object.values(ACCOUNTING_EXPENSE_CATEGORY_IDS).map((id, index) => ({
    id,
    name: getExpenseCategoryLabel(id).toUpperCase(),
    description: null,
    defaultBancarizado: true,
    defaultImputableImpositivo: true,
    active: true,
    sortOrder: (index + 1) * 10,
    ...auditFallback(),
  }));
}

export function formatExpenseCategoryName(name: string): string {
  return name.trim().toUpperCase();
}
