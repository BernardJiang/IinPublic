import { broadcastableTalkIds, receiversExcludingAuthor, sendableTalkIds } from '../../core/broadcast-selection';

describe('Talk selection for automatic exchange vs a contact-group send (OPEN-112)', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const myTalks = {
    pub: { role: 'created' },
    priv: { role: 'created', disabled: true },
    copied: { role: 'copied' },
    expired: { role: 'created', expiresAt: now - 1 },
    answered: { role: 'answered' },
  };

  it('automatic exchange takes only public, unexpired Talks I created or copied', () => {
    expect(broadcastableTalkIds(myTalks, now).sort()).toEqual(['copied', 'pub']);
  });

  it('a contact-group send may also take private Talks, never expired or answered ones', () => {
    expect(sendableTalkIds(myTalks, now).sort()).toEqual(['copied', 'priv', 'pub']);
  });
});

describe('a Talk never goes back to its author (OPEN-112)', () => {
  it('drops the original author of a copied Talk from the receivers', () => {
    expect(receiversExcludingAuthor(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('keeps everyone when the Talk has no author recorded', () => {
    expect(receiversExcludingAuthor(['a', 'b'], undefined)).toEqual(['a', 'b']);
  });
});
