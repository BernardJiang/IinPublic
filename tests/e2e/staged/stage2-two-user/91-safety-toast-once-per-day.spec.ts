import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, headless } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../../helpers/talks-matching-flow';
import { createSimpleFlowTalk } from '../../helpers/broadcast-cancellation-helpers';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { openCurrentChatroom } from '../../helpers/chatroom-nav';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

/**
 * Switch one of my Talks to Broadcast On from its row in the Talks tab — the real control. Talk
 * exchange is automatic (OPEN-112), so making a Talk public is the moment T1 fires.
 *
 * Only toggles and returns: the toast is created synchronously by the toggle and auto-dismisses
 * after 3s, so a caller must check it immediately after this resolves.
 */
async function makeTalkPublic(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await afterNav();
  const row = page.locator('.talk-list-item[data-role="created"]').filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const toggle = row.locator('.talk-broadcast-toggle-checkbox');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
}

// FR-FIN-1 (spec §7.4, TODO §CC): the mandatory financial-safety reminder is a toast that
// fires at most once per day per checkpoint — T1 when a talk becomes public, T2 right
// after a match is found. `shouldShowCooldownToast` (ui-manager.ts) gates both on a
// `localStorage` timestamp; this spec drives the real UI triggers (a real publish, a real
// match) and time-travels only that one durable timestamp key to prove the day boundary,
// rather than faking the whole system clock.
test.describe.configure({ timeout: 120_000 });

const T1_KEY = 'iinpublic_safety_toast_t1_last_shown';
const T2_KEY = 'iinpublic_safety_toast_t2_last_shown';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function bootstrapUser(browser: Browser, label: string, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await injectIdbClear(page);
  await gotoWebApp(page, webAppURLStableChatroom());
  await ensureWindowFitsViewport(page, 640, 1000);
  await afterLoad();

  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await openSettingsSection(page, SETTINGS_SECTION.profile);
  await page.waitForSelector('#settings-stage-name-input');
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect(page.locator('[data-testid="user-stage-name"]')).toContainText(stageName);

  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await openCurrentChatroom(page);
  await afterSync();
  attachE2eBrowserTabLabel(page, label);
  return { context, page };
}

/** Force the next cooldown check on `key` to pass (as if a day has already elapsed). */
async function expireCooldown(page: Page, key: string): Promise<void> {
  await page.evaluate(
    ({ k, ago }) => localStorage.setItem(k, String(Date.now() - ago)),
    { k: key, ago: ONE_DAY_MS + 60_000 },
  );
}

test.describe('FR-FIN-1: once-per-day pre-send and post-match safety toasts', () => {
  let browserAlice: Browser;
  let browserTom: Browser;
  let contextAlice: BrowserContext;
  let contextTom: BrowserContext;
  let pageAlice: Page;
  let pageTom: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
    browserTom = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
  });

  test.afterAll(async () => {
    const manualCleanup = async (page?: Page) => {
      if (!page) return;
      try {
        await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.());
      } catch { /* ignore */ }
    };
    await manualCleanup(pageAlice);
    await manualCleanup(pageTom);
    await pageAlice?.close();
    await pageTom?.close();
    await contextAlice?.close();
    await contextTom?.close();
    await browserAlice?.close();
    await browserTom?.close();
    await clearGunForStage2Spec();
  });

  test('T1 pre-send and T2 post-match toasts each fire once, are suppressed within the cooldown, and return after it expires', async () => {
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;

    // Tom joins first: a broadcast needs a receiver in the room, and the automatic Nearby room no
    // longer holds TechSupport (Global did), so Alice alone would have nothing to send.
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;

    const t1Toast = pageAlice.locator('[data-safety-toast="pre-send"]');

    // T1, step 1: first broadcast of the session,
    // no prior cooldown entry, toast must appear. Checked immediately after the click,
    // before it can auto-dismiss (3s lifetime).
    await createSimpleFlowTalk(pageAlice, 'CC Talk 1', 'Match', 'Ignore', { isPublic: false });
    await makeTalkPublic(pageAlice, 'CC Talk 1');
    await expect(t1Toast).toBeVisible({ timeout: 2_500 });
    await expect
      .poll(() => pageAlice.evaluate((k) => localStorage.getItem(k), T1_KEY))
      .not.toBeNull();
    await t1Toast.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});

    // T1, step 2: second broadcast immediately after — cooldown active, toast must not reappear.
    await pageAlice.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await createSimpleFlowTalk(pageAlice, 'CC Talk 2', 'Match', 'Ignore', { isPublic: false });
    const lastShownBefore = await pageAlice.evaluate((k) => localStorage.getItem(k), T1_KEY);
    await makeTalkPublic(pageAlice, 'CC Talk 2');
    await pageAlice.waitForTimeout(1_000);
    await expect(t1Toast).toHaveCount(0);
    const lastShownAfter = await pageAlice.evaluate((k) => localStorage.getItem(k), T1_KEY);
    expect(lastShownAfter).toBe(lastShownBefore);

    // T1, step 3: simulate the cooldown day having elapsed, then broadcast again — toast returns.
    await expireCooldown(pageAlice, T1_KEY);
    await pageAlice.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await createSimpleFlowTalk(pageAlice, 'CC Talk 3', 'Match', 'Ignore', { isPublic: false });
    await makeTalkPublic(pageAlice, 'CC Talk 3');
    await expect(t1Toast).toBeVisible({ timeout: 2_500 });

    const t2Toast = pageTom.locator('[data-safety-toast="post-match"]');
    const MATCH_ANSWER = 'Yes match';

    // Alice creates a fresh public matching talk: it reaches Tom with no Broadcast tap.
    await pageAlice.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await createSimpleFlowTalk(pageAlice, 'CC Match Talk A', MATCH_ANSWER, 'No mismatch');

    // Tom answers with the match answer: this is his first-ever match this session, no prior
    // T2 cooldown entry, so the toast must appear.
    await openIncomingTalkModal(pageTom, 'CC Match Talk A');
    await pageTom
      .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
      .first()
      .click();
    await waitForResponseModalClosed(pageTom);
    await expect(t2Toast).toBeVisible({ timeout: 15_000 });
    const t2LastShownBefore = await pageTom.evaluate((k) => localStorage.getItem(k), T2_KEY);
    expect(t2LastShownBefore).not.toBeNull();

    // The wiring into a real match is proven above; re-proving the cooldown arithmetic
    // via a second and third full cross-browser broadcast+match round trip would only
    // re-test mesh delivery reliability (already thoroughly covered by the T1 case above
    // and dozens of other specs), not FR-FIN-1 itself. So the rest of this checkpoint's
    // cooldown behavior is driven directly through the same production method the real
    // match above already funnels through (`maybeShowMatchSafetyToast`, ui-manager.ts).
    await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.maybeShowMatchSafetyToast?.());
    await pageTom.waitForTimeout(500);
    await expect(t2Toast).toHaveCount(0);
    const t2LastShownAfter = await pageTom.evaluate((k) => localStorage.getItem(k), T2_KEY);
    expect(t2LastShownAfter).toBe(t2LastShownBefore);

    // Simulate the cooldown day having elapsed: the same real call now shows the toast again.
    await expireCooldown(pageTom, T2_KEY);
    await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.maybeShowMatchSafetyToast?.());
    await expect(t2Toast).toBeVisible({ timeout: 2_500 });
  });
});
