import { selectDirectTalkPeers } from '../../shared/direct-talk-scheduler';

describe('direct Talk round-robin scheduler', () => {
  it('selects symmetric direct peers and never exceeds K', () => {
    const users = Array.from({ length: 37 }, (_, index) => `user-${String(index).padStart(2, '0')}`);
    const K = 5;
    for (let window = 0; window < 12; window += 1) {
      for (const userId of users) {
        const peers = selectDirectTalkPeers(users, userId, K, window);
        expect(peers.length).toBeLessThanOrEqual(K);
        expect(new Set(peers).size).toBe(peers.length);
        for (const peerId of peers) {
          expect(selectDirectTalkPeers(users, peerId, K, window)).toContain(userId);
        }
      }
    }
  });

  it('covers every pair within ceil((N-1)/K) windows', () => {
    const users = Array.from({ length: 100 }, (_, index) => `u${String(index).padStart(3, '0')}`);
    const K = 12;
    const windows = Math.ceil((users.length - 1) / K);
    for (const userId of users) {
      const met = new Set<string>();
      for (let window = 0; window < windows; window += 1) {
        for (const peerId of selectDirectTalkPeers(users, userId, K, window)) met.add(peerId);
      }
      expect(met.size).toBe(users.length - 1);
    }
  });

  it('handles an odd room without selecting the synthetic bye', () => {
    const users = ['alice', 'bob', 'carol'];
    for (let window = 0; window < 3; window += 1) {
      for (const userId of users) {
        expect(selectDirectTalkPeers(users, userId, 1, window))
          .not.toContain('__iinpublic_direct_talk_bye__');
      }
    }
  });
});

