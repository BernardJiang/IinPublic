import {
  filterIncomingTalkClustersByContactPolicy,
  filterTalkPeersByContactPolicy,
  talkContactPolicyAllowsPeer,
} from '../../shared/talk-contact-policy';

const contacts = [{ userId: 'contact-1' }, { userId: 'contact-2' }];

describe('contacts-only Talk policy', () => {
  it('keeps stranger Talk exchange enabled by default for existing accounts', () => {
    expect(talkContactPolicyAllowsPeer('stranger', undefined, undefined)).toBe(true);
    expect(talkContactPolicyAllowsPeer('stranger', {}, contacts)).toBe(true);
  });

  it('allows only exact contact identities when enabled', () => {
    const filters = { contactsOnlyTalks: true };

    expect(talkContactPolicyAllowsPeer('contact-1', filters, contacts)).toBe(true);
    expect(talkContactPolicyAllowsPeer('stranger', filters, contacts)).toBe(false);
    expect(talkContactPolicyAllowsPeer('', filters, contacts)).toBe(false);
  });

  it('fails closed while contacts are unavailable and filters outgoing recipients', () => {
    const filters = { contactsOnlyTalks: true };

    expect(talkContactPolicyAllowsPeer('contact-1', filters, undefined)).toBe(false);
    expect(
      filterTalkPeersByContactPolicy(
        ['stranger-1', 'contact-2', 'contact-1', 'stranger-2'],
        filters,
        contacts,
      ),
    ).toEqual(['contact-2', 'contact-1']);
  });

  it('hides cached stranger offers and keeps the contact copy of a mixed cluster', () => {
    const contactOnly = { contactsOnlyTalks: true };
    const strangerOnly = {
      identityKey: 'stranger-only',
      latestTalkId: 'talk-stranger',
      senders: {
        stranger: { senderId: 'stranger', lastTalkId: 'talk-stranger' },
      },
      talkIds: { 'talk-stranger': '2026-10-01' },
    };
    const mixed = {
      identityKey: 'mixed',
      latestTalkId: 'talk-stranger-newer',
      senders: {
        stranger: {
          senderId: 'stranger',
          lastTalkId: 'talk-stranger-newer',
          lastReceivedAt: '2026-10-02',
        },
        contact: {
          senderId: 'contact-1',
          lastTalkId: 'talk-contact',
          lastReceivedAt: '2026-10-01',
        },
      },
      talkIds: {
        'talk-stranger-newer': '2026-10-02',
        'talk-contact': '2026-10-01',
      },
    };

    expect(
      filterIncomingTalkClustersByContactPolicy(
        [strangerOnly, mixed],
        contactOnly,
        contacts,
      ),
    ).toEqual([
      expect.objectContaining({
        identityKey: 'mixed',
        latestTalkId: 'talk-contact',
        senders: {
          contact: expect.objectContaining({ senderId: 'contact-1' }),
        },
        talkIds: { 'talk-contact': '2026-10-01' },
      }),
    ]);
  });
});
