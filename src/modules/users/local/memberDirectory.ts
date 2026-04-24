const DIRECTORY_STORAGE_KEY = 'club_member_directory_records';
const DIRECTORY_STORAGE_VERSION_KEY = 'club_member_directory_version';
const DIRECTORY_DATASET_VERSION = 'palpala-members-2026-04-23-v1';
const DIRECTORY_SOURCE_PATH = '/data/palpala-members.csv';

export type ClubMemberTypeId =
  | 'pleno'
  | 'vitalicio'
  | 'menor'
  | 'licencia'
  | 'grupo_familiar_asociado'
  | 'grupo_familiar_titular';

export type ClubMemberRecord = {
  id: string;
  memberNumber: string;
  fullName: string;
  displayName: string;
  firstName: string;
  lastName: string;
  dni?: string | undefined;
  aagMembershipNumber?: string | undefined;
  membershipStatusLabel: string;
  memberTypeId: ClubMemberTypeId;
  memberTypeLabel: string;
  feeDeductionLabel?: string | undefined;
  notes?: string | undefined;
  active: boolean;
  legacyOrder: number;
  familyGroupCode?: string | undefined;
  householdSize: number;
  isFamilyHolder: boolean;
  source: 'legacy-padron' | 'manual';
  createdAt: string;
  updatedAt: string;
};

export type ClubMemberDraft = {
  id?: string;
  memberNumber: string;
  fullName: string;
  dni?: string | undefined;
  aagMembershipNumber?: string | undefined;
  membershipStatusLabel: string;
  memberTypeId: ClubMemberTypeId;
  feeDeductionLabel?: string | undefined;
  notes?: string | undefined;
  active: boolean;
};

type LegacyRosterRow = {
  order: number;
  memberNumber: string;
  fullName: string;
  aagMembershipNumber?: string | undefined;
  membershipStatusLabel: string;
  feeDeductionLabel?: string | undefined;
};

type LegacySplitName = {
  firstName: string;
  lastName: string;
};

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

let directoryPromise: Promise<ClubMemberRecord[]> | null = null;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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

function slugify(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '-');
}

function cleanOptionalValue(value: string): string | undefined {
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.toUpperCase() === 'NO TIENE') {
    return undefined;
  }

  return trimmedValue;
}

function mapMemberType(statusLabel: string): { memberTypeId: ClubMemberTypeId; memberTypeLabel: string } {
  const normalizedStatus = normalizeSearchText(statusLabel);

  if (normalizedStatus.includes('vitalicio')) {
    return { memberTypeId: 'vitalicio', memberTypeLabel: 'Vitalicio' };
  }

  if (normalizedStatus.includes('menor')) {
    return { memberTypeId: 'menor', memberTypeLabel: 'Socio menor' };
  }

  if (normalizedStatus.includes('licencia')) {
    return { memberTypeId: 'licencia', memberTypeLabel: 'Licencia' };
  }

  if (normalizedStatus.includes('esposa')) {
    return {
      memberTypeId: 'grupo_familiar_asociado',
      memberTypeLabel: 'Grupo familiar asociado',
    };
  }

  return { memberTypeId: 'pleno', memberTypeLabel: 'Socio pleno' };
}

function getMemberTypeLabel(memberTypeId: ClubMemberTypeId): string {
  switch (memberTypeId) {
    case 'pleno':
      return 'Socio pleno';
    case 'vitalicio':
      return 'Vitalicio';
    case 'menor':
      return 'Socio menor';
    case 'licencia':
      return 'Licencia';
    case 'grupo_familiar_asociado':
      return 'Grupo familiar asociado';
    case 'grupo_familiar_titular':
      return 'Grupo familiar titular';
    default:
      return 'Socio pleno';
  }
}

function splitLegacyFullName(fullName: string): LegacySplitName {
  const sanitizedValue = fullName.trim().replace(/\s+/g, ' ');
  const tokens = sanitizedValue.split(' ').filter(Boolean);

  if (tokens.length <= 1) {
    return { firstName: '', lastName: toTitleCase(sanitizedValue) };
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

function parseRosterCsv(csvContent: string): LegacyRosterRow[] {
  const [headerLine, ...dataLines] = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!headerLine) {
    return [];
  }

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

function sortMembers(members: ClubMemberRecord[]): ClubMemberRecord[] {
  return [...members].sort((left, right) => {
    const leftNumber = Number(left.memberNumber);
    const rightNumber = Number(right.memberNumber);
    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return left.displayName.localeCompare(right.displayName, 'es-AR');
  });
}

function recomputeFamilyMetadata(members: ClubMemberRecord[]): ClubMemberRecord[] {
  const membersByNumber = members.reduce<Map<string, ClubMemberRecord[]>>((accumulator, member) => {
    const currentMembers = accumulator.get(member.memberNumber) ?? [];
    currentMembers.push(member);
    accumulator.set(member.memberNumber, currentMembers);
    return accumulator;
  }, new Map());

  return sortMembers(
    members.map((member) => {
      const household = membersByNumber.get(member.memberNumber) ?? [member];
      const familyGroupCode = household.length > 1 ? `GF-${member.memberNumber.padStart(4, '0')}` : undefined;
      const holderCandidate =
        household.find(
          (entry) => entry.memberTypeId !== 'grupo_familiar_asociado' && entry.memberTypeId !== 'menor',
        ) ?? household[0];

      return {
        ...member,
        familyGroupCode,
        householdSize: household.length,
        isFamilyHolder: familyGroupCode ? holderCandidate?.id === member.id : false,
      };
    }),
  );
}

function createSeedRecords(rosterRows: LegacyRosterRow[]): ClubMemberRecord[] {
  const now = new Date().toISOString();

  const records = rosterRows.map((row) => {
    const { memberTypeId, memberTypeLabel } = mapMemberType(row.membershipStatusLabel);
    const parsedName = splitLegacyFullName(row.fullName);
    const displayName = toTitleCase(row.fullName);

    return {
      id: `legacy-${row.memberNumber}-${row.order}-${slugify(row.fullName)}`,
      memberNumber: row.memberNumber,
      fullName: row.fullName.trim(),
      displayName,
      firstName: parsedName.firstName || displayName,
      lastName: parsedName.lastName || displayName,
      aagMembershipNumber: row.aagMembershipNumber,
      membershipStatusLabel: row.membershipStatusLabel,
      memberTypeId,
      memberTypeLabel,
      feeDeductionLabel: row.feeDeductionLabel,
      active: true,
      legacyOrder: row.order,
      householdSize: 1,
      isFamilyHolder: false,
      source: 'legacy-padron' as const,
      createdAt: now,
      updatedAt: now,
    };
  });

  return recomputeFamilyMetadata(records);
}

function readStoredDirectory(): ClubMemberRecord[] | null {
  if (!canUseStorage()) {
    return null;
  }

  const version = window.localStorage.getItem(DIRECTORY_STORAGE_VERSION_KEY);
  if (version !== DIRECTORY_DATASET_VERSION) {
    return null;
  }

  const rawValue = window.localStorage.getItem(DIRECTORY_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as ClubMemberRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }

    return recomputeFamilyMetadata(parsed);
  } catch (error) {
    console.error('No pudimos leer el padron local de socios.', error);
    return null;
  }
}

function persistDirectory(records: ClubMemberRecord[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(DIRECTORY_STORAGE_VERSION_KEY, DIRECTORY_DATASET_VERSION);
  window.localStorage.setItem(DIRECTORY_STORAGE_KEY, JSON.stringify(records));
}

async function seedDirectoryFromSource(): Promise<ClubMemberRecord[]> {
  const response = await fetch(DIRECTORY_SOURCE_PATH, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('No se pudo cargar el padron base de socios.');
  }

  const csvContent = await response.text();
  const records = createSeedRecords(parseRosterCsv(csvContent));
  persistDirectory(records);
  return records;
}

async function ensureDirectory(): Promise<ClubMemberRecord[]> {
  const storedDirectory = readStoredDirectory();
  if (storedDirectory) {
    return storedDirectory;
  }

  return seedDirectoryFromSource();
}

export async function getClubMembers(): Promise<ClubMemberRecord[]> {
  if (!directoryPromise) {
    directoryPromise = ensureDirectory();
  }

  return directoryPromise;
}

export async function getClubMemberById(memberId: string): Promise<ClubMemberRecord | null> {
  const members = await getClubMembers();
  return members.find((member) => member.id === memberId) ?? null;
}

export async function getClubMemberHousehold(memberId: string): Promise<ClubMemberRecord[]> {
  const member = await getClubMemberById(memberId);
  if (!member) {
    return [];
  }

  const members = await getClubMembers();
  return members.filter((entry) => entry.memberNumber === member.memberNumber);
}

export async function saveClubMember(draft: ClubMemberDraft): Promise<ClubMemberRecord> {
  const currentMembers = await getClubMembers();
  const now = new Date().toISOString();
  const parsedName = splitLegacyFullName(draft.fullName);
  const displayName = toTitleCase(draft.fullName);

  const nextRecord: ClubMemberRecord = {
    id:
      draft.id ??
      `manual-${draft.memberNumber}-${Date.now().toString(36)}-${slugify(draft.fullName)}`,
    memberNumber: draft.memberNumber.trim(),
    fullName: draft.fullName.trim(),
    displayName,
    firstName: parsedName.firstName || displayName,
    lastName: parsedName.lastName || displayName,
    dni: cleanOptionalValue(draft.dni ?? ''),
    aagMembershipNumber: cleanOptionalValue(draft.aagMembershipNumber ?? ''),
    membershipStatusLabel: draft.membershipStatusLabel.trim(),
    memberTypeId: draft.memberTypeId,
    memberTypeLabel: getMemberTypeLabel(draft.memberTypeId),
    feeDeductionLabel: cleanOptionalValue(draft.feeDeductionLabel ?? ''),
    notes: cleanOptionalValue(draft.notes ?? ''),
    active: draft.active,
    legacyOrder:
      draft.id
        ? currentMembers.find((member) => member.id === draft.id)?.legacyOrder ?? currentMembers.length + 1
        : currentMembers.length + 1,
    householdSize: 1,
    isFamilyHolder: false,
    source: draft.id ? currentMembers.find((member) => member.id === draft.id)?.source ?? 'manual' : 'manual',
    createdAt: draft.id ? currentMembers.find((member) => member.id === draft.id)?.createdAt ?? now : now,
    updatedAt: now,
  };

  const nextMembers = recomputeFamilyMetadata(
    draft.id
      ? currentMembers.map((member) => (member.id === draft.id ? nextRecord : member))
      : [...currentMembers, nextRecord],
  );

  persistDirectory(nextMembers);
  directoryPromise = Promise.resolve(nextMembers);
  return nextMembers.find((member) => member.id === nextRecord.id) ?? nextRecord;
}

export async function setClubMemberActive(memberId: string, active: boolean): Promise<ClubMemberRecord | null> {
  const currentMembers = await getClubMembers();
  const nextMembers = recomputeFamilyMetadata(
    currentMembers.map((member) =>
      member.id === memberId
        ? {
            ...member,
            active,
            updatedAt: new Date().toISOString(),
          }
        : member,
    ),
  );

  persistDirectory(nextMembers);
  directoryPromise = Promise.resolve(nextMembers);
  return nextMembers.find((member) => member.id === memberId) ?? null;
}

export async function resetClubMemberDirectory(): Promise<ClubMemberRecord[]> {
  const records = await seedDirectoryFromSource();
  directoryPromise = Promise.resolve(records);
  return records;
}

export function matchesClubMemberSearch(member: ClubMemberRecord, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const searchTerms = normalizedQuery.split(' ').filter(Boolean);
  const searchableText = normalizeSearchText(
    [
      member.id,
      member.memberNumber,
      member.fullName,
      member.displayName,
      member.firstName,
      member.lastName,
      member.dni ?? '',
      member.aagMembershipNumber ?? '',
      member.membershipStatusLabel,
      member.memberTypeLabel,
      member.feeDeductionLabel ?? '',
    ].join(' '),
  );

  return searchTerms.every((term) => searchableText.includes(term));
}
