/**
 * GUI responsiveness with a peer (test plan P2): two matched users; then Tom's hub is stalled and
 * every control on the screens that need a peer — Contacts with a real contact, the person page,
 * the conversation — must react at once, and the actions about Tom's own data must hold offline.
 *
 * docs/testing/gui-responsiveness-test-plan.md §4.3–4.5, audit F2/F5/F13 and the person-page stats.
 */
import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { dismissNotificationOverlays } from '../helpers/durable-ui';
import { reloadAppReady } from '../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { setupLeanMatchedPair, type LeanMatchedPair } from '../helpers/fast-match-lean';
import {
  expectClickResponds,
  formatSweepFailures,
  installMainThreadProbe,
  stallHub,
  sweepClickables,
  type HubFaultHandle,
} from '../helpers/ui-responsiveness';

test.describe('GUI responsiveness: two users, hub stalled for one', () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  let browserA: Browser;
  let browserB: Browser;
  let pair: LeanMatchedPair;
  let tom: Page;
  let fault: HubFaultHandle | undefined;

  const closeOverlays = async (): Promise<void> => {
    await tom.keyboard.press('Escape').catch(() => undefined);
    await tom.evaluate(() => document.querySelectorAll('.modal-overlay, .notification, [id$="-modal"]').forEach((e) => e.remove()));
    for (const back of ['#back-from-conversation', '#back-from-media', '#back-from-peer-detail']) {
      const button = tom.locator(back);
      if (await button.isVisible().catch(() => false)) await button.click({ timeout: 1_000 }).catch(() => undefined);
    }
  };
  const openContacts = async (): Promise<void> => {
    await closeOverlays();
    await tom.locator('.nav-btn[data-view="contacts"]').click();
    const back = tom.locator('#back-to-contacts-list');
    if (await back.isVisible().catch(() => false)) await back.click();
    await expect(tom.locator(`.contact-item[data-contact-user-id="${pair.userIdB}"]`)).toBeVisible({ timeout: 15_000 });
    await dismissNotificationOverlays(tom);
  };
  const openPersonPage = async (): Promise<void> => {
    await openContacts();
    await tom.locator(`.contact-item[data-contact-user-id="${pair.userIdB}"] .contact-item-name`).click();
    await expect(tom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 2_000 });
    await dismissNotificationOverlays(tom);
  };
  const openConversation = async (): Promise<void> => {
    await closeOverlays();
    await tom.evaluate((id) => (window as any).__iinpublic_app.getApp().uiManager.showConversationDetail(id), pair.conversationId);
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 2_000 });
    await dismissNotificationOverlays(tom);
  };

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
    browserA = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    browserB = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    pair = await setupLeanMatchedPair(browserA, browserB, 'TomResp', 'JerryResp');
    tom = pair.pageA;
    await installMainThreadProbe(tom);
    // The probe is an init script: reload once so this page has it, then stall Tom's hub.
    await reloadAppReady(tom);
    fault = await stallHub(tom);
  });

  test.afterAll(async () => {
    await fault?.clear().catch(() => undefined);
    await pair?.contextA?.close().catch(() => undefined);
    await pair?.contextB?.close().catch(() => undefined);
    await browserA?.close().catch(() => undefined);
    await browserB?.close().catch(() => undefined);
    await clearGunForStage1Spec();
  });

  test('every control on Contacts (with a real contact) responds', async () => {
    const report = await sweepClickables(tom, { surface: 'contacts/with-peer', scope: '#contacts-view', restore: openContacts });
    expect(report.clicked).toBeGreaterThan(1);
    expect(formatSweepFailures([report])).toBe('');
  });

  test('every control on the person page responds; its stats are not stuck on "Loading"', async () => {
    await openPersonPage();
    await expect(tom.locator('#peer-stats-section')).not.toContainText(/Loading relationship stats/i, { timeout: 1_000 });
    const report = await sweepClickables(tom, {
      surface: 'person-page',
      scope: '#peer-detail-overlay',
      restore: openPersonPage,
      // Block has its own test below (it changes what the rest of this file sees).
      deny: ['#peer-block-user-btn', '#back-from-peer-detail'],
    });
    expect(report.clicked).toBeGreaterThan(2);
    expect(formatSweepFailures([report])).toBe('');
  });

  test('every control in the conversation responds', async () => {
    const report = await sweepClickables(tom, {
      surface: 'conversation',
      scope: '#conversation-detail-overlay',
      restore: openConversation,
      deny: ['#back-from-conversation'],
    });
    expect(report.clicked).toBeGreaterThan(0);
    expect(formatSweepFailures([report])).toBe('');
  });

  test('a message sends (is stored and the composer clears) with the hub stalled', async () => {
    await openConversation();
    const text = `offline hello ${Date.now()}`;
    await tom.fill('#conversation-message-input', text);
    await expectClickResponds(tom, tom.locator('#send-conversation-message'), 'Send');
    await expect(tom.locator('#conversation-message-input')).toHaveValue('', { timeout: 5_000 });
    await expect(tom.locator('#send-conversation-message')).toBeEnabled({ timeout: 5_000 });
    await expect(tom.locator('#conversation-messages')).toContainText(text, { timeout: 5_000 });
  });

  test('Block works with the hub stalled: the page closes at once and the block survives a reload', async () => {
    await openPersonPage();
    await tom.locator('#peer-overflow-btn').click();
    await expectClickResponds(tom, tom.locator('#peer-block-user-btn'), 'Block');
    const skip = tom.locator('[data-testid="block-notify-skip"]');
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await expect(tom.locator('#peer-detail-overlay')).toBeHidden({ timeout: 1_000 });
    const blockedNow = () => tom.evaluate((peer) =>
      ((window as any).__iinpublic_app.getApp().currentUser?.blockedUserIds || []).includes(peer), pair.userIdB);
    expect(await blockedNow()).toBe(true);
    // R6: saved on this device (its private store) within a few seconds, though the hub never
    // answered — and still blocked after a reload.
    const started = Date.now();
    await expect.poll(() => tom.evaluate(async (peer) => {
      const data = await (window as any).__iinpublic_app.getApp().gunService.getPrivate('profile').catch(() => null);
      return Array.isArray(data?.blockedUserIds) && data.blockedUserIds.includes(peer);
    }, pair.userIdB), { timeout: 5_000, intervals: [200] }).toBe(true);
    console.log(`[block] saved on the device ${Date.now() - started} ms after the tap`);
    // The device core flushes its store to disk in batches; reload as a person would, not within
    // the same millisecond.
    await tom.waitForTimeout(1_000);
    await reloadAppReady(tom);
    expect(await blockedNow()).toBe(true);
  });
});
