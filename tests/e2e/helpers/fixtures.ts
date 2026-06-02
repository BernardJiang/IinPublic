/**
 * Playwright fixtures: override `baseURL` per-worker so `page.goto('/')` hits
 * the webpack dev-server assigned to this worker (see ./ports.ts).
 *
 * Config-level `use.baseURL` is evaluated once in the main process, before
 * worker indices exist. The `e2eWorkerSlot` worker fixture runs first and sets
 * parallelSlotOverride from workerInfo.parallelIndex so helpers (ports, clears,
 * artifact paths) agree with Playwright before any `beforeAll` hook runs.
 *
 * Every spec file should import `test` and `expect` from this module instead
 * of `@playwright/test` so they share this fixture.
 */

import { test as base, expect } from '@playwright/test';
import { setE2eParallelSlotFromWorker, webBaseURL } from './ports';
import { clearE2eBrowserTabTitleRunContext, setE2eBrowserTabTitleRunContext } from './e2e-tab-title';
import { waitForAppReady, reloadAppReady } from './timing';

export const test = base.extend<{
  /** Worker parallel index (0 … workers−1); also initializes ports.ts slot. */
  e2eWorkerSlot: number;
}>({
  e2eWorkerSlot: [
    async ({}, use, workerInfo) => {
      setE2eParallelSlotFromWorker(workerInfo.parallelIndex);
      await use(workerInfo.parallelIndex);
    },
    { scope: 'worker', auto: true },
  ],
  baseURL: async ({ e2eWorkerSlot }, use) => {
    void e2eWorkerSlot;
    await use(webBaseURL());
  },
  /** After each app navigation, wait for Gun auth + main shell (bottom nav + currentUser). */
  page: async ({ page, baseURL }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await goto(url, options);
      const target = typeof url === 'string' ? url : url?.toString() ?? baseURL ?? '';
      if (target && !target.startsWith('about:')) {
        await page.waitForLoadState('load').catch(() => {});
        await waitForAppReady(page);
      }
      return response;
    };
    const reload = page.reload.bind(page);
    page.reload = async (options) => {
      const response = await reload(options);
      await reloadAppReady(page);
      return response;
    };
    await use(page);
  },
  /** Sets per-test metadata used by attachE2eBrowserTabLabel (spec file, worker, test title). */
  _e2eTabTitleContext: [
    async ({}, use, testInfo) => {
      setE2eBrowserTabTitleRunContext(testInfo);
      await use();
      clearE2eBrowserTabTitleRunContext();
    },
    { auto: true },
  ],
});

export { expect };
