/**
 * Playwright fixtures: override `baseURL` per-worker so `page.goto('/')` hits
 * the webpack dev-server assigned to this worker (see ./ports.ts).
 *
 * Config-level `use.baseURL` is evaluated once in the main process, before
 * worker indices exist. This fixture runs inside each worker, where
 * `TEST_WORKER_INDEX` is already populated, so the URL is correct per worker.
 *
 * Every spec file should import `test` and `expect` from this module instead
 * of `@playwright/test` so they share this fixture.
 */

import { test as base, expect } from '@playwright/test';
import { webBaseURL } from './ports';

export const test = base.extend<{}>({
  baseURL: async ({}, use) => {
    await use(webBaseURL());
  },
});

export { expect };
