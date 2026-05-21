import type { User } from './types';

export const TECHSUPPORT_STAGE_NAME = 'TechSupport';
export const TECHSUPPORT_ROOT_USER_ID = 'iinpublic-root-techsupport';
export const TECHSUPPORT_NETWORK_ROLE = 'root-techsupport';
export const TECHSUPPORT_HEADSHOT = 'TS';

export const RESERVED_STAGE_NAMES = [
  TECHSUPPORT_STAGE_NAME,
  'admin',
  'administrator',
  'api',
  'root',
  'system',
  'support',
  'www',
] as const;

export function normalizeReservedStageName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s._-]+/g, '');
}

const RESERVED_NORMALIZED = new Set(RESERVED_STAGE_NAMES.map(normalizeReservedStageName));

export function isReservedStageName(stageName: string): boolean {
  return RESERVED_NORMALIZED.has(normalizeReservedStageName(stageName));
}

export function isTechSupportUser(user: Pick<User, 'id' | 'stageName'> | undefined | null): boolean {
  if (!user) return false;
  return user.id === TECHSUPPORT_ROOT_USER_ID || normalizeReservedStageName(user.stageName) === normalizeReservedStageName(TECHSUPPORT_STAGE_NAME);
}

export function assertStageNameAllowed(stageName: string, options?: { allowTechSupportRoot?: boolean }): void {
  if (options?.allowTechSupportRoot && normalizeReservedStageName(stageName) === normalizeReservedStageName(TECHSUPPORT_STAGE_NAME)) {
    return;
  }
  if (isReservedStageName(stageName)) {
    throw new Error(`Stage name "${stageName}" is reserved.`);
  }
}

