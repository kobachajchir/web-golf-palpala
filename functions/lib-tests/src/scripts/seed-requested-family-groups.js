import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MEMBER_TYPE_IDS, SYSTEM_ACTOR_UID, USERS_COLLECTIONS } from '../modules/users/domain/constants.js';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-web-golf-palpala';
const REPORT_DIR = resolve(process.cwd(), 'seed-reports');
const REQUESTED_FAMILY_LINKS = [
    {
        holder: { firstName: 'Luis', lastName: 'Gomez' },
        associated: { firstName: 'Isabel', lastName: 'Santucho' },
    },
    {
        holder: { firstName: 'Horacio', lastName: 'Ibarra' },
        associated: { firstName: 'Maria Gabriela', lastName: 'Lokman' },
    },
    {
        holder: { firstName: 'Oscar', lastName: 'Branca' },
        associated: { firstName: 'Maria Fernanda', lastName: 'Delgado' },
    },
    {
        holder: { firstName: 'Rene', lastName: 'Boggione' },
        associated: { firstName: 'Patricia', lastName: 'Traversi' },
    },
    {
        holder: { firstName: 'Hector', lastName: 'Rodriguez Francile' },
        associated: { firstName: 'Patricia', lastName: 'Pedroso' },
    },
];
function ensureAdminApp() {
    if (getApps().length === 0) {
        initializeApp({ projectId: DEFAULT_PROJECT_ID });
    }
}
function normalizeSearchText(value) {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('es-AR')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizePersonKey(person) {
    return `${normalizeSearchText(person.lastName)}|${normalizeSearchText(person.firstName)}`;
}
function displayPerson(person) {
    return `${person.lastName}, ${person.firstName}`;
}
function createFamilyGroupId(holder, associated) {
    return `requested-family-${holder.id}-${associated.id}`.slice(0, 140);
}
async function run() {
    ensureAdminApp();
    const firestore = getFirestore();
    firestore.settings({ ignoreUndefinedProperties: true });
    const membersSnapshot = await firestore.collection(USERS_COLLECTIONS.members).get();
    const members = membersSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            memberNumber: data.memberNumber,
            firstName: data.firstName,
            lastName: data.lastName,
            familyGroupId: data.familyGroupId,
        };
    });
    const membersByPersonKey = members.reduce((accumulator, member) => {
        const key = normalizePersonKey(member);
        const matches = accumulator.get(key) ?? [];
        matches.push(member);
        accumulator.set(key, matches);
        return accumulator;
    }, new Map());
    const linked = [];
    const skipped = [];
    const batch = firestore.batch();
    for (const link of REQUESTED_FAMILY_LINKS) {
        const holderMatches = membersByPersonKey.get(normalizePersonKey(link.holder)) ?? [];
        const associatedMatches = membersByPersonKey.get(normalizePersonKey(link.associated)) ?? [];
        if (holderMatches.length !== 1 || associatedMatches.length !== 1) {
            skipped.push({
                holder: displayPerson(link.holder),
                associated: displayPerson(link.associated),
                reason: holderMatches.length === 0 || associatedMatches.length === 0 ? 'No encontrado en members.' : 'Coincidencia multiple en members.',
                matches: {
                    holder: holderMatches.map((member) => `${member.id} #${member.memberNumber}`),
                    associated: associatedMatches.map((member) => `${member.id} #${member.memberNumber}`),
                },
            });
            continue;
        }
        const holder = holderMatches[0];
        const associated = associatedMatches[0];
        const existingDifferentGroup = (holder.familyGroupId && associated.familyGroupId && holder.familyGroupId !== associated.familyGroupId) ||
            (holder.familyGroupId && !associated.familyGroupId) ||
            (!holder.familyGroupId && associated.familyGroupId);
        if (existingDifferentGroup) {
            skipped.push({
                holder: displayPerson(link.holder),
                associated: displayPerson(link.associated),
                reason: 'Alguno de los socios ya pertenece a otro grupo familiar. Revisar manualmente antes de sobrescribir.',
                matches: {
                    holder: [`${holder.id} #${holder.memberNumber} grupo=${holder.familyGroupId ?? 'sin grupo'}`],
                    associated: [`${associated.id} #${associated.memberNumber} grupo=${associated.familyGroupId ?? 'sin grupo'}`],
                },
            });
            continue;
        }
        const familyGroupId = holder.familyGroupId ?? associated.familyGroupId ?? createFamilyGroupId(holder, associated);
        const memberIds = [holder.id, associated.id];
        batch.set(firestore.collection(USERS_COLLECTIONS.familyGroups).doc(familyGroupId), {
            code: `GF-${holder.memberNumber.padStart(4, '0')}`,
            holderMemberId: holder.id,
            memberIds,
            active: true,
            notes: 'Grupo familiar cargado por seed solicitado desde administracion.',
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
        batch.set(firestore.collection(USERS_COLLECTIONS.members).doc(holder.id), {
            familyGroupId,
            isFamilyHolder: true,
            typeId: MEMBER_TYPE_IDS.grupoFamiliarTitular,
            typeCodeSnapshot: MEMBER_TYPE_IDS.grupoFamiliarTitular,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
        batch.set(firestore.collection(USERS_COLLECTIONS.members).doc(associated.id), {
            familyGroupId,
            isFamilyHolder: false,
            typeId: MEMBER_TYPE_IDS.grupoFamiliarAsociado,
            typeCodeSnapshot: MEMBER_TYPE_IDS.grupoFamiliarAsociado,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
        linked.push({ holder, associated, familyGroupId });
    }
    if (linked.length > 0) {
        await batch.commit();
    }
    const report = {
        ok: true,
        projectId: DEFAULT_PROJECT_ID,
        emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
        requested: REQUESTED_FAMILY_LINKS.length,
        linked: linked.map((entry) => ({
            familyGroupId: entry.familyGroupId,
            holder: `${entry.holder.lastName}, ${entry.holder.firstName} #${entry.holder.memberNumber}`,
            associated: `${entry.associated.lastName}, ${entry.associated.firstName} #${entry.associated.memberNumber}`,
        })),
        skipped,
    };
    await mkdir(REPORT_DIR, { recursive: true });
    const reportPath = resolve(REPORT_DIR, `requested-family-groups-${Date.now()}.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}
void run().catch((error) => {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`No pudimos seedear los grupos familiares solicitados. Motivo: ${message}`);
    process.exitCode = 1;
});
//# sourceMappingURL=seed-requested-family-groups.js.map