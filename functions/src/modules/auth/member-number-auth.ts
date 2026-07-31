export const MEMBER_NUMBER_WIDTH = 6;
export const SYNTHETIC_AUTH_EMAIL_DOMAIN = 'club-auth.local';
export const DEFAULT_TEMPORARY_PASSWORD = 'password';

export type GeneratedMemberTemporaryPassword = {
  temporaryPassword: string;
  passwordGeneratedAt: string;
};

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

export function generateMemberTemporaryPassword(
  _memberNumber: string,
  generatedAt = new Date(),
  _token?: string,
): GeneratedMemberTemporaryPassword {
  return {
    temporaryPassword: DEFAULT_TEMPORARY_PASSWORD,
    passwordGeneratedAt: generatedAt.toISOString(),
  };
}
