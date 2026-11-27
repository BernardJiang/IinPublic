import { BlockSignalEffects, type BlockSignalEffectsPorts } from '../../core/block-signal-effects';
import { BLOCK_SIGNAL_PAYLOAD_KIND } from '../../shared/block-signal';
import type { KnownPerson, User } from '../../shared/types';

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'me',
    stageName: 'Me',
    profile: [],
    reputation: {} as User['reputation'],
    location: { region: 'test', chatrooms: [] },
    languages: [],
    interests: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastActive: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function contact(userId: string, labels: KnownPerson['labels']): KnownPerson {
  return { userId, labels, addedAt: new Date('2026-01-01T00:00:00.000Z') };
}

function setup(current = user()) {
  const order: string[] = [];
  const recordReceived = jest.fn(async () => { order.push('record-received'); });
  const recordShared = jest.fn(async () => { order.push('record-shared'); });
  const deliver = jest.fn(async (_payload, recipientId: string) => { order.push(`deliver:${recipientId}`); });
  const deliveryFailed = jest.fn();
  const ports: BlockSignalEffectsPorts = {
    currentUser: () => current,
    recordReceived,
    recordShared,
    deliver,
    deliveryFailed,
    now: () => new Date('2026-11-26T20:00:00.000Z'),
    signalId: () => 'sig-fixed',
  };
  return {
    effects: new BlockSignalEffects(ports),
    current,
    order,
    recordReceived,
    recordShared,
    deliver,
    deliveryFailed,
  };
}

describe('BlockSignalEffects', () => {
  it('ingests a valid signal durably before updating the in-memory user', async () => {
    const h = setup();
    await expect(h.effects.ingest({
      kind: BLOCK_SIGNAL_PAYLOAD_KIND,
      targetIdentity: 'target',
      at: '2026-11-26T20:00:00.000Z',
      signalId: 'sig-in',
    })).resolves.toBe(true);

    expect(h.recordReceived).toHaveBeenCalledWith('me', 'target', 'sig-in');
    expect(h.current.receivedBlockSignals).toEqual({ target: ['sig-in'] });
  });

  it('persists an empty-group share so future contacts can catch up', async () => {
    const h = setup();
    const payload = await h.effects.fanOut('target', 'coworker', []);

    expect(payload).toEqual({
      kind: BLOCK_SIGNAL_PAYLOAD_KIND,
      targetIdentity: 'target',
      at: '2026-11-26T20:00:00.000Z',
      signalId: 'sig-fixed',
    });
    expect(h.recordShared).toHaveBeenCalledWith('me', 'target', 'coworker', 'sig-fixed');
    expect(h.current.sharedBlockSignals?.target).toMatchObject({
      groupId: 'coworker',
      signalId: 'sig-fixed',
    });
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('persists before delivery, dedupes recipients, and continues after one failure', async () => {
    const h = setup();
    h.deliver.mockImplementation(async (_payload, recipientId) => {
      h.order.push(`deliver:${recipientId}`);
      if (recipientId === 'broken') throw new Error('offline');
    });

    await h.effects.fanOut('target', 'all', ['broken', 'ok', 'ok', '']);

    expect(h.order).toEqual(['record-shared', 'deliver:broken', 'deliver:ok']);
    expect(h.deliveryFailed).toHaveBeenCalledWith(
      'fan-out',
      'broken',
      'target',
      expect.objectContaining({ message: 'offline' }),
    );
  });

  it('reuses the original signal id when a contact later joins the shared group', async () => {
    const h = setup(user({
      sharedBlockSignals: {
        blocked: {
          groupId: 'coworker',
          signalId: 'sig-original',
          sharedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }));

    await expect(h.effects.resendToContact(contact('tom', ['coworker']))).resolves.toBe(1);
    expect(h.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        targetIdentity: 'blocked',
        signalId: 'sig-original',
      }),
      'tom',
    );
  });

  it('fails closed without an active user or a well-formed payload', async () => {
    const h = setup();
    const noUser = new BlockSignalEffects({
      currentUser: () => undefined,
      recordReceived: h.recordReceived,
      recordShared: h.recordShared,
      deliver: h.deliver,
    });

    await expect(noUser.fanOut('target', 'all', ['peer'])).resolves.toBeNull();
    await expect(h.effects.ingest({
      kind: BLOCK_SIGNAL_PAYLOAD_KIND,
      targetIdentity: '',
      at: '',
      signalId: '',
    })).resolves.toBe(false);
    expect(h.deliver).not.toHaveBeenCalled();
  });
});
