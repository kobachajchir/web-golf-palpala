import { normalizeMemberNumber } from '../../../auth/member-number-auth.js';
function parseNumericMemberNumber(value) {
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
export function getNextMemberNumberFromExisting(memberNumbers) {
    const parsedNumbers = memberNumbers
        .map((memberNumber) => parseNumericMemberNumber(memberNumber))
        .filter((memberNumber) => memberNumber !== null);
    const highest = parsedNumbers.reduce((currentHighest, memberNumber) => {
        if (!currentHighest || memberNumber.numericId > currentHighest.numericId) {
            return memberNumber;
        }
        return currentHighest;
    }, null);
    const nextNumericId = (highest?.numericId ?? 0) + 1;
    const nextMemberNumber = String(nextNumericId).padStart(Math.max(String(nextNumericId).length, highest?.width ?? 0), '0');
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
//# sourceMappingURL=member-number.use-cases.js.map