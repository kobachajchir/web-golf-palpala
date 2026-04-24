import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DEFAULT_MEMBER_TYPES,
  MEMBER_TYPE_IDS,
  SYSTEM_ACTOR_UID,
  USERS_COLLECTIONS,
} from '../modules/users/domain/constants.js';

type LegacyRosterRow = {
  order: number;
  memberNumber: string;
  fullName: string;
  aagMembershipNumber?: string | undefined;
  membershipStatusLabel: string;
  feeDeductionLabel?: string | undefined;
};

type ImportedMemberSeed = {
  id: string;
  memberNumber: string;
  firstName: string;
  lastName: string;
  aagMembershipNumber?: string | undefined;
  membershipStatusLabel: string;
  feeDeductionLabel?: string | undefined;
  typeId: string;
  familyGroupId?: string | undefined;
  isFamilyHolder: boolean;
};

type FamilyGroupSeed = {
  id: string;
  code: string;
  holderMemberId: string;
  memberIds: string[];
};

const IMPORT_MARK = 'Padron legado Palpala Golf Tenis Club';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-web-golf-palpala';
const CSV_PATH = resolve(
  process.env.PALPALA_MEMBERS_CSV ?? resolve(process.cwd(), '..', 'public', 'data', 'palpala-members.csv'),
);

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
  'FRANCILE',
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
    } else {
      initializeApp({ projectId: DEFAULT_PROJECT_ID });
    }
  }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '-');
}

function cleanOptionalValue(value: string | undefined): string | undefined {
  const normalizedValue = (value ?? '').trim();
  if (!normalizedValue || normalizedValue.toUpperCase() === 'NO TIENE') {
    return undefined;
  }

  return normalizedValue;
}

function toTitleCase(value: string): string {
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

function splitLegacyFullName(fullName: string): { firstName: string; lastName: string } {
  const sanitizedValue = fullName.trim().replace(/\s+/g, ' ');
  const tokens = sanitizedValue.split(' ').filter(Boolean);

  if (tokens.length <= 1) {
    return {
      firstName: '',
      lastName: toTitleCase(sanitizedValue),
    };
  }

  const givenNameTokens: string[] = [tokens[tokens.length - 1] ?? ''];

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

function mapMemberType(statusLabel: string): string {
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

function parseRosterCsv(csvContent: string): LegacyRosterRow[] {
  const [, ...dataLines] = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return dataLines.map((line) => {
    const [
      order = '',
      memberNumber = '',
      fullName = '',
      aagMembershipNumber = '',
      membershipStatusLabel = '',
      feeDeductionLabel = '',
    ] =
      line.split(';');

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

function createMemberId(row: LegacyRosterRow): string {
  return `legacy-${row.memberNumber}-${row.order}-${slugify(row.fullName)}`;
}

function createFamilyGroupId(memberNumber: string): string {
  return `legacy-family-${memberNumber.padStart(4, '0')}`;
}

function buildImportSeeds(rows: LegacyRosterRow[]): {
  members: ImportedMemberSeed[];
  familyGroups: FamilyGroupSeed[];
} {
  const members = rows.map<ImportedMemberSeed>((row) => {
    const parsedName = splitLegacyFullName(row.fullName);

    return {
      id: createMemberId(row),
      memberNumber: row.memberNumber,
      firstName: parsedName.firstName || toTitleCase(row.fullName),
      lastName: parsedName.lastName || toTitleCase(row.fullName),
      aagMembershipNumber: row.aagMembershipNumber,
      membershipStatusLabel: row.membershipStatusLabel,
      feeDeductionLabel: row.feeDeductionLabel,
      typeId: mapMemberType(row.membershipStatusLabel),
      isFamilyHolder: false,
    };
  });

  const membersByNumber = members.reduce<Map<string, ImportedMemberSeed[]>>((accumulator, member) => {
    const currentMembers = accumulator.get(member.memberNumber) ?? [];
    currentMembers.push(member);
    accumulator.set(member.memberNumber, currentMembers);
    return accumulator;
  }, new Map());

  const familyGroups: FamilyGroupSeed[] = [];

  for (const [memberNumber, groupedMembers] of membersByNumber.entries()) {
    if (groupedMembers.length < 2) {
      continue;
    }

    const holder =
      groupedMembers.find(
        (member) =>
          member.typeId !== MEMBER_TYPE_IDS.grupoFamiliarAsociado &&
          member.typeId !== MEMBER_TYPE_IDS.menor &&
          member.typeId !== MEMBER_TYPE_IDS.licencia,
      ) ?? groupedMembers[0]!;

    const familyGroupId = createFamilyGroupId(memberNumber);

    familyGroups.push({
      id: familyGroupId,
      code: `GF-${memberNumber.padStart(4, '0')}`,
      holderMemberId: holder.id,
      memberIds: groupedMembers.map((member) => member.id),
    });

    for (const groupedMember of groupedMembers) {
      groupedMember.familyGroupId = familyGroupId;
      groupedMember.isFamilyHolder = groupedMember.id === holder.id;
    }
  }

  return { members, familyGroups };
}

async function readRoster(): Promise<LegacyRosterRow[]> {
  const csvContent = await readFile(CSV_PATH, 'utf8');
  return parseRosterCsv(csvContent);
}

async function run() {
  ensureAdminApp();

  const firestore = getFirestore();
  firestore.settings({ ignoreUndefinedProperties: true });
  const importDate = new Date('2026-04-23T12:00:00-03:00');
  const { members, familyGroups } = buildImportSeeds(await readRoster());

  const batch = firestore.batch();

  for (const memberType of DEFAULT_MEMBER_TYPES) {
    const memberTypeRef = firestore.collection(USERS_COLLECTIONS.memberTypes).doc(memberType.id);
    batch.set(
      memberTypeRef,
      {
        ...memberType,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );
  }

  for (const familyGroup of familyGroups) {
    const familyGroupRef = firestore.collection(USERS_COLLECTIONS.familyGroups).doc(familyGroup.id);
    batch.set(
      familyGroupRef,
      {
        code: familyGroup.code,
        holderMemberId: familyGroup.holderMemberId,
        memberIds: familyGroup.memberIds,
        active: true,
        notes: `${IMPORT_MARK}. Grupo familiar reconstruido desde el padron historico.`,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );
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

    batch.set(
      memberRef,
      {
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
      },
      { merge: true },
    );
  }

  await batch.commit();

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId: DEFAULT_PROJECT_ID,
        emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
        csvPath: CSV_PATH,
        importedMemberTypes: DEFAULT_MEMBER_TYPES.length,
        importedFamilyGroups: familyGroups.length,
        importedMembers: members.length,
      },
      null,
      2,
    ),
  );
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error desconocido';

  console.error(
    [
      'No pudimos importar el padron legado a Firestore.',
      `Motivo: ${message}`,
      process.env.FIRESTORE_EMULATOR_HOST
        ? 'Revisa que el emulador de Firestore este disponible.'
        : 'Si quieres importar a produccion, configura credenciales Admin SDK o usa el emulador.',
    ].join(' '),
  );

  process.exitCode = 1;
});
