/** @jest-environment jsdom */
import type { ExchangeRecord } from '../../core/exchanges';
import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';
import { connectExchangeCore, removeExchangePeers, upsertExchange } from '../../web/services/exchange-view';
import { exchangeMapMatchSource } from '../../web/services/map-match-source';
import { MapMatchView } from '../../web/services/map-match-view';

const exchange = (talkId: string, extra: Partial<ExchangeRecord> = {}): ExchangeRecord => ({
  peerId: 'eve', peerName: 'Eve', talkId, title: talkId, direction: 'sent', outcome: 'match',
  date: '2026-10-26T12:00:00.000Z', ...extra,
});

describe('core exchange view to map badges', () => {
  beforeEach(() => localStorage.clear());

  it('restores core counts without browser storage, follows changed outcomes and peer removal', async () => {
    // The adapter needs the view API, never a localStorage key or serialized exchange shape.
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled'); });
    const handle = createCoreHandler(memoryGraphStore());
    await handle({ name: 'exchanges.upsert', records: [exchange('one'), exchange('one', { direction: 'received' }), exchange('two')] });
    await connectExchangeCore({
      snapshot: () => handle({ name: 'exchanges.snapshot' }) as Promise<ExchangeRecord[]>,
      upsert: (records) => handle({ name: 'exchanges.upsert', records }),
      removePeers: (peerIds) => handle({ name: 'exchanges.removePeers', peerIds }),
    });
    const publish = jest.fn();
    const view = new MapMatchView(publish);
    try {
      view.setSource(exchangeMapMatchSource);
      expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 2]]));
      upsertExchange(exchange('one', { outcome: 'mismatch' }));
      expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 2]]));
      upsertExchange(exchange('one', { outcome: 'mismatch', direction: 'received' }));
      expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 1]]));
      removeExchangePeers(['eve']);
      expect(publish).toHaveBeenLastCalledWith(new Map());
    } finally {
      view.reset();
      getItem.mockRestore();
    }
  });

  it('receives a late core snapshot and unsubscribes on logout', async () => {
    const publish = jest.fn();
    const view = new MapMatchView(publish);
    view.setSource(exchangeMapMatchSource);
    expect(publish).toHaveBeenLastCalledWith(new Map());
    let deliver!: (records: ExchangeRecord[]) => void;
    const connecting = connectExchangeCore({
      snapshot: () => new Promise((resolve) => { deliver = resolve; }),
      upsert: async () => undefined,
      removePeers: async () => undefined,
    });
    deliver([exchange('restored')]);
    await connecting;
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 1]]));
    view.reset();
    publish.mockClear();
    upsertExchange(exchange('later'));
    expect(publish).not.toHaveBeenCalled();
  });
});
