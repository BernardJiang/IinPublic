/**
 * OPEN-91 P1 / OPEN-88 part 2: the exchange log lives in the device core's Gun (`local/exchanges`,
 * IndexedDB on the web), not in localStorage. Exchanges from an earlier version (the old
 * `localTalkExchanges` blob) are imported once and the blob removed; after a reload they come back
 * from the core, and Contacts still lists the people.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { gotoWebApp } from '../../helpers/clear-database';
import { headless } from '../../helpers/timing';
import { bootstrapUser } from '../../helpers/talks-matching-flow';

/* eslint-disable @typescript-eslint/no-explicit-any */

const people = (page: Page) => page.locator('.contact-item[data-contact-user-id]:not([data-support-contact="true"])');
const exchangeKeys = (page: Page) => page.evaluate(() => Object.keys((window as any).__iinpublic_exchanges?.() ?? {}).sort());

test.describe('The exchange log in the device core', () => {
  let browser: Browser | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
  });

  test.afterAll(async () => {
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('old exchanges are imported once, kept in the core, and come back after a reload', async () => {
    test.setTimeout(120_000);
    browser = await chromium.launch({ headless });
    const { page } = await bootstrapUser(browser, 'Core', 'Core Owner');

    // An earlier version left its exchanges in localStorage.
    await page.evaluate(() => {
      localStorage.setItem('localTalkExchanges', JSON.stringify({
        'core-ann::qa_pizza': { peerId: 'core-ann', peerName: 'Ann Old', talkId: 'qa_pizza', title: 'Pizza', type: 'tag', outcome: 'match', direction: 'sent', date: '2026-10-20T10:00:00.000Z' },
        'core-ben::qa_jazz': { peerId: 'core-ben', peerName: 'Ben Old', talkId: 'qa_jazz', title: 'Jazz', type: 'tag', outcome: 'mismatch', direction: 'received', date: '2026-10-21T10:00:00.000Z' },
      }));
    });
    await page.locator('.nav-btn[data-view="contacts"]').click();
    await expect(people(page)).toHaveCount(2, { timeout: 15_000 });
    expect(await exchangeKeys(page)).toEqual(['core-ann::qa_pizza::sent', 'core-ben::qa_jazz::received']);
    expect(await page.evaluate(() => localStorage.getItem('localTalkExchanges'))).toBeNull();

    // Stored in the device core, not only in the view: the core's own snapshot holds both.
    const coreCount = () => page.evaluate(async () => {
      const bridge = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getBridge?.();
      try { return ((await bridge.core({ name: 'exchanges.snapshot' })) || []).length; } catch { return -1; }
    });
    await expect.poll(coreCount, { timeout: 20_000 }).toBe(2);
    // A reload reads them back from the device core (IndexedDB), not from localStorage.
    await gotoWebApp(page, page.url());
    await expect.poll(coreCount, { timeout: 20_000 }).toBe(2);
    await expect.poll(() => exchangeKeys(page), { timeout: 20_000 }).toEqual(['core-ann::qa_pizza::sent', 'core-ben::qa_jazz::received']);
    expect(await page.evaluate(() => localStorage.getItem('localTalkExchanges'))).toBeNull();
    await page.locator('.nav-btn[data-view="contacts"]').click();
    await expect(people(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(people(page).filter({ hasText: 'Ann Old' })).toHaveCount(1);
  });
});
