/** @jest-environment node */

import Gun from 'gun';
import {
  installTransientSignalStoreFilter,
  isTransientSignalSoul,
  sweepTransientSignalGraph,
} from '../../server/services/transient-signal-store-filter';

describe('transient signal store filter', () => {
  it('recognizes signaling souls only', () => {
    expect(isTransientSignalSoul('p2p-signal')).toBe(true);
    expect(isTransientSignalSoul('p2p-signal/abc/p2p_1')).toBe(true);
    expect(isTransientSignalSoul('p2p-signals/x')).toBe(false);
    expect(isTransientSignalSoul('users/p2p-signal')).toBe(false);
    expect(isTransientSignalSoul(undefined)).toBe(false);
    expect(isTransientSignalSoul('undefinedp2p-signal/x/y')).toBe(true);
    expect(isTransientSignalSoul('undefinedusers/x')).toBe(false);
  });

  it('flags signaling puts so the store skips them, while they still reach the in-memory graph', async () => {
    // Stand-in for gun/lib/store.js's put handler, registered like it on the real Gun event
    // system: it passes the message down the chain first, then skips anything flagged `_.rad`.
    const persisted: string[] = [];
    (Gun as any).on('create', function (this: any, root: any) {
      this.to.next(root);
      root.on('put', function (this: any, msg: any) {
        this.to.next(msg);
        if ((msg._ || '').rad) return;
        persisted.push(String(msg.put['#']));
      });
    });
    installTransientSignalStoreFilter(Gun as unknown as Parameters<typeof installTransientSignalStoreFilter>[0], { sweepIntervalMs: 3_600_000 });
    const gun = (Gun as any)({ radisk: false, localStorage: false, peers: [], multicast: false, axe: false });

    gun.get('p2p-signal/pairkey/nonce-1').put({ frame: 'SDP-OFFER' });
    gun.get('users/alice').put({ stageName: 'Alice' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(persisted.some((soul) => soul.startsWith('users/alice'))).toBe(true);
    expect(persisted.some((soul) => soul.startsWith('p2p-signal'))).toBe(false);
    const inMemory = await new Promise((resolve) => gun.get('p2p-signal/pairkey/nonce-1').get('frame').once(resolve));
    expect(inMemory).toBe('SDP-OFFER');
  });

  it('evicts idle signaling nodes from the in-memory graph and leaves other souls alone', () => {
    const now = 10_000_000;
    const root = {
      graph: {
        'p2p-signal/a/old': { _: { '#': 'p2p-signal/a/old', '>': { frame: now - 6 * 60_000 } } },
        'p2p-signal/a/new': { _: { '#': 'p2p-signal/a/new', '>': { frame: now - 10_000 } } },
        'users/alice': { _: { '#': 'users/alice', '>': { stageName: 1 } } },
      },
    };
    expect(sweepTransientSignalGraph(root, now, 5 * 60_000)).toBe(1);
    expect(Object.keys(root.graph).sort()).toEqual(['p2p-signal/a/new', 'users/alice']);
  });
});
