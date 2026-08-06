/**
 * Unified peer/contact detail (redesign §5, T5): clicking a user from a chatroom
 * member list and clicking the same user from the Contacts tab land on the IDENTICAL
 * shared ⟨User⟩ layout — same component, same DOM structure, same section order
 * (context → stats → messaging → talk history).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { afterLoad, afterSync, afterNav } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe.configure({ timeout: 120_000 });

test.describe('Peer/contact layout parity', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    browserJerry = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
  });

  test.afterAll(async () => {
    for (const p of [pageTom, pageJerry]) {
      await p?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  async function bootstrap(browser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.click('.chatroom-item:has-text("Global")');
    await afterSync();
    return { context, page };
  }

  /** Structural fingerprint of the User layout: section ids in DOM order + header controls. */
  async function layoutFingerprint(page: Page): Promise<{ sections: string[]; name: string; hasBar: boolean }> {
    return page.evaluate(() => {
      const body = document.querySelector('#peer-detail-overlay .peer-detail-body');
      const sections = Array.from(body?.children || [])
        .map((el) => el.id || el.className.split(' ')[0])
        .filter(Boolean);
      return {
        sections,
        name: document.getElementById('peer-detail-name')?.textContent || '',
        hasBar: !!document.querySelector('#peer-detail-overlay .app-bar #peer-send-talks-btn'),
      };
    });
  }

  test('both entry points render the identical shared layout', async () => {
    ({ context: contextTom, page: pageTom } = await bootstrap(browserTom, 'TomParity'));
    ({ context: contextJerry, page: pageJerry } = await bootstrap(browserJerry, 'JerryParity'));
    const tom = pageTom!;

    // ── Entry 1: chatroom member row ─────────────────────────────────────────
    await tom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
    const memberRow = tom.locator('.chatroom-member-item').filter({ hasText: 'JerryParity' }).first();
    await expect(memberRow).toBeVisible({ timeout: 15_000 });
    await memberRow.click();
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await tom.click('#back-from-conversation');
    await expect(tom.locator('#peer-detail-overlay')).toBeVisible();
    const fromMember = await layoutFingerprint(tom);

    // The retired contact-detail page must not exist anywhere.
    await expect(tom.locator('#contact-detail-container')).toHaveCount(0);

    await tom.click('#back-from-peer-detail');

    // ── Entry 2: contact row (the DM conversation created above makes Jerry a contact) ──
    await tom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const contactRow = tom.locator('#contacts-list .contact-item').filter({ hasText: 'JerryParity' }).first();
    await expect(contactRow).toBeVisible({ timeout: 20_000 });
    await contactRow.click();
    // contacts-view.ts tap-target split: the row click lands directly on the shared
    // ⟨User⟩ layout (peer-detail) — no DM conversation step to back out of first.
    await expect(tom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    const fromContact = await layoutFingerprint(tom);

    // Identical screen from both entry points (T5).
    expect(fromContact.sections).toEqual(fromMember.sections);
    expect(fromContact.name).toBe(fromMember.name);
    expect(fromContact.hasBar).toBe(true);
    expect(fromMember.hasBar).toBe(true);

    // Section order per redesign §5: context → stats → messaging → talk history.
    const order = fromContact.sections;
    expect(order.indexOf('peer-context-section')).toBeLessThan(order.indexOf('peer-stats-section'));
    expect(order.indexOf('peer-stats-section')).toBeLessThan(order.indexOf('peer-messaging-section'));
    expect(order.indexOf('peer-messaging-section')).toBeLessThan(order.indexOf('peer-talk-history-list'));
  });
});
