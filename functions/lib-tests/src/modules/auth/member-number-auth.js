export const MEMBER_NUMBER_WIDTH = 6;
export const SYNTHETIC_AUTH_EMAIL_DOMAIN = 'club-auth.local';
export const DEFAULT_TEMPORARY_PASSWORD = 'password';
export function normalizeMemberNumber(value) {
    const compactValue = value.trim().replace(/\s+/g, '');
    if (/^\d+$/.test(compactValue)) {
        return compactValue.padStart(MEMBER_NUMBER_WIDTH, '0');
    }
    return compactValue.toLowerCase();
}
export function buildSyntheticAuthEmail(memberNumber) {
    return `socio-${normalizeMemberNumber(memberNumber)}@${SYNTHETIC_AUTH_EMAIL_DOMAIN}`;
}
export function generateMemberTemporaryPassword(_memberNumber, generatedAt = new Date(), _token) {
    return {
        temporaryPassword: DEFAULT_TEMPORARY_PASSWORD,
        passwordGeneratedAt: generatedAt.toISOString(),
    };
}
//# sourceMappingURL=member-number-auth.js.map