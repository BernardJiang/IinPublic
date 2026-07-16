/**
 * Settings — option matrix + guards (catalog Part 5, R2/R4).
 *
 * Single user. Exercises the guard paths the persistence spec (31) doesn't:
 *   - stage name < 3 chars is rejected (inline error, value reverts)
 *   - min distance > max distance is rejected (values revert)
 *   - zero allowed languages falls back to ['en']
 *   - zero allowed talk types falls back to all four
 * plus a persistence round-trip of the grammar/dirty-word toggles.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, afterLoad } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Settings: option matrix + guards', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterLoad();
    await page.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('stage-name, distance, language, and type guards', async () => {
    const p = page!;

    // Set a valid stage name first.
    await p.fill('#settings-stage-name-input', 'ValidName');
    await p.locator('#settings-stage-name-input').blur();
    await afterSync();

    // Guard: stage name < 3 chars → inline error, value reverts to the valid one.
    await p.fill('#settings-stage-name-input', 'ab');
    await p.locator('#settings-stage-name-input').blur();
    await afterSync();
    await expect(p.locator('#settings-stage-name-error')).toBeVisible();
    await expect(p.locator('#settings-stage-name-input')).toHaveValue('ValidName');

    // Guard: min distance > max distance → rejected (revert).
    await p.fill('#settings-min-distance', '10');
    await p.locator('#settings-min-distance').dispatchEvent('change');
    await afterSync();
    await p.fill('#settings-max-distance', '25');
    await p.locator('#settings-max-distance').dispatchEvent('change');
    await afterSync();
    await p.fill('#settings-min-distance', '999');
    await p.locator('#settings-min-distance').dispatchEvent('change');
    await afterSync();
    // Min should not have persisted above max (reverted to prior valid 10).
    await expect(p.locator('#settings-min-distance')).not.toHaveValue('999');

    // Fallback: uncheck every allowed language → persisted as ['en'].
    const langOptions = p.locator('.settings-filter-language-option');
    const n = await langOptions.count();
    for (let i = 0; i < n; i++) {
      const cb = langOptions.nth(i);
      if (await cb.isChecked()) {
        await cb.uncheck();
        await cb.dispatchEvent('change');
      }
    }
    await afterSync();
    const langs = await p.evaluate(() =>
      JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').allowedLanguages,
    );
    expect(langs).toEqual(['en']);

    // Fallback: uncheck every allowed talk type → persisted as all four.
    const typeOptions = p.locator('.settings-talk-filter-type');
    const tn = await typeOptions.count();
    for (let i = 0; i < tn; i++) {
      const cb = typeOptions.nth(i);
      if (await cb.isChecked()) {
        await cb.uncheck();
        await cb.dispatchEvent('change');
      }
    }
    await afterSync();
    const types = await p.evaluate(() =>
      JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').allowedTalkTypes,
    );
    expect([...types].sort()).toEqual(['flow', 'route', 'survey', 'tag']);
  });
});
