import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';
import { ledgerFromEntries, type LedgerCommandResult } from '../../core/talk-ledger-store';
import { TALK_SEND_DAILY, exchangedKey, outcomeKey } from '../../shared/talk-ledger';

const now = Date.parse('2026-10-29T12:00:00Z');
describe('host-owned Talk ledger commands', () => {
  it('serializes quota decisions from concurrent GUIs and retains the counter on host restart', async () => {
    const store = memoryGraphStore();
    const core = createCoreHandler(store);
    const results = await Promise.all(Array.from({ length: 18 }, (_, i) => core({ name: 'ledger.gate', peerId: 'peer', nowMs: now, talkId: `talk-${i}` }))) as LedgerCommandResult[];
    expect(results.filter((result) => result.gate?.ok)).toHaveLength(TALK_SEND_DAILY);
    const restarted = createCoreHandler(store);
    expect(await restarted({ name: 'ledger.gate', peerId: 'peer', nowMs: now, talkId: 'new' })).toMatchObject({ gate: { ok: false } });
    expect(await restarted({ name: 'ledger.gate', peerId: 'peer', nowMs: now, talkId: 'talk-0' })).toMatchObject({ gate: { ok: true } });
    const entries = await restarted({ name: 'collection.snapshot', collection: 'talkLedger' }) as Record<string, unknown>;
    expect(ledgerFromEntries(entries).edges.peer.sentToday).toBe(TALK_SEND_DAILY);
  });

  it('does not let a stale tab replace a newer outcome or responder entry', async () => {
    const core = createCoreHandler(memoryGraphStore());
    for (const version of [3, 1]) {
      await core({ name: 'ledger.apply', event: { kind: 'TALK_ANSWERED', responderId: 'peer', talkId: 'talk', authorId: 'me', identityKey: 'identity', outcome: version === 3 ? 'matched' : 'ignored', version, responseId: `response-${version}`, respondedAt: new Date(now).toISOString(), now: new Date(now).toISOString() } });
      await core({ name: 'ledger.responder', input: { authorId: 'author', identityKey: 'identity', outcome: 'matched', version, responseId: `response-${version}`, respondedAt: new Date(now).toISOString() } });
    }
    const entries = await core({ name: 'collection.snapshot', collection: 'talkLedger' }) as Record<string, unknown>;
    const ledger = ledgerFromEntries(entries);
    expect(ledger.outcomes[outcomeKey('peer', 'talk', 'me')]).toMatchObject({ version: 3, outcome: 'matched' });
    expect(ledger.exchanged[exchangedKey('author', 'identity')]).toMatchObject({ version: 3, responseId: 'response-3' });
  });

  it('keeps the queue usable after a failed write and does not acknowledge an uncommitted command', async () => {
    const store = memoryGraphStore();
    const put = store.put;
    let fail = true;
    store.put = async (...args) => { if (fail) { fail = false; throw new Error('disk failed'); } return put(...args); };
    const core = createCoreHandler(store);
    const command = { name: 'ledger.gate' as const, peerId: 'peer', nowMs: now, talkId: 'talk' };
    await expect(core(command)).rejects.toThrow('disk failed');
    await expect(core(command)).resolves.toMatchObject({ gate: { ok: true } });
  });

  it('does not accept the GUI test override in a normal host', async () => {
    const core = createCoreHandler(memoryGraphStore());
    for (let i = 0; i < TALK_SEND_DAILY; i++) await core({ name: 'ledger.gate', peerId: 'peer', nowMs: now, talkId: String(i) });
    await expect(core({ name: 'ledger.gate', peerId: 'peer', nowMs: now, talkId: 'overflow', unlimitedForTesting: true })).resolves.toMatchObject({ gate: { ok: false } });
  });
});

describe('response commit commands', () => {
  const ciphertext = 'SEA' + JSON.stringify({ ct: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAAAAAA', s: 'AAAAAAAAAAAA' });
  const input = {
    talkId: 'talk', talkData: { type: 'flow', title: 'Test', questions: [{ id: 'q', text: 'Ready?', answers: [{ id: 'yes', text: 'Yes', isMatch: true }] }] },
    answers: [{ questionId: 'q', answerId: 'yes', answerText: 'Yes' }],
    authorId: 'author', authorName: 'Author', responderId: 'me', payloadCiphertext: ciphertext, submittedAt: new Date(now).toISOString(),
  };

  it('allocates monotonic versions across concurrent tabs and preserves idempotency after restart', async () => {
    const store = memoryGraphStore();
    const core = createCoreHandler(store);
    const commands = Array.from({ length: 6 }, (_, i) => ({ name: 'response.commit' as const, input: { ...input, answers: [{ questionId: 'q', answerId: `answer-${i}`, answerText: `Answer ${i}` }] } }));
    const results = await Promise.all(commands.map(core)) as LedgerCommandResult[];
    expect(results.map((result) => result.response?.payload.version)).toEqual([1, 2, 3, 4, 5, 6]);
    const restarted = createCoreHandler(store);
    const replay = await restarted(commands[5]) as LedgerCommandResult;
    expect(replay.response?.payload.version).toBe(6);
    expect(replay.response?.payload.responseId).toBe(results[5].response?.payload.responseId);
    expect(replay.response?.isContentChange).toBe(false);
    expect(await restarted({ name: 'delivery.get', objectId: replay.response!.payload.responseId, recipientId: 'author' })).toMatchObject({ state: 'committed' });
    await restarted({ name: 'delivery.record', input: { objectId: replay.response!.payload.responseId, recipientId: 'author', objectKind: 'talk-response', state: 'sent' } });
    await restarted(commands[5]);
    expect(await restarted({ name: 'delivery.get', objectId: replay.response!.payload.responseId, recipientId: 'author' })).toMatchObject({ state: 'sent' });
  });

  it('refuses incomplete, retracted and unencrypted responses before transport preparation', async () => {
    const core = createCoreHandler(memoryGraphStore());
    await expect(core({ name: 'response.commit', input: { ...input, payloadCiphertext: 'plaintext' } })).rejects.toThrow('encrypted');
    await expect(core({ name: 'response.commit', input: { ...input, talkData: { ...input.talkData, type: 'survey' }, answers: [] } })).rejects.toThrow('Incomplete');
    await core({ name: 'ledger.apply', event: { kind: 'TALK_RETRACTED', talkId: input.talkId, authorId: input.authorId, retractedAt: now } });
    await expect(core({ name: 'response.commit', input })).rejects.toThrow('retracted');
  });

  it('keeps a separate encrypted delivery copy for each author of identical content', async () => {
    const { DeliveryStore, SENT_RESPONSES_PATH } = await import('../../core/delivery');
    const store = memoryGraphStore();
    const core = createCoreHandler(store);
    const a = await core({ name: 'response.commit', input }) as LedgerCommandResult;
    const b = await core({ name: 'response.commit', input: { ...input, authorId: 'other-author' } }) as LedgerCommandResult;
    expect(a.response!.payload.responseId).toBe(b.response!.payload.responseId);
    expect(await store.childKeys(SENT_RESPONSES_PATH)).toHaveLength(2);
    const delivery = new DeliveryStore(store);
    expect(await delivery.getSentResponse('talk', a.response!.payload.responseId, 'author')).toMatchObject({ authorId: 'author' });
    expect(await delivery.getSentResponse('talk', b.response!.payload.responseId, 'other-author')).toMatchObject({ authorId: 'other-author' });
  });

  it('does not return a payload when durable storage fails', async () => {
    const store = memoryGraphStore();
    store.put = async () => { throw new Error('disk failed'); };
    await expect(createCoreHandler(store)({ name: 'response.commit', input })).rejects.toThrow('disk failed');
  });
});
