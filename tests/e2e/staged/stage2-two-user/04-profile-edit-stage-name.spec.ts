import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import * as fs from 'fs';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, delay, gotoAppReady, headless } from '../../helpers/timing';
import { webAppURLStableChatroom, gunBaseURL, e2eTestScreenshotsDir } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { establishContactsTomJerry, getCurrentUserId } from '../../helpers/reputation-e2e-helpers';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Profile foundation', () => {
  test.setTimeout(180_000);
  let browser: Browser;
  let browserPeer: Browser;
  let context: BrowserContext;
  let contextPeer: BrowserContext;
  let page: Page;
  let peerPage: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
    browserPeer = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=960,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    if (browserPeer) await browserPeer.close();
    await clearGunForStage2Spec();
  });

  test.afterEach(async () => {
    await page?.close();
    await peerPage?.close();
    await context?.close();
    await contextPeer?.close();
  });

  async function bootstrapUser(targetBrowser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const nextContext = await targetBrowser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    const nextPage = await nextContext.newPage();
    await injectIdbClear(nextPage);
    await gotoAppReady(nextPage, webAppURLStableChatroom());
    await ensureWindowFitsViewport(nextPage, 960, 1200);
    await afterLoad();
    await nextPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await nextPage.waitForSelector('#settings-stage-name-input');
    await nextPage.fill('#settings-stage-name-input', stageName);
    await nextPage.locator('#settings-stage-name-input').blur();
    await afterNav();
    attachE2eBrowserTabLabel(nextPage, stageName);
    return { context: nextContext, page: nextPage };
  }

  test('New user edits stage name and public profile, then peers can see it', async () => {
    const screenshotDir = e2eTestScreenshotsDir('04-profile');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    const me = await bootstrapUser(browser, 'Tom');
    context = me.context;
    page = me.page;
    page.on('console', (m) => console.log('[Tom]:', m.text()));

    await expect(page.locator('[data-testid="user-stage-name"]')).toContainText('Tom');
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await expect(page.locator('.header-user-info')).toContainText('Tom');

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await expect(page.locator('#settings-content')).not.toContainText('Interests: None listed');
    const reservedStageNames = [
      'TechSupport',
      'tech_support',
      'Tech Support',
      'ROOT',
      'admin',
      'administrator',
      'system',
      'support',
      'api',
      'www',
    ];
    for (const reservedName of reservedStageNames) {
      await page.fill('#settings-stage-name-input', reservedName);
      await page.locator('#settings-stage-name-input').blur();
      await expect(page.locator('#settings-stage-name-error')).toContainText(
        'That stage name is reserved. Please choose another name.',
        { timeout: 10000 },
      );
      await expect(page.locator('#settings-stage-name-input')).toHaveValue('Tom', { timeout: 10000 });
    }
    for (const reservedName of reservedStageNames) {
      const response = await page.request.post(`${gunBaseURL()}/api/users`, {
        data: { stageName: reservedName, profile: [], languages: ['en'], interests: [] },
      });
      expect(response.status(), `ordinary API account should not claim ${reservedName}`).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/reserved/i) });
    }
    await expect(page.locator('[data-testid="user-stage-name"]')).toContainText('Tom');
    await page.selectOption('#settings-headshot-select', '😎');
    await page.selectOption('#settings-profile-languages', 'en');
    await page.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const user = app?.currentUser;
      if (!user?.id || !app?.uiManager?.onProfileChange) throw new Error('Profile callback not ready');
      await app.uiManager.onProfileChange(user.id, {
        headshot: '😎',
        languages: ['en'],
        interests: [],
        profile: [
          {
            id: 'profile_1',
            question: 'Favorite drink',
            answer: 'Coffee',
            isAuto: false,
            answeredAt: new Date(),
          },
          {
            id: 'profile_2',
            question: 'Usual city',
            answer: 'San Diego',
            isAuto: false,
            answeredAt: new Date(),
          },
        ],
      });
    });
    await afterNav();

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await expect(page.locator('#settings-profile-languages')).toHaveValue('en');
    const tomUserId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
    const publicHeadshot = async () => {
      const res = await page.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(tomUserId)}`);
      if (!res.ok()) return 'request-failed';
      const user = await res.json() as any;
      return String(user?.headshot || '');
    };
    await expect.poll(publicHeadshot, { timeout: 30000 }).toBe('😎');
    await page.setInputFiles('#settings-photo-input', {
      name: 'profile-avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect(page.locator('[data-testid="settings-photo-preview-modal"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="settings-photo-preview-modal"] .profile-avatar-image')).toBeVisible();
    await page.click('[data-testid="settings-photo-preview-cancel"]');
    await expect(page.locator('[data-testid="settings-photo-preview-modal"]')).toHaveCount(0);
    await expect.poll(publicHeadshot, { timeout: 30000 }).toBe('😎');
    await page.setInputFiles('#settings-photo-input', {
      name: 'profile-avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect(page.locator('[data-testid="settings-photo-preview-modal"]')).toBeVisible({ timeout: 10000 });
    await page.click('[data-testid="settings-photo-preview-confirm"]');
    await expect(page.locator('#settings-content .profile-avatar-image')).toBeVisible({ timeout: 10000 });
    await expect.poll(publicHeadshot, { timeout: 30000 }).toContain('data:image/png;base64,');
    await page.reload();
    await afterLoad();
    await expect
      .poll(
        () => page.evaluate(() => String((window as any).__iinpublic_app?.getApp()?.currentUser?.headshot || '')),
        { timeout: 30000, message: 'reloaded owner session should load the public profile photo' },
      )
      .toContain('data:image/png;base64,');
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await expect(page.locator('#settings-content .profile-avatar-image')).toBeVisible({ timeout: 10000 });
    await page.setInputFiles('#settings-photo-input', {
      name: 'not-a-photo.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not image content'),
    });
    await expect(page.locator('#settings-content .profile-avatar-image')).toBeVisible({ timeout: 10000 });
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(tomUserId)}`);
          if (!res.ok()) return 'request-failed';
          const user = await res.json() as any;
          const languages = Array.isArray(user?.languages) ? user.languages.join(',') : 'missing';
          const profileCount = Array.isArray(user?.profile) ? user.profile.length : 0;
          return `${languages}|${profileCount}`;
        },
        { timeout: 30000, message: 'public user profile should propagate to the server view' },
      )
      .toBe('en|2');

    const peer = await bootstrapUser(browserPeer, 'Jerry');
    contextPeer = peer.context;
    peerPage = peer.page;
    peerPage.on('console', (m) => console.log('[Jerry]:', m.text()));

    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.click('.chatroom-item:has-text("Global")');
    await afterNav();

    await peerPage.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await peerPage.click('.chatroom-item:has-text("Global")');
    await afterNav();

    const tomMember = peerPage.locator(`.chatroom-member-item[data-user-id="${tomUserId}"]`).filter({ hasText: 'Tom' }).first();
    await expect(tomMember).toBeVisible({ timeout: 15000 });
    await tomMember.click();
    await afterNav();
    // Rule N2a: dismiss the auto-opened DM conversation to interact with the User layout.
    await expect(peerPage.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await peerPage.click('#back-from-conversation');
    await expect(peerPage.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () => peerPage.locator('#peer-stats-section').innerText(), { timeout: 10_000, intervals: [200, 400, 800] })
      .not.toContain('Loading relationship stats...');
    if ((await peerPage.locator('#peer-stats-section').innerText()).includes('Could not load stats.')) {
      await peerPage.click('#back-from-peer-detail');
      await afterNav();
      await tomMember.click();
      await afterNav();
      await expect(peerPage.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
      await peerPage.click('#back-from-conversation');
    }
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Public Profile');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Languages: English');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Favorite drink');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Coffee');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Usual city');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('San Diego');
    await expect(peerPage.locator('#peer-stats-section')).not.toContainText('Interests: Not listed');
    await expect(peerPage.locator('#peer-stats-section .profile-avatar-image').first()).toBeVisible();

    await peerPage.click('#back-from-peer-detail');
    await establishContactsTomJerry(page, peerPage, `Profile Photo Contact ${Date.now()}`);
    const ownerId = await getCurrentUserId(page);
    await peerPage.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const ownerContact = peerPage.locator(`.contact-item[data-contact-user-id="${ownerId}"]`).first();
    await expect(ownerContact).toBeVisible({ timeout: 15000 });
    await ownerContact.click();
    // contacts-view.ts tap-target split: the row click lands directly on the shared
    // ⟨User⟩ layout (peer-detail) — no DM conversation step to back out of first.
    await expect(peerPage.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(peerPage.locator('#peer-detail-subtitle')).toContainText('talk', { timeout: 45000 });
    await expect(peerPage.locator('#peer-stats-section .profile-avatar-image').first()).toBeVisible({ timeout: 45000 });

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.click('#settings-remove-photo-btn');
    await expect(page.locator('#settings-content .profile-avatar-image')).toHaveCount(0, { timeout: 10000 });
    await expect.poll(publicHeadshot, { timeout: 30000 }).toBe('');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => new MediaStream(),
        },
      });
      CanvasRenderingContext2D.prototype.drawImage = () => undefined;
      HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,Y2FtZXJhLWZpeHR1cmU=';
    });
    await page.click('#settings-take-photo-btn');
    await expect(page.locator('#settings-camera-capture-modal')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
      const video = document.querySelector('#settings-camera-preview-video') as HTMLVideoElement | null;
      if (!video) throw new Error('Camera preview was not rendered');
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    await expect(page.locator('[data-testid="settings-camera-capture"]')).toBeEnabled();
    await page.click('[data-testid="settings-camera-capture"]');
    await expect(page.locator('[data-testid="settings-photo-preview-modal"]')).toBeVisible({ timeout: 10000 });
    await page.click('[data-testid="settings-photo-preview-confirm"]');
    await expect(page.locator('#settings-content .profile-avatar-image')).toBeVisible({ timeout: 10000 });
    await expect.poll(publicHeadshot, { timeout: 30000 }).toBe('data:image/jpeg;base64,Y2FtZXJhLWZpeHR1cmU=');
    await page.click('#settings-remove-photo-btn');
    await expect(page.locator('#settings-content .profile-avatar-image')).toHaveCount(0, { timeout: 10000 });
    await expect
      .poll(
        publicHeadshot,
        { timeout: 30000, message: 'removed public photo should no longer be returned' },
      )
      .toBe('');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            throw new DOMException('Permission denied', 'NotAllowedError');
          },
        },
      });
    });
    await page.click('#settings-take-photo-btn');
    await expect(page.locator('#settings-camera-status')).toContainText('Camera access was denied.', { timeout: 10000 });
    await expect(page.locator('#settings-camera-capture-modal')).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: undefined,
      });
    });
    await page.click('#settings-take-photo-btn');
    await expect(page.locator('#settings-camera-status')).toContainText('Camera capture is unavailable', { timeout: 10000 });
  });
});
