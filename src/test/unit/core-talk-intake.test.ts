/** OPEN-91 P4: the receiving side's rule for an incoming Talk, as the core makes it. */
import { decideIncomingTalk, talkExpiresAtMs, type IntakeContext, type IntakeLookups } from '../../core/talk-intake';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import type { TalkIntakeFilters } from '../../shared/types';

const filters: TalkIntakeFilters = { allowedLanguages: [], requireGoodGrammar: false, blockDirtyWords: false, allowedTalkTypes: ['flow', 'survey', 'tag', 'route'] };
const talk = { title: 'Tennis', type: 'tag', language: 'en', questions: [{ id: 'q1', text: 'Tennis?', answers: [] }] };

function context(overrides: Partial<IntakeContext> = {}): IntakeContext {
  return { myId: 'me', filters, knownPeople: [], currentChatroomId: 'nearby-v3', now: Date.parse('2026-10-26T10:00:00Z'), ...overrides };
}
function lookups(overrides: Partial<IntakeLookups> = {}): IntakeLookups & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isBlockedEitherWay: async () => { calls.push('blocked'); return false; },
    ageVerified: async () => { calls.push('age'); return true; },
    isRoomMember: async () => { calls.push('member'); return true; },
    ...overrides,
  };
}

describe('decideIncomingTalk', () => {
  it('takes a broadcast in my room without asking who is in the room or my age', async () => {
    const l = lookups();
    expect(await decideIncomingTalk({ senderId: 'bob', talkData: talk, deliveryChatroomId: 'nearby-v3' }, context(), l)).toEqual({ accept: true });
    expect(l.calls).toEqual(['blocked']);
  });

  it('refuses in rule order: myself, TechSupport, blocked, contact policy, other room, not a member', async () => {
    expect(await decideIncomingTalk({ senderId: 'me', talkData: talk }, context(), lookups())).toMatchObject({ reason: 'self' });
    expect(await decideIncomingTalk({ senderId: 'bob', talkData: talk }, context({ myId: TECHSUPPORT_ROOT_USER_ID }), lookups())).toMatchObject({ reason: 'no-talks' });
    expect(await decideIncomingTalk({ senderId: 'bob', talkData: talk }, context(), lookups({ isBlockedEitherWay: async () => true }))).toMatchObject({ reason: 'blocked' });
    expect(await decideIncomingTalk({ senderId: 'bob', talkData: talk }, context({ filters: { ...filters, contactsOnlyTalks: true } }), lookups())).toMatchObject({ reason: 'contact-policy' });
    expect(await decideIncomingTalk({ senderId: 'bob', talkData: talk, deliveryChatroomId: 'place_x' }, context(), lookups())).toMatchObject({ reason: 'other-room' });
    expect(await decideIncomingTalk({ senderId: 'bob', talkData: talk }, context(), lookups({ isRoomMember: async () => false }))).toMatchObject({ reason: 'not-in-room' });
  });

  it('a direct send skips the room; a contact passes contacts-only', async () => {
    const l = lookups({ isRoomMember: async () => false });
    expect(await decideIncomingTalk({ senderId: 'bob', talkData: talk, directPeerSend: true }, context({ filters: { ...filters, contactsOnlyTalks: true }, knownPeople: [{ userId: 'bob' }] }), l)).toEqual({ accept: true });
  });

  it('asks for age verification only for an adult Talk, and refuses it when not verified', async () => {
    const l = lookups({ ageVerified: async () => false });
    expect(await decideIncomingTalk({ senderId: 'bob', talkData: { ...talk, isAdult: true }, deliveryChatroomId: 'nearby-v3' }, context(), l))
      .toMatchObject({ accept: false, reason: 'filters', filterReasons: ['age_gate'] });
  });

  it('reads expiry from the Talk or a seed’s nested fullTalk', () => {
    expect(talkExpiresAtMs({ expiresAt: 5 })).toBe(5);
    expect(talkExpiresAtMs({ fullTalk: { expiresAt: '2026-10-26T10:00:00Z' } })).toBe(Date.parse('2026-10-26T10:00:00Z'));
    expect(talkExpiresAtMs({})).toBeNaN();
  });
});
