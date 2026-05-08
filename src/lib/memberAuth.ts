export const MEMBER_NUMBER_WIDTH = 6;
export const SYNTHETIC_AUTH_EMAIL_DOMAIN = 'club-auth.local';

export function normalizeMemberNumber(value: string): string {
  const compactValue = value.trim().replace(/\s+/g, '');

  if (/^\d+$/.test(compactValue)) {
    return compactValue.padStart(MEMBER_NUMBER_WIDTH, '0');
  }

  return compactValue.toLowerCase();
}

export function buildSyntheticAuthEmail(memberNumber: string): string {
  return `socio-${normalizeMemberNumber(memberNumber)}@${SYNTHETIC_AUTH_EMAIL_DOMAIN}`;
}
