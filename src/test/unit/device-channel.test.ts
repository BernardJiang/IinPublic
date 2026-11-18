/**
 * The page's one WebSocket to its node (2026-11-16): core requests, Gun operations and events on a
 * single connection instead of HTTP requests queued behind the WebView's 6 per origin.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { attachDeviceChannel, BulkLane, DEVICE_CHANNEL_PATH } from '../../server/routes/device-channel';
import { DeviceChannel, DeviceChannelUnavailable, coreLane } from '../../web/services/device-channel';
import { channelCoreRequester, coalesceCollectionUpserts } from '../../web/services/node-core-link';
import { OfferBatcher } from '../../web/services/offer-batcher';
import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TOKEN = 'x'.repeat(40);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer(core: (request: any) => Promise<unknown>, gun: unknown = null, bulkConcurrency = 1) {
  const server = http.createServer((_req, res) => res.end('ok'));
  // As in the node: Gun's WebSocket server is attached first, and answers 400 to any other path.
  const gunWss = new WebSocket.Server({ server, path: '/gun' });
  gunWss.on('connection', (ws) => ws.send('gun-hello'));
  const channel = attachDeviceChannel(server, { token: TOKEN, core, gun, bulkConcurrency });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const clients: DeviceChannel[] = [];
  const client = (token = TOKEN) => {
    const c = new DeviceChannel({ baseUrl, token, createSocket: (url) => new WebSocket(url) as unknown as globalThis.WebSocket, requestTimeoutMs: 5_000 });
    clients.push(c);
    return c;
  };
  const stop = async () => {
    for (const c of clients) c.close();
    channel.close();
    gunWss.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  };
  return { baseUrl, client, stop };
}

describe('device channel (one WebSocket between page and node)', () => {
  it('answers core requests and reports their errors', async () => {
    const env = await startServer(async (request) => {
      if (request.name === 'boom') throw new Error('bad request');
      return { echo: request.name };
    });
    try {
      const channel = env.client();
      expect(await channel.connect()).toMatch(/^[0-9a-f]{24}$/);
      expect(await channel.request('core', { name: 'collection.snapshot' })).toEqual({ echo: 'collection.snapshot' });
      await expect(channel.request('core', { name: 'boom' })).rejects.toThrow('bad request');
      // Many requests at once over the one socket.
      const many = await Promise.all(Array.from({ length: 200 }, (_, i) => channel.request('core', { name: `n${i}` })));
      expect(many.map((answer) => answer.echo)).toEqual(Array.from({ length: 200 }, (_, i) => `n${i}`));
    } finally {
      await env.stop();
    }
  });

  it('refuses a wrong secret, and the page then uses HTTP', async () => {
    const env = await startServer(async () => 'never');
    try {
      const channel = env.client('y'.repeat(40));
      await expect(channel.connect()).rejects.toBeInstanceOf(DeviceChannelUnavailable);
      await expect(channel.request('core', { name: 'x' })).rejects.toBeInstanceOf(DeviceChannelUnavailable);
      const http = jest.fn(async () => 'over http');
      expect(await channelCoreRequester(channel, http)({ name: 'delivery.get', objectId: 'a', recipientId: 'b' })).toBe('over http');
    } finally {
      await env.stop();
    }
  });

  it('leaves Gun’s own WebSocket path working', async () => {
    const env = await startServer(async () => null);
    try {
      const ws = new WebSocket(`${env.baseUrl.replace('http', 'ws')}/gun`);
      const first = await new Promise<string>((resolve, reject) => {
        ws.on('message', (data) => resolve(String(data)));
        ws.on('error', reject);
      });
      expect(first).toBe('gun-hello');
      ws.close();
      // An unknown path is still refused (Gun's server answers 400).
      const other = new WebSocket(`${env.baseUrl.replace('http', 'ws')}/nope`);
      await expect(new Promise((resolve, reject) => { other.on('open', resolve); other.on('error', reject); })).rejects.toThrow();
    } finally {
      await env.stop();
    }
  });

  it('runs bulk work a few at a time while a request someone waits on goes at once', async () => {
    let bulkRunning = 0;
    let maxBulk = 0;
    const env = await startServer(async (request) => {
      if (request.name === 'graph.offer') {
        bulkRunning += 1;
        maxBulk = Math.max(maxBulk, bulkRunning);
        await sleep(100);
        bulkRunning -= 1;
      }
      return request.name;
    }, null, 1);
    try {
      const channel = env.client();
      await channel.connect();
      const offers = Array.from({ length: 5 }, () => channel.request('core', { name: 'graph.offer' }, coreLane({ name: 'graph.offer' })));
      await sleep(20);
      const started = Date.now();
      expect(await channel.request('core', { name: 'collection.snapshot' }, coreLane({ name: 'collection.snapshot' }))).toBe('collection.snapshot');
      // Not behind ~500 ms of offers.
      expect(Date.now() - started).toBeLessThan(80);
      await Promise.all(offers);
      expect(maxBulk).toBe(1);
    } finally {
      await env.stop();
    }
  });

  it('carries Gun operations and their subscription events', async () => {
    const listeners = new Map<string, (data: unknown) => void>();
    // The smallest Gun the RPC uses: get().on() and put().
    const node = (path: string[]): any => ({
      get: (key: string) => node([...path, key]),
      on: (cb: (data: unknown, key: string) => void) => { listeners.set(path.join('/'), (data) => cb(data, path[path.length - 1]!)); },
      off: () => undefined,
      put: (data: unknown, ack?: (a: { ok: number }) => void) => { listeners.get(path.join('/'))?.(data); ack?.({ ok: 1 }); },
    });
    const env = await startServer(async () => null, node([]));
    try {
      const channel = env.client();
      const session = await channel.connect();
      const events: unknown[] = [];
      channel.onGunEvent((event) => events.push(event));
      await channel.request('gun', { op: 'on', session, sub: 's1', path: ['a', 'b'], map: false });
      await channel.request('gun', { op: 'put', path: ['a', 'b'], data: { x: 1 }, timeoutMs: 10 });
      for (let i = 0; i < 50 && !events.length; i++) await sleep(10);
      expect(events).toEqual([expect.objectContaining({ sub: 's1', key: 'b' })]);
    } finally {
      await env.stop();
    }
  });

  it('runs the bulk lane in arrival order, up to its limit', async () => {
    const lane = new BulkLane(2);
    const order: number[] = [];
    let running = 0;
    let max = 0;
    await Promise.all(Array.from({ length: 6 }, (_, i) => new Promise<void>((done) => lane.push({
      run: async () => { running += 1; max = Math.max(max, running); order.push(i); await sleep(5); running -= 1; done(); },
    }))));
    expect(max).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('fewer, coarser core requests', () => {
  it('merges upserts to one collection made in the same moment, and never lets a read overtake them', async () => {
    const sent: any[] = [];
    const core = coalesceCollectionUpserts(async (request) => { sent.push(request); return request.name === 'collection.upsert' ? { written: Object.keys(request.entries).length } : 'read'; });
    const writes = [
      core({ name: 'collection.upsert', collection: 'appData', entries: { a: 1 } }),
      core({ name: 'collection.upsert', collection: 'appData', entries: { b: 2, a: 3 } }),
      core({ name: 'collection.upsert', collection: 'settings', entries: { s: 1 } }),
    ];
    expect(await Promise.all(writes)).toEqual([{ written: 1 }, { written: 2 }, { written: 1 }]);
    expect(sent).toEqual([
      { name: 'collection.upsert', collection: 'appData', entries: { a: 3, b: 2 } },
      { name: 'collection.upsert', collection: 'settings', entries: { s: 1 } },
    ]);
    sent.length = 0;
    void core({ name: 'collection.upsert', collection: 'appData', entries: { c: 1 } });
    await core({ name: 'collection.snapshot', collection: 'appData' });
    expect(sent.map((request) => request.name)).toEqual(['collection.upsert', 'collection.snapshot']);
  });

  it('sends offers made together as graph.offerMany and gives each caller its own result', async () => {
    const requests: any[] = [];
    const batcher = new OfferBatcher({
      maxPerRequest: 2,
      request: async (request: any) => {
        requests.push(request);
        return { results: request.offers.map((offer: any) => (offer.talkId === 'bad' ? { error: 'no such Talk' } : { offered: 1, known: true, sent: offer.recipients, skipped: {}, omitted: {}, waiting: [] })) };
      },
    });
    const results = await Promise.allSettled(['t1', 'bad', 't3'].map((talkId) => batcher.offer({ name: 'graph.offer', talkId, recipients: ['p1', 'p2'] })));
    expect(requests.map((request) => [request.name, request.offers.map((o: any) => o.talkId)])).toEqual([
      ['graph.offerMany', ['t1', 'bad']],
      ['graph.offerMany', ['t3']],
    ]);
    expect(results[0]).toEqual({ status: 'fulfilled', value: expect.objectContaining({ sent: ['p1', 'p2'] }) });
    expect(results[1]).toEqual({ status: 'rejected', reason: new Error('no such Talk') });
    expect(results[2].status).toBe('fulfilled');
  });

  it('answers graph.offerMany in the core with one result per offer, in order', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    const answer = await handle({ name: 'graph.offerMany', offers: [{ talkId: 'a', recipients: ['p'] }, { talkId: 'b', recipients: ['q'] }] }) as any;
    // No device graph here: each offer answers as graph.offer does then (nothing known, nothing sent).
    expect(answer.results).toEqual([
      { offered: 0, known: false, sent: [], skipped: {}, omitted: {}, waiting: [] },
      { offered: 0, known: false, sent: [], skipped: {}, omitted: {}, waiting: [] },
    ]);
  });

  it('routes the device channel path only', () => {
    expect(DEVICE_CHANNEL_PATH).toBe('/api/device-channel');
    expect(coreLane({ name: 'graph.offerMany' })).toBe('bulk');
    expect(coreLane({ name: 'graph.incoming' })).toBe('ui');
  });
});
