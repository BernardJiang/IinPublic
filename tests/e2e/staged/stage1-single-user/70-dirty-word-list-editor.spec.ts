/**
 * Settings › Dirty-word filter list editor (redesign §9.1, TODO item H / T9).
 *
 * Verifies the editable dirty-word list on the Settings content-filters page:
 *   - the four defaults (fuck, cunt, bitch, cock) render as chips
 *   - add a word (chip appears), remove a word (chip gone)
 *   - Reset to defaults restores the four seeds
 *   - validation: <2 chars rejected, duplicate rejected, 51st entry rejected
 *   - the list persists across page.reload()
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';

const DEFAULTS = ['fuck', 'cunt', 'bitch', 'cock'];

test.describe('Settings: dirty-word list editor', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless: true,
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  async function openSettings(stageName: string): Promise<void> {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    attachE2eBrowserTabLabel(page, stageName);
    await page.waitForSelector('#dirty-word-chips', { timeout: 10000 });
    await afterLoad();
  }

  const chipWords = () =>
    page.$$eval('.dirty-word-chip', (els) => els.map((e) => e.getAttribute('data-word') || ''));

  test('defaults render, add/remove/reset, validation, and persistence', async () => {
    await openSettings('DirtyWordEditorUser');

    // Defaults present
    expect((await chipWords()).sort()).toEqual([...DEFAULTS].sort());

    // Add a new word
    await page.fill('#dirty-word-add-input', 'yikes');
    await page.click('#dirty-word-add-btn');
    await afterSync();
    expect(await chipWords()).toContain('yikes');

    // Remove a default (cock)
    await page.click('.dirty-word-chip[data-word="cock"] .dirty-word-chip-remove');
    await afterSync();
    expect(await chipWords()).not.toContain('cock');

    // Reject too-short (<2 chars)
    await page.fill('#dirty-word-add-input', 'a');
    await page.click('#dirty-word-add-btn');
    await afterSync();
    expect(await page.locator('#dirty-word-error').textContent()).not.toEqual('');
    expect(await chipWords()).not.toContain('a');

    // Reject duplicate
    await page.fill('#dirty-word-add-input', 'yikes');
    await page.click('#dirty-word-add-btn');
    await afterSync();
    expect((await chipWords()).filter((w) => w === 'yikes')).toHaveLength(1);

    // Reset to defaults
    await page.click('#dirty-word-reset-btn');
    await afterSync();
    expect((await chipWords()).sort()).toEqual([...DEFAULTS].sort());

    // Persist across reload: remove one, add one, reload, verify
    await page.click('.dirty-word-chip[data-word="bitch"] .dirty-word-chip-remove');
    await afterSync();
    await page.fill('#dirty-word-add-input', 'zzword');
    await page.click('#dirty-word-add-btn');
    await afterSync();
    await afterSync();

    await page.reload();
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#dirty-word-chips', { timeout: 10000 });
    await afterLoad();

    const afterReload = await chipWords();
    expect(afterReload).toContain('zzword');
    expect(afterReload).not.toContain('bitch');
    expect(afterReload).toContain('fuck');

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });

  test('rejects the 51st entry (cap 50)', async () => {
    await openSettings('DirtyWordCapUser');

    // Reset to a known 4, then fill up to 50 total.
    await page.click('#dirty-word-reset-btn');
    await afterSync();
    // Add words until 50 chips exist.
    for (let i = 0; (await page.locator('.dirty-word-chip').count()) < 50; i++) {
      await page.fill('#dirty-word-add-input', `capword${i}`);
      await page.click('#dirty-word-add-btn');
    }
    await afterSync();
    expect(await page.locator('.dirty-word-chip').count()).toBe(50);

    // The 51st is rejected with an inline error.
    await page.fill('#dirty-word-add-input', 'overflowword');
    await page.click('#dirty-word-add-btn');
    await afterSync();
    expect(await page.locator('.dirty-word-chip').count()).toBe(50);
    expect(await page.locator('#dirty-word-error').textContent()).not.toEqual('');

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
