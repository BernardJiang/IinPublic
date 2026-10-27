/** OPEN-91 P5: the device core hosted by the embedded node, and the move from the WebView's worker. */
import express from 'express';
import request from 'supertest';
import { localNodeToken, registerCoreRoutes } from '../../server/routes/core-routes';
import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';
import { migrateWorkerCoreToNode, type CoreRequester } from '../../web/services/node-core-link';

const TOKEN = 'a'.repeat(64);

describe('the node core route', () => {
  function app() {
    const server = express();
    server.use(express.json());
    // A Gun stand-in is enough here: the route only builds the handler over it.
    registerCoreRoutes(server, { get: () => ({ once: () => undefined }) }, TOKEN, '/nonexistent-data-dir');
    return server;
  }

  it('does not exist without the shell’s secret, or with a wrong one', async () => {
    await request(app()).post('/api/core').send({ request: { name: 'exchanges.snapshot' } }).expect(404);
    await request(app()).post('/api/core').set('authorization', `Bearer ${'b'.repeat(64)}`).send({ request: { name: 'exchanges.snapshot' } }).expect(404);
  });

  it('answers with the secret (a fresh node: empty until its first write)', async () => {
    const response = await request(app()).post('/api/core').set('authorization', `Bearer ${TOKEN}`).send({ request: { name: 'exchanges.snapshot' } }).expect(200);
    expect(response.body).toEqual({ ok: true, value: [] });
    const bad = await request(app()).post('/api/core').set('authorization', `Bearer ${TOKEN}`).send({ request: { name: 'nope' } }).expect(400);
    expect(bad.body.ok).toBe(false);
  });

  it('takes the secret from the shell only when it is long enough', () => {
    expect(localNodeToken({ IINPUBLIC_CORE_TOKEN: 'short' })).toBe('');
    expect(localNodeToken({ IINPUBLIC_BACKGROUND_AGENT_TOKEN: TOKEN })).toBe(TOKEN);
    expect(localNodeToken({ IINPUBLIC_CORE_TOKEN: TOKEN, IINPUBLIC_BACKGROUND_AGENT_TOKEN: 'x'.repeat(40) })).toBe(TOKEN);
  });
});

describe('moving the core from the WebView worker to the node', () => {
  const requester = (handle: ReturnType<typeof createCoreHandler>): CoreRequester => (r) => handle(r);

  it('copies what the node lacks once, keeps what it has, and marks it done', async () => {
    const worker = createCoreHandler(memoryGraphStore());
    const node = createCoreHandler(memoryGraphStore());
    await worker({ name: 'collection.upsert', collection: 'myTalks', entries: { t1: { title: 'old' }, t2: { title: 'two' } } });
    await worker({ name: 'exchanges.upsert', records: [{ peerId: 'ann', talkId: 't1', direction: 'sent', outcome: 'match', date: '2026-10-26T00:00:00Z', peerName: 'Ann', title: 'x' } as never] });
    await node({ name: 'collection.upsert', collection: 'myTalks', entries: { t1: { title: 'newer on the node' } } });

    expect(await migrateWorkerCoreToNode(requester(worker), requester(node))).toEqual({ migrated: true, records: 2 });
    expect(await node({ name: 'collection.snapshot', collection: 'myTalks' })).toEqual({ t1: { title: 'newer on the node' }, t2: { title: 'two' } });
    expect(await node({ name: 'exchanges.snapshot' })).toHaveLength(1);

    await worker({ name: 'collection.upsert', collection: 'myTalks', entries: { t3: {} } });
    expect(await migrateWorkerCoreToNode(requester(worker), requester(node))).toEqual({ migrated: false, records: 0 });
  });
});
