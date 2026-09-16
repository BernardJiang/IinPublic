/**
 * WP5 device-sync — the "Enable sync" handshake on two already-linked devices, then a real
 * `preferences` (talk intake filters) change on one device arriving on the other. This is the
 * first live-transport E2E coverage for the WP5 protocol (shared/device-sync-*.ts): the
 * orchestration itself was already unit-proven (device-sync-outbox.test.ts et al. and this
 * session's own web-device-sync-service.test.ts), but never driven through a real browser/Gun
 * round trip before. Bootstrap mirrors 73-identity-link-mutual.spec.ts exactly — two independent
 * installations, real QR/code UI, mutual signed approval — since device-sync deliberately reuses
 * "linked" as its trust precondition rather than inventing a separate one.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

async function openIdentityDevices(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="settings"]').click();
  await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
  await page.locator('[data-testid="settings-linked-devices-btn"]').click();
  await expect(page.locator('[data-testid="linked-devices-page"]')).toBeVisible();
}

async function bootstrapDevice(browser: Browser, label: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 760, height: 960 } });
  const page = await context.newPage();
  page.on('console', (m) => console.log(`[${label}]:`, m.text()));
  page.on('pageerror', (e) => console.log(`[${label} pageerror]:`, e.message));
  await injectIdbClear(page);
  await gotoWebApp(page, webBaseURL());
  await afterLoad();
  return { context, page };
}

/** Real link flow, identical to 73-identity-link-mutual.spec.ts's happy path — A generates a
 * code, B enters it, A approves B's request, B confirms both signatures verify. */
async function linkDevices(a: Page, b: Page): Promise<void> {
  await Promise.all([openIdentityDevices(a), openIdentityDevices(b)]);

  await a.locator('[data-testid="link-a-device-btn"]').click();
  await a.locator('[data-testid="confirm-generate-link-code"]').click();
  const code = (await a.locator('[data-testid="link-device-code"]').textContent()) || '';
  expect(code).not.toBe('');

  await b.locator('[data-testid="enter-link-code-btn"]').click();
  await b.locator('[data-testid="enter-link-code-input"]').fill(code);
  await b.locator('[data-testid="enter-link-code-submit"]').click();
  await expect(b.locator('[data-testid="linked-device-row"]')).toContainText('Waiting for approval', { timeout: 20_000 });

  const check = a.locator('[data-testid="link-device-check-request"]');
  await expect(check).toBeVisible();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await check.click();
    const approve = a.locator('[data-testid="approve-link-request"]');
    await expect.poll(async () =>
      (await approve.isVisible().catch(() => false)) || (await check.isEnabled().catch(() => false)),
    { timeout: 12_000 }).toBe(true);
    if (await approve.isVisible().catch(() => false)) break;
    await a.waitForTimeout(400);
  }
  await expect(a.locator('[data-testid="approve-link-request"]')).toBeVisible();
  await a.locator('[data-testid="approve-link-request"]').click();
  await expect(a.locator('[data-testid="linked-device-row"]')).toContainText('Linked');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await b.locator('[data-testid="refresh-linked-devices"]').click();
    if ((await b.locator('[data-testid="linked-device-row"]').textContent())?.includes('Linked')) break;
    await b.waitForTimeout(500);
  }
  await expect(b.locator('[data-testid="linked-device-row"]')).toContainText('Linked');
}

test.describe('device sync (WP5): continuous preferences sync between linked devices', () => {
  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterEach(async () => {
    await clearGunForStage2Spec();
  });

  test('enabling sync on both sides propagates a talk-filter change from one device to the other', async ({ browser }) => {
    // Fixed bug (found via this exact test): both devices independently seed a "preferences"
    // record at boot (their default TalkIntakeFilters) before either ever enables sync.
    // `syncPreferencesToAllPeers` used to rebuild its outgoing record with a fresh `updatedAt` on
    // every tick, even when the value hadn't changed, so a device sitting idle with its own
    // unchanged default kept "winning" convergence against a peer's genuinely newer edit purely
    // because its own timestamp kept marching forward in real time. Fixed by building the record
    // once, when the value actually changes, and reusing it across every retry.
    test.setTimeout(120_000);
    const a = await bootstrapDevice(browser, 'A');
    const b = await bootstrapDevice(browser, 'B');

    try {
      await linkDevices(a.page, b.page);

      // Each side explicitly enables sync toward the other — mutual, symmetric consent, same
      // discipline as the link itself. Order doesn't matter: whichever side's authorization
      // publishes second is what flips both rows to "Syncing".
      await a.page.locator('[data-testid="linked-device-sync-btn"]').click();
      await b.page.locator('[data-testid="linked-device-sync-btn"]').click();
      await expect(a.page.locator('[data-testid="linked-device-row"]')).toContainText('Syncing', { timeout: 15_000 });
      await expect(b.page.locator('[data-testid="linked-device-row"]')).toContainText('Syncing', { timeout: 15_000 });

      // A changes a real talk-filter setting (requireGoodGrammar) through the ordinary Settings UI.
      await a.page.locator('[data-testid="linked-devices-close"]').click();
      await b.page.locator('[data-testid="linked-devices-close"]').click();
      await openSettingsSection(a.page, SETTINGS_SECTION.contentFilters);
      const grammarCheckbox = a.page.locator('#settings-grammar-filter');
      const before = await grammarCheckbox.isChecked();
      await grammarCheckbox.setChecked(!before);

      // B never touched Settings itself — the periodic device-sync tick (5s interval) delivers
      // the change and applies it to B's live talkFilters, re-rendering Settings if open.
      await b.page.locator('.nav-btn[data-view="settings"]').click();
      await openSettingsSection(b.page, SETTINGS_SECTION.contentFilters);
      await expect.poll(
        async () => b.page.locator('#settings-grammar-filter').isChecked(),
        { timeout: 60_000, intervals: [2_000] },
      ).toBe(!before);
    } finally {
      await Promise.all([
        a.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {}),
        b.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {}),
      ]);
      await Promise.all([a.context.close(), b.context.close()]);
    }
  });
});
