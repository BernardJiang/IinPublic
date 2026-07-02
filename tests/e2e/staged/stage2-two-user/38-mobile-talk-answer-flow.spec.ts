/**
 * Talk answer flow works on a phone viewport.
 *
 * A (desktop) "creates" a flow talk via the same lower-level mesh cache trick fast-dm-setup
 * uses for its author side (no talk-editor UI — this spec is about B's mobile answer dialog,
 * not A's authoring flow). B (390x844 mobile context) receives the talk as a real incoming-talk
 * cluster (seeded via app.seedIncomingTalkForE2e — the same local-cluster-upsert code path a
 * real mesh/mailbox delivery uses, minus the network hop) and answers it THROUGH THE REAL
 * RESPONSE MODAL UI: opening the incoming row, clicking the match radio button, submitting.
 * The response modal must fit the 390x844 viewport with no horizontal overflow, and answering
 * "match" must produce a real conversation on both sides.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForResponseModalClosed, waitForTabActive } from '../../helpers/talks-matching-flow';
import { bootstrapMobileUser, MOBILE_VIEWPORT } from '../../helpers/mobile-bootstrap';
import { waitForServerConversationBetween, getConversationIdBetween } from '../../helpers/conversation-e2e';

test.describe('Mobile talk answer flow: B on 390x844 answers through the real response modal', () => {
  let browserA: Browser;
  let browserB: Browser;
  let contextA: import('@playwright/test').BrowserContext | undefined;
  let contextB: import('@playwright/test').BrowserContext | undefined;
  let pageA: import('@playwright/test').Page | undefined;
  let pageB: import('@playwright/test').Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=420,900'] });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: import('@playwright/test').Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch {
        /* ignore */
      }
    };
    await cleanup(pageA);
    await cleanup(pageB);
    await pageA?.close().catch(() => {});
    await pageB?.close().catch(() => {});
    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('B answers an incoming flow talk via the mobile response modal and matches with A', async () => {
    const [a, b] = await Promise.all([
      bootstrapUser(browserA, 'AnswerA', 'AnswerA'),
      bootstrapMobileUser(browserB, 'AnswerB', 'AnswerB'),
    ]);
    contextA = a.context;
    pageA = a.page;
    contextB = b.context;
    pageB = b.page;

    const [userIdA, userIdB] = await Promise.all([
      pageA.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
      pageB.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    ]);
    expect(userIdA).toBeTruthy();
    expect(userIdB).toBeTruthy();

    const talkId = `mobile-answer-e2e-${Date.now()}`;
    const talkTitle = `Mobile Answer Flow Talk ${talkId}`;
    const talkDef = {
      id: talkId,
      authorId: userIdA,
      authorName: 'AnswerA',
      title: talkTitle,
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'Want to chat on mobile?',
          answers: [
            { id: 'a-match', text: 'Yes, lets chat.', isMatch: true },
            { id: 'a-ignore', text: 'No thanks.', isMatch: false, isIgnore: true },
          ],
        },
      ],
    };

    // A's side: cache the talk body locally and record it as an owned/created talk — the
    // same lower-level mesh cache trick fast-dm-setup uses for its author side, no editor UI.
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

    // B's side: seed a real incoming-talk cluster (local-cluster-upsert code path used by
    // real mesh/mailbox delivery, minus the network hop) so the Talks tab shows a genuine IN row.
    await pageB.evaluate(
      ({ def, senderId, senderName }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app?.seedIncomingTalkForE2e?.({ talkData: def, senderId, senderName });
      },
      { def: talkDef, senderId: userIdA, senderName: 'AnswerA' },
    );

    // ── B opens the incoming talk via the real Talks tab + View button ──────────────────
    await pageB.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageB, 'talks');
    const incomingRow = pageB.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: talkTitle });
    await expect(incomingRow.first()).toBeVisible({ timeout: 15_000 });
    await incomingRow.first().locator('button.view-talk-btn').click();

    const modal = pageB.locator('#talk-response-modal');
    const modalContent = pageB.locator('#talk-response-modal .modal-content');
    await expect(modalContent).toBeVisible({ timeout: 15_000 });

    // ── Mobile assertions: the response modal fits the 390x844 viewport ─────────────────
    const modalBox = await modalContent.boundingBox();
    expect(modalBox).toBeTruthy();
    if (modalBox) {
      expect(modalBox.x).toBeGreaterThanOrEqual(0);
      expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
      expect(modalBox.y + modalBox.height).toBeLessThanOrEqual(MOBILE_VIEWPORT.height + 1);
    }
    const noHorizontalOverflow = await pageB.evaluate(
      (vw) => document.documentElement.scrollWidth <= vw + 1,
      MOBILE_VIEWPORT.width,
    );
    expect(noHorizontalOverflow).toBe(true);

    // Answer options are visible + clickable within the viewport.
    const matchRadio = modal.locator('.choice-radio[data-answer-id="a-match"][data-mode="manual"]');
    await expect(matchRadio).toBeVisible({ timeout: 10_000 });
    const radioBox = await matchRadio.boundingBox();
    expect(radioBox).toBeTruthy();
    if (radioBox) {
      expect(radioBox.x + radioBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }

    // ── Submit through the real UI: tap the "manual match" radio for this answer ────────
    await matchRadio.click();

    // Clicking a match radio calls completeTalk -> submitTalkResponsePairDirect and closes the modal.
    await waitForResponseModalClosed(pageB);

    // ── Hard signal: a real match conversation now exists between A and B ────────────────
    await Promise.all([
      waitForServerConversationBetween(pageA, userIdA, userIdB),
      waitForServerConversationBetween(pageB, userIdB, userIdA),
    ]);
    const conversationId = await getConversationIdBetween(pageB, userIdB, userIdA);
    expect(conversationId).toBeTruthy();

    // Durable UI signal on B: the Contacts tab renders a real DOM row per exchanged peer
    // with a `data-matched-talks` count (contacts-view.ts) — assert A shows up there as a
    // matched contact, which only happens once the match/conversation has actually landed.
    await pageB.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageB, 'contacts');
    const contactRow = pageB.locator(`.contact-item[data-contact-user-id="${userIdA}"]`);
    await expect(contactRow).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => Number(await contactRow.getAttribute('data-matched-talks')), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
  });
});
