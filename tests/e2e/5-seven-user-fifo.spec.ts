import { test, expect, Browser, Page, BrowserContext } from '@playwright/test';
import { clearGunDatabases } from './helpers/clear-database';
import * as path from 'path';
import * as fs from 'fs';

// 7 Users with specific GPS coordinates
const USERS = [
  // North America - Users 1, 2, 3
  { id: 1, name: 'NA-User1', lat: 40.7128, lon: -74.006, continent: 'North America' }, // NYC
  { id: 2, name: 'NA-User2', lat: 34.0522, lon: -118.2437, continent: 'North America' }, // LA
  { id: 3, name: 'NA-User3', lat: 41.8781, lon: -87.6298, continent: 'North America' }, // Chicago

  // South America - Users 4, 5, 6
  { id: 4, name: 'SA-User1', lat: -23.5505, lon: -46.6333, continent: 'South America' }, // São Paulo
  { id: 5, name: 'SA-User2', lat: -34.6037, lon: -58.3816, continent: 'South America' }, // Buenos Aires
  { id: 6, name: 'SA-User3', lat: -12.0464, lon: -77.0428, continent: 'South America' }, // Lima

  // Asia - User 7
  { id: 7, name: 'AS-User1', lat: 35.6762, lon: 139.6503, continent: 'Asia' }, // Tokyo
];

test.describe('Seven User FIFO Eviction Test', () => {
  test('7 users: FIFO eviction from Global to continental rooms', async ({ playwright }) => {
    const browsers: Browser[] = [];
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    // Helper to get status bar text
    async function getStatusBar(page: Page): Promise<string> {
      const statusBar = page.locator('#status-bar-text');
      await statusBar.waitFor({ state: 'visible', timeout: 10000 });
      return (await statusBar.textContent()) || '';
    }

    // Helper to get headcount for a chatroom
    async function getHeadcount(page: Page, chatroomName: string): Promise<number> {
      const selector = `.chatroom-item:has-text("${chatroomName}") .chatroom-headcount`;
      const headcount = page.locator(selector);
      await headcount.waitFor({ state: 'visible', timeout: 10000 });
      const text = await headcount.textContent();
      const match = text?.match(/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }

    // Helper to check all chatrooms are at or under capacity
    async function checkAllRoomsUnderCapacity(page: Page, userContext: string): Promise<void> {
      const globalCount = await getHeadcount(page, 'Global');
      const naCount = await getHeadcount(page, 'North America');
      const saCount = await getHeadcount(page, 'South America');

      console.log(`   [${userContext}] Global: ${globalCount}, NA: ${naCount}, SA: ${saCount}`);

      if (globalCount > 3) {
        throw new Error(`❌ Global room EXCEEDED capacity: ${globalCount}/3`);
      }
      if (naCount > 3) {
        throw new Error(`❌ North America room EXCEEDED capacity: ${naCount}/3`);
      }
      if (saCount > 3) {
        throw new Error(`❌ South America room EXCEEDED capacity: ${saCount}/3`);
      }
      console.log(`   ✅ All rooms at or under capacity`);
    }

    // Helper to cleanup a user
    async function cleanupUser(page: Page, userName: string) {
      try {
        await page.evaluate(() => {
          if ((window as any).__iinpublic_app) {
            (window as any).__iinpublic_app.cleanup();
          }
        });
        console.log(`   ✅ ${userName} cleaned up`);
      } catch (error) {
        console.log(`   ⚠️  Cleanup error for ${userName}:`, error);
      }
    }

    console.log('🧹 Clearing Gun.js databases to start fresh...');
    await clearGunDatabases();
    console.log('✅ All databases cleared\n');

    console.log('🚀 Launching 7 Chrome browsers...');
    for (let i = 0; i < 7; i++) {
      const browser = await playwright.chromium.launch({ headless: false });
      browsers.push(browser);
    }
    console.log('✅ Launched 7 browsers\n');

    const storageDir = path.join(__dirname, '../../.test-storage');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    // ============================================
    // PHASE 1: Users 1-3 join (fill Global)
    // ============================================
    console.log('='.repeat(80));
    console.log('PHASE 1: Users 1-3 join Global (room fills up)');
    console.log('='.repeat(80));

    for (let i = 0; i < 3; i++) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} joining...`);

      const context = await browsers[i].newContext({
        viewport: { width: 1280, height: 720 },
      });

      const page = await context.newPage();
      page.on('console', (msg) => console.log(`[${user.name}]:`, msg.text()));

      // Set custom test location before page loads
      await page.addInitScript(
        (location) => {
          (window as any).__test_location = location;
        },
        { latitude: user.lat, longitude: user.lon },
      );

      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      contexts.push(context);
      pages.push(page);

      const status = await getStatusBar(page);
      console.log(`   ✅ ${user.name} joined: ${status}`);

      // Wait for FIFO to process
      await page.waitForTimeout(3000);

      // Check capacity
      await checkAllRoomsUnderCapacity(page, `After User ${user.id}`);
    }

    console.log('\n📊 After Phase 1: Global should have 3 users (1, 2, 3)');
    const globalCount1 = await getHeadcount(pages[2], 'Global');
    console.log(`   Global: ${globalCount1}/3`);
    expect(globalCount1).toBe(3);

    // ============================================
    // PHASE 2: User 4 joins (bumps User 1 to NA)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 2: User 4 (SA) joins → User 1 bumped to North America');
    console.log('='.repeat(80));

    const user4 = USERS[3];
    console.log(`\n📍 User ${user4.id}: ${user4.name} joining...`);

    const context4 = await browsers[3].newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page4 = await context4.newPage();
    page4.on('console', (msg) => console.log(`[${user4.name}]:`, msg.text()));

    // Set custom test location before page loads
    await page4.addInitScript(
      (location) => {
        (window as any).__test_location = location;
      },
      { latitude: user4.lat, longitude: user4.lon },
    );

    await page4.goto('/');
    await page4.waitForLoadState('networkidle');
    await page4.waitForTimeout(3000);

    contexts.push(context4);
    pages.push(page4);

    const status4 = await getStatusBar(page4);
    console.log(`   ✅ ${user4.name} joined: ${status4}`);

    // Wait for FIFO eviction
    await page4.waitForTimeout(4000);

    // Check capacity
    await checkAllRoomsUnderCapacity(page4, `After User 4`);

    console.log('\n📊 After User 4: Global should have users 2,3,4. NA should have user 1');
    const globalCount2 = await getHeadcount(pages[3], 'Global');
    const naCount2 = await getHeadcount(pages[0], 'North America');
    console.log(`   Global: ${globalCount2}/3, North America: ${naCount2}/3`);
    expect(globalCount2).toBe(3);
    expect(naCount2).toBe(1);

    // ============================================
    // PHASE 3: User 5 joins (bumps User 2 to NA)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 3: User 5 (SA) joins → User 2 bumped to North America');
    console.log('='.repeat(80));

    const user5 = USERS[4];
    console.log(`\n📍 User ${user5.id}: ${user5.name} joining...`);

    const context5 = await browsers[4].newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page5 = await context5.newPage();
    page5.on('console', (msg) => console.log(`[${user5.name}]:`, msg.text()));

    // Set custom test location before page loads
    await page5.addInitScript(
      (location) => {
        (window as any).__test_location = location;
      },
      { latitude: user5.lat, longitude: user5.lon },
    );

    await page5.goto('/');
    await page5.waitForLoadState('networkidle');
    await page5.waitForTimeout(3000);

    contexts.push(context5);
    pages.push(page5);

    const status5 = await getStatusBar(page5);
    console.log(`   ✅ ${user5.name} joined: ${status5}`);

    await page5.waitForTimeout(4000);
    await checkAllRoomsUnderCapacity(page5, `After User 5`);

    console.log('\n📊 After User 5: Global should have users 3,4,5. NA should have users 1,2');
    const globalCount3 = await getHeadcount(pages[4], 'Global');
    const naCount3 = await getHeadcount(pages[0], 'North America');
    console.log(`   Global: ${globalCount3}/3, North America: ${naCount3}/3`);
    expect(globalCount3).toBe(3);
    expect(naCount3).toBe(2);

    // ============================================
    // PHASE 4: User 6 joins (bumps User 3 to NA)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 4: User 6 (SA) joins → User 3 bumped to North America');
    console.log('='.repeat(80));

    const user6 = USERS[5];
    console.log(`\n📍 User ${user6.id}: ${user6.name} joining...`);

    const context6 = await browsers[5].newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page6 = await context6.newPage();
    page6.on('console', (msg) => console.log(`[${user6.name}]:`, msg.text()));

    // Set custom test location before page loads
    await page6.addInitScript(
      (location) => {
        (window as any).__test_location = location;
      },
      { latitude: user6.lat, longitude: user6.lon },
    );

    await page6.goto('/');
    await page6.waitForLoadState('networkidle');
    await page6.waitForTimeout(3000);

    contexts.push(context6);
    pages.push(page6);

    const status6 = await getStatusBar(page6);
    console.log(`   ✅ ${user6.name} joined: ${status6}`);

    await page6.waitForTimeout(4000);
    await checkAllRoomsUnderCapacity(page6, `After User 6`);

    console.log('\n📊 After User 6: Global should have users 4,5,6. NA should have users 1,2,3');
    const globalCount4 = await getHeadcount(pages[5], 'Global');
    const naCount4 = await getHeadcount(pages[0], 'North America');
    console.log(`   Global: ${globalCount4}/3, North America: ${naCount4}/3`);
    expect(globalCount4).toBe(3);
    expect(naCount4).toBe(3);

    // ============================================
    // PHASE 5: User 7 joins (bumps User 4 to SA)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 5: User 7 (Asia) joins → User 4 bumped to South America');
    console.log('='.repeat(80));

    const user7 = USERS[6];
    console.log(`\n📍 User ${user7.id}: ${user7.name} joining...`);

    const context7 = await browsers[6].newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page7 = await context7.newPage();
    page7.on('console', (msg) => console.log(`[${user7.name}]:`, msg.text()));

    // Set custom test location before page loads
    await page7.addInitScript(
      (location) => {
        (window as any).__test_location = location;
      },
      { latitude: user7.lat, longitude: user7.lon },
    );

    await page7.goto('/');
    await page7.waitForLoadState('networkidle');
    await page7.waitForTimeout(3000);

    contexts.push(context7);
    pages.push(page7);

    const status7 = await getStatusBar(page7);
    console.log(`   ✅ ${user7.name} joined: ${status7}`);

    await page7.waitForTimeout(4000);
    await checkAllRoomsUnderCapacity(page7, `After User 7`);

    console.log('\n📊 After User 7: Global=5,6,7. NA=1,2,3. SA=4');
    const globalCount5 = await getHeadcount(pages[6], 'Global');
    const naCount5 = await getHeadcount(pages[0], 'North America');
    const saCount5 = await getHeadcount(pages[3], 'South America');
    console.log(
      `   Global: ${globalCount5}/3, North America: ${naCount5}/3, South America: ${saCount5}/3`,
    );
    expect(globalCount5).toBe(3);
    expect(naCount5).toBe(3);
    expect(saCount5).toBe(1);

    // ============================================
    // PHASE 6: All logout
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 6: All users logout');
    console.log('='.repeat(80));

    for (let i = 0; i < USERS.length; i++) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} logging out...`);

      await contexts[i].storageState({
        path: path.join(storageDir, `user-${user.id}-state.json`),
      });

      await cleanupUser(pages[i], user.name);
      await pages[i].close();
      console.log(`   ✅ ${user.name} logged out`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // ============================================
    // PHASE 7: All rejoin (should remember their rooms)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 7: All users rejoin (should remember previous room)');
    console.log('='.repeat(80));

    // Clear arrays
    contexts.length = 0;
    pages.length = 0;

    for (let i = 0; i < USERS.length; i++) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} rejoining...`);

      const context = await browsers[i].newContext({
        storageState: path.join(storageDir, `user-${user.id}-state.json`),
        viewport: { width: 1280, height: 720 },
      });

      const page = await context.newPage();
      page.on('console', (msg) => console.log(`[${user.name}]:`, msg.text()));

      // Set custom test location before page loads
      await page.addInitScript(
        (location) => {
          (window as any).__test_location = location;
        },
        { latitude: user.lat, longitude: user.lon },
      );

      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      contexts.push(context);
      pages.push(page);

      const status = await getStatusBar(page);
      console.log(`   ✅ ${user.name} rejoined: ${status}`);

      await page.waitForTimeout(2000);
    }

    console.log('\n📊 After rejoin: Should be same distribution as before logout');
    const globalCountFinal = await getHeadcount(pages[6], 'Global');
    const naCountFinal = await getHeadcount(pages[0], 'North America');
    const saCountFinal = await getHeadcount(pages[3], 'South America');
    console.log(
      `   Global: ${globalCountFinal}/3, North America: ${naCountFinal}/3, South America: ${saCountFinal}/3`,
    );
    expect(globalCountFinal).toBe(3);
    expect(naCountFinal).toBe(3);
    expect(saCountFinal).toBe(1);

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    for (let i = 0; i < USERS.length; i++) {
      await cleanupUser(pages[i], USERS[i].name);
      await pages[i].close();
      await contexts[i].close();
    }
    for (const browser of browsers) {
      await browser.close();
    }

    console.log('\n✅ Test completed successfully!');
  });
});
