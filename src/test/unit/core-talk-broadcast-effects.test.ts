import { TalkBroadcastEffects, type TalkBroadcastEffectsPorts } from '../../core/talk-broadcast-effects';
import type { Talk } from '../../shared/types';

const talk = (id: string): Talk => ({
  id,
  authorId: 'me',
  title: id,
  type: 'tag',
  language: 'en',
  questions: [],
  tags: [],
  isAdult: false,
  createdAt: new Date(),
  isTemplate: false,
  usageCount: 0,
} as Talk);

function harness(overrides: Partial<TalkBroadcastEffectsPorts> = {}) {
  const events: string[] = [];
  const delivered: string[] = [];
  const ports: TalkBroadcastEffectsPorts = {
    currentUserId: () => 'me',
    currentRoomId: () => 'room-1',
    broadcastableTalkIds: () => ['talk-1', 'talk-2'],
    resolveReceivers: async (_room, members) => members,
    resolveTalk: async (id) => talk(id),
    isExpired: () => false,
    deliver: async (id, _talk, _receivers, _eligible, onDelivered) => { delivered.push(id); onDelivered?.(1); return true; },
    recordCollectionDelivery: ({ talkIds }) => { events.push(`record:${talkIds.join(',')}`); },
    syncBackgroundAgent: () => { events.push('sync'); },
    markInFlight: () => { events.push('claim'); return () => { events.push('release'); }; },
    startProgress: () => { events.push('progress'); },
    emitBroadcast: (id) => { events.push(`ledger:${id}`); },
    setBulkAck: (sent, total) => { events.push(`ack:${sent}/${total}`); },
    notify: (kind) => { events.push(`notify:${kind}`); },
    ...overrides,
  };
  return { effects: new TalkBroadcastEffects(ports), events, delivered };
}

describe('TalkBroadcastEffects', () => {
  it('claims, batches, records and releases a room broadcast', async () => {
    const { effects, events, delivered } = harness();
    await effects.broadcastRoom({ members: [{ userId: 'peer', stageName: 'Peer' }] });
    expect(delivered).toEqual(['talk-1', 'talk-2']);
    expect(events).toEqual(expect.arrayContaining(['claim', 'notify:progress', 'record:talk-1,talk-2', 'sync', 'progress', 'ledger:talk-1', 'ledger:talk-2', 'ack:2/1', 'notify:success', 'release']));
  });

  it('narrows catch-up recipients and skips progress UI', async () => {
    const receivers: string[][] = [];
    const { effects, events } = harness({
      excludedUserIds: ['support'],
      deliver: async (_id, _talk, rows) => { receivers.push(rows.map((row) => row.userId)); return true; },
    });
    await effects.broadcastRoom({ catchUp: true, members: [
      { userId: 'me', stageName: 'Me' }, { userId: 'support', stageName: 'Support' }, { userId: 'peer', stageName: 'Peer' },
    ] });
    expect(receivers).toEqual([['peer'], ['peer']]);
    expect(events).not.toContain('claim');
    expect(events).not.toContain('progress');
  });

  it('isolates missing and expired Talks', async () => {
    const { effects, delivered } = harness({
      broadcastableTalkIds: () => ['missing', 'expired', 'ok'],
      resolveTalk: async (id) => id === 'missing' ? null : talk(id),
      isExpired: (value) => value.id === 'expired',
    });
    await effects.broadcastRoom({ members: [{ userId: 'peer', stageName: 'Peer' }] });
    expect(delivered).toEqual(['ok']);
  });

  it('releases an in-flight claim after delivery failure', async () => {
    const { effects, events } = harness({ deliver: async () => { throw new Error('offline'); } });
    await effects.broadcastRoom({ members: [{ userId: 'peer', stageName: 'Peer' }] });
    expect(events).toEqual(expect.arrayContaining(['notify:failure', 'release']));
  });

  it('delivers a contact-group Talk without room progress', async () => {
    const { effects, events, delivered } = harness();
    await effects.broadcastGroup({ talkId: 'talk-1', members: [{ userId: 'peer', stageName: 'Peer' }] });
    expect(delivered).toEqual(['talk-1']);
    expect(events).toEqual(expect.arrayContaining(['ledger:talk-1', 'notify:group-success']));
  });
});
