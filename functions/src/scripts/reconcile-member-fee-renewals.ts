import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { reconcileMemberFeeRenewalsUseCase } from '../modules/accounting/application/use-cases/member-fee-reconciliation.use-cases.js';
import { FINANCIAL_INCOME_CATEGORY_IDS } from '../modules/accounting/domain/constants.js';
import type { AccountingPeriod, Actor, FinancialMovementDocument } from '../modules/accounting/domain/models.js';
import { FirestoreAccountingTransactionManager, SystemClock } from '../modules/accounting/infrastructure/firestore/repositories.js';

const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'webgolfclub';
const REPORT_PATH = resolve(
  process.env.MEMBER_FEE_RECONCILIATION_REPORT_PATH
    ?? resolve(process.cwd(), 'migration-reports', `member-fee-renewals-${Date.now()}.json`),
);

function parseOptions() {
  const args = process.argv.slice(2);
  const projectArg = args.find((arg) => arg.startsWith('--project='));
  const periodArg = args.find((arg) => arg.startsWith('--period='));
  const period = periodArg?.split('=')[1]?.trim() || 'all';
  if (period !== 'all' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('El periodo debe tener formato AAAA-MM o ser all.');
  }
  return {
    projectId: projectArg?.split('=')[1]?.trim() || DEFAULT_PROJECT_ID,
    period: period as AccountingPeriod | 'all',
    execute: args.includes('--execute') && args.includes('--yes-membership-renewals-only'),
  };
}

function createMigrationActor(): Actor {
  const auditTimestamp = Timestamp.fromMillis(0);
  return {
    uid: 'migration-member-fee-reconciliation',
    user: {
      id: 'migration-member-fee-reconciliation',
      email: 'migration@club.local',
      displayName: 'Sincronizacion de cuotas',
      primaryRoleId: 'directivo',
      roleIds: ['directivo'],
      profileType: 'none',
      active: true,
      claimsVersion: 1,
      createdAt: auditTimestamp,
      createdBy: 'migration-member-fee-reconciliation',
      updatedAt: auditTimestamp,
      updatedBy: 'migration-member-fee-reconciliation',
    },
    claims: {
      comite_ejecutivo: false,
      directivo: true,
      administrativo: false,
      empleado: false,
      comision_directiva: false,
      socio: false,
      desarrollador: false,
      claimsVersion: 1,
    },
  };
}

async function listPeriods(selectedPeriod: AccountingPeriod | 'all'): Promise<AccountingPeriod[]> {
  if (selectedPeriod !== 'all') return [selectedPeriod];
  const snapshot = await getFirestore()
    .collection('financial_movements')
    .where('categoryCodeSnapshot', '==', FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria)
    .get();
  return [...new Set(
    snapshot.docs
      .map((document) => document.data() as FinancialMovementDocument)
      .filter((movement) => movement.status === 'posted' && movement.movementType === 'income')
      .map((movement) => movement.accountingPeriod)
      .filter((period): period is AccountingPeriod => /^\d{4}-(0[1-9]|1[0-2])$/.test(period)),
  )].sort();
}

async function run() {
  const options = parseOptions();
  if (getApps().length === 0) initializeApp({ projectId: options.projectId });
  getFirestore().settings({ ignoreUndefinedProperties: true });

  const manager = new FirestoreAccountingTransactionManager(new SystemClock());
  const actor = createMigrationActor();
  const periods = await listPeriods(options.period);
  const results = [];
  for (const period of periods) {
    results.push(await reconcileMemberFeeRenewalsUseCase({
      actor,
      input: { period, execute: options.execute },
      transactions: manager,
    }));
  }

  const report = {
    ok: true,
    mode: options.execute ? 'execute' : 'dry-run',
    projectId: options.projectId,
    selectedPeriod: options.period,
    periods,
    totals: {
      movements: results.reduce((total, result) => total + result.feeMovementCount, 0),
      matchedAllocations: results.reduce((total, result) => total + result.matchedAllocationCount, 0),
      repairedCharges: results.reduce((total, result) => total + result.repairedChargeCount, 0),
      repairedMembers: results.reduce((total, result) => total + result.repairedMemberCount, 0),
      ambiguous: results.reduce((total, result) => total + result.ambiguousCount, 0),
    },
    safety: {
      financialMovementsWritten: false,
      unrelatedCategoriesWritten: false,
      writesLimitedToMatchedChargesAndTheirMembers: true,
      executionConfirmation: '--execute --yes-membership-renewals-only',
    },
    results,
    reportPath: REPORT_PATH,
  };
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No pudimos sincronizar las cuotas societarias.');
  process.exitCode = 1;
});
