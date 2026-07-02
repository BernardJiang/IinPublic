/**
 * Deleted talk delivery routes return 404 (mesh migration step 7 smoke test).
 * Verifies that POST /api/talks/:id/received and GET /api/incoming-talks
 * no longer exist and return 404, while /health and GET /api/talks/:id remain live.
 * Pure API test — uses the browserless `request` fixture.
 */
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { gunBaseURL } from '../../helpers/ports';

test.describe('Deleted talk delivery routes return 404', () => {
  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
  });

  test.afterAll(async () => {
    await clearGunForStage1Spec();
  });

  test('removed delivery endpoints 404; health and talk lookup stay live', async ({ request }) => {
    const baseUrl = gunBaseURL();

    // Step 7 removed the server-side talk delivery path entirely.
    const received = await request.post(`${baseUrl}/api/talks/test-talk-id/received`, {
      data: { someField: 'someValue' },
    });
    expect(received.status()).toBe(404);

    // Old server inbox path (browser used to fetch incoming talks over HTTP).
    const incomingBare = await request.get(`${baseUrl}/api/incoming-talks`);
    expect(incomingBare.status()).toBe(404);
    const incomingWithUser = await request.get(`${baseUrl}/api/incoming-talks/some-user-id`);
    expect(incomingWithUser.status()).toBe(404);

    // Liveness: the server itself is still healthy...
    const health = await request.get(`${baseUrl}/health`);
    expect(health.status()).toBe(200);

    // ...and the surviving talk lookup route still responds (200 found / 202 pending replication / 404 unknown id is
    // NOT acceptable here: route must exist. Unknown id on the live route returns 200/202 per talk-routes.ts.)
    const talkLookup = await request.get(`${baseUrl}/api/talks/any-test-id`);
    expect([200, 202]).toContain(talkLookup.status());
  });
});
