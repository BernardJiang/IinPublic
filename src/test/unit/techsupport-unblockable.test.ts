import {
  assertBlockTargetAllowed,
  canBlockTarget,
  isTechSupportId,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_UNBLOCKABLE_ERROR,
} from '../../shared/techsupport';
import { filterIncomingMessage, filterOutgoingMessage } from '../../shared/message-content-filter';
import type { TalkIntakeFilters } from '../../shared/types';

/**
 * docs/TODO.md K6 — TechSupport can never be blocked, muted into silence, or filtered out.
 * The support channel is the only recourse a stuck user has.
 */

const strictFilters = {
  blockDirtyWords: true,
  requireGoodGrammar: true,
  dirtyWords: ['fuck'],
} as Pick<TalkIntakeFilters, 'blockDirtyWords' | 'requireGoodGrammar' | 'dirtyWords'>;

describe('isTechSupportId', () => {
  it('matches only the canonical root id', () => {
    expect(isTechSupportId(TECHSUPPORT_ROOT_USER_ID)).toBe(true);
    expect(isTechSupportId('user-123')).toBe(false);
  });

  it('is safe on null/undefined/empty', () => {
    expect(isTechSupportId(null)).toBe(false);
    expect(isTechSupportId(undefined)).toBe(false);
    expect(isTechSupportId('')).toBe(false);
  });

  it('does not match a lookalike id', () => {
    expect(isTechSupportId(`${TECHSUPPORT_ROOT_USER_ID}-copy`)).toBe(false);
    expect(isTechSupportId(TECHSUPPORT_ROOT_USER_ID.toUpperCase())).toBe(false);
  });
});

describe('canBlockTarget / assertBlockTargetAllowed', () => {
  it('refuses the TechSupport root', () => {
    expect(canBlockTarget(TECHSUPPORT_ROOT_USER_ID)).toBe(false);
    expect(() => assertBlockTargetAllowed(TECHSUPPORT_ROOT_USER_ID)).toThrow(
      TECHSUPPORT_UNBLOCKABLE_ERROR,
    );
  });

  it('allows ordinary peers', () => {
    expect(canBlockTarget('user-123')).toBe(true);
    expect(() => assertBlockTargetAllowed('user-123')).not.toThrow();
  });
});

describe('filterIncomingMessage — TechSupport exemption', () => {
  it('renders a TechSupport message that would otherwise trip the dirty-word filter', () => {
    const verdict = filterIncomingMessage('what the fuck', strictFilters, {
      senderId: TECHSUPPORT_ROOT_USER_ID,
    });
    expect(verdict.passed).toBe(true);
  });

  it('renders a TechSupport message that would otherwise trip the grammar filter', () => {
    const verdict = filterIncomingMessage('asdf qwer zxcv', strictFilters, {
      senderId: TECHSUPPORT_ROOT_USER_ID,
    });
    expect(verdict.passed).toBe(true);
  });

  it('still filters the same text from an ordinary peer', () => {
    const verdict = filterIncomingMessage('what the fuck', strictFilters, { senderId: 'user-123' });
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toBe('dirty_words');
  });

  it('keeps previous behaviour when senderId is omitted', () => {
    expect(filterIncomingMessage('what the fuck', strictFilters).passed).toBe(false);
  });

  it('does not exempt the outgoing path — a user writing to TechSupport is still filtered', () => {
    expect(filterOutgoingMessage('what the fuck', strictFilters).passed).toBe(false);
  });
});
