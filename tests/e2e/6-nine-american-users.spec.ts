import { test, expect, Browser, Page, BrowserContext } from '@playwright/test';
import { clearGunDatabases } from './helpers/clear-database';
import * as path from 'path';
import * as fs from 'fs';

// 9 American users with GPS coordinates in the USA
const USERS = [
  { id: 1, name: 'US-User1', lat: 40.7128, lon: -74.006 }, // NYC
  { id: 2, name: 'US-User2', lat: 34.0522, lon: -118.2437 }, // Los Angeles
  { id: 3, name: 'US-User3', lat: 41.8781, lon: -87.6298 }, // Chicago
  { id: 4, name: 'US-User4', lat: 29.7604, lon: -95.3698 }, // Houston
  { id: 5, name: 'US-User5', lat: 33.4484, lon: -112.074 }, // Phoenix
  { id: 6, name: 'US-User6', lat: 39.7392, lon: -104.9903 }, // Denver
  { id: 7, name: 'US-User7', lat: 47.6062, lon: -122.3321 }, // Seattle
  { id: 8, name: 'US-User8', lat: 25.7617, lon: -80.1918 }, // Miami
  { id: 9, name: 'US-User9', lat: 42.3601, lon: -71.0589 }, // Boston
];

test.describe('Nine American Users FIFO Eviction Test', () => {
  test('9 US users: FIFO eviction Global → North America → USA', async ({ playwright }) => {
    test.setTimeout(600000); // 10 minutes for 9 users
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
    async function getHeadcount(
      page: Page,
      chatroomName: string,
      timeout = 10000,
    ): Promise<number> {
      const selector = `.chatroom-item:has-text("${chatroomName}") .chatroom-headcount`;
      const headcount = page.locator(selector);
      await headcount.waitFor({ state: 'visible', timeout });
      const text = await headcount.textContent();
      const match = text?.match(/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }

    // Helper to expand a chatroom to see its children
    async function expandChatroom(page: Page, chatroomName: string): Promise<void> {
      const selector = `.chatroom-item:has-text("${chatroomName}")`;
      const expandButton = page.locator(`${selector} > button`).first();

      // Check if expand button exists with a short timeout
      try {
        await expandButton.waitFor({ state: 'visible', timeout: 2000 });
        await expandButton.click();
        await page.waitForTimeout(500); // Wait for expansion animation
      } catch (error) {
        // Button doesn't exist or already expanded
        throw new Error(`Could not find or click expand button for ${chatroomName}`);
      }
    }

    // Helper to get USA headcount (needs North America expanded)
    async function getUSAHeadcount(page: Page, timeout = 1000): Promise<number> {
      // First expand North America if not already expanded
      try {
        await expandChatroom(page, 'North America');
      } catch (error) {
        // Already expanded or doesn't exist, ignore
      }
      // Use provided timeout (default short for early phases, longer for final assertions)
      return await getHeadcount(page, 'United States', timeout);
    }

    // Helper to check all chatrooms are at or under capacity
    async function checkAllRoomsUnderCapacity(page: Page, userContext: string): Promise<void> {
      const globalCount = await getHeadcount(page, 'Global');
      const naCount = await getHeadcount(page, 'North America');

      // Only check USA if we're past phase 2 (when cascading to USA starts)
      let usaCount = 0;
      try {
        usaCount = await getUSAHeadcount(page);
      } catch (error) {
        // USA might not be visible yet, that's ok
      }

      console.log(`   [${userContext}] Global: ${globalCount}, NA: ${naCount}, USA: ${usaCount}`);

      if (globalCount > 3) {
        throw new Error(`❌ Global room EXCEEDED capacity: ${globalCount}/3`);
      }
      if (naCount > 3) {
        throw new Error(`❌ North America room EXCEEDED capacity: ${naCount}/3`);
      }
      if (usaCount > 3) {
        throw new Error(`❌ USA room EXCEEDED capacity: ${usaCount}/3`);
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

    console.log('🚀 Launching 9 Chrome browsers...');
    for (let i = 0; i < 9; i++) {
      const browser = await playwright.chromium.launch({ headless: true });
      browsers.push(browser);
    }
    console.log('✅ Launched 9 browsers\n');

    const storageDir = path.join(__dirname, '../../.test-storage');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    // ============================================
    // PHASE 1: Users 1-3 join Global (fill Global to 3/3)
    // ============================================
    console.log('='.repeat(80));
    console.log('PHASE 1: Users 1-3 join Global (room fills up to 3/3)');
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
    // PHASE 2: Users 4-6 join (bumps Users 1-3 to North America, fills NA to 3/3)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 2: Users 4-6 join → Users 1-3 bumped to North America (fills NA to 3/3)');
    console.log('='.repeat(80));

    for (let i = 3; i < 6; i++) {
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

      // Wait for FIFO eviction
      await page.waitForTimeout(4000);

      // Check capacity
      await checkAllRoomsUnderCapacity(page, `After User ${user.id}`);
    }

    console.log('\n📊 After Phase 2: Global=4,5,6. North America=1,2,3');
    const globalCount2 = await getHeadcount(pages[5], 'Global');
    const naCount2 = await getHeadcount(pages[0], 'North America');
    console.log(`   Global: ${globalCount2}/3, North America: ${naCount2}/3`);
    expect(globalCount2).toBe(3);
    expect(naCount2).toBe(3);

    // ============================================
    // PHASE 3: Users 7-9 join (cascading evictions to USA)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log(
      'PHASE 3: Users 7-9 join → Cascading evictions push Users 1-3 to USA (fills USA to 3/3)',
    );
    console.log('='.repeat(80));

    for (let i = 6; i < 9; i++) {
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

      // Wait for cascading FIFO eviction
      await page.waitForTimeout(5000);

      // Check capacity
      await checkAllRoomsUnderCapacity(page, `After User ${user.id}`);
    }

    console.log('\n📊 After Phase 3: Global=7,8,9. North America=4,5,6. USA=1,2,3');

    // Wait for UI to update
    await pages[0].waitForTimeout(2000);

    const globalCount3 = await getHeadcount(pages[8], 'Global');
    const naCount3 = await getHeadcount(pages[3], 'North America');

    // Verify USA by checking User 1's status bar (since UI might not show USA chatroom headcount)
    const user1Status = await getStatusBar(pages[0]);
    const user2Status = await getStatusBar(pages[1]);
    const user3Status = await getStatusBar(pages[2]);

    console.log(`   Global: ${globalCount3}/3, North America: ${naCount3}/3`);
    console.log(`   User 1 in: ${user1Status}`);
    console.log(`   User 2 in: ${user2Status}`);
    console.log(`   User 3 in: ${user3Status}`);

    expect(globalCount3).toBe(3);
    expect(naCount3).toBe(3);
    // Verify users 1-3 are in United States
    expect(user1Status).toContain('United States');
    expect(user2Status).toContain('United States');
    expect(user3Status).toContain('United States');

    // ============================================
    // PHASE 4: All logout
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 4: All users logout');
    console.log('='.repeat(80));

    for (let i = 0; i < USERS.length; i++) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} logging out...`);

      await contexts[i].storageState({
        path: path.join(storageDir, `us-user-${user.id}-state.json`),
      });

      await cleanupUser(pages[i], user.name);
      await pages[i].close();
      console.log(`   ✅ ${user.name} logged out`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // ============================================
    // PHASE 5: All rejoin (should remember their rooms)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 5: All users rejoin (should remember previous room)');
    console.log('='.repeat(80));

    // Clear arrays
    contexts.length = 0;
    pages.length = 0;

    for (let i = 0; i < USERS.length; i++) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} rejoining...`);

      const context = await browsers[i].newContext({
        storageState: path.join(storageDir, `us-user-${user.id}-state.json`),
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
    const globalCountFinal = await getHeadcount(pages[8], 'Global');
    const naCountFinal = await getHeadcount(pages[3], 'North America');

    // Verify USA by checking User 1's status bar
    const user1StatusFinal = await getStatusBar(pages[0]);
    const user2StatusFinal = await getStatusBar(pages[1]);
    const user3StatusFinal = await getStatusBar(pages[2]);

    console.log(`   Global: ${globalCountFinal}/3, North America: ${naCountFinal}/3`);
    console.log(`   User 1 in: ${user1StatusFinal}`);
    console.log(`   User 2 in: ${user2StatusFinal}`);
    console.log(`   User 3 in: ${user3StatusFinal}`);

    expect(globalCountFinal).toBe(3);
    expect(naCountFinal).toBe(3);
    // Verify users 1-3 are still in United States
    expect(user1StatusFinal).toContain('United States');
    expect(user2StatusFinal).toContain('United States');
    expect(user3StatusFinal).toContain('United States');

    // ============================================
    // SUCCESS SUMMARY
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('🎉 ✅ ALL NINE-USER TESTS PASSED!');
    console.log('='.repeat(80));
    console.log('Summary:');
    console.log('  1. ✅ Users 1-3 filled Global (3/3)');
    console.log('  2. ✅ Users 4-6 joined → Users 1-3 bumped to North America (3/3)');
    console.log('  3. ✅ Users 7-9 joined → Cascading evictions pushed Users 1-3 to USA (3/3)');
    console.log('  4. ✅ All users rejoined → Same room distribution maintained');
    console.log('     - Global: Users 7, 8, 9');
    console.log('     - North America: Users 4, 5, 6');
    console.log('     - USA: Users 1, 2, 3');

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await clearGunDatabases();
    for (let i = 0; i < USERS.length; i++) {
      await cleanupUser(pages[i], USERS[i].name);
      await pages[i].close();
      await contexts[i].close();
    }
    for (const browser of browsers) {
      await browser.close();
    }

    console.log('✅ Cleanup complete');
  });
});
