import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_MEMBER_TYPES, MEMBER_TYPE_IDS, SYSTEM_ACTOR_UID, USERS_COLLECTIONS, } from '../modules/users/domain/constants.js';
import { normalizeMemberNumber } from '../modules/auth/member-number-auth.js';
const IMPORT_MARK = 'Padron legado Palpala Golf Tenis Club';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-web-golf-palpala';
const CSV_PATH = resolve(process.env.PALPALA_MEMBERS_CSV ?? resolve(process.cwd(), '..', 'public', 'data', 'palpala-members.csv'));
const DRY_RUN = process.env.MEMBERS_IMPORT_DRY_RUN === 'true' || process.argv.includes('--dry-run');
const COMMON_GIVEN_NAMES = new Set([
    'ADRIANA',
    'AGUSTIN',
    'ALEJANDRA',
    'ALEJANDRO',
    'ALEXIS',
    'ALFREDO',
    'AMELIO',
    'ANTONIO',
    'CARLOS',
    'CRISTINA',
    'CRUZ',
    'DANIEL',
    'DIEGO',
    'EDUARDO',
    'ELADIO',
    'FERNANDA',
    'FERNANDO',
    'FABRICIO',
    'FEDERICO',
    'FRANCO',
    'FRANCISCO',
    'GABRIEL',
    'GASTON',
    'GERARDO',
    'GERMAN',
    'GUILLERMO',
    'HADEL',
    'HERNAN',
    'HECTOR',
    'HORACIO',
    'HUGO',
    'ISABEL',
    'JAIME',
    'JAVIER',
    'JORGE',
    'JOSE',
    'JUAN',
    'LISANDRO',
    'LUCIANO',
    'LUIS',
    'MANUEL',
    'MARCELO',
    'MARCOS',
    'MARIA',
    'MARIANO',
    'MARTIN',
    'MATIAS',
    'MIGUEL',
    'NILO',
    'OCTAVIO',
    'OLIVER',
    'OSCAR',
    'PABLO',
    'PATRICIA',
    'PEDRO',
    'RAUL',
    'RENATO',
    'RENE',
    'RICARDO',
    'ROBERTO',
    'RODRIGO',
    'ROQUE',
    'RUTH',
    'SEBASTIAN',
    'SEIYU',
    'SEGUNDO',
    'SERGIO',
    'SOLANO',
    'YAMIL',
]);
function ensureAdminApp() {
    if (getApps().length === 0) {
        if (process.env.FIRESTORE_EMULATOR_HOST) {
            initializeApp({ projectId: DEFAULT_PROJECT_ID });
        }
        else {
            initializeApp({ projectId: DEFAULT_PROJECT_ID });
        }
    }
}
function normalizeSearchText(value) {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function slugify(value) {
    return normalizeSearchText(value).replace(/\s+/g, '-');
}
function cleanOptionalValue(value) {
    const normalizedValue = (value ?? '').trim();
    if (!normalizedValue || normalizedValue.toUpperCase() === 'NO TIENE') {
        return undefined;
    }
    return normalizedValue;
}
function toTitleCase(value) {
    return value
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => {
        const lowerToken = token.toLocaleLowerCase('es-AR');
        return `${lowerToken.charAt(0).toLocaleUpperCase('es-AR')}${lowerToken.slice(1)}`;
    })
        .join(' ');
}
function splitLegacyFullName(fullName) {
    const sanitizedValue = fullName.trim().replace(/\s+/g, ' ');
    const tokens = sanitizedValue.split(' ').filter(Boolean);
    if (tokens.length <= 1) {
        return {
            firstName: '',
            lastName: toTitleCase(sanitizedValue),
        };
    }
    const givenNameTokens = [tokens[tokens.length - 1] ?? ''];
    for (let index = tokens.length - 2; index >= 1; index -= 1) {
        const token = tokens[index] ?? '';
        const normalizedToken = normalizeSearchText(token).toUpperCase();
        if (!COMMON_GIVEN_NAMES.has(normalizedToken)) {
            break;
        }
        givenNameTokens.unshift(token);
    }
    const lastNameTokens = tokens.slice(0, tokens.length - givenNameTokens.length);
    const safeLastNameTokens = lastNameTokens.length > 0 ? lastNameTokens : [tokens[0] ?? ''];
    const safeFirstNameTokens = lastNameTokens.length > 0 ? givenNameTokens : tokens.slice(1);
    return {
        firstName: toTitleCase(safeFirstNameTokens.join(' ')),
        lastName: toTitleCase(safeLastNameTokens.join(' ')),
    };
}
function mapMemberType(statusLabel) {
    const normalizedStatus = normalizeSearchText(statusLabel);
    if (normalizedStatus.includes('vitalicio')) {
        return MEMBER_TYPE_IDS.vitalicio;
    }
    if (normalizedStatus.includes('menor')) {
        return MEMBER_TYPE_IDS.menor;
    }
    if (normalizedStatus.includes('licencia')) {
        return MEMBER_TYPE_IDS.licencia;
    }
    if (normalizedStatus.includes('esposa')) {
        return MEMBER_TYPE_IDS.grupoFamiliarAsociado;
    }
    return MEMBER_TYPE_IDS.pleno;
}
function parseRosterCsv(csvContent) {
    const [, ...dataLines] = csvContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    return dataLines.map((line) => {
        const [order = '', memberNumber = '', fullName = '', aagMembershipNumber = '', membershipStatusLabel = '', feeDeductionLabel = '',] = line.split(';');
        return {
            order: Number(order.trim()),
            memberNumber: memberNumber.trim(),
            fullName: fullName.trim(),
            aagMembershipNumber: cleanOptionalValue(aagMembershipNumber),
            membershipStatusLabel: membershipStatusLabel.trim(),
            feeDeductionLabel: cleanOptionalValue(feeDeductionLabel),
        };
    });
}
function createMemberId(row) {
    return `legacy-${row.memberNumber}-${row.order}-${slugify(row.fullName)}`;
}
function createFamilyGroupId(memberNumber) {
    return `legacy-family-${memberNumber.padStart(4, '0')}`;
}
function parseNumericMemberNumber(value) {
    const normalizedValue = value.trim().replace(/\s+/g, '');
    if (!/^\d+$/.test(normalizedValue)) {
        return null;
    }
    const numericValue = Number.parseInt(normalizedValue, 10);
    return Number.isSafeInteger(numericValue) && numericValue >= 0 ? numericValue : null;
}
function buildImportSeeds(rows, options) {
    const members = rows.map((row) => {
        const parsedName = splitLegacyFullName(row.fullName);
        return {
            id: createMemberId(row),
            memberNumber: row.memberNumber,
            legacyMemberNumber: row.memberNumber,
            firstName: parsedName.firstName || toTitleCase(row.fullName),
            lastName: parsedName.lastName || toTitleCase(row.fullName),
            aagMembershipNumber: row.aagMembershipNumber,
            membershipStatusLabel: row.membershipStatusLabel,
            feeDeductionLabel: row.feeDeductionLabel,
            typeId: mapMemberType(row.membershipStatusLabel),
            isFamilyHolder: false,
            memberNumberAssignment: 'legacy',
        };
    });
    const membersByNumber = members.reduce((accumulator, member) => {
        const currentMembers = accumulator.get(normalizeMemberNumber(member.legacyMemberNumber)) ?? [];
        currentMembers.push(member);
        accumulator.set(normalizeMemberNumber(member.legacyMemberNumber), currentMembers);
        return accumulator;
    }, new Map());
    const highestLegacyMemberNumber = members.reduce((highest, member) => {
        const parsedValue = parseNumericMemberNumber(member.legacyMemberNumber);
        return parsedValue !== null && parsedValue > highest ? parsedValue : highest;
    }, 0);
    let nextGeneratedMemberNumber = highestLegacyMemberNumber + 1;
    const reservedMemberNumbers = new Set(options.occupiedMemberNumbers);
    members.forEach((member) => reservedMemberNumbers.add(normalizeMemberNumber(member.legacyMemberNumber)));
    const assignedMemberNumbers = new Set();
    const memberNumberReassignments = [];
    const reserveAssignedMemberNumber = (memberNumber) => {
        const normalizedMemberNumber = normalizeMemberNumber(memberNumber);
        reservedMemberNumbers.add(normalizedMemberNumber);
        assignedMemberNumbers.add(normalizedMemberNumber);
    };
    const generateUniqueMemberNumber = () => {
        let candidate = String(nextGeneratedMemberNumber);
        while (reservedMemberNumbers.has(normalizeMemberNumber(candidate))) {
            nextGeneratedMemberNumber += 1;
            candidate = String(nextGeneratedMemberNumber);
        }
        nextGeneratedMemberNumber += 1;
        reserveAssignedMemberNumber(candidate);
        return candidate;
    };
    for (const groupedMembers of membersByNumber.values()) {
        const holder = groupedMembers.find((member) => member.typeId !== MEMBER_TYPE_IDS.grupoFamiliarAsociado &&
            member.typeId !== MEMBER_TYPE_IDS.menor &&
            member.typeId !== MEMBER_TYPE_IDS.licencia) ?? groupedMembers[0];
        for (const member of groupedMembers) {
            const existingMemberNumber = options.existingMemberNumberByMemberId.get(member.id);
            if (existingMemberNumber) {
                member.memberNumber = existingMemberNumber;
                member.memberNumberAssignment = 'existing';
                reserveAssignedMemberNumber(existingMemberNumber);
                if (normalizeMemberNumber(existingMemberNumber) !== normalizeMemberNumber(member.legacyMemberNumber)) {
                    memberNumberReassignments.push({
                        rowOrder: rows.find((row) => createMemberId(row) === member.id)?.order ?? 0,
                        fullName: `${member.lastName}, ${member.firstName}`,
                        legacyMemberNumber: member.legacyMemberNumber,
                        assignedMemberNumber: existingMemberNumber,
                        reason: 'Se conserva el ID unico ya importado anteriormente.',
                    });
                }
                continue;
            }
            const normalizedLegacyMemberNumber = normalizeMemberNumber(member.legacyMemberNumber);
            const canUseLegacyNumber = member.id === holder.id &&
                !assignedMemberNumbers.has(normalizedLegacyMemberNumber) &&
                !options.occupiedMemberNumbers.has(normalizedLegacyMemberNumber);
            if (canUseLegacyNumber) {
                member.memberNumber = member.legacyMemberNumber;
                member.memberNumberAssignment = 'legacy';
                reserveAssignedMemberNumber(member.memberNumber);
                continue;
            }
            member.memberNumber = generateUniqueMemberNumber();
            member.memberNumberAssignment = 'generated';
            memberNumberReassignments.push({
                rowOrder: rows.find((row) => createMemberId(row) === member.id)?.order ?? 0,
                fullName: `${member.lastName}, ${member.firstName}`,
                legacyMemberNumber: member.legacyMemberNumber,
                assignedMemberNumber: member.memberNumber,
                reason: member.id === holder.id
                    ? 'El numero historico ya estaba reservado; se genero un ID unico.'
                    : 'Integrante de grupo familiar con numero historico compartido; se genero un ID unico.',
            });
        }
    }
    const familyGroups = [];
    for (const [, groupedMembers] of membersByNumber.entries()) {
        if (groupedMembers.length < 2) {
            continue;
        }
        const holder = groupedMembers.find((member) => member.typeId !== MEMBER_TYPE_IDS.grupoFamiliarAsociado &&
            member.typeId !== MEMBER_TYPE_IDS.menor &&
            member.typeId !== MEMBER_TYPE_IDS.licencia) ?? groupedMembers[0];
        const legacyMemberNumber = groupedMembers[0].legacyMemberNumber;
        const familyGroupId = createFamilyGroupId(legacyMemberNumber);
        familyGroups.push({
            id: familyGroupId,
            code: `GF-${legacyMemberNumber.padStart(4, '0')}`,
            legacyMemberNumber,
            holderMemberId: holder.id,
            memberIds: groupedMembers.map((member) => member.id),
        });
        for (const groupedMember of groupedMembers) {
            groupedMember.familyGroupId = familyGroupId;
            groupedMember.isFamilyHolder = groupedMember.id === holder.id;
            groupedMember.typeId =
                groupedMember.id === holder.id ? MEMBER_TYPE_IDS.grupoFamiliarTitular : MEMBER_TYPE_IDS.grupoFamiliarAsociado;
        }
    }
    return { members, familyGroups, memberNumberReassignments };
}
async function readRoster() {
    const csvContent = await readFile(CSV_PATH, 'utf8');
    return parseRosterCsv(csvContent);
}
async function run() {
    ensureAdminApp();
    const firestore = getFirestore();
    firestore.settings({ ignoreUndefinedProperties: true });
    const importDate = new Date('2026-04-23T12:00:00-03:00');
    const rows = await readRoster();
    const invalidRows = rows
        .map((row, index) => ({ row, index: index + 2 }))
        .filter(({ row }) => !row.memberNumber.trim() || !row.fullName.trim());
    const rowsByMemberNumber = rows.reduce((accumulator, row) => {
        const normalizedMemberNumber = normalizeMemberNumber(row.memberNumber);
        const groupedRows = accumulator.get(normalizedMemberNumber) ?? [];
        groupedRows.push(row);
        accumulator.set(normalizedMemberNumber, groupedRows);
        return accumulator;
    }, new Map());
    const duplicateMemberNumbers = Array.from(rowsByMemberNumber.entries())
        .filter(([, groupedRows]) => groupedRows.length > 1)
        .map(([memberNumber, groupedRows]) => ({
        memberNumber,
        rows: groupedRows.map((row) => ({ order: row.order, fullName: row.fullName })),
    }));
    const invalidRowIndexes = new Set(invalidRows.map(({ index }) => index));
    const importableRows = rows.filter((row, index) => {
        const lineNumber = index + 2;
        return !invalidRowIndexes.has(lineNumber);
    });
    const existingMemberIdSnapshots = await Promise.all(importableRows.map((row) => firestore.collection(USERS_COLLECTIONS.members).doc(createMemberId(row)).get()));
    const existingMemberNumberByMemberId = new Map();
    existingMemberIdSnapshots.forEach((snapshot) => {
        if (!snapshot.exists) {
            return;
        }
        const member = snapshot.data();
        if (member.memberNumber) {
            existingMemberNumberByMemberId.set(snapshot.id, member.memberNumber);
        }
    });
    const [allMembersSnapshot, allIdentifiersSnapshot] = await Promise.all([
        firestore.collection(USERS_COLLECTIONS.members).select('memberNumber').get(),
        firestore.collection(USERS_COLLECTIONS.memberLoginIdentifiers).select('active').get(),
    ]);
    const occupiedMemberNumbers = new Set();
    allMembersSnapshot.docs.forEach((snapshot) => {
        const memberNumber = snapshot.get('memberNumber');
        if (typeof memberNumber === 'string' && memberNumber.trim()) {
            occupiedMemberNumbers.add(normalizeMemberNumber(memberNumber));
        }
    });
    allIdentifiersSnapshot.docs.forEach((snapshot) => {
        const active = snapshot.get('active');
        if (active !== false) {
            occupiedMemberNumbers.add(normalizeMemberNumber(snapshot.id));
        }
    });
    const { members, familyGroups, memberNumberReassignments } = buildImportSeeds(importableRows, {
        existingMemberNumberByMemberId,
        occupiedMemberNumbers,
    });
    const existingMemberSnapshots = await Promise.all(members.map((member) => firestore.collection(USERS_COLLECTIONS.members).doc(member.id).get()));
    const createdMembers = existingMemberSnapshots.filter((snapshot) => !snapshot.exists).length;
    const updatedMembers = existingMemberSnapshots.filter((snapshot) => snapshot.exists).length;
    const identifierSnapshots = await Promise.all(members.map((member) => firestore.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizeMemberNumber(member.memberNumber)).get()));
    const identifierConflicts = identifierSnapshots
        .map((snapshot, index) => {
        if (!snapshot.exists) {
            return null;
        }
        const identifier = snapshot.data();
        const member = members[index];
        if (identifier.active === false || !identifier.memberId || identifier.memberId === member.id) {
            return null;
        }
        return {
            memberNumber: normalizeMemberNumber(member.memberNumber),
            incomingMemberId: member.id,
            existingMemberId: identifier.memberId,
        };
    })
        .filter((entry) => entry !== null);
    const batch = firestore.batch();
    for (const memberType of DEFAULT_MEMBER_TYPES) {
        const memberTypeRef = firestore.collection(USERS_COLLECTIONS.memberTypes).doc(memberType.id);
        batch.set(memberTypeRef, {
            ...memberType,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
    }
    for (const familyGroup of familyGroups) {
        const familyGroupRef = firestore.collection(USERS_COLLECTIONS.familyGroups).doc(familyGroup.id);
        batch.set(familyGroupRef, {
            code: familyGroup.code,
            holderMemberId: familyGroup.holderMemberId,
            memberIds: familyGroup.memberIds,
            active: true,
            notes: `${IMPORT_MARK}. Grupo familiar reconstruido desde el padron historico.`,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
    }
    for (const member of members) {
        const memberRef = firestore.collection(USERS_COLLECTIONS.members).doc(member.id);
        const notes = [
            `${IMPORT_MARK}.`,
            `Estado legado: ${member.membershipStatusLabel}.`,
            member.feeDeductionLabel ? `Cuota deducida: ${member.feeDeductionLabel}.` : '',
        ]
            .filter(Boolean)
            .join(' ');
        batch.set(memberRef, {
            memberNumber: member.memberNumber,
            firstName: member.firstName,
            lastName: member.lastName,
            aagMembershipNumber: member.aagMembershipNumber,
            typeId: member.typeId,
            typeCodeSnapshot: member.typeId,
            status: 'active',
            familyGroupId: member.familyGroupId,
            isFamilyHolder: member.isFamilyHolder,
            joinedAt: importDate,
            notes,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
        batch.set(firestore.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizeMemberNumber(member.memberNumber)), {
            uid: null,
            memberId: member.id,
            memberNumber: member.memberNumber,
            active: true,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
    }
    if (!DRY_RUN && identifierConflicts.length === 0) {
        await batch.commit();
    }
    console.log(JSON.stringify({
        ok: true,
        projectId: DEFAULT_PROJECT_ID,
        emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
        dryRun: DRY_RUN,
        csvPath: CSV_PATH,
        inputRows: rows.length,
        importableRows: importableRows.length,
        importedMemberTypes: DEFAULT_MEMBER_TYPES.length,
        importedFamilyGroups: DRY_RUN || identifierConflicts.length > 0 ? 0 : familyGroups.length,
        createdMembers: DRY_RUN || identifierConflicts.length > 0 ? 0 : createdMembers,
        updatedMembers: DRY_RUN || identifierConflicts.length > 0 ? 0 : updatedMembers,
        skippedRows: rows.length - importableRows.length,
        duplicateMemberNumbers,
        memberNumberReassignments,
        invalidRows: invalidRows.map(({ index, row }) => ({
            line: index,
            memberNumber: row.memberNumber,
            fullName: row.fullName,
        })),
        identifierConflicts,
    }, null, 2));
}
void run().catch((error) => {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error([
        'No pudimos importar el padron legado a Firestore.',
        `Motivo: ${message}`,
        process.env.FIRESTORE_EMULATOR_HOST
            ? 'Revisa que el emulador de Firestore este disponible.'
            : 'Si quieres importar a produccion, configura credenciales Admin SDK o usa el emulador.',
    ].join(' '));
    process.exitCode = 1;
});
//# sourceMappingURL=import-palpala-members.js.map