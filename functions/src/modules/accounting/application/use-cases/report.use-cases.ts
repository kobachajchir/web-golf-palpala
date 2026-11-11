import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type {
  Actor,
  AccountingReportScope,
  AccountingReportTemplate,
  FinancialMovementDocument,
  GenerateAccountingReportPayload,
  GenerateAccountingReportResult,
  MemberFeeChargeDocument,
} from '../../domain/models.js';
import { ACCOUNTING_COLLECTIONS, ACCOUNTING_TIME_ZONE, FINANCIAL_INCOME_CATEGORY_IDS } from '../../domain/constants.js';
import { assertCondition, isRecord } from '../../domain/errors.js';
import { ensureStaff } from '../shared.js';

type ReportRow = {
  id: string;
  section: 'movements' | 'green_fee' | 'dues_paid' | 'dues_unpaid_period' | 'dues_unpaid_accumulated';
  date: string | null;
  label: string;
  categoryId: string | null;
  categoryLabel: string | null;
  groupKey: string | null;
  groupLabel: string | null;
  movementType: 'income' | 'expense' | null;
  memberId: string | null;
  memberName: string | null;
  period: string | null;
  paymentMethodId: string | null;
  paymentMethodLabel: string | null;
  grossAmountMinor: number;
  commissionAmountMinor: number;
  netAmountMinor: number;
  outstandingAmountMinor: number;
  status: string;
};

type ReportSection = {
  key: string;
  label: string;
  count: number;
  grossAmountMinor: number;
  commissionAmountMinor: number;
  netAmountMinor: number;
  outstandingAmountMinor: number;
};

function database() {
  const app = getApps().length > 0 ? getApp() : initializeApp();
  return getFirestore(app);
}

function requiredString(data: Record<string, unknown>, field: string) {
  const value = data[field];
  assertCondition(typeof value === 'string' && value.trim().length > 0, 'invalid-argument', `El campo ${field} es obligatorio.`);
  return value.trim();
}

function optionalString(data: Record<string, unknown>, field: string) {
  const value = data[field];
  assertCondition(value === undefined || value === null || typeof value === 'string', 'invalid-argument', `El campo ${field} debe ser texto.`);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(data: Record<string, unknown>, field: string) {
  const value = data[field];
  assertCondition(typeof value === 'boolean', 'invalid-argument', `El campo ${field} debe ser booleano.`);
  return value;
}

function stringList(data: Record<string, unknown>, field: string) {
  const value = data[field];
  assertCondition(Array.isArray(value) && value.every((entry) => typeof entry === 'string'), 'invalid-argument', `El campo ${field} debe ser una lista de textos.`);
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}

export function parseGenerateAccountingReportInput(payload: unknown): GenerateAccountingReportPayload {
  assertCondition(isRecord(payload), 'invalid-argument', 'El payload debe ser un objeto.');
  const template = requiredString(payload, 'template') as AccountingReportTemplate;
  const scope = requiredString(payload, 'scope') as AccountingReportScope;
  const movementTypes = stringList(payload, 'movementTypes');

  assertCondition(['categories', 'green_fee', 'member_dues', 'custom'].includes(template), 'invalid-argument', 'La plantilla de reporte no es v?lida.');
  assertCondition(scope === 'period' || scope === 'date_range', 'invalid-argument', 'El alcance temporal no es v?lido.');
  assertCondition(movementTypes.every((entry) => entry === 'income' || entry === 'expense'), 'invalid-argument', 'Los tipos de movimiento no son v?lidos.');

  const input: GenerateAccountingReportPayload = {
    requestId: requiredString(payload, 'requestId'),
    title: requiredString(payload, 'title'),
    template,
    scope,
    period: optionalString(payload, 'period'),
    dateFrom: optionalString(payload, 'dateFrom'),
    dateTo: optionalString(payload, 'dateTo'),
    movementTypes: movementTypes as Array<'income' | 'expense'>,
    categoryIds: stringList(payload, 'categoryIds'),
    includePaidDues: booleanValue(payload, 'includePaidDues'),
    includeUnpaidPeriod: booleanValue(payload, 'includeUnpaidPeriod'),
    includeUnpaidAccumulated: booleanValue(payload, 'includeUnpaidAccumulated'),
    notes: optionalString(payload, 'notes'),
  };

  assertCondition(/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId), 'invalid-argument', 'El identificador de solicitud no es v?lido.');
  if (scope === 'period') {
    assertCondition(Boolean(input.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)), 'invalid-argument', 'El per?odo debe tener formato YYYY-MM.');
  } else {
    assertCondition(Boolean(input.dateFrom && input.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(input.dateTo)), 'invalid-argument', 'El rango de fechas no es v?lido.');
    assertCondition(input.dateFrom! <= input.dateTo!, 'invalid-argument', 'La fecha desde no puede ser posterior a la fecha hasta.');
  }
  return input;
}

function reportRange(input: GenerateAccountingReportPayload) {
  if (input.scope === 'period') {
    const [year, month] = input.period!.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return {
      dateFrom: `${input.period}-01`,
      dateTo: `${input.period}-${String(lastDay).padStart(2, '0')}`,
      periodFrom: input.period!,
      periodTo: input.period!,
    };
  }
  return {
    dateFrom: input.dateFrom!,
    dateTo: input.dateTo!,
    periodFrom: input.dateFrom!.slice(0, 7),
    periodTo: input.dateTo!.slice(0, 7),
  };
}

function argentinaDate(value: Timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ACCOUNTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value.toDate());
}

function outstandingAmount(charge: MemberFeeChargeDocument) {
  const paid = charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0;
  return charge.remainingAmountMinor ?? Math.max((charge.settlementAmountMinor ?? charge.finalAmountMinor) - paid, 0);
}

function movementIsReportable(movement: FinancialMovementDocument) {
  return movement.status === 'posted'
    && movement.installmentRole !== 'charge'
    && movement.excludeFromBalance !== true
    && movement.originType !== 'internal_transfer';
}

function displayName(data: DocumentData | undefined) {
  if (!data) return 'Sin socio identificado';
  const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
  const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';
  const memberNumber = typeof data.memberNumber === 'string' ? data.memberNumber.trim() : '';
  const name = [lastName, firstName].filter(Boolean).join(', ');
  return memberNumber && name ? `${name} ? Socio ${memberNumber}` : name || memberNumber || 'Sin socio identificado';
}

function movementRow(
  snapshot: QueryDocumentSnapshot,
  movement: FinancialMovementDocument,
  categoryLabel: string,
  paymentMethodLabel: string | null,
  memberName: string | null,
  section: ReportRow['section'],
  groupKey: string | null = null,
  groupLabel: string | null = null,
): ReportRow {
  return {
    id: snapshot.id,
    section,
    date: argentinaDate(movement.operationDate),
    label: movement.notes?.trim() || categoryLabel,
    categoryId: movement.categoryCodeSnapshot || movement.categoryId,
    categoryLabel,
    groupKey,
    groupLabel,
    movementType: movement.movementType,
    memberId: movement.thirdPartyId ?? null,
    memberName,
    period: movement.accountingPeriod,
    paymentMethodId: movement.paymentMethodId ?? null,
    paymentMethodLabel,
    grossAmountMinor: movement.grossAmountMinor,
    commissionAmountMinor: movement.appliedCommissionAmountMinor ?? 0,
    netAmountMinor: movement.netAmountMinor,
    outstandingAmountMinor: 0,
    status: movement.status,
  };
}

function addSection(target: Map<string, ReportSection>, key: string, label: string, row: ReportRow) {
  const current = target.get(key) ?? {
    key,
    label,
    count: 0,
    grossAmountMinor: 0,
    commissionAmountMinor: 0,
    netAmountMinor: 0,
    outstandingAmountMinor: 0,
  };
  current.count += 1;
  current.grossAmountMinor += row.grossAmountMinor;
  current.commissionAmountMinor += row.commissionAmountMinor;
  current.netAmountMinor += row.netAmountMinor;
  current.outstandingAmountMinor += row.outstandingAmountMinor;
  target.set(key, current);
}

export async function generateAccountingReportUseCase(params: {
  actor: Actor | null;
  input: GenerateAccountingReportPayload;
}): Promise<GenerateAccountingReportResult> {
  const actor = ensureStaff(params.actor);
  const db = database();
  const reportId = `${actor.uid}_${params.input.requestId}`;
  const reportRef = db.collection(ACCOUNTING_COLLECTIONS.accountingReports).doc(reportId);
  const existing = await reportRef.get();
  if (existing.exists && existing.data()?.status !== 'failed') return { reportId };

  if (existing.exists) {
    const oldChunks = await reportRef.collection('chunks').get();
    if (!oldChunks.empty) {
      const deleteBatch = db.batch();
      oldChunks.docs.forEach((doc) => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
    }
  }

  const range = reportRange(params.input);
  const generatedAt = Timestamp.now();
  await reportRef.set({
    schemaVersion: 2,
    kind: 'accounting_snapshot',
    title: params.input.title,
    template: params.input.template,
    scope: params.input.scope,
    period: params.input.scope === 'period' ? params.input.period : null,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    generatedAt,
    sourceCutoffAt: generatedAt,
    generatedBy: actor.uid,
    generatedByRole: actor.user.roleIds,
    status: 'generating',
    notes: params.input.notes ?? null,
    format: ['screen', 'pdf', 'excel'],
    filters: params.input,
  });

  try {
    const startAt = Timestamp.fromDate(new Date(`${range.dateFrom}T00:00:00.000-03:00`));
    const endAt = Timestamp.fromDate(new Date(`${range.dateTo}T23:59:59.999-03:00`));
    const [
      movementSnapshot,
      chargeSnapshot,
      memberSnapshot,
      incomeCategorySnapshot,
      expenseCategorySnapshot,
      paymentMethodSnapshot,
      activeConfigSnapshot,
    ] = await Promise.all([
      db.collection(ACCOUNTING_COLLECTIONS.financialMovements)
        .where('operationDate', '>=', startAt)
        .where('operationDate', '<=', endAt)
        .get(),
      db.collection(ACCOUNTING_COLLECTIONS.memberFeeCharges).get(),
      db.collection('members').get(),
      db.collection(ACCOUNTING_COLLECTIONS.financialIncomeCategories).get(),
      db.collection(ACCOUNTING_COLLECTIONS.financialExpenseCategories).get(),
      db.collection(ACCOUNTING_COLLECTIONS.paymentMethods).get(),
      db.collection(ACCOUNTING_COLLECTIONS.financialConfigs).where('isActive', '==', true).limit(1).get(),
    ]);

    const members = new Map(memberSnapshot.docs.map((entry) => [entry.id, entry.data()]));
    const categories = new Map<string, string>();
    [...incomeCategorySnapshot.docs, ...expenseCategorySnapshot.docs].forEach((entry) => {
      categories.set(entry.id, String(entry.data().name ?? entry.id));
    });
    const paymentMethods = new Map(paymentMethodSnapshot.docs.map((entry) => [entry.id, String(entry.data().name ?? entry.id)]));
    const holidays = new Set<string>((activeConfigSnapshot.docs[0]?.data().nationalHolidayDates ?? []).filter((entry: unknown) => typeof entry === 'string'));
    const selectedCategoryIds = new Set(params.input.categoryIds);
    const selectedMovementTypes = new Set(params.input.movementTypes);
    const rows: ReportRow[] = [];
    const sections = new Map<string, ReportSection>();

    movementSnapshot.docs.forEach((snapshot) => {
      const movement = snapshot.data() as FinancialMovementDocument;
      if (!movementIsReportable(movement)) return;
      const categoryId = movement.categoryCodeSnapshot || movement.categoryId;
      const isGreenFee = categoryId === FINANCIAL_INCOME_CATEGORY_IDS.greenFee;
      const isMemberFee = categoryId === FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria;
      const matchesCategories = (selectedCategoryIds.size === 0 || selectedCategoryIds.has(categoryId))
        && (selectedMovementTypes.size === 0 || selectedMovementTypes.has(movement.movementType));
      const memberName = movement.thirdPartyId ? displayName(members.get(movement.thirdPartyId)) : null;
      const categoryLabel = categories.get(categoryId) ?? categoryId.replaceAll('_', ' ');
      const paymentMethodLabel = movement.paymentMethodId ? paymentMethods.get(movement.paymentMethodId) ?? movement.paymentMethodId : null;

      if (params.input.template === 'green_fee' && isGreenFee && movement.movementType === 'income') {
        const dateKey = argentinaDate(movement.operationDate);
        const day = new Date(`${dateKey}T12:00:00-03:00`).getDay();
        const groupKey = holidays.has(dateKey) ? 'holiday' : day === 0 || day === 6 ? 'weekend' : 'weekday';
        const groupLabel = groupKey === 'holiday' ? 'Feriados' : groupKey === 'weekend' ? 'Fines de semana' : 'D?as de semana';
        const row = movementRow(snapshot, movement, categoryLabel, paymentMethodLabel, memberName, 'green_fee', groupKey, groupLabel);
        rows.push(row);
        addSection(sections, `green_fee:${groupKey}`, groupLabel, row);
        return;
      }

      if (params.input.template === 'member_dues') {
        if (isMemberFee && params.input.includePaidDues && movement.movementType === 'income') {
          const row = movementRow(snapshot, movement, categoryLabel, paymentMethodLabel, memberName, 'dues_paid');
          rows.push(row);
          addSection(sections, 'dues_paid', 'Cuotas cobradas en el rango', row);
        }
        return;
      }

      if ((params.input.template === 'categories' || params.input.template === 'custom') && matchesCategories) {
        const row = movementRow(snapshot, movement, categoryLabel, paymentMethodLabel, memberName, 'movements');
        rows.push(row);
        addSection(sections, `category:${movement.movementType}:${categoryId}`, `${movement.movementType === 'income' ? 'Ingreso' : 'Egreso'} ? ${categoryLabel}`, row);
      }
    });

    if (params.input.includeUnpaidPeriod || params.input.includeUnpaidAccumulated) {
      chargeSnapshot.docs.forEach((snapshot) => {
        const charge = snapshot.data() as MemberFeeChargeDocument;
        const outstanding = outstandingAmount(charge);
        if (!['pending', 'overdue'].includes(charge.status) || outstanding <= 0 || charge.status === 'exempt' || charge.status === 'cancelled') return;
        const memberId = charge.memberId ?? charge.holderMemberId ?? null;
        const memberName = memberId ? displayName(members.get(memberId)) : 'Grupo familiar sin titular';
        const baseRow: Omit<ReportRow, 'section'> = {
          id: snapshot.id,
          date: charge.dueDate ? argentinaDate(charge.dueDate) : null,
          label: `Cuota societaria ${charge.period}`,
          categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
          categoryLabel: 'Cuota societaria',
          groupKey: null,
          groupLabel: null,
          movementType: 'income',
          memberId,
          memberName,
          period: charge.period,
          paymentMethodId: null,
          paymentMethodLabel: null,
          grossAmountMinor: charge.settlementAmountMinor ?? charge.finalAmountMinor,
          commissionAmountMinor: 0,
          netAmountMinor: charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0,
          outstandingAmountMinor: outstanding,
          status: charge.status,
        };
        if (params.input.includeUnpaidPeriod && charge.period >= range.periodFrom && charge.period <= range.periodTo) {
          const row: ReportRow = { ...baseRow, id: `${snapshot.id}:period`, section: 'dues_unpaid_period' };
          rows.push(row);
          addSection(sections, 'dues_unpaid_period', 'Cuotas impagas del per?odo', row);
        }
        if (params.input.includeUnpaidAccumulated && charge.period <= range.periodTo) {
          const row: ReportRow = { ...baseRow, id: `${snapshot.id}:accumulated`, section: 'dues_unpaid_accumulated' };
          rows.push(row);
          addSection(sections, 'dues_unpaid_accumulated', 'Deuda acumulada al cierre', row);
        }
      });
    }

    rows.sort((left, right) => (right.date ?? right.period ?? '').localeCompare(left.date ?? left.period ?? '') || left.label.localeCompare(right.label));
    const movementRows = rows.filter((row) => row.section === 'movements' || row.section === 'green_fee' || row.section === 'dues_paid');
    const incomeTotalMinor = movementRows.filter((row) => row.movementType === 'income').reduce((total, row) => total + row.netAmountMinor, 0);
    const expenseTotalMinor = movementRows.filter((row) => row.movementType === 'expense').reduce((total, row) => total + row.netAmountMinor, 0);
    const unpaidPeriodMinor = rows.filter((row) => row.section === 'dues_unpaid_period').reduce((total, row) => total + row.outstandingAmountMinor, 0);
    const unpaidAccumulatedMinor = rows.filter((row) => row.section === 'dues_unpaid_accumulated').reduce((total, row) => total + row.outstandingAmountMinor, 0);

    const chunks = Array.from({ length: Math.ceil(rows.length / 100) }, (_, index) => rows.slice(index * 100, (index + 1) * 100));
    for (let offset = 0; offset < chunks.length; offset += 400) {
      const batch = db.batch();
      chunks.slice(offset, offset + 400).forEach((chunk, localIndex) => {
        const index = offset + localIndex;
        batch.set(reportRef.collection('chunks').doc(String(index).padStart(6, '0')), { index, rows: chunk });
      });
      await batch.commit();
    }

    await reportRef.update({
      status: 'generated',
      completedAt: Timestamp.now(),
      sections: [...sections.values()],
      detailRowCount: rows.length,
      chunkCount: chunks.length,
      includes: ['movements', 'categories', ...(params.input.includePaidDues || params.input.includeUnpaidPeriod || params.input.includeUnpaidAccumulated ? ['fees'] : [])],
      summary: {
        incomeTotalMinor,
        expenseTotalMinor,
        netTotalMinor: incomeTotalMinor - expenseTotalMinor,
        movementCount: movementRows.length,
        feePendingMinor: unpaidAccumulatedMinor,
        salaryTotalMinor: 0,
        paidDuesMinor: rows.filter((row) => row.section === 'dues_paid').reduce((total, row) => total + row.netAmountMinor, 0),
        unpaidPeriodMinor,
        unpaidAccumulatedMinor,
      },
    });
    return { reportId };
  } catch (error) {
    await reportRef.update({
      status: 'failed',
      completedAt: Timestamp.now(),
      errorMessage: error instanceof Error ? error.message : 'No se pudo generar el reporte.',
    });
    throw error;
  }
}
