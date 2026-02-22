import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Three User Login/Logout Test', () => {
  let browser1: Browser;
  let browser2: Browser;
  let browser3: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let context3: BrowserContext;
  let page1: Page;
  let page2: Page;
  let page3: Page;

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

  // Helper function to get headcount from a page
  async function getHeadcount(page: Page, chatroomName: string = 'Global'): Promise<string> {
    const headcount = await page.locator(
      `.chatroom-item:has-text("${chatroomName}") .chatroom-headcount`,
    );
    await headcount.waitFor({ state: 'visible', timeout: 5000 });
    const text = await headcount.textContent();
    return text || '';
  }

  // Helper function to verify headcount matches expected value
  function verifyHeadcount(headcountText: string, expected: number, userName: string): void {
    if (!headcountText.includes(expected.toString())) {
      throw new Error(`Expected ${userName} headcount "👥 ${expected}", got "${headcountText}"`);
    }
    console.log(`✅ ${userName} sees headcount = ${expected}`);
  }

  // Helper function to create a user
  async function createUser(page: Page, userName: string): Promise<void> {
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.click('#get-started-btn');
    await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 10000 });
    console.log(`✅ ${userName} created with auto-generated stage name`);
    await page.waitForTimeout(3000); // Wait for Gun.js sync
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

    // Launch 3 separate Chrome browsers positioned in a grid
    browser1 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=640,800', '--force-device-scale-factor=1'],
    });

    browser2 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=640,0', '--window-size=640,800', '--force-device-scale-factor=1'],
    });

    browser3 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=1280,0', '--window-size=640,800', '--force-device-scale-factor=1'],
    });

    console.log('🚀 Launched 3 Chrome browsers in a row');
    console.log('   User 1: Left window (0,0)');
    console.log('   User 2: Middle window (640,0)');
    console.log('   User 3: Right window (1280,0)');
  });

  test.afterAll(async () => {
    if (browser1) {
      await browser1.close();
    }
    if (browser2) {
      await browser2.close();
    }
    if (browser3) {
      await browser3.close();
    }

    // Clean up databases after test
    clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  test('Three users: sequential login/logout FIFO, then random order', async () => {
    const screenshotDir = path.join(__dirname, '../../test-screenshots/three-user');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // Storage state file paths for persisting localStorage between sessions
    const storageDir = path.join(__dirname, '../../test-storage');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    const storage1Path = path.join(storageDir, 'user1-state.json');
    const storage2Path = path.join(storageDir, 'user2-state.json');
    const storage3Path = path.join(storageDir, 'user3-state.json');

    // ============================================
    // PHASE 1: Three users enter one by one (0→1→2→3)
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 1: Three users enter sequentially (headcount: 0→1→2→3)');
    console.log('='.repeat(70));

    // --- User 1 enters ---
    console.log('\n📍 STEP 1.1: User 1 enters (headcount 0→1)');
    console.log('-'.repeat(60));

    context1 = await browser1.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
    });
    page1 = await context1.newPage();
    page1.on('console', (msg) => console.log(`[User1]:`, msg.text()));

    await page1.goto('/');
    await page1.waitForLoadState('networkidle');
    await createUser(page1, 'User 1');

    const headcount1_1 = await getHeadcount(page1);
    console.log(`📊 User 1 headcount: ${headcount1_1}`);
    verifyHeadcount(headcount1_1, 1, 'User 1');

    await page1.screenshot({
      path: path.join(screenshotDir, '01-user1-enters.png'),
      fullPage: true,
    });

    // --- User 2 enters ---
    console.log('\n📍 STEP 1.2: User 2 enters (headcount 1→2)');
    console.log('-'.repeat(60));

    context2 = await browser2.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
    });
    page2 = await context2.newPage();
    page2.on('console', (msg) => console.log(`[User2]:`, msg.text()));

    await page2.goto('/');
    await page2.waitForLoadState('networkidle');
    await createUser(page2, 'User 2');

    // Verify both users see headcount = 2
    const headcount1_2 = await getHeadcount(page1);
    const headcount2_2 = await getHeadcount(page2);
    console.log(`📊 User 1 headcount: ${headcount1_2}`);
    console.log(`📊 User 2 headcount: ${headcount2_2}`);
    verifyHeadcount(headcount1_2, 2, 'User 1');
    verifyHeadcount(headcount2_2, 2, 'User 2');

    await page1.screenshot({
      path: path.join(screenshotDir, '02-user1-sees-2.png'),
      fullPage: true,
    });
    await page2.screenshot({
      path: path.join(screenshotDir, '02-user2-sees-2.png'),
      fullPage: true,
    });

    // --- User 3 enters ---
    console.log('\n📍 STEP 1.3: User 3 enters (headcount 2→3)');
    console.log('-'.repeat(60));

    context3 = await browser3.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
    });
    page3 = await context3.newPage();
    page3.on('console', (msg) => console.log(`[User3]:`, msg.text()));

    await page3.goto('/');
    await page3.waitForLoadState('networkidle');
    await createUser(page3, 'User 3');

    // Verify all three users see headcount = 3
    const headcount1_3 = await getHeadcount(page1);
    const headcount2_3 = await getHeadcount(page2);
    const headcount3_3 = await getHeadcount(page3);
    console.log(`📊 User 1 headcount: ${headcount1_3}`);
    console.log(`📊 User 2 headcount: ${headcount2_3}`);
    console.log(`📊 User 3 headcount: ${headcount3_3}`);
    verifyHeadcount(headcount1_3, 3, 'User 1');
    verifyHeadcount(headcount2_3, 3, 'User 2');
    verifyHeadcount(headcount3_3, 3, 'User 3');

    await page1.screenshot({
      path: path.join(screenshotDir, '03-user1-sees-3.png'),
      fullPage: true,
    });
    await page2.screenshot({
      path: path.join(screenshotDir, '03-user2-sees-3.png'),
      fullPage: true,
    });
    await page3.screenshot({
      path: path.join(screenshotDir, '03-user3-sees-3.png'),
      fullPage: true,
    });

    console.log('✅ PHASE 1 COMPLETE: All 3 users entered successfully');

    // ============================================
    // PHASE 2: Three users exit FIFO (3→2→1→0)
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 2: Three users exit FIFO (headcount: 3→2→1→0)');
    console.log('='.repeat(70));

    // --- User 1 exits (first in, first out) ---
    console.log('\n📍 STEP 2.1: User 1 exits (headcount 3→2)');
    console.log('-'.repeat(60));

    await cleanupUser(page1, 'User 1');
    // Save localStorage state before closing context
    await context1.storageState({ path: storage1Path });
    console.log('💾 User 1 localStorage saved');
    await page1.close();
    await context1.close();
    console.log('✅ User 1 exited');

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for Gun.js sync

    // Verify remaining users see headcount = 2
    const headcount2_afterU1 = await getHeadcount(page2);
    const headcount3_afterU1 = await getHeadcount(page3);
    console.log(`📊 User 2 headcount: ${headcount2_afterU1}`);
    console.log(`📊 User 3 headcount: ${headcount3_afterU1}`);
    verifyHeadcount(headcount2_afterU1, 2, 'User 2');
    verifyHeadcount(headcount3_afterU1, 2, 'User 3');

    await page2.screenshot({
      path: path.join(screenshotDir, '04-user2-sees-2.png'),
      fullPage: true,
    });

    // --- User 2 exits ---
    console.log('\n📍 STEP 2.2: User 2 exits (headcount 2→1)');
    console.log('-'.repeat(60));

    await cleanupUser(page2, 'User 2');
    // Save localStorage state before closing context
    await context2.storageState({ path: storage2Path });
    console.log('💾 User 2 localStorage saved');
    await page2.close();
    await context2.close();
    console.log('✅ User 2 exited');

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for Gun.js sync

    // Verify User 3 sees headcount = 1
    const headcount3_afterU2 = await getHeadcount(page3);
    console.log(`📊 User 3 headcount: ${headcount3_afterU2}`);
    verifyHeadcount(headcount3_afterU2, 1, 'User 3');

    await page3.screenshot({
      path: path.join(screenshotDir, '05-user3-sees-1.png'),
      fullPage: true,
    });

    // --- User 3 exits ---
    console.log('\n📍 STEP 2.3: User 3 exits (headcount 1→0)');
    console.log('-'.repeat(60));

    await cleanupUser(page3, 'User 3');
    // Save localStorage state before closing context
    await context3.storageState({ path: storage3Path });
    console.log('💾 User 3 localStorage saved');
    await page3.close();
    await context3.close();
    console.log('✅ User 3 exited');

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for Gun.js sync
    console.log('✅ PHASE 2 COMPLETE: All users exited in FIFO order');

    // ============================================
    // PHASE 3: Three users re-enter in random order (User 2, User 3, User 1)
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 3: Three users re-enter in RANDOM order (User 2→User 3→User 1)');
    console.log('='.repeat(70));

    // --- User 2 re-enters first ---
    console.log('\n📍 STEP 3.1: User 2 re-enters (headcount 0→1)');
    console.log('-'.repeat(60));

    // Restore localStorage from saved state
    context2 = await browser2.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      storageState: storage2Path, // Restore saved localStorage
    });
    page2 = await context2.newPage();
    page2.on('console', (msg) => console.log(`[User2]:`, msg.text()));

    await page2.goto('/');
    await page2.waitForLoadState('networkidle');

    // Should NOT show user creation dialog (user remembered)
    await page2.waitForTimeout(1000);
    const modalVisible2 = await page2
      .locator('.modal-overlay')
      .isVisible()
      .catch(() => false);
    if (modalVisible2) {
      throw new Error('User 2 was not remembered - localStorage persistence failed');
    }
    console.log('✅ User 2 remembered from localStorage');

    await page2.waitForTimeout(3000); // Wait for Gun.js sync

    const headcount2_phase3_1 = await getHeadcount(page2);
    console.log(`📊 User 2 headcount: ${headcount2_phase3_1}`);
    verifyHeadcount(headcount2_phase3_1, 1, 'User 2');

    await page2.screenshot({
      path: path.join(screenshotDir, '06-user2-reenter.png'),
      fullPage: true,
    });

    // --- User 3 re-enters second ---
    console.log('\n📍 STEP 3.2: User 3 re-enters (headcount 1→2)');
    console.log('-'.repeat(60));

    context3 = await browser3.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      storageState: storage3Path, // Restore saved localStorage
    });
    page3 = await context3.newPage();
    page3.on('console', (msg) => console.log(`[User3]:`, msg.text()));

    await page3.goto('/');
    await page3.waitForLoadState('networkidle');

    await page3.waitForTimeout(1000);
    const modalVisible3 = await page3
      .locator('.modal-overlay')
      .isVisible()
      .catch(() => false);
    if (modalVisible3) {
      throw new Error('User 3 was not remembered - localStorage persistence failed');
    }
    console.log('✅ User 3 remembered from localStorage');

    await page3.waitForTimeout(3000); // Wait for Gun.js sync

    const headcount2_phase3_2 = await getHeadcount(page2);
    const headcount3_phase3_2 = await getHeadcount(page3);
    console.log(`📊 User 2 headcount: ${headcount2_phase3_2}`);
    console.log(`📊 User 3 headcount: ${headcount3_phase3_2}`);
    verifyHeadcount(headcount2_phase3_2, 2, 'User 2');
    verifyHeadcount(headcount3_phase3_2, 2, 'User 3');

    // --- User 1 re-enters third ---
    console.log('\n📍 STEP 3.3: User 1 re-enters (headcount 2→3)');
    console.log('-'.repeat(60));

    context1 = await browser1.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      storageState: storage1Path, // Restore saved localStorage
    });
    page1 = await context1.newPage();
    page1.on('console', (msg) => console.log(`[User1]:`, msg.text()));

    await page1.goto('/');
    await page1.waitForLoadState('networkidle');

    await page1.waitForTimeout(1000);
    const modalVisible1 = await page1
      .locator('.modal-overlay')
      .isVisible()
      .catch(() => false);
    if (modalVisible1) {
      throw new Error('User 1 was not remembered - localStorage persistence failed');
    }
    console.log('✅ User 1 remembered from localStorage');

    await page1.waitForTimeout(3000); // Wait for Gun.js sync

    const headcount1_phase3_3 = await getHeadcount(page1);
    const headcount2_phase3_3 = await getHeadcount(page2);
    const headcount3_phase3_3 = await getHeadcount(page3);
    console.log(`📊 User 1 headcount: ${headcount1_phase3_3}`);
    console.log(`📊 User 2 headcount: ${headcount2_phase3_3}`);
    console.log(`📊 User 3 headcount: ${headcount3_phase3_3}`);
    verifyHeadcount(headcount1_phase3_3, 3, 'User 1');
    verifyHeadcount(headcount2_phase3_3, 3, 'User 2');
    verifyHeadcount(headcount3_phase3_3, 3, 'User 3');

    await page1.screenshot({
      path: path.join(screenshotDir, '07-user1-reenter-sees-3.png'),
      fullPage: true,
    });
    await page2.screenshot({
      path: path.join(screenshotDir, '07-user2-sees-3.png'),
      fullPage: true,
    });
    await page3.screenshot({
      path: path.join(screenshotDir, '07-user3-sees-3.png'),
      fullPage: true,
    });

    console.log('✅ PHASE 3 COMPLETE: All users re-entered in random order');

    // ============================================
    // PHASE 4: Three users exit in random order (User 3, User 1, User 2)
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 4: Three users exit in RANDOM order (User 3→User 1→User 2)');
    console.log('='.repeat(70));

    // --- User 3 exits first ---
    console.log('\n📍 STEP 4.1: User 3 exits (headcount 3→2)');
    console.log('-'.repeat(60));

    await cleanupUser(page3, 'User 3');
    await page3.close();
    await context3.close();
    console.log('✅ User 3 exited');

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for Gun.js sync

    const headcount1_phase4_1 = await getHeadcount(page1);
    const headcount2_phase4_1 = await getHeadcount(page2);
    console.log(`📊 User 1 headcount: ${headcount1_phase4_1}`);
    console.log(`📊 User 2 headcount: ${headcount2_phase4_1}`);
    verifyHeadcount(headcount1_phase4_1, 2, 'User 1');
    verifyHeadcount(headcount2_phase4_1, 2, 'User 2');

    // --- User 1 exits second ---
    console.log('\n📍 STEP 4.2: User 1 exits (headcount 2→1)');
    console.log('-'.repeat(60));

    await cleanupUser(page1, 'User 1');
    await page1.close();
    await context1.close();
    console.log('✅ User 1 exited');

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for Gun.js sync

    const headcount2_phase4_2 = await getHeadcount(page2);
    console.log(`📊 User 2 headcount: ${headcount2_phase4_2}`);
    verifyHeadcount(headcount2_phase4_2, 1, 'User 2');

    // --- User 2 exits last ---
    console.log('\n📍 STEP 4.3: User 2 exits (headcount 1→0)');
    console.log('-'.repeat(60));

    await cleanupUser(page2, 'User 2');
    await page2.close();
    await context2.close();
    console.log('✅ User 2 exited');

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for Gun.js sync
    console.log('✅ PHASE 4 COMPLETE: All users exited in random order');

    // ============================================
    // SUCCESS!
    // ============================================
    console.log('\n' + '🎉'.repeat(35));
    console.log('✅ ALL TESTS PASSED!');
    console.log('🎉'.repeat(35));
    console.log('\nSummary:');
    console.log('  Phase 1: ✅ Users entered sequentially (0→1→2→3)');
    console.log('  Phase 2: ✅ Users exited FIFO (3→2→1→0)');
    console.log('  Phase 3: ✅ Users re-entered in random order (2→3→1)');
    console.log('  Phase 4: ✅ Users exited in random order (3→1→2)');
    console.log('  Persistence: ✅ All users remembered via localStorage');
    console.log('  Headcount: ✅ Accurate real-time tracking throughout all phases');
  });
});
