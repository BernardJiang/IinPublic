/**
 * UI shell contract: five bottom tabs, merged Me answers, contextual stats, and Settings controls.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { afterNav, afterSync } from './helpers/timing';
import { webBaseURL } from './helpers/ports';

test.describe('UI navigation and settings shell', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunDatabases();
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
    await clearGunDatabases();
  });

  test('bottom navigation exposes Chatrooms, Contacts, Talks, Me, Settings only', async () => {
    const p = page!;
    await expect(p.locator('.bottom-nav .nav-label')).toHaveText([
      'Chatrooms',
      'Contacts',
      'Talks',
      'Me',
      'Settings',
    ]);
    await expect(p.locator('.nav-btn[data-view="answers"]')).toHaveCount(0);
    await expect(p.locator('.nav-btn[data-view="statistics"]')).toHaveCount(0);

    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await expect(p.locator('#status-bar-text')).not.toContainText(/User.* in /);
    await expect(p.locator('#chatroom-action-bar')).toContainText('New Room');
    await expect(p.locator('#chatroom-action-bar')).toContainText('Return Home');
    await expect(p.locator('#chatroom-action-bar')).toContainText('Broadcast');
    await expect(p.locator('body')).not.toContainText('Uses talks from Talks OUT');
    await expect(p.locator('#return-home-btn')).toBeEnabled();
    await expect(p.locator('#chatrooms-stats-strip')).toHaveCount(0);
    await expect
      .poll(async () => {
        return p.locator('#broadcast-talk-btn').evaluate((button) => {
          const bar = document.getElementById('chatroom-action-bar')?.getBoundingClientRect();
          const rect = button.getBoundingClientRect();
          return {
            compact: rect.width < 180,
            sameRow: bar ? Math.abs(rect.top - bar.top) < 16 : false,
          };
        });
      })
      .toEqual({ compact: true, sameRow: true });

    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('#me-view')).toBeVisible();
    await expect(p.locator('#answers-content')).toBeVisible();
    await expect(p.locator('.me-answer-filter')).toHaveText(['All', 'Auto', 'Manual', 'Conditional']);

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#settings-view')).toBeVisible();
    await expect(p.locator('#settings-content')).toContainText('Languages');
    await expect(p.locator('#settings-copy-talk-autosave')).toBeVisible();
    await expect(p.locator('#settings-chatbot-enabled')).toBeVisible();
    await expect(p.locator('#settings-grammar-filter')).toBeVisible();
    await expect(p.locator('#settings-dirty-words-filter')).toBeVisible();
    await expect(p.locator('#settings-credit-visible')).toBeVisible();
  });

  test('settings tolerates legacy string-valued profile and filter fields', async () => {
    const p = page!;
    await p.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const ui = app.uiManager;
      ui.showMainInterface({
        id: 'legacy-user',
        stageName: 'Legacy User',
        profile: [],
        reputation: {
          questionsAnswered: 0,
          talksSent: 0,
          matchesFound: 0,
          friendsCount: 0,
          mutualFriendsCount: 0,
          likedCount: 0,
          dislikedCount: 0,
          starRating: 3,
          reviewCount: 0,
          ageVerified: false,
          ageVerificationVotes: 0,
          blockCount: 0,
          isHidden: false,
        },
        location: { region: 'region_37.77_-122.42', chatrooms: ['global'] },
        languages: 'en, zh',
        interests: [],
        createdAt: new Date(),
        lastActive: new Date(),
        talkFilters: {
          allowedLanguages: 'en, zh',
          requireGoodGrammar: true,
          blockDirtyWords: false,
          allowedTalkTypes: 'flow',
          customBlockedTerms: 'spam, scam',
        },
      });
    });

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('body')).not.toContainText('Oops! Something went wrong');
    await expect(p.locator('#settings-profile-languages')).toHaveValue('en, zh');
    await expect(p.locator('#settings-filter-languages')).toHaveValue('en, zh');
    await expect(p.locator('#settings-custom-blocked')).toHaveValue('spam, scam');
  });
});
