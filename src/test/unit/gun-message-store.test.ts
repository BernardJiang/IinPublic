/**
 * TODO §S Item 4: unit coverage for message checkpoint creation and pruning
 * (docs/design/section-s-merkle-checkpoint-pruning-design-note.md).
 *
 * The legacy policy functions remain pure (no Gun, DOM, or WebRTC) and are tested with
 * plain arrays. Current encrypted local persistence is covered separately by
 * local-private-conversation-repository.test.ts.
 */
import {
  MESSAGE_CHECKPOINT_INTERVAL,
  MESSAGE_RETENTION_WINDOW,
  planMessageCheckpoint,
  planMessagePruning,
  GunMessageStore,
} from '../../web/services/gun-message-store';
import { computeMerkleRoot, sha256Hex } from '../../shared/merkle-checkpoint';
import type { WebGunService } from '../../web/services/web-gun-service';
import { getSEA } from '../../web/sea-gun';

it('uses an in-room recipient epub without waiting for a slow public-user request', async () => {
  const getPublicUser = jest.fn(() => new Promise<never>(() => undefined));
  const gun = {
    getCachedRosterEpub: (id: string) => id === 'peer' ? 'epub_peer' : undefined,
    getPublicUser,
  } as unknown as WebGunService;
  const store = new GunMessageStore(gun);
  const keys = store as unknown as { getUserEpub: (id: string) => Promise<string | undefined> };

  await expect(keys.getUserEpub('peer')).resolves.toBe('epub_peer');
  expect(getPublicUser).not.toHaveBeenCalled();
});

it('retries unchanged ciphertext when the sender epub arrives after the message', async () => {
  jest.useFakeTimers();
  let privateListener: ((value: any) => void) | undefined;
  const gun = {
    getStoredPair: () => ({ pub: 'my-pub', priv: 'my-priv', epub: 'my-epub', epriv: 'my-epriv' }),
    getPrivate: jest.fn().mockResolvedValue(null),
    subscribePrivate: jest.fn((_key: string, callback: (value: any) => void) => {
      privateListener = callback;
      return () => undefined;
    }),
    getGun: jest.fn(),
  } as unknown as WebGunService;
  const store = new GunMessageStore(gun);
  const getUserEpub = jest.fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValue('sender-epub');
  (store as unknown as { getUserEpub: typeof getUserEpub }).getUserEpub = getUserEpub;
  const secret = jest.spyOn(getSEA(), 'secret').mockResolvedValue('pair-secret');
  const decrypt = jest.spyOn(getSEA(), 'decrypt').mockResolvedValue('hello after key sync');
  const renders: string[][] = [];

  try {
    const off = store.subscribeToMessages(
      'conv_pair_me_peer',
      (messages) => renders.push(messages.map((message) => message.text)),
      'me',
      'peer',
    );
    privateListener?.({
      version: 1,
      conversationId: 'conv_pair_me_peer',
      messagesJson: JSON.stringify([{
        id: 'm1',
        senderId: 'peer',
        text: 'SEA{"ct":"ciphertext"}',
        timestamp: '2026-11-05T00:00:00.000Z',
        channel: 'pair',
        encryption: 'sea-ecdh-v1',
      }]),
      checkpointsJson: '[]',
      totalCount: 1,
      lastCheckpointedCount: 0,
      prunedThroughCount: 0,
      updatedAt: '2026-11-05T00:00:00.000Z',
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(renders.at(-1)).toEqual(['SEA{"ct":"ciphertext"}']);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(renders.at(-1)).toEqual(['hello after key sync']);
    expect(getUserEpub).toHaveBeenCalledTimes(2);
    off();
  } finally {
    secret.mockRestore();
    decrypt.mockRestore();
    jest.useRealTimers();
  }
});

describe('planMessageCheckpoint / planMessagePruning (TODO §S Item 4, pure logic)', () => {
  function wires(count: number, offset = 0): { id: string; text: string }[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `msg-${String(i + offset).padStart(4, '0')}`,
      text: `plaintext-${i + offset}`,
    }));
  }

  it('returns null before MESSAGE_CHECKPOINT_INTERVAL new messages exist', async () => {
    const plan = await planMessageCheckpoint(wires(MESSAGE_CHECKPOINT_INTERVAL - 1), 0, MESSAGE_CHECKPOINT_INTERVAL);
    expect(plan).toBeNull();
  });

  it('builds a self-consistent checkpoint exactly at the interval', async () => {
    const all = wires(MESSAGE_CHECKPOINT_INTERVAL);
    const plan = await planMessageCheckpoint(all, 0, MESSAGE_CHECKPOINT_INTERVAL);
    expect(plan).toBeTruthy();
    const { content, newLastCheckpointedCount } = plan!;
    expect(newLastCheckpointedCount).toBe(MESSAGE_CHECKPOINT_INTERVAL);
    expect(content.count).toBe(MESSAGE_CHECKPOINT_INTERVAL);
    expect(content.rangeStartId).toBe('msg-0000');
    expect(content.rangeEndId).toBe(`msg-${String(MESSAGE_CHECKPOINT_INTERVAL - 1).padStart(4, '0')}`);
    expect(content.leafHashes).toHaveLength(MESSAGE_CHECKPOINT_INTERVAL);

    const expectedLeaves = await Promise.all(all.map(async (w) => `${w.id}:${await sha256Hex(w.text)}`));
    expect(content.leafHashes).toEqual(expectedLeaves);
    const recomputedRoot = await computeMerkleRoot(content.leafHashes);
    expect(content.merkleRoot).toBe(recomputedRoot);
  });

  it('continues checkpointing when the wire list no longer contains a pruned prefix', async () => {
    const retained = wires(MESSAGE_CHECKPOINT_INTERVAL * 2).slice(MESSAGE_CHECKPOINT_INTERVAL);
    const plan = await planMessageCheckpoint(
      retained,
      MESSAGE_CHECKPOINT_INTERVAL,
      MESSAGE_CHECKPOINT_INTERVAL,
      MESSAGE_CHECKPOINT_INTERVAL,
    );

    expect(plan?.newLastCheckpointedCount).toBe(MESSAGE_CHECKPOINT_INTERVAL * 2);
    expect(plan?.content.rangeStartId).toBe(`msg-${String(MESSAGE_CHECKPOINT_INTERVAL).padStart(4, '0')}`);
  });

  it('takes the next window after an existing checkpoint, not the whole backlog', async () => {
    const all = wires(MESSAGE_CHECKPOINT_INTERVAL * 2);
    const plan = await planMessageCheckpoint(all, MESSAGE_CHECKPOINT_INTERVAL, MESSAGE_CHECKPOINT_INTERVAL);
    expect(plan).toBeTruthy();
    const { content, newLastCheckpointedCount } = plan!;
    expect(newLastCheckpointedCount).toBe(MESSAGE_CHECKPOINT_INTERVAL * 2);
    expect(content.rangeStartId).toBe(`msg-${String(MESSAGE_CHECKPOINT_INTERVAL).padStart(4, '0')}`);
    expect(content.rangeEndId).toBe(`msg-${String(MESSAGE_CHECKPOINT_INTERVAL * 2 - 1).padStart(4, '0')}`);
  });

  it('prunes nothing before the retention window is exceeded', () => {
    // 3 checkpoints' worth, all within MESSAGE_RETENTION_WINDOW (200).
    const plan = planMessagePruning(MESSAGE_CHECKPOINT_INTERVAL * 3, MESSAGE_CHECKPOINT_INTERVAL * 3, 0, MESSAGE_RETENTION_WINDOW);
    expect(plan).toBeNull();
  });

  it('computes the deletable boundary as min(lastCheckpointedCount, total - retentionWindow)', () => {
    // 5 checkpoints (250 messages), all checkpointed, retention window 200 -> 50 deletable.
    const plan = planMessagePruning(250, 250, 0, MESSAGE_RETENTION_WINDOW);
    expect(plan).toEqual({ deletableThrough: 50 });
  });

  it('does not re-deliver an already-pruned boundary', () => {
    // Same totals as above, but 50 have already been pruned -> nothing new.
    const plan = planMessagePruning(250, 250, 50, MESSAGE_RETENTION_WINDOW);
    expect(plan).toBeNull();
  });

  it('advances the boundary as more checkpoints land', () => {
    // 6 checkpoints (300 messages), 50 already pruned -> boundary advances to 100.
    const plan = planMessagePruning(300, 300, 50, MESSAGE_RETENTION_WINDOW);
    expect(plan).toEqual({ deletableThrough: 100 });
  });

  it('never prunes past what has actually been checkpointed', () => {
    // total - retentionWindow (300-200=100) would allow pruning through 100, but only 80
    // messages are actually checkpointed yet -> capped at 80, not 100.
    const plan = planMessagePruning(300, 80, 0, MESSAGE_RETENTION_WINDOW);
    expect(plan).toEqual({ deletableThrough: 80 });
  });
});
