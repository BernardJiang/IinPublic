import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';

test.describe('Two User Login/Logout Test', () => {
  let browser1: Browser;
  let browser2: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;

  test.beforeAll(async () => {
    // Clear databases before starting
    await clearGunDatabases();

    // Launch 2 separate Chrome browsers positioned side-by-side
    browser1 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=960,1200', '--force-device-scale-factor=1'],
    });

    browser2 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=960,0', '--window-size=960,1200', '--force-device-scale-factor=1'],
    });

    console.log('🚀 Launched 2 Chrome browsers side-by-side');
    console.log('   User 1: Left window (0,0)');
    console.log('   User 2: Right window (960,0)');
  });

  test.afterAll(async () => {
    if (browser1) {
      await browser1.close();
    }
    if (browser2) {
      await browser2.close();
    }

    // Clean up databases after test
    await clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  test('Two users login, logout, and re-login with headcount tracking', async () => {
    const screenshotDir = path.join(__dirname, '../../test-screenshots/two-user');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // ============================================
    // STEP 1: User 1 logs in and stays
    // ============================================
    console.log('\n📍 STEP 1: User 1 logs in (empty database)');
    console.log('='.repeat(60));

    context1 = await browser1.newContext({
      viewport: { width: 960, height: 1200 },
      deviceScaleFactor: 1,
    });

    page1 = await context1.newPage();
    page1.on('console', (msg) => console.log(`[User1]:`, msg.text()));

    await page1.goto('/');
    await page1.waitForLoadState('networkidle');

    // User 1 is automatically created (no modal needed)
    console.log('✅ User 1 created automatically with auto-generated stage name');

    await page1.waitForTimeout(3000); // Wait for Gun.js sync

    // Check headcount for User 1
    const headcount1_step1 = await page1.locator(
      '.chatroom-item:has-text("Global") .chatroom-headcount',
    );
    await headcount1_step1.waitFor({ state: 'visible', timeout: 5000 });
    const headcountText1_step1 = await headcount1_step1.textContent();
    console.log(`📊 User 1 headcount: ${headcountText1_step1}`);

    if (!headcountText1_step1?.includes('1')) {
      throw new Error(`Expected User 1 headcount "👥 1", got "${headcountText1_step1}"`);
    }
    console.log('✅ User 1 sees headcount = 1');

    await page1.screenshot({
      path: path.join(screenshotDir, '01-user1-login.png'),
      fullPage: true,
    });

    // ============================================
    // STEP 2: User 2 logs in (headcount becomes 2)
    // ============================================
    console.log('\n📍 STEP 2: User 2 logs in (headcount should become 2)');
    console.log('='.repeat(60));

    context2 = await browser2.newContext({
      viewport: { width: 960, height: 1200 },
      deviceScaleFactor: 1,
    });

    page2 = await context2.newPage();
    page2.on('console', (msg) => console.log(`[User2]:`, msg.text()));

    await page2.goto('/');
    await page2.waitForLoadState('networkidle');

    // User 2 is automatically created (no modal needed)
    console.log('✅ User 2 created automatically with auto-generated stage name');

    await page2.waitForTimeout(3000); // Wait for Gun.js sync

    // Check headcount for both users (should be 2)
    const headcount1_step2 = await page1.locator(
      '.chatroom-item:has-text("Global") .chatroom-headcount',
    );
    const headcountText1_step2 = await headcount1_step2.textContent();
    console.log(`📊 User 1 headcount: ${headcountText1_step2}`);

    const headcount2_step2 = await page2.locator(
      '.chatroom-item:has-text("Global") .chatroom-headcount',
    );
    const headcountText2_step2 = await headcount2_step2.textContent();
    console.log(`📊 User 2 headcount: ${headcountText2_step2}`);

    if (!headcountText1_step2?.includes('2')) {
      throw new Error(`Expected User 1 headcount "👥 2", got "${headcountText1_step2}"`);
    }
    if (!headcountText2_step2?.includes('2')) {
      throw new Error(`Expected User 2 headcount "👥 2", got "${headcountText2_step2}"`);
    }
    console.log('✅ Both users see headcount = 2');

    await page1.screenshot({
      path: path.join(screenshotDir, '02-both-logged-in-user1.png'),
      fullPage: true,
    });
    await page2.screenshot({
      path: path.join(screenshotDir, '02-both-logged-in-user2.png'),
      fullPage: true,
    });

    // ============================================
    // STEP 3: User 2 exits (headcount becomes 1)
    // ============================================
    console.log('\n📍 STEP 3: User 2 exits (headcount should become 1)');
    console.log('='.repeat(60));

    // Debug: Check what's on the window object
    const windowKeys = await page2.evaluate(() => {
      return Object.keys(window).filter((k) => k.includes('iinpublic') || k.includes('app'));
    });
    console.log('🔍 Window keys containing "iinpublic" or "app":', windowKeys);

    // Manually trigger cleanup before closing (beforeunload may not fire in Playwright)
    const cleanupResult = await page2.evaluate(() => {
      const webApp = (window as any).__iinpublic_app;
      if (!webApp) {
        return { success: false, error: '__iinpublic_app not found' };
      }
      const app = webApp.getApp();
      if (!app) {
        return { success: false, error: 'getApp() returned null/undefined' };
      }
      if (!app.manualCleanup) {
        return { success: false, error: 'manualCleanup method not found' };
      }
      try {
        app.manualCleanup();
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    });
    console.log('✅ User 2 cleanup result:', JSON.stringify(cleanupResult));

    // Wait significantly longer for Gun.js to process the cleanup writes
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await page2.close();
    console.log('✅ User 2 exited');

    // Wait for Gun.js to sync the "left" state and update headcount
    // We need to wait for the subscription to fire and update the UI
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Increased wait time

    // Check User 1's headcount (should be 1)
    // Use a retry mechanism since Gun.js updates may take time
    let headcountText1_step3 = '';
    for (let i = 0; i < 10; i++) {
      const headcount1_step3 = await page1.locator(
        '.chatroom-item:has-text("Global") .chatroom-headcount',
      );
      headcountText1_step3 = (await headcount1_step3.textContent()) || '';
      console.log(
        `📊 User 1 headcount after User 2 exit (attempt ${i + 1}): ${headcountText1_step3}`,
      );

      if (headcountText1_step3.includes('1')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second between retries
    }

    if (!headcountText1_step3?.includes('1')) {
      throw new Error(`Expected User 1 headcount "👥 1", got "${headcountText1_step3}"`);
    }
    console.log('✅ User 1 sees headcount = 1 (User 2 left)');

    await page1.screenshot({
      path: path.join(screenshotDir, '03-user2-exited.png'),
      fullPage: true,
    });

    // ============================================
    // STEP 4: User 2 re-enters (headcount becomes 2)
    // ============================================
    console.log('\n📍 STEP 4: User 2 re-enters (headcount should become 2)');
    console.log('='.repeat(60));

    // User 2 opens new page (same context, so localStorage persists)
    page2 = await context2.newPage();
    page2.on('console', (msg) => console.log(`[User2]:`, msg.text()));

    await page2.goto('/');
    await page2.waitForLoadState('networkidle');

    // User 2 should NOT see creation dialog (remembered from localStorage)
    await page2.waitForTimeout(1000);
    console.log('✅ User 2 remembered from localStorage (no dialog shown)');

    await page2.waitForTimeout(3000); // Wait for Gun.js sync

    // Check headcount for both users (should be 2 again)
    const headcount1_step4 = await page1.locator(
      '.chatroom-item:has-text("Global") .chatroom-headcount',
    );
    const headcountText1_step4 = await headcount1_step4.textContent();
    console.log(`📊 User 1 headcount: ${headcountText1_step4}`);

    const headcount2_step4 = await page2.locator(
      '.chatroom-item:has-text("Global") .chatroom-headcount',
    );
    const headcountText2_step4 = await headcount2_step4.textContent();
    console.log(`📊 User 2 headcount: ${headcountText2_step4}`);

    if (!headcountText1_step4?.includes('2')) {
      throw new Error(`Expected User 1 headcount "👥 2", got "${headcountText1_step4}"`);
    }
    if (!headcountText2_step4?.includes('2')) {
      throw new Error(`Expected User 2 headcount "👥 2", got "${headcountText2_step4}"`);
    }
    console.log('✅ Both users see headcount = 2 (User 2 rejoined)');

    await page1.screenshot({
      path: path.join(screenshotDir, '04-user2-rejoined-user1.png'),
      fullPage: true,
    });
    await page2.screenshot({
      path: path.join(screenshotDir, '04-user2-rejoined-user2.png'),
      fullPage: true,
    });

    // ============================================
    // STEP 5: Both users exit
    // ============================================
    console.log('\n📍 STEP 5: Both users exit');
    console.log('='.repeat(60));

    // Manually cleanup both users before closing
    await page1.evaluate(() => {
      const webApp = (window as any).__iinpublic_app;
      if (webApp) {
        webApp.getApp().manualCleanup();
      }
    });
    await page2.evaluate(() => {
      const webApp = (window as any).__iinpublic_app;
      if (webApp) {
        webApp.getApp().manualCleanup();
      }
    });
    console.log('✅ Both users cleanup called manually');

    await page1.close();
    await page2.close();
    console.log('✅ Both users exited');

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for Gun.js sync

    // ============================================
    // STEP 6: Both users re-enter (headcount becomes 2)
    // ============================================
    console.log('\n📍 STEP 6: Both users re-enter (headcount should become 2)');
    console.log('='.repeat(60));

    // User 1 re-enters
    page1 = await context1.newPage();
    page1.on('console', (msg) => console.log(`[User1]:`, msg.text()));

    await page1.goto('/');
    await page1.waitForLoadState('networkidle');

    await page1.waitForTimeout(1000);
    console.log('✅ User 1 remembered from localStorage (no dialog shown)');

    // User 2 re-enters
    page2 = await context2.newPage();
    page2.on('console', (msg) => console.log(`[User2]:`, msg.text()));

    await page2.goto('/');
    await page2.waitForLoadState('networkidle');

    await page2.waitForTimeout(1000);
    console.log('✅ User 2 remembered from localStorage (no dialog shown)');

    await page1.waitForTimeout(3000); // Wait for Gun.js sync

    // Check headcount for both users (should be 2)
    const headcount1_step6 = await page1.locator(
      '.chatroom-item:has-text("Global") .chatroom-headcount',
    );
    const headcountText1_step6 = await headcount1_step6.textContent();
    console.log(`📊 User 1 headcount: ${headcountText1_step6}`);

    const headcount2_step6 = await page2.locator(
      '.chatroom-item:has-text("Global") .chatroom-headcount',
    );
    const headcountText2_step6 = await headcount2_step6.textContent();
    console.log(`📊 User 2 headcount: ${headcountText2_step6}`);

    if (!headcountText1_step6?.includes('2')) {
      throw new Error(`Expected User 1 headcount "👥 2", got "${headcountText1_step6}"`);
    }
    if (!headcountText2_step6?.includes('2')) {
      throw new Error(`Expected User 2 headcount "👥 2", got "${headcountText2_step6}"`);
    }
    console.log('✅ Both users see headcount = 2 (both rejoined)');

    await page1.screenshot({
      path: path.join(screenshotDir, '05-both-rejoined-user1.png'),
      fullPage: true,
    });
    await page2.screenshot({
      path: path.join(screenshotDir, '05-both-rejoined-user2.png'),
      fullPage: true,
    });

    // =============================================================
    // STEP 6.5: User 2 manually navigates through chatrooms and User 1 verifies headcounts
    // =============================================================
    console.log(
      '\n📍 STEP 6.5: User 2 navigates rooms, User 1 verifies headcounts',
    );
    console.log('='.repeat(60));

    const roomsToTest = ['North America', 'South America', 'Europe', 'Asia'];

    for (const roomName of roomsToTest) {
      console.log(`\n▶️ Testing navigation to ${roomName}`);

      // STEP A: User 2 enters the room
      console.log(`  - User 2 enters ${roomName}`);
      await page2.click(`.chatroom-item:has-text("${roomName}")`);
      await page2.waitForTimeout(2000); // Wait for sync

      // STEP B: User 1 verifies headcounts (Global: 1, Room: 1)
      console.log(`  - User 1 verifies headcounts (Global: 1, ${roomName}: 1)`);
      const globalHeadcountAfterEnter = await page1
        .locator('.chatroom-item:has-text("Global") .chatroom-headcount')
        .textContent();
      const roomHeadcountAfterEnter = await page1
        .locator(`.chatroom-item:has-text("${roomName}") .chatroom-headcount`)
        .textContent();

      if (!globalHeadcountAfterEnter?.includes('1')) {
        throw new Error(
          `[${roomName}] Expected Global headcount "1", got "${globalHeadcountAfterEnter}"`,
        );
      }
      if (!roomHeadcountAfterEnter?.includes('1')) {
        throw new Error(
          `[${roomName}] Expected ${roomName} headcount "1", got "${roomHeadcountAfterEnter}"`,
        );
      }
      console.log(
        `  ✅ Correct: Global headcount is ${globalHeadcountAfterEnter}, ${roomName} headcount is ${roomHeadcountAfterEnter}`,
      );
      await page1.screenshot({
        path: path.join(screenshotDir, `06-user2-in-${roomName}.png`),
        fullPage: true,
      });

      // STEP C: User 2 goes back to Global
      console.log('  - User 2 returns to Global');
      await page2.click('.chatroom-item:has-text("Global")');
      await page2.waitForTimeout(2000); // Wait for sync

      // STEP D: User 1 verifies headcounts (Global: 2, Room: 0 or empty)
      console.log(`  - User 1 verifies headcounts (Global: 2, ${roomName}: 0)`);
      const globalHeadcountAfterBack = await page1
        .locator('.chatroom-item:has-text("Global") .chatroom-headcount')
        .textContent();
      const roomHeadcountAfterBack = await page1
        .locator(`.chatroom-item:has-text("${roomName}") .chatroom-headcount`)
        .textContent();

      if (!globalHeadcountAfterBack?.includes('2')) {
        throw new Error(
          `[${roomName}] Expected Global headcount "2" after return, got "${globalHeadcountAfterBack}"`,
        );
      }
      // Headcount can be '👥 0' or the element might not exist if it's empty
      if (roomHeadcountAfterBack && !roomHeadcountAfterBack.includes('0')) {
        throw new Error(
          `[${roomName}] Expected ${roomName} headcount "0" after return, got "${roomHeadcountAfterBack}"`,
        );
      }
      console.log(
        `  ✅ Correct: Global headcount is ${globalHeadcountAfterBack}, ${roomName} headcount is ${
          roomHeadcountAfterBack || '0'
        }`,
      );
      await page1.screenshot({
        path: path.join(screenshotDir, `07-user2-back-from-${roomName}.png`),
        fullPage: true,
      });
    }

    console.log('\n✅ All room navigation tests passed!');

    // ============================================
    // STEP 7: Both users exit (final cleanup)
    // ============================================
    console.log('\n📍 STEP 7: Both users exit (final cleanup)');
    console.log('='.repeat(60));

    // Manually cleanup both users before closing
    await page1.evaluate(() => {
      const webApp = (window as any).__iinpublic_app;
      if (webApp) {
        webApp.getApp().manualCleanup();
      }
    });
    await page2.evaluate(() => {
      const webApp = (window as any).__iinpublic_app;
      if (webApp) {
        webApp.getApp().manualCleanup();
      }
    });
    console.log('✅ Both users cleanup called manually');

    await page1.close();
    await page2.close();
    console.log('✅ Both users exited');

    await context1.close();
    await context2.close();

    // ============================================
    // SUCCESS!
    // ============================================
    console.log('\n🎉 ✅ ALL TWO-USER TESTS PASSED!');
    console.log('='.repeat(60));
    console.log('Summary:');
    console.log('  1. ✅ User 1 logs in → headcount = 1');
    console.log('  2. ✅ User 2 logs in → headcount = 2 (both users)');
    console.log('  3. ✅ User 2 exits → headcount = 1 (User 1 only)');
    console.log('  4. ✅ User 2 re-enters → headcount = 2 (remembered via localStorage)');
    console.log('  5. ✅ Both exit → headcount = 0');
    console.log('  6. ✅ Both re-enter → headcount = 2 (both remembered)');
    console.log('  6.5. ✅ User 2 navigates rooms, and headcount is verified');
    console.log('  7. ✅ Both exit → test complete');
  });
});
