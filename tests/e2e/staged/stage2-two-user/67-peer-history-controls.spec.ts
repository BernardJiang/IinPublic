/**
 * Peer history controls (catalog Part 5).
 *
 * Two matched users: open the shared User layout for the peer, then drive the
 * talk-history sort buttons (date/outcome), the direction filter tabs
 * (all/sent/received), and confirm the auto-mode checkbox persists its state.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterNav, afterSync } from '../../helpers/timing';
import { setupFastMatchedDm, teardownFastDmPair, FastDmPair } from '../../helpers/fast-dm-setup';

test.describe('Peer history controls', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=1000,1100'] });
    browserB = await chromium.launch({ headless, args: ['--window-position=1000,0', '--window-size=800,1100'] });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastDmPair(pair);
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('sort by date/outcome, filter all/sent/received, auto-mode persists', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'HistA', 'HistB');
    const { pageA, userIdB, nameB } = pair;

    // The fast-DM helper leaves the conversation overlay open; close it so it
    // doesn't cover the User layout's history controls.
    if (await pageA.locator('#conversation-detail-overlay').isVisible().catch(() => false)) {
      await pageA.click('#back-from-conversation');
      await afterNav();
    }

    // Open the shared User layout for peer B directly.
    await pageA.evaluate(
      ({ id, name }) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.openPeerDetailForUser?.(id, name),
      { id: userIdB, name: nameB },
    );
    await afterNav();
    await expect(pageA.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });

    // History controls appear once the pair has ≥1 exchanged talk.
    await expect(pageA.locator('#peer-history-controls')).toBeVisible({ timeout: 10000 });

    // Sort buttons.
    for (const sort of ['date', 'outcome']) {
      const btn = pageA.locator(`.peer-sort-btn[data-sort="${sort}"]`);
      if (await btn.count()) {
        await btn.first().click();
        await afterSync();
        await expect(btn.first()).toHaveClass(/active/);
      }
    }

    // Direction filter tabs.
    for (const filter of ['all', 'sent', 'received']) {
      const tab = pageA.locator(`.peer-filter-tab[data-filter="${filter}"]`);
      if (await tab.count()) {
        await tab.first().click();
        await afterSync();
        await expect(tab.first()).toHaveClass(/active/);
      }
    }

    // Auto-mode checkbox persists its toggled state within the session.
    const auto = pageA.locator('#peer-auto-mode-checkbox');
    if (await auto.count()) {
      const before = await auto.isChecked();
      await auto.setChecked(!before);
      await afterSync();
      await expect(auto).toBeChecked({ checked: !before });
    }
  });
});
