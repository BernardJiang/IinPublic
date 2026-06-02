import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';

const P2P_DIRECT_ENABLED = process.env.P2P_DIRECT_CHAT_ENABLED !== '0';

test.describe('P2P roadmap P4 — conversation transport and signaling', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('debug storage exposes transport modes and signaling accepts encrypted setup only', async ({ request }) => {
    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const payload = await storage.json();
    expect(payload.conversationTransport).toEqual(
      expect.objectContaining({
        activeMode: P2P_DIRECT_ENABLED ? 'direct-p2p' : 'star-gun',
        availableModes: ['star-gun', 'server-relay', 'direct-p2p'],
        messageBodyStorage: P2P_DIRECT_ENABLED ? 'gun-local' : 'gun-legacy',
      }),
    );

    const posted = await request.post(`${gunBaseURL()}/api/p2p/signaling/conv_e2e_transport`, {
      data: {
        kind: 'offer',
        senderPub: 'pub_e2e_a',
        recipientPub: 'pub_e2e_b',
        signalCiphertext: 'SEA{"ct":"offer"}',
        signature: 'sig_e2e_a',
        nonce: 'nonce_e2e_a',
      },
    });
    expect(posted.ok()).toBeTruthy();
    expect((await posted.json()).envelope).toEqual(
      expect.objectContaining({
        conversationId: 'conv_e2e_transport',
        kind: 'offer',
        signalCiphertext: 'SEA{"ct":"offer"}',
      }),
    );

    const plaintext = await request.post(`${gunBaseURL()}/api/p2p/signaling/conv_e2e_transport`, {
      data: {
        kind: 'offer',
        senderPub: 'pub_e2e_a',
        recipientPub: 'pub_e2e_b',
        signalCiphertext: '{"sdp":"plain"}',
        signature: 'sig_e2e_a',
        nonce: 'nonce_e2e_plain',
      },
    });
    expect(plaintext.status()).toBe(400);

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#storage-inspector-conversation-transport')).toBeVisible();
    await expect(p.locator('#storage-inspector-conversation-transport')).toContainText('Conversation Transport');
    await expect(p.locator('#storage-inspector-conversation-transport-modes')).toContainText('direct-p2p');
  });
});
