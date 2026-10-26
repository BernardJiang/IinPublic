/**
 * OPEN-87 S5 bounded Contacts: 600 people this user only exchanged Talks with, plus one Friend.
 * Choosing "500" in Settings prunes the 100 oldest exchange-only people (their exchange records are
 * deleted and they leave Contacts); the Friend stays; a new exchange brings a pruned person back.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { afterNav } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';

/* eslint-disable @typescript-eslint/no-explicit-any */

test.describe('Contacts cap (OPEN-87)', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('choosing 500 prunes the oldest exchange-only people and keeps relationships', async () => {
    const p = page!;
    await p.evaluate(() => {
      const exchanges: Record<string, any> = {};
      const day = 86_400_000;
      for (let i = 0; i < 600; i += 1) {
        const peerId = `peer-${String(i).padStart(3, '0')}`;
        // peer-000 is the newest exchange, peer-599 the oldest.
        exchanges[`${peerId}::t`] = {
          peerId, peerName: `Peer ${i}`, talkId: 't', title: 'Tag', type: 'tag', outcome: 'mismatch',
          direction: 'sent', date: new Date(Date.UTC(2026, 9, 24) - i * day).toISOString(),
        };
      }
      exchanges['friend-1::t'] = { peerId: 'friend-1', peerName: 'Old Friend', talkId: 't', type: 'tag', outcome: 'mismatch', direction: 'sent', date: '2020-01-01T00:00:00.000Z' };
      localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
      const app = (window as any).__iinpublic_app.getApp();
      app.currentUser.knownPeople = [...(app.currentUser.knownPeople || []), { userId: 'friend-1', labels: ['friend'] }];
    });

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.talkBehavior);
    await expect(p.locator('[data-testid="settings-contacts-cap"]')).toHaveValue('1000');
    await p.locator('[data-testid="settings-contacts-cap"]').selectOption('500');

    const state = () => p.evaluate(() => {
      const exchanges = ((window as any).__iinpublic_exchanges?.() ?? {});
      const peers = new Set(Object.values<any>(exchanges).map((exchange) => exchange.peerId));
      const pruned = JSON.parse(localStorage.getItem('iinpublic_contacts_pruned_v1') || '[]');
      return { peers: peers.size, pruned: pruned.length, friend: peers.has('friend-1'), newest: peers.has('peer-000'), oldest: peers.has('peer-599') };
    });
    await expect.poll(state, { timeout: 15_000 }).toEqual({ peers: 501, pruned: 100, friend: true, newest: true, oldest: false });

    // Contacts no longer lists a pruned person; the Friend is still there.
    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await p.locator('#contacts-filter-name').fill('Peer 599');
    await expect(p.locator('.contact-item').filter({ hasText: 'Peer 599' })).toHaveCount(0);
    await p.locator('#contacts-filter-name').fill('Old Friend');
    await expect(p.locator('.contact-item').filter({ hasText: 'Old Friend' })).toHaveCount(1);

    // A new exchange with a pruned person brings them back.
    await p.evaluate(() => (window as any).__iinpublic_app.getApp().recordLocalTalkExchange(
      'peer-599', 'Peer 599', 't2', { title: 'Tag 2', type: 'tag' }, 'match', { direction: 'sent' }));
    expect(await p.evaluate(() => JSON.parse(localStorage.getItem('iinpublic_contacts_pruned_v1') || '[]').includes('peer-599'))).toBe(false);
  });
});
