import { normalizeMemberNumber } from '../../../auth/member-number-auth.js';

export interface NextMemberNumberResult {
  nextNumericId: number;
  nextMemberNumber: string;
  normalizedNextMemberNumber: string;
  highestNumericId: number | null;
  highestMemberNumber: string | null;
  inspectedCount: number;
  numericCount: number;
}

type ParsedMemberNumber = {
  raw: string;
  numericId: number;
  width: number;
};

function parseNumericMemberNumber(value: string): ParsedMemberNumber | null {
  const raw = value.trim().replace(/\s+/g, '');

  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const numericId = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(numericId) || numericId < 0) {
    return null;
  }

  return {
    raw,
    numericId,
    width: raw.length,
  };
}

export function getNextMemberNumberFromExisting(memberNumbers: readonly string[]): NextMemberNumberResult {
  const parsedNumbers = memberNumbers
    .map((memberNumber) => parseNumericMemberNumber(memberNumber))
    .filter((memberNumber): memberNumber is ParsedMemberNumber => memberNumber !== null);
  const highest = parsedNumbers.reduce<ParsedMemberNumber | null>((currentHighest, memberNumber) => {
    if (!currentHighest || memberNumber.numericId > currentHighest.numericId) {
      return memberNumber;
    }

    return currentHighest;
  }, null);
  const nextNumericId = (highest?.numericId ?? 0) + 1;
  const nextMemberNumber = String(nextNumericId).padStart(
    Math.max(String(nextNumericId).length, highest?.width ?? 0),
    '0',
  );

  return {
    nextNumericId,
    nextMemberNumber,
    normalizedNextMemberNumber: normalizeMemberNumber(nextMemberNumber),
    highestNumericId: highest?.numericId ?? null,
    highestMemberNumber: highest?.raw ?? null,
    inspectedCount: memberNumbers.length,
    numericCount: parsedNumbers.length,
  };
}

