import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';

test.describe('P2P roadmap P2 — permissioned local node supervisor', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('local node requires explicit permission, signed pairing, identity binding, and wipe controls', async ({ request }) => {
    const initial = await request.get(`${gunBaseURL()}/api/p2p/local-node`);
    expect(initial.ok()).toBeTruthy();
    const initialPayload = await initial.json();
    expect(initialPayload.status).toBe('stopped');
    expect(initialPayload.permissionDisclosures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'storage' }),
        expect.objectContaining({ key: 'bandwidth' }),
        expect.objectContaining({ key: 'battery' }),
        expect.objectContaining({ key: 'background' }),
        expect.objectContaining({ key: 'local-port' }),
        expect.objectContaining({ key: 'delete-stop' }),
      ]),
    );
    expect(initialPayload.sessionPairing.trustModel).toBe('signed-session-pairing');
    expect(initialPayload.persistenceControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataClass: 'neighbor-cache', localOnly: true }),
        expect.objectContaining({ dataClass: 'message-history', localOnly: true }),
      ]),
    );

    const started = await request.post(`${gunBaseURL()}/api/p2p/local-node/start`, { data: {} });
    expect(started.ok()).toBeTruthy();
    expect((await started.json()).status).toBe('running');

    const bound = await request.post(`${gunBaseURL()}/api/p2p/local-node/bind-identity`, {
      data: { webIdentityId: 'web_pub_e2e', nodeIdentityId: 'node_pub_e2e', proof: 'signed-proof-e2e' },
    });
    expect(bound.ok()).toBeTruthy();
    expect((await bound.json()).identityBinding).toEqual(
      expect.objectContaining({ webIdentityId: 'web_pub_e2e', nodeIdentityId: 'node_pub_e2e' }),
    );

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#storage-inspector-local-node')).toBeVisible();
    await expect(p.locator('#storage-inspector-local-node')).toContainText('Local Node Supervisor');
    await expect(p.locator('#storage-inspector-local-node')).toContainText('signed-session-pairing');
    await expect(p.locator('#storage-inspector-local-node-disclosures')).toContainText('Storage');
    await expect(p.locator('#storage-inspector-local-node-disclosures')).toContainText('Local port');
    await expect(p.locator('#storage-inspector-local-node-controls')).toContainText('neighbor-cache');

    const wiped = await request.post(`${gunBaseURL()}/api/p2p/local-node/wipe`, { data: {} });
    expect(wiped.ok()).toBeTruthy();
    expect((await wiped.json()).status).toBe('wiped');
  });
});
