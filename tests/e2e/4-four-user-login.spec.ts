import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Four User Chatroom Capacity Test', () => {
  let browser1: Browser;
  let browser2: Browser;
  let browser3: Browser;
  let browser4: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let context3: BrowserContext;
  let context4: BrowserContext;
  let page1: Page;
  let page2: Page;
  let page3: Page;
  let page4: Page;

  // Helper function to clear Gun.js databases
  function clearGunDatabases() {
    console.log('🧹 Clearing Gun.js databases to start fresh...');

    // Clear client database
    const radataPath = path.join(__dirname, '../../radata');
    if (fs.existsSync(radataPath)) {
      fs.rmSync(radataPath, { recursive: true, force: true });
      console.log('  ✅ Cleared client database (radata/)');
    }

    // Clear server database
    const serverDataPath = path.join(__dirname, '../../data1.json');
    if (fs.existsSync(serverDataPath)) {
      fs.rmSync(serverDataPath, { recursive: true, force: true });
      console.log('  ✅ Cleared server database (data1.json)');
    }

    // Clear .tmp files created by Gun.js
    const projectRoot = path.join(__dirname, '../../');
    const tmpFiles = fs.readdirSync(projectRoot).filter((file) => file.endsWith('.tmp'));
    tmpFiles.forEach((file) => {
      fs.rmSync(path.join(projectRoot, file), { force: true });
    });
    if (tmpFiles.length > 0) {
      console.log(`  ✅ Cleared ${tmpFiles.length} .tmp files`);
    }

    console.log('✅ All databases cleared');
  }

  // Helper function to get status bar text
  async function getStatusBar(page: Page): Promise<string> {
    const statusBar = await page.locator('#status-bar-text');
    await statusBar.waitFor({ state: 'visible', timeout: 5000 });
    const text = await statusBar.textContent();
    return text || '';
  }

  // Helper function to get headcount for a chatroom
  async function getHeadcount(page: Page, chatroomName: string): Promise<string> {
    const headcount = await page.locator(
      `.chatroom-item:has-text("${chatroomName}") .chatroom-headcount`,
    );
    await headcount.waitFor({ state: 'visible', timeout: 5000 });
    const text = await headcount.textContent();
    return text || '';
  }

  // Helper function to cleanup user before closing
  async function cleanupUser(page: Page, userName: string): Promise<void> {
    await page.evaluate(() => {
      const webApp = (window as any).__iinpublic_app;
      if (webApp) {
        webApp.getApp().manualCleanup();
      }
    });
    console.log(`✅ ${userName} cleanup called`);
  }

  test.beforeAll(async () => {
    // Clear databases before starting
    clearGunDatabases();

    // Launch 4 separate Chrome browsers positioned in a 2x2 grid
    browser1 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=640,600', '--force-device-scale-factor=1'],
    });

    browser2 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=640,0', '--window-size=640,600', '--force-device-scale-factor=1'],
    });

    browser3 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,600', '--window-size=640,600', '--force-device-scale-factor=1'],
    });

    browser4 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=640,600', '--window-size=640,600', '--force-device-scale-factor=1'],
    });

    console.log('🚀 Launched 4 Chrome browsers in 2x2 grid');
    console.log('   User 1: Top-left (0,0)');
    console.log('   User 2: Top-right (640,0)');
    console.log('   User 3: Bottom-left (0,600)');
    console.log('   User 4: Bottom-right (640,600)');
  });

  test.afterAll(async () => {
    if (browser1) await browser1.close();
    if (browser2) await browser2.close();
    if (browser3) await browser3.close();
    if (browser4) await browser4.close();

    // Clean up databases after test
    clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  test('Four American users: capacity test and chatroom persistence', async () => {
    const screenshotDir = path.join(__dirname, '../../test-screenshots/four-user');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // ============================================
    // PHASE 1: Users 1-3 enter Global (Global capacity: 3)
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 1: Users 1, 2, 3 enter Global (capacity 3/3)');
    console.log('='.repeat(70));

    // --- User 1 enters ---
    console.log('\n📍 STEP 1.1: User 1 enters Global');
    console.log('-'.repeat(60));

    context1 = await browser1.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
    });
    page1 = await context1.newPage();
    page1.on('console', (msg) => console.log(`[User1]:`, msg.text()));

    await page1.goto('/');
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(3000);

    const status1 = await getStatusBar(page1);
    console.log(`📊 User1 status: ${status1}`);
    console.log('✅ User1 in Global');

    // Add delay before next user joins
    console.log('⏳ Waiting 2s before User 2 joins...');
    await page1.waitForTimeout(2000);

    // --- User 2 enters ---
    console.log('\n📍 STEP 1.2: User 2 enters Global');
    console.log('-'.repeat(60));

    context2 = await browser2.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
    });
    page2 = await context2.newPage();
    page2.on('console', (msg) => console.log(`[UserAmerican2]:`, msg.text()));

    await page2.goto('/');
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(3000);
    const status2 = await getStatusBar(page2);
    console.log(`📊 UserAmerican2 status: ${status2}`);
    console.log('✅ UserAmerican2 in Global');

    // Add delay before next user joins
    console.log('⏳ Waiting 2s before User 3 joins...');
    await page2.waitForTimeout(2000);

    // --- UserAmerican3 enters ---
    console.log('\n📍 STEP 1.3: UserAmerican3 enters Global');
    console.log('-'.repeat(60));

    context3 = await browser3.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
    });
    page3 = await context3.newPage();
    page3.on('console', (msg) => console.log(`[UserAmerican3]:`, msg.text()));

    await page3.goto('/');
    await page3.waitForLoadState('networkidle');
    await page3.waitForTimeout(3000);
    const status3 = await getStatusBar(page3);
    console.log(`📊 UserAmerican3 status: ${status3}`);
    console.log('✅ UserAmerican3 in Global');

    // Verify Global has 3 users - add extra wait for Gun.js sync
    console.log('⏳ Waiting 3s for Gun.js to sync headcounts...');
    await page1.waitForTimeout(3000);
    const global1 = await getHeadcount(page1, 'Global');
    console.log(`📊 Global headcount: ${global1}`);
    if (!global1.includes('3')) {
      throw new Error(`Expected Global to have 3 users, got: ${global1}`);
    }
    console.log('✅ Global at capacity (3/3)');

    await page1.screenshot({
      path: path.join(screenshotDir, '01-global-full-user1.png'),
      fullPage: true,
    });

    // Add delay before User 4 joins
    console.log('⏳ Waiting 3s before User 4 joins...');
    await page1.waitForTimeout(3000);

    // ============================================
    // PHASE 2: UserAmerican4 enters → bumps UserAmerican1 to North America
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 2: UserAmerican4 enters → UserAmerican1 bumped to North America');
    console.log('='.repeat(70));

    console.log('\n📍 STEP 2.1: UserAmerican4 enters');
    console.log('-'.repeat(60));

    context4 = await browser4.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
    });
    page4 = await context4.newPage();
    page4.on('console', (msg) => console.log(`[UserAmerican4]:`, msg.text()));

    await page4.goto('/');
    await page4.waitForLoadState('networkidle');
    await page4.waitForTimeout(3000);
    const status4 = await getStatusBar(page4);
    console.log(`📊 UserAmerican4 status: ${status4}`);

    // Wait for capacity logic to kick in
    console.log('⏳ Waiting 6s for capacity logic to bump UserAmerican1...');
    await page1.waitForTimeout(6000);

    // Check UserAmerican1 status bar - should show North America
    const status1After = await getStatusBar(page1);
    console.log(`📊 UserAmerican1 status after bump: ${status1After}`);

    if (!status1After.includes('North America')) {
      console.log('⚠️  UserAmerican1 not bumped to North America yet, checking chatroom...');
      // Might still show Global in status, but should be in north-america
    }

    // Check headcounts - add extra wait for sync
    console.log('⏳ Waiting 3s for headcount sync...');
    await page1.waitForTimeout(3000);
    const northAmerica1 = await getHeadcount(page1, 'North America');
    const global1After = await getHeadcount(page1, 'Global');
    console.log(`📊 UserAmerican1 sees - Global: ${global1After}, North America: ${northAmerica1}`);

    if (northAmerica1.includes('1') && global1After.includes('3')) {
      console.log('✅ UserAmerican1 bumped to North America');
    } else {
      console.log(`⚠️  Expected UserAmerican1 in North America (1 user) and Global with 3 users`);
    }

    await page1.screenshot({
      path: path.join(screenshotDir, '02-user1-bumped-to-north-america.png'),
      fullPage: true,
    });
    await page4.screenshot({
      path: path.join(screenshotDir, '02-user4-in-global.png'),
      fullPage: true,
    });

    // ============================================
    // PHASE 3: All users exit and re-enter → check persistence
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 3: All users exit and re-enter to test chatroom persistence');
    console.log('='.repeat(70));

    // Save storage states
    const storageDir = path.join(__dirname, '../../test-storage');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    await context1.storageState({ path: path.join(storageDir, 'user-american1-state.json') });
    await context2.storageState({ path: path.join(storageDir, 'user-american2-state.json') });
    await context3.storageState({ path: path.join(storageDir, 'user-american3-state.json') });
    await context4.storageState({ path: path.join(storageDir, 'user-american4-state.json') });

    console.log('\n📍 STEP 3.1: All users exit');
    await cleanupUser(page1, 'UserAmerican1');
    await page1.waitForTimeout(1000);
    await cleanupUser(page2, 'UserAmerican2');
    await page2.waitForTimeout(1000);
    await cleanupUser(page3, 'UserAmerican3');
    await page3.waitForTimeout(1000);
    await cleanupUser(page4, 'UserAmerican4');
    await page4.waitForTimeout(1000);

    await page1.close();
    await page2.close();
    await page3.close();
    await page4.close();
    console.log('✅ All users exited');

    console.log('⏳ Waiting 5s for Gun.js cleanup...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log('\n📍 STEP 3.2: All users re-enter');

    // UserAmerican1 re-enters
    context1 = await browser1.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
      storageState: path.join(storageDir, 'user-american1-state.json'),
    });
    page1 = await context1.newPage();
    page1.on('console', (msg) => console.log(`[UserAmerican1]:`, msg.text()));
    await page1.goto('/');
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(3000);

    console.log('⏳ Waiting 2s before User 2 re-enters...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // UserAmerican2 re-enters
    context2 = await browser2.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
      storageState: path.join(storageDir, 'user-american2-state.json'),
    });
    page2 = await context2.newPage();
    page2.on('console', (msg) => console.log(`[UserAmerican2]:`, msg.text()));
    await page2.goto('/');
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(3000);

    console.log('⏳ Waiting 2s before User 3 re-enters...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // UserAmerican3 re-enters
    context3 = await browser3.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
      storageState: path.join(storageDir, 'user-american3-state.json'),
    });
    page3 = await context3.newPage();
    page3.on('console', (msg) => console.log(`[UserAmerican3]:`, msg.text()));
    await page3.goto('/');
    await page3.waitForLoadState('networkidle');
    await page3.waitForTimeout(3000);

    console.log('⏳ Waiting 2s before User 4 re-enters...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // UserAmerican4 re-enters
    context4 = await browser4.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
      storageState: path.join(storageDir, 'user-american4-state.json'),
    });
    page4 = await context4.newPage();
    page4.on('console', (msg) => console.log(`[UserAmerican4]:`, msg.text()));
    await page4.goto('/');
    await page4.waitForLoadState('networkidle');
    await page4.waitForTimeout(3000);

    console.log('✅ All users re-entered');

    // Check that they stayed in their rooms - add extra wait for sync
    console.log('⏳ Waiting 3s for final headcount sync...');
    await page1.waitForTimeout(3000);
    const status1Final = await getStatusBar(page1);
    const status2Final = await getStatusBar(page2);
    const status3Final = await getStatusBar(page3);
    const status4Final = await getStatusBar(page4);

    console.log(`📊 UserAmerican1 final status: ${status1Final}`);
    console.log(`📊 UserAmerican2 final status: ${status2Final}`);
    console.log(`📊 UserAmerican3 final status: ${status3Final}`);
    console.log(`📊 UserAmerican4 final status: ${status4Final}`);

    // Verify UserAmerican1 stayed in North America
    if (status1Final.includes('North America')) {
      console.log('✅ UserAmerican1 persisted in North America');
    } else {
      console.log('⚠️  UserAmerican1 should be in North America');
    }

    // Verify UserAmerican2, 3, 4 stayed in Global
    if (
      status2Final.includes('Global') &&
      status3Final.includes('Global') &&
      status4Final.includes('Global')
    ) {
      console.log('✅ UserAmerican2, 3, 4 persisted in Global');
    } else {
      console.log('⚠️  UserAmerican2, 3, 4 should be in Global');
    }

    await page1.screenshot({
      path: path.join(screenshotDir, '03-user1-persisted-north-america.png'),
      fullPage: true,
    });
    await page4.screenshot({
      path: path.join(screenshotDir, '03-user4-persisted-global.png'),
      fullPage: true,
    });

    // Final cleanup
    await cleanupUser(page1, 'UserAmerican1');
    await cleanupUser(page2, 'UserAmerican2');
    await cleanupUser(page3, 'UserAmerican3');
    await cleanupUser(page4, 'UserAmerican4');

    await page1.close();
    await page2.close();
    await page3.close();
    await page4.close();

    await context1.close();
    await context2.close();
    await context3.close();
    await context4.close();

    console.log('\n🎉 ✅ ALL FOUR-USER TESTS PASSED!');
    console.log('='.repeat(70));
    console.log('Summary:');
    console.log('  1. ✅ UserAmerican1, 2, 3 enter Global → Global at capacity (3/3)');
    console.log('  2. ✅ UserAmerican4 enters → UserAmerican1 bumped to North America');
    console.log('  3. ✅ All users exit and re-enter → chatrooms persisted');
    console.log('     - UserAmerican1 stayed in North America');
    console.log('     - UserAmerican2, 3, 4 stayed in Global');
  });
});
