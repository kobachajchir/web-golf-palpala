import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FinancialMovementDocument } from '../modules/accounting/domain/models.js';

const MIGRATION_ACTOR = 'migration-installment-to-partial-payments';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'webgolfclub';
const REPORT_PATH = resolve(
  process.env.PARTIAL_PAYMENT_MIGRATION_REPORT_PATH
    ?? resolve(process.cwd(), 'migration-reports', `installment-to-partial-payments-${Date.now()}.json`),
);

function parseOptions() {
  const args = process.argv.slice(2);
  const projectArg = args.find((arg) => arg.startsWith('--project='));
  const planArg = args.find((arg) => arg.startsWith('--plan-id='));
  const planId = planArg?.split('=')[1]?.trim();
  if (!planId) throw new Error('Debes indicar --plan-id.');
  return {
    projectId: projectArg?.split('=')[1]?.trim() || DEFAULT_PROJECT_ID,
    planId,
    execute: args.includes('--execute') && args.includes('--yes-partial-payment-migration'),
  };
}

function assertEligiblePlan(params: {
  root: FinancialMovementDocument | undefined;
  linkedPayments: FinancialMovementDocument[];
}) {
  const { root, linkedPayments } = params;
  if (!root) throw new Error('No existe el movimiento indicado.');
  if (root.installmentRole !== 'charge') throw new Error('El movimiento no es la carga principal de un plan.');
  if (root.metadata?.partialPaymentMode === 'flexible') return;
  if (root.status !== 'pending') throw new Error('Solo se migra un plan pendiente.');
  if ((root.installmentPaidAmountMinor ?? 0) !== 0 || (root.installmentPaidCount ?? 0) !== 0) {
    throw new Error('El plan ya tiene importes pagados y requiere revision manual.');
  }
  if (linkedPayments.length > 0) throw new Error('El plan tiene movimientos vinculados y requiere revision manual.');
}

function summarizePlan(id: string, root: FinancialMovementDocument, linkedCount: number) {
  return {
    id,
    movementType: root.movementType,
    categoryId: root.categoryId,
    accountingPeriod: root.accountingPeriod,
    status: root.status,
    originType: root.originType,
    partialPaymentMode: root.metadata?.partialPaymentMode ?? null,
    installmentCount: root.installmentCount ?? null,
    totalAmountMinor: root.installmentTotalAmountMinor ?? root.netAmountMinor,
    paidAmountMinor: root.installmentPaidAmountMinor ?? 0,
    linkedMovementCount: linkedCount,
  };
}

async function run() {
  const options = parseOptions();
  if (getApps().length === 0) initializeApp({ projectId: options.projectId });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  const rootRef = db.collection('financial_movements').doc(options.planId);
  const [rootSnapshot, linkedSnapshot] = await Promise.all([
    rootRef.get(),
    db.collection('financial_movements').where('installmentPlanId', '==', options.planId).get(),
  ]);
  const root = rootSnapshot.data() as FinancialMovementDocument | undefined;
  const linkedPayments = linkedSnapshot.docs
    .filter((document) => document.id !== options.planId)
    .map((document) => document.data() as FinancialMovementDocument);
  assertEligiblePlan({ root, linkedPayments });
  if (!root) throw new Error('No existe el movimiento indicado.');

  const alreadyMigrated = root.metadata?.partialPaymentMode === 'flexible';
  if (options.execute && !alreadyMigrated) {
    await db.runTransaction(async (transaction) => {
      const [currentSnapshot, currentLinkedSnapshot] = await Promise.all([
        transaction.get(rootRef),
        transaction.get(db.collection('financial_movements').where('installmentPlanId', '==', options.planId)),
      ]);
      const current = currentSnapshot.data() as FinancialMovementDocument | undefined;
      const currentLinkedPayments = currentLinkedSnapshot.docs
        .filter((document) => document.id !== options.planId)
        .map((document) => document.data() as FinancialMovementDocument);
      assertEligiblePlan({ root: current, linkedPayments: currentLinkedPayments });
      if (!current || current.metadata?.partialPaymentMode === 'flexible') return;

      const baseAmountMinor = current.installmentBaseAmountMinor ?? current.netAmountMinor;
      const interestAmountMinor = current.installmentInterestAmountMinor ?? 0;
      const totalAmountMinor = current.installmentTotalAmountMinor ?? current.netAmountMinor;
      transaction.update(rootRef, {
        originType: 'partial_payment_plan',
        installmentCount: null,
        installmentScheduledAmountMinor: null,
        balanceExclusionReason: 'Plan de pagos parciales: el balance se actualiza con cada pago efectivo.',
        metadata: {
          ...(current.metadata ?? {}),
          partialPaymentMode: 'flexible',
          installmentSchedule: [],
          principalAmountsMinor: [baseAmountMinor],
          monthlyInterestAmountsMinor: [interestAmountMinor],
          installmentAmountsMinor: [totalAmountMinor],
          migratedFromInstallmentPlan: true,
          migratedBy: MIGRATION_ACTOR,
          migratedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: MIGRATION_ACTOR,
      });
    });
  }

  const finalSnapshot = options.execute ? await rootRef.get() : rootSnapshot;
  const finalRoot = finalSnapshot.data() as FinancialMovementDocument;
  const report = {
    ok: true,
    mode: options.execute ? 'execute' : 'dry-run',
    projectId: options.projectId,
    alreadyMigrated,
    financialAmountsWritten: false,
    linkedMovementsWritten: false,
    before: summarizePlan(options.planId, root, linkedPayments.length),
    after: options.execute
      ? summarizePlan(options.planId, finalRoot, linkedPayments.length)
      : {
          ...summarizePlan(options.planId, root, linkedPayments.length),
          originType: 'partial_payment_plan',
          partialPaymentMode: 'flexible',
          installmentCount: null,
        },
    reportPath: REPORT_PATH,
  };
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No pudimos migrar el plan a pagos parciales.');
  process.exitCode = 1;
});
