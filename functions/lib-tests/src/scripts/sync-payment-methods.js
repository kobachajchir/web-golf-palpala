import { getApps, initializeApp } from 'firebase-admin/app';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLIENT_PAYMENT_METHODS, DEPRECATED_PAYMENT_METHOD_IDS, SYSTEM_ACTOR_UID, } from '../modules/accounting/domain/constants.js';
import { FirestoreAccountingTransactionManager, SystemClock, } from '../modules/accounting/infrastructure/firestore/repositories.js';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'webgolfclub';
const CONFIRMATION_FLAGS = '--execute --yes-sync-payment-methods';
const REPORT_PATH = resolve(process.env.SYNC_PAYMENT_METHODS_REPORT_PATH
    ?? resolve(process.cwd(), 'seed-reports', `sync-payment-methods-${Date.now()}.json`));
function parseOptions() {
    const args = process.argv.slice(2);
    const projectArg = args.find((arg) => arg.startsWith('--project='));
    return {
        projectId: projectArg?.split('=')[1]?.trim() || DEFAULT_PROJECT_ID,
        execute: args.includes('--execute') && args.includes('--yes-sync-payment-methods'),
    };
}
function comparableMethod(method) {
    return {
        name: method.name,
        bancarizado: method.bancarizado,
        specialReportingType: method.specialReportingType ?? null,
        active: method.active,
        sortOrder: method.sortOrder,
    };
}
function methodsMatch(current, next) {
    return JSON.stringify(comparableMethod(current)) === JSON.stringify(comparableMethod(next));
}
async function run() {
    const options = parseOptions();
    if (getApps().length === 0) {
        initializeApp({ projectId: options.projectId });
    }
    const transactions = new FirestoreAccountingTransactionManager(new SystemClock());
    const dataAccess = transactions.getDataAccess();
    const changes = [];
    for (const method of CLIENT_PAYMENT_METHODS) {
        const current = await dataAccess.paymentMethods.getById(method.id);
        if (current && methodsMatch(current, method.data)) {
            continue;
        }
        changes.push({
            id: method.id,
            action: current ? 'update' : 'create',
            current: current ? comparableMethod(current) : null,
            next: comparableMethod(method.data),
        });
        if (options.execute) {
            await dataAccess.paymentMethods.set(method.id, method.data, SYSTEM_ACTOR_UID);
        }
    }
    for (const methodId of DEPRECATED_PAYMENT_METHOD_IDS) {
        const current = await dataAccess.paymentMethods.getById(methodId);
        if (!current?.active) {
            continue;
        }
        const next = {
            name: current.name,
            bancarizado: current.bancarizado,
            specialReportingType: current.specialReportingType ?? null,
            active: false,
            sortOrder: current.sortOrder,
        };
        changes.push({
            id: methodId,
            action: 'deactivate',
            current: comparableMethod(current),
            next,
        });
        if (options.execute) {
            await dataAccess.paymentMethods.set(methodId, next, SYSTEM_ACTOR_UID);
        }
    }
    const report = {
        ok: true,
        mode: options.execute ? 'execute' : 'dry-run',
        projectId: options.projectId,
        changeCount: changes.length,
        changes,
        confirmationRequiredForExecution: CONFIRMATION_FLAGS,
        reportPath: REPORT_PATH,
    };
    await mkdir(resolve(REPORT_PATH, '..'), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
}
void run().catch((error) => {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`No pudimos sincronizar los medios de pago. Motivo: ${message}`);
    process.exitCode = 1;
});
//# sourceMappingURL=sync-payment-methods.js.map