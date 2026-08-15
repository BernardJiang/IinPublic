import express from 'express';
import request from 'supertest';
import { configureHttpMiddleware } from '../../server/bootstrap/http-bootstrap';

describe('production static-file boundary', () => {
  it('serves required Gun worker assets without exposing repository files', async () => {
    const app = express();
    configureHttpMiddleware(app);

    await request(app).get('/node_modules/gun/gun.js').expect(200);
    await request(app).get('/package.json').expect(404);
    await request(app).get('/src/server/index.ts').expect(404);
    await request(app).get('/.env').expect(404);
  });
});
