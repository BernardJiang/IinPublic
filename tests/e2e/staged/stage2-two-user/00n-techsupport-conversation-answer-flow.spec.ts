/**
 * Regression coverage for a real bug found via manual testing (2026-09-15): TechSupport's own
 * operator session replying to an ordinary user through the NORMAL conversation UI — click a
 * peer, type a reply, hit Send — used to land in a completely different, disconnected
 * conversation than the one the ordinary user was writing into (a stray conv_pair_ id on the
 * ordinary WebRTC transport, instead of the shared conv_support_ id on the durable star-gun
 * transport). Fixed in app.ts's findOrCreateDirectConversation/ensureSupportConversationRecord
 * and user-detail-view.ts's renderMatchedConversations.
 *
 * This is deliberately NOT the same path 07-support-inbox-answer-flow.spec.ts and
 * 00l-techsupport-faq-cross-user.spec.ts exercise — both of those have the operator answer via
 * the dedicated Support Inbox panel (.support-inbox-item / handleAnswerSupportQuestion), which
 * never calls findOrCreateDirectConversation and would not have caught this regression. Here
 * TechSupport instead finds the asker the same way any two ordinary peers find each other — the
 * shared Global chatroom's member list — and replies from the ordinary conversation overlay.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { expectCurrentUserIsTechSupportRoot } from '../../helpers/techsupport-contract';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { loadRealTechSupportPair } from '../../helpers/techsupport-real-pair';

// Rotated 2026-09-16: the real TechSupport signing key lives only in this machine's own
// `.env.local` (never committed — see techsupport.ts's TECHSUPPORT_PUB doc comment), loaded at
// runtime instead of hardcoded. The describe block below skips entirely when it's absent, so
// every usage past that guard is safe despite the type assertion here.
const REAL_PAIR = loadRealTechSupportPair();
const DEV_PAIR = REAL_PAIR as NonNullable<typeof REAL_PAIR>;

/** Boots a browser in K3 TechSupport mode, mirroring stage1 specs 05/07 and stage2 00l/00m. */
async function bootstrapTechSupportMode(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 720, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await injectIdbClear(page);
  await context.addInitScript(
    ({ userId, keypairStorageKey, pairJson }) => {
      window.localStorage.setItem('iinpublic_user_id', userId);
      window.localStorage.setItem(keypairStorageKey, pairJson);
    },
    { userId: TECHSUPPORT_ROOT_USER_ID, keypairStorageKey: 'iinpublic_techsupport_keypair_v1', pairJson: JSON.stringify(DEV_PAIR) },
  );
  await gotoWebApp(page, webBaseURL());
  await ensureWindowFitsViewport(page, 720, 960);
  await afterLoad();
  attachE2eBrowserTabLabel(page, 'TechSupport');
  return { context, page };
}

test.describe('TechSupport conversation UI: operator answers multiple questions through the ordinary DM flow', () => {
  test.skip(!REAL_PAIR, 'Set TECHSUPPORT_SEA_PAIR_JSON in .env.local to run this TechSupport-mode spec.');

  let browser: Browser;
  let userContext: BrowserContext | undefined;
  let userPage: Page | undefined;
  let techSupportContext: BrowserContext | undefined;
  let techSupportPage: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1300', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await userPage?.close().catch(() => {});
    await techSupportPage?.close().catch(() => {});
    await userContext?.close().catch(() => {});
    await techSupportContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('user asks several questions in the DM thread; TechSupport opens the same thread from the chatroom member list and answers each one', async () => {
    // Any "server persist failed" / "Not a TechSupport conversation id" console line is exactly
    // the regression this spec exists to catch (the 400 toast from the wrong-id bug) — collected
    // from both sides and asserted empty at the end, on top of the functional message checks.
    const regressionErrors: string[] = [];

    const user = await bootstrapUser(browser, 'Wendy support asker', 'Wendy');
    userContext = user.context;
    userPage = user.page;
    userPage.on('console', (m) => {
      const text = m.text();
      if (/persist failed|Not a TechSupport conversation id/i.test(text)) regressionErrors.push(`[user] ${text}`);
    });

    const userId = await userPage.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    expect(userId).toBeTruthy();

    // 1. User opens the TechSupport DM the same way any ordinary user does — tap the name on
    // the pinned support contact row (contacts-view.ts tap-target split: this is the tap target
    // that jumps straight to the conversation).
    await userPage.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const supportRow = userPage.locator(`.contact-support-item[data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await expect(supportRow).toBeVisible({ timeout: 15_000 });
    await supportRow.locator('.contact-item-name').click();
    await expect(userPage.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(userPage.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    // 2. User asks a few distinct, brand-new questions (miss path — each gets its own signed
    // "a human will get back to you" ack, never a fabricated instant answer).
    const questions = [
      `Why does the app show me offline when I'm online ${Date.now()}?`,
      `Can I change my display name after signup ${Date.now()}?`,
      `How do I export my talk history ${Date.now()}?`,
    ];
    const answers = [
      'Presence updates every few seconds — give it a moment and it should flip to online.',
      'Yes — Settings > Profile lets you change your display name any time.',
      'There is no export button yet; it is on our roadmap.',
    ];

    for (const question of questions) {
      await userPage.locator('#conversation-message-input').fill(question);
      await userPage.locator('#send-conversation-message').click();
      // Barrier between sends: wait for this question's own auto-ack before typing the next,
      // so the three questions land as genuinely separate messages rather than racing the
      // composer.
      await expect(userPage.locator('#conversation-messages')).toContainText('will get back to you', { timeout: 15_000 });
      await afterSync();
    }
    for (const question of questions) {
      await expect(userPage.locator('#conversation-messages')).toContainText(question);
    }

    // 3. TechSupport boots (K3 mode) and reaches this exact conversation the same way any two
    // ordinary peers reach each other — the shared Global chatroom's member list — NOT the
    // Support Inbox. This is the click that used to mint a disconnected conv_pair_ conversation.
    ({ context: techSupportContext, page: techSupportPage } = await bootstrapTechSupportMode(browser));
    techSupportPage.on('console', (m) => {
      const text = m.text();
      if (/persist failed|Not a TechSupport conversation id/i.test(text)) regressionErrors.push(`[techsupport] ${text}`);
    });
    await expectCurrentUserIsTechSupportRoot(techSupportPage);

    await techSupportPage.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await techSupportPage.click('.chatroom-item[data-chatroom-id="global"]');
    await afterSync();
    const userMember = techSupportPage.locator(`.chatroom-member-item[data-user-id="${userId}"]`);
    await expect(userMember).toBeVisible({ timeout: 20_000 });
    await userMember.click();
    await expect(techSupportPage.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });

    // All three questions (and their auto-acks) are visible from the operator's side — proof
    // this is the SAME conversation the user has been writing into, not a disconnected one.
    for (const question of questions) {
      await expect(techSupportPage.locator('#conversation-messages')).toContainText(question, { timeout: 15_000 });
    }

    // 4. Operator answers each question inline, from the ordinary conversation composer.
    for (const answer of answers) {
      await techSupportPage.locator('#conversation-message-input').fill(answer);
      await techSupportPage.locator('#send-conversation-message').click();
      await afterSync();
    }

    // 5. The user's already-open thread receives every reply — proof the operator's replies
    // landed in the SAME shared conv_support_ conversation on the durable star-gun transport,
    // not a disconnected conv_pair_/direct-p2p one.
    for (const answer of answers) {
      await expect(userPage.locator('#conversation-messages')).toContainText(answer, { timeout: 20_000 });
    }

    expect(regressionErrors).toEqual([]);

    await userPage.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await techSupportPage.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
  });
});
