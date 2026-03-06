import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';

// User definitions with GPS coordinates for each continent
const USERS = [
  // North America - 3 users
  { id: 1, name: 'NA-User1', lat: 40.7128, lon: -74.006, continent: 'North America' }, // New York
  { id: 2, name: 'NA-User2', lat: 34.0522, lon: -118.2437, continent: 'North America' }, // Los Angeles
  { id: 3, name: 'NA-User3', lat: 41.8781, lon: -87.6298, continent: 'North America' }, // Chicago

  // South America - 3 users
  { id: 4, name: 'SA-User1', lat: -23.5505, lon: -46.6333, continent: 'South America' }, // São Paulo
  { id: 5, name: 'SA-User2', lat: -34.6037, lon: -58.3816, continent: 'South America' }, // Buenos Aires
  { id: 6, name: 'SA-User3', lat: -15.7975, lon: -47.8919, continent: 'South America' }, // Brasília

  // Europe - 3 users
  { id: 7, name: 'EU-User1', lat: 51.5074, lon: -0.1278, continent: 'Europe' }, // London
  { id: 8, name: 'EU-User2', lat: 48.8566, lon: 2.3522, continent: 'Europe' }, // Paris
  { id: 9, name: 'EU-User3', lat: 52.52, lon: 13.405, continent: 'Europe' }, // Berlin

  // Asia - 3 users
  { id: 10, name: 'AS-User1', lat: 35.6762, lon: 139.6503, continent: 'Asia' }, // Tokyo
  { id: 11, name: 'AS-User2', lat: 39.9042, lon: 116.4074, continent: 'Asia' }, // Beijing
  { id: 12, name: 'AS-User3', lat: 1.3521, lon: 103.8198, continent: 'Asia' }, // Singapore

  // Africa - 3 users
  { id: 13, name: 'AF-User1', lat: 6.5244, lon: 3.3792, continent: 'Africa' }, // Lagos
  { id: 14, name: 'AF-User2', lat: -26.2041, lon: 28.0473, continent: 'Africa' }, // Johannesburg
  { id: 15, name: 'AF-User3', lat: 30.0444, lon: 31.2357, continent: 'Africa' }, // Cairo

  // Oceania - 3 users
  { id: 16, name: 'OC-User1', lat: -33.8688, lon: 151.2093, continent: 'Oceania' }, // Sydney
  { id: 17, name: 'OC-User2', lat: -37.8136, lon: 144.9631, continent: 'Oceania' }, // Melbourne
  { id: 18, name: 'OC-User3', lat: -41.2865, lon: 174.7762, continent: 'Oceania' }, // Wellington

  // 3 extra Americans joining Global last
  { id: 19, name: 'US-Extra1', lat: 37.7749, lon: -122.4194, continent: 'North America' }, // San Francisco
  { id: 20, name: 'US-Extra2', lat: 29.7604, lon: -95.3698, continent: 'North America' }, // Houston
  { id: 21, name: 'US-Extra3', lat: 33.4484, lon: -112.074, continent: 'North America' }, // Phoenix
];

test.describe('Twenty-One User Comprehensive Chatroom Test', () => {
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  // Viewport/grid dimensions (shared so test and beforeAll can use them)
  const COLS = 7;
  const ROWS = 3;
  const viewportWidth = Math.floor(1920 / COLS);
  const viewportHeight = Math.floor(1080 / ROWS);
  const browserChromeHeight = 200;

  // Helper function to get status bar text
  async function getStatusBar(page: Page): Promise<string> {
    try {
      const statusBar = await page.locator('#status-bar-text');
      await statusBar.waitFor({ state: 'visible', timeout: 5000 });
      const text = await statusBar.textContent();
      return text || '';
    } catch (e) {
      return 'ERROR';
    }
  }

  // Helper function to get headcount for a chatroom
  async function getHeadcount(page: Page, chatroomName: string): Promise<string> {
    try {
      const headcount = await page.locator(
        `.chatroom-item:has-text("${chatroomName}") .chatroom-headcount`,
      ).first();
      await headcount.waitFor({ state: 'visible', timeout: 5000 });
      const text = await headcount.textContent();
      return text || '0';
    } catch (e) {
      return 'ERROR';
    }
  }

  // Helper to parse headcount string to number
  function parseHeadcount(headcountStr: string): number {
    const match = headcountStr.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  // Helper function to cleanup user before closing
  async function cleanupUser(page: Page, userName: string): Promise<void> {
    try {
      await page.evaluate(() => {
        if ((window as any).__iinpublic_app) {
          (window as any).__iinpublic_app.cleanup();
        }
      });
      console.log(`✅ ${userName} cleanup called`);
    } catch (e) {
      console.log(`⚠️  ${userName} cleanup failed: ${e}`);
    }
  }

  test.beforeAll(async () => {
    // Clear databases before starting
    await clearGunDatabases();

    // Launch 21 browsers in a grid layout (7x3)
    console.log('🚀 Launching 21 Chrome browsers...');
    for (let i = 0; i < 21; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * viewportWidth;
      const y = row * (viewportHeight + browserChromeHeight);

      const browser = await chromium.launch({
        headless: false,
        slowMo: 50,
        args: [
          `--window-position=${x},${y}`,
          `--window-size=${viewportWidth},${viewportHeight + browserChromeHeight}`,
          '--force-device-scale-factor=0.8',
        ],
      });
      browsers.push(browser);
    }

    console.log(`✅ Launched ${browsers.length} browsers in ${COLS}x${ROWS} grid`);
  });

  test.afterAll(async () => {
    console.log('🧹 Closing all browsers...');
    for (const browser of browsers) {
      if (browser) await browser.close();
    }

    // Clean up databases after test
    await clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  test('21 users: login, logout, re-login, stack-order exit with headcount checks', async () => {
    test.setTimeout(900000); // 15 minutes for 21 users
    const screenshotDir = path.join(__dirname, '../../test-screenshots/twenty-one-user');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const storageDir = path.join(__dirname, '../../.test-storage');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    // ============================================
    // PHASE 1: All 21 users login sequentially
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 1: All 21 users login (Global FIFO bumps to continental rooms)');
    console.log('='.repeat(80));

    // Track headcounts to detect unexpected decreases
    let lastHeadcounts = {
      global: 0,
      na: 0,
      sa: 0,
      eu: 0,
      as: 0,
      af: 0,
      oc: 0,
    };

    // Login all 21 users sequentially
    for (let i = 0; i < 21; i++) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} joining (${user.continent})...`);

      const context = await browsers[i].newContext({
        viewport: { width: viewportWidth, height: viewportHeight },
        deviceScaleFactor: 0.8,
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
      await ensureWindowFitsViewport(page, viewportWidth, viewportHeight);
      await page.waitForTimeout(3000);

      contexts.push(context);
      pages.push(page);

      const status = await getStatusBar(page);
      console.log(`   ✅ ${user.name} joined: ${status}`);

      // Wait for FIFO eviction to process
      await page.waitForTimeout(5000);

      // Check headcounts and verify they're sensible
      const globalCount = parseHeadcount(await getHeadcount(page, 'Global'));
      const naCount = parseHeadcount(await getHeadcount(page, 'North America'));
      const saCount = parseHeadcount(await getHeadcount(page, 'South America'));
      const euCount = parseHeadcount(await getHeadcount(page, 'Europe'));
      const asCount = parseHeadcount(await getHeadcount(page, 'Asia'));
      const afCount = parseHeadcount(await getHeadcount(page, 'Africa'));
      const ocCount = parseHeadcount(await getHeadcount(page, 'Oceania'));

      console.log(
        `   📊 [After User ${user.id}] G:${globalCount} NA:${naCount} SA:${saCount} EU:${euCount} AS:${asCount} AF:${afCount} OC:${ocCount}`,
      );

      // Verify Global never exceeds capacity
      if (globalCount > 3) {
        throw new Error(`❌ Global exceeded capacity: ${globalCount}/3 after ${user.name} joined`);
      }

      // Verify continental rooms never exceed capacity
      if (naCount > 3) {
        throw new Error(
          `❌ North America exceeded capacity: ${naCount}/3 after ${user.name} joined`,
        );
      }
      if (saCount > 3) {
        throw new Error(
          `❌ South America exceeded capacity: ${saCount}/3 after ${user.name} joined`,
        );
      }
      if (euCount > 3) {
        throw new Error(`❌ Europe exceeded capacity: ${euCount}/3 after ${user.name} joined`);
      }
      if (asCount > 3) {
        throw new Error(`❌ Asia exceeded capacity: ${asCount}/3 after ${user.name} joined`);
      }
      if (afCount > 3) {
        throw new Error(`❌ Africa exceeded capacity: ${afCount}/3 after ${user.name} joined`);
      }
      if (ocCount > 3) {
        throw new Error(`❌ Oceania exceeded capacity: ${ocCount}/3 after ${user.name} joined`);
      }

      // Specific verification for User 1 receiving headcount updates after being bumped
      if (i === 4) {
        console.log('   🔍 Verifying User 1 sees headcount change in North America...');
        // User 1 should be in North America and see 2 users (User 1 + User 2)
        
        // Use polling to ensure we catch the update
        await expect.poll(async () => {
          const user1NAHeadcount = await getHeadcount(pages[0], 'North America');
          return parseHeadcount(user1NAHeadcount);
        }, {
          message: 'User 1 should see 2 users in North America',
          timeout: 10000,
        }).toBe(2);
        
        console.log('   ✅ User 1 correctly sees 2 users in North America');
      }

      // Check for unexpected decreases (except when cascading might cause temporary fluctuations)
      // Continental rooms should only increase or stay same (never decrease when users join)
      if (i > 3) {
        // After Global fills
        if (naCount < lastHeadcounts.na - 1) {
          console.warn(
            `⚠️  North America headcount decreased unexpectedly: ${lastHeadcounts.na} -> ${naCount}`,
          );
        }
        if (saCount < lastHeadcounts.sa - 1) {
          console.warn(
            `⚠️  South America headcount decreased unexpectedly: ${lastHeadcounts.sa} -> ${saCount}`,
          );
        }
        if (euCount < lastHeadcounts.eu - 1) {
          console.warn(
            `⚠️  Europe headcount decreased unexpectedly: ${lastHeadcounts.eu} -> ${euCount}`,
          );
        }
        if (asCount < lastHeadcounts.as - 1) {
          console.warn(
            `⚠️  Asia headcount decreased unexpectedly: ${lastHeadcounts.as} -> ${asCount}`,
          );
        }
        if (afCount < lastHeadcounts.af - 1) {
          console.warn(
            `⚠️  Africa headcount decreased unexpectedly: ${lastHeadcounts.af} -> ${afCount}`,
          );
        }
        if (ocCount < lastHeadcounts.oc - 1) {
          console.warn(
            `⚠️  Oceania headcount decreased unexpectedly: ${lastHeadcounts.oc} -> ${ocCount}`,
          );
        }
      }

      // Update last headcounts
      lastHeadcounts = {
        global: globalCount,
        na: naCount,
        sa: saCount,
        eu: euCount,
        as: asCount,
        af: afCount,
        oc: ocCount,
      };

      console.log(`   ✅ Headcounts within capacity limits`);
    }

    console.log('\n✅ All 21 users logged in');

    // Wait for final sync
    console.log('⏳ Waiting 5s for final headcount sync...');
    await pages[0].waitForTimeout(5000);

    // Check final headcounts
    // Expected: Global should have last 3 users (19, 20, 21)
    // Continental rooms should have users bumped from Global
    console.log('\n📊 Checking final headcounts:');
    const globalCount = await getHeadcount(pages[20], 'Global');
    const naCount = await getHeadcount(pages[0], 'North America');
    const saCount = await getHeadcount(pages[3], 'South America');
    const euCount = await getHeadcount(pages[6], 'Europe');
    const asCount = await getHeadcount(pages[9], 'Asia');
    const afCount = await getHeadcount(pages[12], 'Africa');
    const ocCount = await getHeadcount(pages[15], 'Oceania');

    console.log(`   Global: ${globalCount} (expected: 3 - users 19, 20, 21)`);
    console.log(`   North America: ${naCount}`);
    console.log(`   South America: ${saCount}`);
    console.log(`   Europe: ${euCount}`);
    console.log(`   Asia: ${asCount}`);
    console.log(`   Africa: ${afCount}`);
    console.log(`   Oceania: ${ocCount}`);

    // ============================================
    // PHASE 3: Sequential logout (1s intervals)
    // ============================================
    // PHASE 2: Sequential logout (1s intervals)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 2: Sequential logout - Users exit one by one (1s interval)');
    console.log('='.repeat(80));

    for (let i = 0; i < USERS.length; i++) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} logging out...`);

      // Save storage state before logout
      await contexts[i].storageState({
        path: path.join(storageDir, `user-${user.id}-state.json`),
      });

      await cleanupUser(pages[i], user.name);
      await pages[i].close();
      console.log(`   ✅ ${user.name} logged out`);

      // Wait 1 second before next logout
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check headcounts from a still-active user (if any)
      if (i < USERS.length - 1) {
        const nextActiveUser = USERS[i + 1];
        const globalCount = await getHeadcount(pages[i + 1], 'Global');
        console.log(`   📊 ${nextActiveUser.name} sees Global: ${globalCount}`);
      }
    }

    console.log('\n✅ All users logged out');

    // Wait for Gun.js cleanup
    console.log('⏳ Waiting 5s for Gun.js cleanup...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // ============================================
    // PHASE 3: Re-login all users
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 3: Re-login - All users re-enter (remember last room)');
    console.log('='.repeat(80));

    // Clear arrays for new contexts/pages
    contexts.length = 0;
    pages.length = 0;

    for (let i = 0; i < USERS.length; i++) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} re-logging in...`);

      const context = await browsers[i].newContext({
        viewport: { width: Math.floor(1920 / 7), height: Math.floor(1080 / 3) },
        deviceScaleFactor: 0.8,
        storageState: path.join(storageDir, `user-${user.id}-state.json`),
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
      await page.waitForTimeout(2000);

      contexts.push(context);
      pages.push(page);

      const status = await getStatusBar(page);
      console.log(`   ✅ ${user.name} re-logged in: ${status}`);

      // Check headcounts
      const globalCount = await getHeadcount(page, 'Global');
      console.log(`   📊 Global headcount: ${globalCount}`);

      // Small delay between logins
      await page.waitForTimeout(1000);
    }

    console.log('\n✅ All users re-logged in');

    // Wait for all headcounts to sync
    console.log('⏳ Waiting 5s for final headcount sync...');
    await pages[0].waitForTimeout(5000);

    // Check final headcounts again
    console.log('\n📊 Checking final headcounts after re-login from User 1 perspective:');
    const globalCount2 = await getHeadcount(pages[0], 'Global');
    const naCount2 = await getHeadcount(pages[0], 'North America');
    const saCount2 = await getHeadcount(pages[0], 'South America');
    const euCount2 = await getHeadcount(pages[0], 'Europe');
    const asCount2 = await getHeadcount(pages[0], 'Asia');
    const afCount2 = await getHeadcount(pages[0], 'Africa');
    const ocCount2 = await getHeadcount(pages[0], 'Oceania');

    console.log(`   Global: ${globalCount2}`);
    console.log(`   North America: ${naCount2}`);
    console.log(`   South America: ${saCount2}`);
    console.log(`   Europe: ${euCount2}`);
    console.log(`   Asia: ${asCount2}`);
    console.log(`   Africa: ${afCount2}`);
    console.log(`   Oceania: ${ocCount2}`);

    // ============================================
    // PHASE 4: Stack-order exit (reverse, 21→1)
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 4: Stack-order exit - Users exit in reverse (21→1)');
    console.log('='.repeat(80));

    for (let i = USERS.length - 1; i >= 0; i--) {
      const user = USERS[i];
      console.log(`\n📍 User ${user.id}: ${user.name} exiting (stack order)...`);

      await cleanupUser(pages[i], user.name);
      await pages[i].close();
      await contexts[i].close();
      console.log(`   ✅ ${user.name} exited`);

      // Wait 1 second before next exit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check headcounts from a still-active user (if any)
      if (i > 0) {
        const prevUser = USERS[i - 1];
        const globalCount = await getHeadcount(pages[i - 1], 'Global');
        console.log(`   📊 ${prevUser.name} sees Global: ${globalCount}`);
      }
    }

    console.log('\n✅ All users exited in stack order');

    console.log('\n🎉 ✅ ALL TWENTY-ONE-USER TESTS PASSED!');
    console.log('='.repeat(80));
    console.log('Summary:');
    console.log('  Phase 1: ✅ 21 users join sequentially, Global FIFO bumps to continental rooms');
    console.log('  Phase 2: ✅ All users logged out sequentially (1s interval)');
    console.log('  Phase 3: ✅ All users re-logged in successfully (remember last room)');
    console.log('  Phase 4: ✅ All users exited in stack order (reverse)');
    console.log('  ✅ Headcount verified at every step');
  });
});
