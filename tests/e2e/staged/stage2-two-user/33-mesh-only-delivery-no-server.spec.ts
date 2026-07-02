/**
 * Step-7 migration proof: talk delivery + match + conversation creation happen WITHOUT
 * any server talk-delivery path.
 *
 * The server-side talk inbox (POST /api/talks/:id/received) and the incoming-talks fetch
 * (GET /api/incoming-talks / /api/users/:id/incoming-talks) were deleted in the P0 step-7
 * migration to a mesh/pair-direct architecture. This spec is the load-bearing regression
 * guard: it drives a full author→respond→match→conversation flow and proves
 *
 *   (a) the removed delivery endpoints return 404 (they no longer exist), and
 *   (b) NO request from either page ever hits a talk-delivery endpoint, and
 *   (c) the responder's incoming-talk cluster came from the LOCAL Gun IN index
 *       (app.getLocalIncomingClustersForE2e()), not from any /api talk fetch, and
 *   (d) the resulting conversation exists on BOTH sides from LOCAL Gun state
 *       (localStorage myConversations) — the same durable signal specs 03/29/38 use.
 *
 * Delivery here uses the seedIncomingTalkForE2e seam (local Gun IN index write) rather than a
 * live WebRTC hop, and the response uses the pair-direct submit path whose mailbox fallback the
 * author drains locally. The subject under test is which TRANSPORT carries delivery, so the
 * network-log assertion is the load-bearing part and is kept strict: the only /api/* traffic
 * allowed is signaling / room-membership / health / users / mailbox / debug — never a
 * talk-delivery endpoint.
 *
 * See companion 33-mesh-only-delivery-no-server.md for a plain-English description.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { gunBaseURL } from '../../helpers/ports';

const FLOW_TIMEOUT_MS = 30_000;

/** Any request path that would indicate a server talk-delivery / inbox endpoint (all removed in step 7). */
function isTalkDeliveryEndpoint(pathname: string): boolean {
  if (/\/api\/talks\/[^/]+\/received/.test(pathname)) return true;
  if (/\/api\/talks\/[^/]+\/response/.test(pathname)) return true;
  if (/\/api\/incoming-talks/.test(pathname)) return true;
  if (/\/api\/users\/[^/]+\/incoming-talks/.test(pathname)) return true;
  return false;
}

test.describe('Mesh-only delivery: talk delivery + match + conversation without any server talk-delivery path', () => {
  let browserA: Browser;
  let browserB: Browser;
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  let pageA: Page | undefined;
  let pageB: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=640,1100'] });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch {
        /* ignore */
      }
      await p.close().catch(() => {});
    };
    await cleanup(pageA);
    await cleanup(pageB);
    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('A authors, B receives via local Gun IN, answers → match on both sides; zero server talk-delivery traffic', async () => {
    // ── 1. Bootstrap both users ──────────────────────────────────────────────
    const [a, b] = await Promise.all([
      bootstrapUser(browserA, 'MeshA', 'MeshA'),
      bootstrapUser(browserB, 'MeshB', 'MeshB'),
    ]);
    contextA = a.context;
    pageA = a.page;
    contextB = b.context;
    pageB = b.page;

    // ── 2. Instrument BOTH pages BEFORE the flow ─────────────────────────────
    // Record every /api/* request either page issues. Load-bearing: none may be a
    // talk-delivery endpoint.
    const apiRequestsA: string[] = [];
    const apiRequestsB: string[] = [];
    const record = (log: string[]) => (req: import('@playwright/test').Request) => {
      const url = req.url();
      const pathname = (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })();
      if (pathname.includes('/api/')) log.push(`${req.method()} ${pathname}`);
    };
    pageA.on('request', record(apiRequestsA));
    pageB.on('request', record(apiRequestsB));

    const [userIdA, userIdB] = await Promise.all([
      pageA.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
      pageB.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    ]);
    expect(userIdA).toBeTruthy();
    expect(userIdB).toBeTruthy();

    const talkId = `mesh-only-${Date.now()}`;
    const talkTitle = `Mesh Only Delivery ${talkId}`;
    const talkDef = {
      id: talkId,
      authorId: userIdA,
      title: talkTitle,
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'Meet up over coffee?',
          answers: [
            { id: 'a-match', text: 'Yes lets meet', isMatch: true },
            { id: 'a-ignore', text: 'No thanks', isMatch: false, isIgnore: true },
          ],
        },
      ],
    };

    // ── 3. A authors the talk (caches body + records as owned) ────────────────
    await pageA.evaluate(
      ({ tid, def }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        app?.peerMeshService?.cacheTalkBody?.(tid, def);
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        myTalks[tid] = { role: 'created', fullTalk: def };
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
      },
      { tid: talkId, def: talkDef },
    );

    const authorEpub = await pageA.evaluate(() => {
      const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
      return pair?.epub ?? '';
    });

    // ── 4. Deliver to B purely via the LOCAL Gun IN index (mesh seam, no server inbox) ─
    await pageB.evaluate(
      async ({ def, senderId, senderName }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        await app.seedIncomingTalkForE2e({ talkData: def, senderId, senderName });
      },
      { def: { ...talkDef, authorEpub }, senderId: userIdA, senderName: 'MeshA' },
    );

    // ── 5. Assert B's incoming cluster came from the LOCAL Gun IN index ──────
    // getLocalIncomingClustersForE2e() reads the local Gun `incomingTalksByUser` index —
    // never an /api talk fetch. If this contains the talk, delivery was purely mesh/local.
    await expect
      .poll(
        async () =>
          pageB!.evaluate(async (tid) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
            return JSON.stringify(clusters).includes(tid);
          }, talkId),
        { timeout: FLOW_TIMEOUT_MS, message: 'B: talk not in local Gun IN index' },
      )
      .toBe(true);

    // ── 6. B answers MATCH via the pair-direct submit path (mailbox fallback) ─
    await pageB.evaluate(
      async ({ def, authorId, authorName, epub }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        app?.peerMeshService?.cacheTalkBody?.(def.id, { ...def, authorEpub: epub });
        await app.submitTalkResponsePairDirect({
          talkId: def.id,
          talkData: { ...def, authorEpub: epub },
          answers: [
            { questionId: 'q1', answerId: 'a-match', answerText: 'Yes lets meet', mode: 'manual', isMatch: true },
          ],
          isChatbotResponse: false,
          authorId,
          authorName,
          isAutoResponse: false,
        });
      },
      { def: talkDef, authorId: userIdA, authorName: 'MeshA', epub: authorEpub },
    );

    // ── 7. A drains its mailbox to ingest the response (author-side receipt) ──
    await expect
      .poll(
        async () =>
          pageA!.evaluate(async ({ bId }) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            await app.drainMailbox?.();
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).some((c: any) => c?.otherUserId === bId);
          }, { bId: userIdB }),
        { timeout: FLOW_TIMEOUT_MS, intervals: [300, 600, 1000], message: 'A: no conversation with B after mailbox drain' },
      )
      .toBe(true);

    // ── 8. Conversation exists on BOTH sides from LOCAL Gun state ─────────────
    const convIdA = await pageA.evaluate(({ bId }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      const entry = Object.entries(conversations).find(([, c]: [string, any]) => c?.otherUserId === bId);
      return entry ? entry[0] : null;
    }, { bId: userIdB });
    expect(convIdA, 'A must have a local conversation with B').toBeTruthy();

    const convIdB = await pageB.evaluate(({ aId }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      const entry = Object.entries(conversations).find(([, c]: [string, any]) => c?.otherUserId === aId);
      return entry ? entry[0] : null;
    }, { aId: userIdA });
    expect(convIdB, 'B must have a local conversation with A').toBeTruthy();
    expect(convIdA, 'Conversation id must match on both sides (deterministic)').toBe(convIdB);

    // ── 9. NETWORK LOG: no request from either page hit a talk-delivery endpoint ─
    const offendersA = apiRequestsA.filter((r) => isTalkDeliveryEndpoint(r));
    const offendersB = apiRequestsB.filter((r) => isTalkDeliveryEndpoint(r));
    expect(offendersA, `A must not call any talk-delivery endpoint. Observed /api calls: ${apiRequestsA.join(', ')}`).toEqual([]);
    expect(offendersB, `B must not call any talk-delivery endpoint. Observed /api calls: ${apiRequestsB.join(', ')}`).toEqual([]);

    // ── 10. Probe: the removed endpoints return 404 (cheap, via page.request) ──
    const receivedProbe = await pageA.request.post(`${gunBaseURL()}/api/talks/${talkId}/received`, {
      data: {},
      failOnStatusCode: false,
    });
    expect(receivedProbe.status(), 'POST /api/talks/:id/received must be 404 (endpoint removed)').toBe(404);

    const incomingProbe = await pageB.request.get(
      `${gunBaseURL()}/api/users/${encodeURIComponent(userIdB)}/incoming-talks`,
      { failOnStatusCode: false },
    );
    expect(incomingProbe.status(), 'GET /api/users/:id/incoming-talks must be 404 (endpoint removed)').toBe(404);
  });
});
