import { createHash } from 'node:crypto';

export const MEMBER_NUMBER_WIDTH = 6;
export const SYNTHETIC_AUTH_EMAIL_DOMAIN = 'club-auth.local';

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

function padDatePart(value: number): string {
  return value.toString().padStart(2, '0');
}

function buildPasswordTimestamp(date: Date): string {
  return [
    date.getUTCFullYear().toString(),
    padDatePart(date.getUTCMonth() + 1),
    padDatePart(date.getUTCDate()),
    padDatePart(date.getUTCHours()),
    padDatePart(date.getUTCMinutes()),
    padDatePart(date.getUTCSeconds()),
  ].join('');
}

function getTemporaryPasswordSecret(): string {
  return (
    process.env.MEMBER_TEMP_PASSWORD_HASH_SECRET ??
    process.env.DEFAULT_MEMBER_PASSWORD_HASH_SECRET ??
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    'club-dev-local-secret'
  );
}

export function generateMemberTemporaryPassword(
  memberNumber: string,
  generatedAt = new Date(),
): GeneratedMemberTemporaryPassword {
  const normalizedMemberNumber = normalizeMemberNumber(memberNumber);
  const timestamp = buildPasswordTimestamp(generatedAt);
  const digest = createHash('sha256')
    .update(`${normalizedMemberNumber}:${timestamp}:${getTemporaryPasswordSecret()}`, 'utf8')
    .digest('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 10)
    .toUpperCase();

  return {
    temporaryPassword: `CGP-${normalizedMemberNumber}-${digest}`,
    passwordGeneratedAt: generatedAt.toISOString(),
  };
}
