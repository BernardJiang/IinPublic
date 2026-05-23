import {
  assertStageNameAllowed,
  isReservedStageName,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../shared/techsupport';

describe('reserved stage names', () => {
  it.each([
    'TechSupport',
    'tech_support',
    'Tech Support',
    'ROOT',
    'admin',
    'administrator',
    'system',
    'support',
    'api',
    'www',
  ])('rejects ordinary claim to %s', (stageName) => {
    expect(isReservedStageName(stageName)).toBe(true);
    expect(() => assertStageNameAllowed(stageName)).toThrow(/reserved/i);
  });

  it('allows only the canonical root flow to retain the TechSupport name', () => {
    expect(TECHSUPPORT_ROOT_USER_ID).toBeTruthy();
    expect(() => assertStageNameAllowed(TECHSUPPORT_STAGE_NAME, { allowTechSupportRoot: true })).not.toThrow();
    expect(() => assertStageNameAllowed('admin', { allowTechSupportRoot: true })).toThrow(/reserved/i);
  });
});
