/** The controller restarts the relay process; this browser must reconnect without changing identity. */
import { test, expect } from '../helpers/fixtures';
import { gotoWebApp, injectIdbClear } from '../helpers/clear-database';
import { gunBaseURL, webBaseURL } from '../helpers/ports';

test.describe('relay process restart recovery', () => {
  test('retains identity, reconnects, and republishes to the restarted relay', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL(), 30_000);
    const originalPub = await page.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
    );
    expect(originalPub).toBeTruthy();

    const shutdown = await fetch(`${gunBaseURL()}/api/test/shutdown-hub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delayMs: 100 }),
    });
    expect(shutdown.status).toBe(202);

    let observedDown = false;
    await expect.poll(async () => {
      try {
        const response = await fetch(`${gunBaseURL()}/health`);
        if (!response.ok) observedDown = true;
        return observedDown && response.ok;
      } catch {
        observedDown = true;
        return false;
      }
    }, { timeout: 20_000, intervals: [100, 200, 500] }).toBe(true);

    const marker = `relay-restart-${Date.now()}`;
    let publishAttempt = 0;
    await expect.poll(async () => {
      publishAttempt += 1;
      await page.evaluate(async ({ id, attempt }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        await app.gunService.put(`e2e/relay-restart/${id}`, {
          id,
          afterRestart: true,
          attempt,
        });
      }, { id: marker, attempt: publishAttempt });
      const response = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
      if (!response.ok) return false;
      return JSON.stringify(await response.json()).includes(marker);
    }, { timeout: 30_000, intervals: [100, 250, 500, 1000] }).toBe(true);
    await expect.poll(() => page.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
    )).toBe(originalPub);

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context.close();
  });
});
