import express from 'express';
import request from 'supertest';
import { registerBackgroundAgentRoutes } from '../../server/routes/background-agent-routes';

describe('native background agent routes', () => {
  const token = 'a'.repeat(64);

  function appWith(agent: Record<string, jest.Mock>) {
    const app = express();
    app.use(express.json());
    registerBackgroundAgentRoutes(app, agent as any, token);
    return app;
  }

  test('hides the native surface without its per-process bearer token', async () => {
    const agent = {
      provision: jest.fn(), drain: jest.fn(), listEvents: jest.fn(), acknowledge: jest.fn(), status: jest.fn(),
    };
    await request(appWith(agent)).get('/api/native/background-agent/events').expect(404);
    expect(agent.listEvents).not.toHaveBeenCalled();
  });

  test('provisions, drains, lists and acknowledges through the authenticated surface', async () => {
    const event = { version: 1, id: 'event-1', kind: 'incoming-talk' };
    const agent = {
      provision: jest.fn(async () => undefined),
      drain: jest.fn(async () => [event]),
      listEvents: jest.fn(() => [event]),
      acknowledge: jest.fn(async () => undefined),
      status: jest.fn(() => ({ provisioned: true, enabled: true, pendingEvents: 1 })),
    };
    const app = appWith(agent);
    const auth = { Authorization: `Bearer ${token}` };

    await request(app).post('/api/native/background-agent/provision').set(auth)
      .send({ config: { version: 1 }, pair: { pub: 'pub' } }).expect(200);
    await request(app).post('/api/native/background-agent/drain').set(auth).send({}).expect(200)
      .expect((response) => expect(response.body.events).toEqual([event]));
    await request(app).get('/api/native/background-agent/events').set(auth).expect(200)
      .expect((response) => expect(response.body.events).toEqual([event]));
    await request(app).post('/api/native/background-agent/events/ack').set(auth)
      .send({ ids: ['event-1'] }).expect(200);

    expect(agent.provision).toHaveBeenCalledWith({ version: 1 }, { pub: 'pub' });
    expect(agent.acknowledge).toHaveBeenCalledWith(['event-1']);
  });
});
