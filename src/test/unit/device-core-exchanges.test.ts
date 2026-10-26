/** @jest-environment jsdom */
/** OPEN-91 P1 / OPEN-88 part 2: the exchange log in the device core, and the GUI's view of it. */
import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';
import { ExchangeStore, exchangeKey, type ExchangeRecord } from '../../core/exchanges';
import {
  connectExchangeCore,
  onExchangesChanged,
  readExchanges,
  removeExchangePeers,
  resetExchangeViewForTests,
  upsertExchange,
} from '../../web/services/exchange-view';

const exchange = (peerId: string, talkId: string, direction: 'sent' | 'received', extra: Partial<ExchangeRecord> = {}): ExchangeRecord => ({
  peerId, peerName: peerId, talkId, title: talkId, outcome: 'match', direction, date: '2026-10-25T10:00:00.000Z', ...extra,
});

describe('the exchange log in the device core', () => {
  it('keeps one node per person, Talk and direction under local/exchanges, and forgets people', async () => {
    const store = memoryGraphStore();
    const log = new ExchangeStore(store);
    await log.upsert([exchange('ann', 'pizza', 'sent'), exchange('ann', 'pizza', 'received'), exchange('ben', 'jazz', 'sent', { answers: [{ questionId: 'q', answerId: 'a', answerText: 'Yes' }] })]);
    expect((await log.all()).map(exchangeKey).sort()).toEqual(['ann::pizza::received', 'ann::pizza::sent', 'ben::jazz::sent']);
    // Nested content survives the flat Gun record.
    expect((await log.all()).find((record) => record.peerId === 'ben')?.answers?.[0]?.answerText).toBe('Yes');
    expect(await store.childKeys('local/exchanges')).toHaveLength(3);
    expect(await log.removePeers(['ann'])).toBe(2);
    expect((await log.all()).map((record) => record.peerId)).toEqual(['ben']);
  });

  it('answers the GUI’s requests through one handler, as every host will', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    await handle({ name: 'exchanges.upsert', records: [exchange('ann', 'pizza', 'sent')] });
    expect(await handle({ name: 'exchanges.snapshot' })).toHaveLength(1);
    await expect(handle({ name: 'nope' } as never)).rejects.toThrow('Unknown core request');
  });
});

describe('the GUI’s view of the exchange log', () => {
  const linkTo = (handle: ReturnType<typeof createCoreHandler>) => ({
    snapshot: () => handle({ name: 'exchanges.snapshot' }) as Promise<ExchangeRecord[]>,
    upsert: (records: ExchangeRecord[]) => handle({ name: 'exchanges.upsert', records }),
    removePeers: (peerIds: string[]) => handle({ name: 'exchanges.removePeers', peerIds }),
  });

  beforeEach(() => localStorage.clear());

  it('loads the core’s log, answers reads synchronously, and sends writes to the core', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    await handle({ name: 'exchanges.upsert', records: [exchange('ann', 'pizza', 'sent')] });
    const changed = jest.fn();
    onExchangesChanged(changed);
    await connectExchangeCore(linkTo(handle));
    expect(readExchanges().map(exchangeKey)).toEqual(['ann::pizza::sent']);
    expect(changed).toHaveBeenCalled();

    upsertExchange(exchange('ann', 'pizza', 'received', { roomId: 'nearby-v3' }));
    expect(readExchanges()).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await handle({ name: 'exchanges.snapshot' })).toHaveLength(2);

    removeExchangePeers(['ann']);
    expect(readExchanges()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await handle({ name: 'exchanges.snapshot' })).toEqual([]);
  });

  it('imports an old-style localStorage blob once — old app data and test seeds — and removes it', async () => {
    localStorage.setItem('localTalkExchanges', JSON.stringify({
      'ann::pizza': { peerId: 'ann', talkId: 'pizza', outcome: 'match', direction: 'sent', date: '2026-10-01T00:00:00.000Z' },
      'ben::jazz': { peerId: 'ben', talkId: 'jazz', outcome: 'match', date: '2026-10-01T00:00:00.000Z' },
    }));
    const handle = createCoreHandler(memoryGraphStore());
    await connectExchangeCore(linkTo(handle));
    expect(localStorage.getItem('localTalkExchanges')).toBeNull();
    expect(readExchanges().map(exchangeKey).sort()).toEqual(['ann::pizza::sent', 'ben::jazz::sent']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await handle({ name: 'exchanges.snapshot' })).toHaveLength(2);
    // A seed written later is picked up on the next read.
    localStorage.setItem('localTalkExchanges', JSON.stringify([{ peerId: 'cy', talkId: 'tea', outcome: 'mismatch', direction: 'received', date: '2026-10-02T00:00:00.000Z' }]));
    expect(readExchanges()).toHaveLength(3);
  });

  it('keeps a write as unsaved until the core confirms it, and sends it again at the next start', async () => {
    const store = memoryGraphStore();
    const handle = createCoreHandler(store);
    // A core that never confirms: the page closed mid-save.
    const stalled = { ...linkTo(handle), upsert: () => new Promise<unknown>(() => undefined) };
    await connectExchangeCore(stalled);
    upsertExchange(exchange('ann', 'pizza', 'sent'));
    expect(Object.keys(JSON.parse(localStorage.getItem('iinpublic_exchanges_unsaved_v1') || '{}'))).toEqual(['ann::pizza::sent']);
    expect(await handle({ name: 'exchanges.snapshot' })).toEqual([]);

    // The next start (a fresh view) finds it, sends it, and clears it once stored.
    resetExchangeViewForTests();
    await connectExchangeCore(linkTo(handle));
    expect(readExchanges().map(exchangeKey)).toEqual(['ann::pizza::sent']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await handle({ name: 'exchanges.snapshot' })).toHaveLength(1);
    expect(localStorage.getItem('iinpublic_exchanges_unsaved_v1')).toBeNull();
  });

  it('keeps the newer copy when the view and the core both hold a record', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    await handle({ name: 'exchanges.upsert', records: [exchange('ann', 'pizza', 'sent', { outcome: 'mismatch', date: '2026-10-01T00:00:00.000Z' })] });
    upsertExchange(exchange('ann', 'pizza', 'sent', { outcome: 'match', date: '2026-10-25T00:00:00.000Z' }));
    await connectExchangeCore(linkTo(handle));
    expect(readExchanges()[0]?.outcome).toBe('match');
  });
});

describe('the Gun-backed store', () => {
  it('a node that does not exist is empty; storage that does not answer is an error to retry', async () => {
    const { gunGraphStore } = await import('../../core/graph-store');
    const silent = { get: () => ({ once: () => {} }) };
    const empty = { get: () => ({ once: (cb: (data: unknown) => void) => cb(undefined) }) };
    await expect(gunGraphStore(silent, { getTimeoutMs: 20 }).childKeys('local/exchanges')).rejects.toThrow('storage did not answer');
    await expect(gunGraphStore(empty).childKeys('local/exchanges')).resolves.toEqual([]);
  });
});
