/**
 * §J — real encrypted device-handoff transfer between two verified-linked identities
 * (spec §11.2/§11.3, docs/TODO.md item J).
 *
 * Two isolated browser installations first establish a real mutual `LINK_IDENTITY` link
 * (the same protocol `73-identity-link-mutual.spec.ts` exercises), then device A ("the
 * public PC") drives the real Sync-before-erase flow: build the archive, encrypt it to
 * device B's published epub, publish the signed envelope, and wait for B's signed
 * acknowledgement before Erase becomes reachable. Device B independently discovers the
 * archive addressed to it (never via a general "who sent me something" scan — only by
 * checking its own already-known linked pubs), decrypts, reviews, and explicitly presses
 * Import — nothing is merged automatically. Only after that does A observe the
 * acknowledgement and see Done enable.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync, afterNav } from '../../helpers/timing';
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
  await injectIdbClear(page);
  await gotoWebApp(page, webBaseURL());
  await afterLoad();
  return { context, page };
}

test.describe('device handoff transfer (§J)', () => {
  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterEach(async () => {
    await clearGunForStage2Spec();
  });

  test('A sends an encrypted archive to linked device B; B imports; A observes the ack and Done enables', async ({ browser }) => {
    test.setTimeout(120_000);
    const a = await bootstrapDevice(browser, 'A');
    const b = await bootstrapDevice(browser, 'B');

    try {
      // ── Establish a real mutual link between A and B (same protocol as stage2/73). ──
      await Promise.all([openIdentityDevices(a.page), openIdentityDevices(b.page)]);

      await a.page.locator('[data-testid="link-a-device-btn"]').click();
      await a.page.locator('[data-testid="confirm-generate-link-code"]').click();
      const code = (await a.page.locator('[data-testid="link-device-code"]').textContent()) || '';
      expect(code).not.toBe('');

      await b.page.locator('[data-testid="enter-link-code-btn"]').click();
      await b.page.locator('[data-testid="enter-link-code-input"]').fill(code);
      await b.page.locator('[data-testid="enter-link-code-submit"]').click();
      await expect(b.page.locator('[data-testid="linked-device-row"]')).toContainText(
        'Waiting for approval',
        { timeout: 20_000 },
      );

      const check = a.page.locator('[data-testid="link-device-check-request"]');
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await check.click();
        const approve = a.page.locator('[data-testid="approve-link-request"]');
        await expect.poll(async () =>
          (await approve.isVisible().catch(() => false)) || (await check.isEnabled().catch(() => false)),
        { timeout: 12_000 }).toBe(true);
        if (await approve.isVisible().catch(() => false)) break;
        await a.page.waitForTimeout(400);
      }
      await a.page.locator('[data-testid="approve-link-request"]').click();
      await expect(a.page.locator('[data-testid="linked-device-row"]')).toContainText('Linked');

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await b.page.locator('[data-testid="refresh-linked-devices"]').click();
        if ((await b.page.locator('[data-testid="linked-device-row"]').textContent())?.includes('Linked')) break;
        await b.page.waitForTimeout(500);
      }
      await expect(b.page.locator('[data-testid="linked-device-row"]')).toContainText('Linked');

      await a.page.locator('[data-testid="linked-devices-close"]').click();
      await b.page.locator('[data-testid="linked-devices-close"]').click();

      // ── Seed one verifiable piece of local data on A — the archive-builder reads this
      // exact localStorage key (app.ts's setDeviceHandoffSync), so a real send genuinely
      // carries it, not just the mechanism firing. ──
      const MARKER_TALK_ID = 'handoff-e2e-marker-talk';
      await a.page.evaluate((talkId) => {
        localStorage.setItem('myTalks', JSON.stringify({ [talkId]: { title: 'Selling a bike (handoff marker)' } }));
      }, MARKER_TALK_ID);

      // ── A: Erase this device → Save to ⟨device⟩ first — triggers the real encrypted send. ──
      await a.page.locator('.nav-btn[data-view="settings"]').click();
      await afterNav();
      await openSettingsSection(a.page, SETTINGS_SECTION.eraseDevice);
      await a.page.locator('[data-testid="settings-erase-device-btn"]').click();
      await afterNav();
      await expect(a.page.locator('[data-testid="erase-device-modal"]')).toBeVisible();
      await a.page.locator('[data-testid="erase-sync-first-btn"]').click();
      await expect(a.page.locator('[data-testid="erase-sync-progress-modal"]')).toBeVisible();
      // The send itself (encrypt + publish the envelope) happens before the ack-wait loop
      // starts, so by the time all 6 categories show progress the archive is already on
      // the graph, addressed to B.
      await expect(a.page.locator('.erase-sync-status[data-status="done"]')).toHaveCount(6, { timeout: 10_000 });

      // ── B: open Identity & devices — discovers the archive addressed to its own pub
      // (not a general scan; see web-device-handoff-service.ts's own doc comment on why
      // no discovery mechanism is needed), reviews, and explicitly imports. ──
      await openIdentityDevices(b.page);
      await expect(b.page.locator('[data-testid="incoming-handoff-card"]')).toBeVisible({ timeout: 20_000 });
      await b.page.locator('[data-testid="import-handoff-btn"]').click();
      await expect(b.page.locator('[data-testid="incoming-handoff-card"]')).toHaveCount(0, { timeout: 10_000 });

      const bImportedTalks = await b.page.evaluate(
        () => JSON.parse(localStorage.getItem('myTalks') || '{}'),
      );
      expect(bImportedTalks[MARKER_TALK_ID]?.title).toBe('Selling a bike (handoff marker)');

      // ── A: the sync-progress dialog observes B's signed ack and enables Done — never
      // before this point (§11.3's safety invariant, also covered negatively by
      // stage2/72 with an unreachable device). ──
      await expect(a.page.locator('[data-testid="erase-sync-done"]')).toBeEnabled({ timeout: 30_000 });
      await a.page.locator('[data-testid="erase-sync-done"]').click();
      await afterSync();
      await expect(a.page.locator('[data-testid="erase-device-btn"]')).toBeDisabled();
      await a.page.fill('[data-testid="erase-confirm-input"]', 'ERASE');
      await expect(a.page.locator('[data-testid="erase-device-btn"]')).toBeEnabled();
    } finally {
      await Promise.all([
        a.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {}),
        b.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {}),
      ]);
      await Promise.all([a.context.close(), b.context.close()]);
    }
  });
});
