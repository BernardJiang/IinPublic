/**
 * Unit tests for FR-CR-11 (content-addressed community IDs) and
 * FR-CR-12 (community ownership and roles).
 *
 * Spec: SRS v4.5 §3.3
 */
import {
  deriveCommunityId,
  getRoleCapabilities,
  canAssignRole,
  chatroomRolePath,
} from '../../shared/chatroom-hierarchy';
import type { CommunityRole } from '../../shared/types';

// ─── FR-CR-11: deriveCommunityId ─────────────────────────────────────────────

describe('deriveCommunityId (FR-CR-11)', () => {
  const pub = 'abc123pub';
  const label = 'My Room';

  it('returns a non-empty string', () => {
    expect(deriveCommunityId(pub, label)).toBeTruthy();
  });

  it('is deterministic — same inputs always produce the same ID', () => {
    const id1 = deriveCommunityId(pub, label);
    const id2 = deriveCommunityId(pub, label);
    expect(id1).toBe(id2);
  });

  it('normalises label (trim + lower-case) before hashing', () => {
    const id1 = deriveCommunityId(pub, '  My Room  ');
    const id2 = deriveCommunityId(pub, 'my room');
    expect(id1).toBe(id2);
  });

  it('different labels → different IDs', () => {
    const id1 = deriveCommunityId(pub, 'room-a');
    const id2 = deriveCommunityId(pub, 'room-b');
    expect(id1).not.toBe(id2);
  });

  it('different ownerPub → different IDs', () => {
    const id1 = deriveCommunityId('pubA', label);
    const id2 = deriveCommunityId('pubB', label);
    expect(id1).not.toBe(id2);
  });

  it('starts with "b" (multibase prefix)', () => {
    // computeCIDv1Sync returns a 'b'-prefixed string (sync uses bsync<hex>)
    expect(deriveCommunityId(pub, label)).toMatch(/^b/);
  });
});

// ─── FR-CR-12: role capabilities ─────────────────────────────────────────────

describe('getRoleCapabilities (FR-CR-12)', () => {
  it('owner has all capabilities', () => {
    const caps = getRoleCapabilities('owner');
    expect(caps.canPost).toBe(true);
    expect(caps.canBroadcast).toBe(true);
    expect(caps.canManageMembers).toBe(true);
    expect(caps.canManageModerators).toBe(true);
    expect(caps.canManageRoom).toBe(true);
  });

  it('moderator can post, broadcast, and manage members but not moderators or room', () => {
    const caps = getRoleCapabilities('moderator');
    expect(caps.canPost).toBe(true);
    expect(caps.canBroadcast).toBe(true);
    expect(caps.canManageMembers).toBe(true);
    expect(caps.canManageModerators).toBe(false);
    expect(caps.canManageRoom).toBe(false);
  });

  it('member can post and broadcast but cannot manage anyone', () => {
    const caps = getRoleCapabilities('member');
    expect(caps.canPost).toBe(true);
    expect(caps.canBroadcast).toBe(true);
    expect(caps.canManageMembers).toBe(false);
    expect(caps.canManageModerators).toBe(false);
    expect(caps.canManageRoom).toBe(false);
  });

  it('guest can post but cannot broadcast (FR-CR-12 default)', () => {
    const caps = getRoleCapabilities('guest');
    expect(caps.canPost).toBe(true);
    expect(caps.canBroadcast).toBe(false);
    expect(caps.canManageMembers).toBe(false);
    expect(caps.canManageModerators).toBe(false);
    expect(caps.canManageRoom).toBe(false);
  });
});

// ─── FR-CR-12: canAssignRole ─────────────────────────────────────────────────

describe('canAssignRole (FR-CR-12)', () => {
  const roles: CommunityRole[] = ['owner', 'moderator', 'member', 'guest'];

  it('owner may assign any role', () => {
    roles.forEach(target => {
      expect(canAssignRole('owner', target)).toBe(true);
    });
  });

  it('moderator may assign member or guest only', () => {
    expect(canAssignRole('moderator', 'member')).toBe(true);
    expect(canAssignRole('moderator', 'guest')).toBe(true);
    expect(canAssignRole('moderator', 'moderator')).toBe(false);
    expect(canAssignRole('moderator', 'owner')).toBe(false);
  });

  it('member cannot assign any role', () => {
    roles.forEach(target => {
      expect(canAssignRole('member', target)).toBe(false);
    });
  });

  it('guest cannot assign any role', () => {
    roles.forEach(target => {
      expect(canAssignRole('guest', target)).toBe(false);
    });
  });
});

// ─── chatroomRolePath ─────────────────────────────────────────────────────────

describe('chatroomRolePath', () => {
  it('produces the expected Gun path', () => {
    expect(chatroomRolePath('room-1', 'user-abc')).toBe('chatroomRoles/room-1/user-abc');
  });
});
