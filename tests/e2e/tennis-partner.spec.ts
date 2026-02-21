import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Tennis Partner Talk - Two User Interaction', () => {
  let browser1: Browser;
  let browser2: Browser;
  let user1Context: BrowserContext;
  let user2Context: BrowserContext;
  let user1Page: Page;
  let user2Page: Page;

  // Helper function to create a simple talk
  async function createSimpleTalk(
    page: Page,
    title: string,
    question: string,
    yesAction: 'noticed' | 'ignore',
    noAction: 'noticed' | 'ignore',
  ) {
    await page.click('#create-talk-btn');
    await page.waitForSelector('.modal-overlay', { timeout: 5000 });

    await page.fill('#talk-title', title);
    await page.selectOption('#talk-type', 'matching');
    await page.fill('.question-item .question-text', question);
    await page.fill('.answer-item:nth-child(1) .answer-text', 'Yes');
    await page.selectOption('.answer-item:nth-child(1) .answer-next', yesAction);
    await page.fill('.answer-item:nth-child(2) .answer-text', 'No');
    await page.selectOption('.answer-item:nth-child(2) .answer-next', noAction);

    await page.click('#talk-editor-form button[type="submit"]');
    await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(3000); // Increased wait for Gun.js sync
  }

  test.beforeAll(async () => {
    // Clear Gun.js databases to start fresh (removes persisted users like "a2")
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
    console.log('⚠️  Please close any manually opened browser tabs pointing to localhost:3001');

    // Launch 2 separate Chrome browsers positioned side-by-side
    browser1 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=960,1200'],
    });

    browser2 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=960,0', '--window-size=960,1200'],
    });

    // Create contexts - each browser gets its own context
    user1Context = await browser1.newContext({
      viewport: { width: 960, height: 1200 },
      storageState: undefined, // Start with clean storage
    });
    user2Context = await browser2.newContext({
      viewport: { width: 960, height: 1200 },
      storageState: undefined, // Start with clean storage
    });

    // Create a page in each context
    user1Page = await user1Context.newPage();
    user2Page = await user2Context.newPage();

    // Listen to console messages from both pages
    user1Page.on('console', (msg) => console.log(`[User1 Browser]:`, msg.text()));
    user2Page.on('console', (msg) => console.log(`[User2 Browser]:`, msg.text()));

    console.log('🚀 Launched 2 Chrome browsers side-by-side');
    console.log('   User 1: Left window (0,0)');
    console.log('   User 2: Right window (960,0)');
  });

  test.afterAll(async () => {
    await user1Context.close();
    await user2Context.close();
    await browser1.close();
    await browser2.close();

    // Clean up databases after test
    console.log('🧹 Cleaning up databases after test...');

    const radataPath = path.join(__dirname, '../../radata');
    if (fs.existsSync(radataPath)) {
      fs.rmSync(radataPath, { recursive: true, force: true });
      console.log('  ✅ Cleared client database (radata/)');
    }

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

    console.log('✅ Cleanup complete');
  });

  test('Should open app and sign in two users', async () => {
    // ============================================
    // STEP 1: User 1 signs in
    // ============================================
    console.log('📍 Step 1: User 1 signing in...');
    await user1Page.goto('/');
    await user1Page.waitForLoadState('networkidle');

    // Fill in user creation form
    const user1StageNameInput = user1Page.locator('#stage-name');
    await user1StageNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await user1StageNameInput.fill('TennisPlayer1');

    const user1SubmitBtn = user1Page.locator('button[type="submit"]');
    await user1SubmitBtn.click();

    // Wait for main interface to load
    await user1Page.waitForSelector('#create-talk-btn', { timeout: 10000 });
    console.log('✅ User 1 signed in as TennisPlayer1');

    // ============================================
    // STEP 2: User 2 signs in
    // ============================================
    console.log('📍 Step 2: User 2 signing in...');
    await user2Page.goto('/');
    await user2Page.waitForLoadState('networkidle');

    const user2StageNameInput = user2Page.locator('#stage-name');
    await user2StageNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await user2StageNameInput.fill('TennisPlayer2');

    const user2SubmitBtn = user2Page.locator('button[type="submit"]');
    await user2SubmitBtn.click();

    await user2Page.waitForSelector('#create-talk-btn', { timeout: 10000 });
    console.log('✅ User 2 signed in as TennisPlayer2');

    // Wait for Gun.js synchronization between the two browser contexts
    console.log('⏳ Waiting for Gun.js peer synchronization...');
    await user1Page.waitForTimeout(3000);
    await user2Page.waitForTimeout(3000);

    // Verify both users can see the navigation
    const user1NavCount = await user1Page.locator('.nav-btn').count();
    const user2NavCount = await user2Page.locator('.nav-btn').count();

    console.log(`✅ User 1 sees ${user1NavCount} navigation tabs`);
    console.log(`✅ User 2 sees ${user2NavCount} navigation tabs`);

    if (user1NavCount !== 4 || user2NavCount !== 4) {
      throw new Error(
        `Expected 4 navigation tabs, got User1: ${user1NavCount}, User2: ${user2NavCount}`,
      );
    }

    console.log('🎉 ✅ BASIC TEST PASSED - App opens and users can sign in!');
  });

  test.skip('Test auto/manual answer preferences', async () => {
    // ============================================
    // SETUP: Wait for Gun.js to fully settle from previous test
    // ============================================
    console.log('🔄 Setting up test 2...');
    console.log('⏳ Waiting 10 seconds for Gun.js to fully stabilize from test 1...');
    await user1Page.waitForTimeout(10000);
    await user2Page.waitForTimeout(10000);

    // Ensure pages are in correct state before accessing localStorage
    console.log('🔍 Verifying users are still signed in...');
    await user1Page.waitForSelector('#create-talk-btn', { state: 'visible', timeout: 10000 });
    await user2Page.waitForSelector('#create-talk-btn', { state: 'visible', timeout: 10000 });
    console.log('✅ Both users still signed in');

    // Clear only answer preferences (not all localStorage)
    console.log('🧹 Clearing answer preferences...');
    await user1Page.evaluate(() => localStorage.removeItem('answerPreferences'));
    await user2Page.evaluate(() => localStorage.removeItem('answerPreferences'));
    console.log('✅ Answer preferences cleared');

    // ============================================
    // STEP 1: User 1 creates a simple Talk
    // ============================================
    console.log('📍 Step 1: User 1 creating a simple Talk...');

    // Verify create button exists before clicking
    await user1Page.waitForSelector('#create-talk-btn', { state: 'visible', timeout: 5000 });
    console.log('  Create button found');

    await createSimpleTalk(
      user1Page,
      'preferences test',
      'Do you like coffee?',
      'noticed',
      'ignore',
    );
    console.log('✅ Talk created and submitted');

    // Extra wait for talk to broadcast
    console.log('⏳ Waiting for talk to broadcast through Gun.js...');
    await user1Page.waitForTimeout(3000);
    await user2Page.waitForTimeout(3000);

    // ============================================
    // STEP 2: User 2 receives and answers with Auto mode
    // ============================================
    console.log('📍 Step 2: User 2 navigating to Talks tab to see received talk...');

    // Click on Talks tab to see the received talk
    await user2Page.click('#tab-talks');
    await user2Page.waitForTimeout(500);

    // Poll for the new talk in the talks list with retries
    console.log('⏳ Waiting for talk to appear in Talks list...');
    let talkFound = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!talkFound && attempts < maxAttempts) {
      attempts++;
      const talkCount = await user2Page
        .locator('.talk-list-item:has-text("preferences test")')
        .count();
      console.log(
        `  Attempt ${attempts}/${maxAttempts}: Found ${talkCount} matching talks in list`,
      );

      if (talkCount > 0) {
        talkFound = true;
        console.log('  ✅ Talk found in list!');
      } else {
        console.log('  ⏳ Not found yet, waiting 2 more seconds...');
        await user2Page.waitForTimeout(2000);

        // Debug: Show all talk items
        const allTalks = await user2Page.locator('.talk-list-item').count();
        console.log(`  Total talks in list: ${allTalks}`);
      }
    }

    if (!talkFound) {
      throw new Error(
        '❌ Talk "preferences test" never appeared in Talks list after ' +
          maxAttempts +
          ' attempts',
      );
    }

    const talkListItem = user2Page.locator('.talk-list-item:has-text("preferences test")');
    await talkListItem.waitFor({ state: 'visible', timeout: 5000 });

    // Click on the talk to open answer modal
    await talkListItem.click();
    await user2Page.waitForSelector('.modal-overlay', { timeout: 5000 });
    console.log('✅ Talk response modal opened');

    // Verify ignore button exists
    const ignoreButton = user2Page.locator('button:has-text("Ignore this talk")');
    await ignoreButton.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Ignore button is present');

    // Verify auto/manual buttons exist for the first answer
    const autoBtn = user2Page.locator('button.answer-auto-btn').first();
    const manualBtn = user2Page.locator('button.answer-manual-btn').first();

    await autoBtn.waitFor({ state: 'visible', timeout: 5000 });
    await manualBtn.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Auto/Manual buttons are present');

    // Click the auto button for "Yes" answer (first answer option)
    await autoBtn.click();
    console.log('✅ Clicked Auto button for Yes');

    // Should see match notification - use first() since there might be multiple notifications
    const matchNotification = user2Page.locator('.notification.success:has-text("Match")').first();
    await matchNotification.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Match notification displayed');

    await user2Page.waitForTimeout(3000);

    // ============================================
    // STEP 3: Verify preference was saved
    // ============================================
    console.log('📍 Step 3: Verifying preference was saved...');

    // Check localStorage for saved preference
    const savedPreference = await user2Page.evaluate(() => {
      const prefs = localStorage.getItem('answerPreferences');
      return prefs ? JSON.parse(prefs) : null;
    });

    console.log('Saved preferences:', JSON.stringify(savedPreference, null, 2));

    if (!savedPreference || Object.keys(savedPreference).length === 0) {
      throw new Error('❌ No preferences were saved!');
    }
    console.log('✅ Preference saved in localStorage');

    // ============================================
    // STEP 4: Test auto-answer on second occurrence
    // ============================================
    console.log('📍 Step 4: Testing auto-answer on second occurrence...');

    // User 1 creates the same talk again
    await createSimpleTalk(
      user1Page,
      'preferences test 2',
      'Do you like coffee?',
      'noticed',
      'ignore',
    );
    console.log('✅ Second talk created');

    // Wait for talk to propagate
    await user1Page.waitForTimeout(3000);
    await user2Page.waitForTimeout(3000);

    // User 2 should see the talk in Talks list and auto-answer when clicked
    console.log('  Waiting for second talk to appear...');
    const talkListItem2 = user2Page.locator('.talk-list-item:has-text("preferences test 2")');
    await talkListItem2.waitFor({ state: 'visible', timeout: 10000 });

    // Click to open the answer modal - should auto-answer due to saved preference
    await talkListItem2.click();

    // Wait a bit for auto-answer logic
    await user2Page.waitForTimeout(1000);

    // Should see auto match notification - use first() since there might be multiple notifications
    const autoMatchNotification = user2Page
      .locator('.notification.success:has-text("Match")')
      .first();
    await autoMatchNotification.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Auto-answer triggered - Match notification displayed with (auto) tag');

    // ============================================
    // STEP 5: Test preferences UI
    // ============================================
    console.log('📍 Step 5: Testing preferences management UI...');

    // Navigate to Answers tab first
    const answersNavBtn = user2Page.locator('.nav-btn[data-view="answers"]');
    await answersNavBtn.click();
    await user2Page.waitForTimeout(500);
    console.log('✅ Navigated to Answers tab');

    // Click on "My Answers" button
    const viewPrefsBtn = user2Page.locator('#view-preferences-btn');
    await viewPrefsBtn.waitFor({ state: 'visible', timeout: 5000 });
    await viewPrefsBtn.click();

    // Wait for preferences modal
    await user2Page.waitForSelector('#preferences-modal', { timeout: 5000 });
    console.log('✅ Preferences modal opened');

    // Verify preference is displayed
    const preferenceItem = user2Page.locator('.preference-item:has-text("Yes")');
    await preferenceItem.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Saved preference is displayed in UI');

    // Test delete button
    const deleteBtn = user2Page.locator('.delete-pref-btn').first();
    await deleteBtn.click();

    await user2Page.waitForTimeout(1000);

    // Verify preference is gone
    const emptyMessage = user2Page.locator('p:has-text("No answered questions yet")');
    await emptyMessage.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Preference deleted successfully');

    // Close preferences modal
    const closeBtn = user2Page.locator('#close-preferences-modal');
    await closeBtn.click();
    await user2Page.waitForSelector('#preferences-modal', { state: 'detached', timeout: 5000 });
    console.log('✅ Preferences modal closed');

    console.log('🎉 ✅ ALL AUTO/MANUAL PREFERENCE TESTS PASSED!');
  });

  test.skip('should track and display "My Talks" history', async () => {
    console.log('\n🎬 Starting "My Talks" feature test...\n');

    // ============================================
    // STEP 0: Clear localStorage and sign in both users
    // ============================================
    console.log('📍 Step 0: Clearing state and signing in both users...');

    // User 1: Navigate first, then clear localStorage
    await user1Page.goto('/');
    await user1Page.waitForLoadState('networkidle');
    await user1Page.evaluate(() => localStorage.clear());

    // User 2: Navigate first, then clear localStorage
    await user2Page.goto('/');
    await user2Page.waitForLoadState('networkidle');
    await user2Page.evaluate(() => localStorage.clear());

    // User 1 sign in
    await user1Page.goto('/');
    await user1Page.waitForLoadState('networkidle');
    const user1StageNameInput = user1Page.locator('#stage-name');
    await user1StageNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await user1StageNameInput.fill('TennisPlayer1');
    const user1SubmitBtn = user1Page.locator('button[type="submit"]');
    await user1SubmitBtn.click();
    await user1Page.waitForSelector('#create-talk-btn', { timeout: 10000 });
    console.log('✅ User 1 signed in as TennisPlayer1');

    // User 2 sign in
    await user2Page.goto('/');
    await user2Page.waitForLoadState('networkidle');
    const user2StageNameInput = user2Page.locator('#stage-name');
    await user2StageNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await user2StageNameInput.fill('TennisPlayer2');
    const user2SubmitBtn = user2Page.locator('button[type="submit"]');
    await user2SubmitBtn.click();
    await user2Page.waitForSelector('#create-talk-btn', { timeout: 10000 });
    console.log('✅ User 2 signed in as TennisPlayer2');

    // Wait for Gun.js synchronization
    console.log('⏳ Waiting for Gun.js peer synchronization...');
    await user1Page.waitForTimeout(3000);
    await user2Page.waitForTimeout(3000);

    // ============================================
    // STEP 1: User1 creates a talk
    // ============================================
    console.log('📍 Step 1: User1 creates a talk...');

    await createSimpleTalk(user1Page, 'My Talks Test', 'Do you enjoy hiking?', 'noticed', 'ignore');

    console.log('✅ Talk created by User1');

    // ============================================
    // STEP 2: User2 receives and answers the talk
    // ============================================
    console.log('📍 Step 2: User2 receives and answers the talk...');

    // Wait for talk to propagate
    await user2Page.waitForTimeout(3000);

    // Navigate to Talks tab to see received talk
    console.log('  Navigating to Talks tab...');
    await user2Page.click('#tab-talks');
    await user2Page.waitForTimeout(500);

    // Wait for talk to appear in Talks list
    const talkListItem = user2Page.locator('.talk-list-item:has-text("My Talks Test")');
    await talkListItem.waitFor({ state: 'visible', timeout: 15000 });
    console.log('✅ User2 sees talk in Talks list');

    // Click on talk to open answer modal
    await talkListItem.click();

    // Wait for talk response modal to open
    await user2Page.waitForSelector('#talk-response-modal', { timeout: 5000 });
    console.log('✅ Talk response modal opened on User2');

    // Wait a bit for the modal to fully render
    await user2Page.waitForTimeout(500);

    // Click AUTO button for "Yes" answer (first answer's AUTO button)
    const autoBtn = user2Page.locator('button.answer-auto-btn').first();
    await autoBtn.waitFor({ state: 'visible', timeout: 5000 });
    await autoBtn.click();
    console.log('✅ User2 clicked AUTO button for answer');

    // Wait for talk response modal to close
    await user2Page.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    console.log('✅ User2 answered the talk');

    // ============================================
    // STEP 3: User1 checks "My Talks" for created talk
    // ============================================
    console.log('📍 Step 3: User1 checks "My Talks" for created talk...');

    // Navigate to Me tab first
    const meNavBtn1 = user1Page.locator('.nav-btn[data-view="me"]');
    await meNavBtn1.click();
    await user1Page.waitForTimeout(500);
    console.log('✅ User1 navigated to Me tab');

    // Click "My Talks" button on User1
    const myTalksBtn1 = user1Page.locator('#view-my-talks-btn');
    await myTalksBtn1.waitFor({ state: 'visible', timeout: 5000 });
    await myTalksBtn1.click();

    // Wait for My Talks modal
    await user1Page.waitForSelector('#my-talks-modal', { timeout: 5000 });
    console.log('✅ My Talks modal opened on User1');

    // Verify created talk is shown with "Created by me" badge
    const createdTalkItem = user1Page.locator('.talk-history-item:has-text("My Talks Test")');
    await createdTalkItem.waitFor({ state: 'visible', timeout: 5000 });

    const createdBadge = createdTalkItem.locator('span:has-text("Created by me")');
    await createdBadge.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Created talk appears with "Created by me" badge');

    // Verify talk type badge
    const typeBadge = createdTalkItem.locator('span:has-text("matching")');
    await typeBadge.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Talk type badge displayed');

    // Close My Talks modal
    const closeBtn1 = user1Page.locator('#close-my-talks-modal');
    await closeBtn1.click();
    await user1Page.waitForSelector('#my-talks-modal', { state: 'detached', timeout: 5000 });
    console.log('✅ My Talks modal closed on User1');

    // ============================================
    // STEP 4: User2 checks "My Talks" for answered talk
    // ============================================
    console.log('📍 Step 4: User2 checks "My Talks" for answered talk...');

    // Navigate to Me tab first
    const meNavBtn2 = user2Page.locator('.nav-btn[data-view="me"]');
    await meNavBtn2.click();
    await user2Page.waitForTimeout(500);
    console.log('✅ User2 navigated to Me tab');

    // Click "My Talks" button on User2
    const myTalksBtn2 = user2Page.locator('#view-my-talks-btn');
    await myTalksBtn2.waitFor({ state: 'visible', timeout: 5000 });
    await myTalksBtn2.click();

    // Wait for My Talks modal
    await user2Page.waitForSelector('#my-talks-modal', { timeout: 5000 });
    console.log('✅ My Talks modal opened on User2');

    // Verify answered talk is shown with "Answered by me" badge
    const answeredTalkItem = user2Page.locator('.talk-history-item:has-text("My Talks Test")');
    await answeredTalkItem.waitFor({ state: 'visible', timeout: 5000 });

    const answeredBadge = answeredTalkItem.locator('span:has-text("Answered by me")');
    await answeredBadge.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Answered talk appears with "Answered by me" badge');

    // ============================================
    // STEP 5: Test delete functionality
    // ============================================
    console.log('📍 Step 5: Testing delete functionality...');

    // Click delete button
    const deleteBtn = user2Page.locator('.delete-talk-btn').first();
    await deleteBtn.click();

    await user2Page.waitForTimeout(1000);

    // Verify the specific talk is removed (modal should refresh)
    await user2Page.waitForSelector('#my-talks-modal', { timeout: 5000 });

    // Verify "My Talks Test" is no longer in the list
    const deletedTalkItem = user2Page.locator('.talk-history-item:has-text("My Talks Test")');
    await deletedTalkItem.waitFor({ state: 'detached', timeout: 5000 });
    console.log('✅ Talk deleted successfully');

    // Close My Talks modal
    const closeBtn2 = user2Page.locator('#close-my-talks-modal');
    await closeBtn2.click();
    await user2Page.waitForSelector('#my-talks-modal', { state: 'detached', timeout: 5000 });
    console.log('✅ My Talks modal closed on User2');

    console.log('🎉 ✅ ALL "MY TALKS" FEATURE TESTS PASSED!');
  });
});
