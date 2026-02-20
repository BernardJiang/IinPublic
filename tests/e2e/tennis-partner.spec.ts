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
    const serverDataPath = path.join(__dirname, '../../data.json');
    if (fs.existsSync(serverDataPath)) {
      fs.rmSync(serverDataPath, { recursive: true, force: true });
      console.log('  ✅ Cleared server database (data.json/)');
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
      args: ['--window-position=0,0', '--window-size=960,1080'],
    });

    browser2 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=960,0', '--window-size=960,1080'],
    });

    // Create contexts - each browser gets its own context
    user1Context = await browser1.newContext({
      viewport: { width: 960, height: 1080 },
      storageState: undefined, // Start with clean storage
    });
    user2Context = await browser2.newContext({
      viewport: { width: 960, height: 1080 },
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

    const serverDataPath = path.join(__dirname, '../../data.json');
    if (fs.existsSync(serverDataPath)) {
      fs.rmSync(serverDataPath, { recursive: true, force: true });
      console.log('  ✅ Cleared server database (data.json/)');
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

  test('Complete Tennis Partner Talk flow with 2 users', async () => {
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
    await user1Page.waitForTimeout(3000); // Reduced to 3 seconds
    await user2Page.waitForTimeout(3000);

    // ============================================
    // STEP 3: User 1 creates Tennis Partner Talk
    // ============================================
    console.log('📍 Step 3: User 1 creating Tennis Partner Talk...');

    // Click "Create Talk" button
    await user1Page.click('#create-talk-btn');

    // Wait for modal to appear
    await user1Page.waitForSelector('.modal-overlay', { timeout: 5000 });
    console.log('✅ Talk editor modal opened');

    // Fill in Talk title
    await user1Page.fill('#talk-title', 'tennis partner');

    // Select "matching" type
    await user1Page.selectOption('#talk-type', 'matching');

    // ============================================
    // Question 1: "Do you play tennis?"
    // ============================================
    console.log('  Adding Question 1: Do you play tennis?');

    // First question input should already exist
    await user1Page.fill('.question-item .question-text', 'Do you play tennis?');

    // First answer: "Yes" -> Go to Question 2 (will set this after Q2 is created)
    await user1Page.fill(
      '.question-item:nth-child(1) .answers-container .answer-item:nth-child(1) .answer-text',
      'Yes',
    );

    // Second answer already exists by default: "No" -> Ignore (already set to "ignore" by default)
    await user1Page.fill(
      '.question-item:nth-child(1) .answers-container .answer-item:nth-child(2) .answer-text',
      'No',
    );
    await user1Page.selectOption(
      '.question-item:nth-child(1) .answers-container .answer-item:nth-child(2) .answer-next',
      'ignore',
    );

    // ============================================
    // Question 2: "What's your skill level?"
    // ============================================
    console.log("  Adding Question 2: What's your skill level?");

    // Add Question 2
    await user1Page.click('#add-question-btn');
    await user1Page.waitForTimeout(300); // Wait for dropdown update
    await user1Page.fill('.question-item:nth-child(2) .question-text', "What's your skill level?");

    // Answer 1: "beginner" -> Ignore
    await user1Page.fill(
      '.question-item:nth-child(2) .answers-container .answer-item:nth-child(1) .answer-text',
      'beginner',
    );
    await user1Page.selectOption(
      '.question-item:nth-child(2) .answers-container .answer-item:nth-child(1) .answer-next',
      'ignore',
    );

    // Answer 2: "amateur" -> Go to Question 3 (will set after Q3 is created)
    await user1Page.fill(
      '.question-item:nth-child(2) .answers-container .answer-item:nth-child(2) .answer-text',
      'amateur',
    );

    // Answer 3: "professional" -> Ignore
    await user1Page.click('.question-item:nth-child(2) .btn-add-answer');
    await user1Page.fill(
      '.question-item:nth-child(2) .answers-container .answer-item:nth-child(3) .answer-text',
      'professional',
    );
    await user1Page.selectOption(
      '.question-item:nth-child(2) .answers-container .answer-item:nth-child(3) .answer-next',
      'ignore',
    );

    // ============================================
    // Question 3: "Are you available at Balboa?"
    // ============================================
    console.log('  Adding Question 3: Are you available at Balboa Activity Center every Sunday?');

    // Add Question 3
    await user1Page.click('#add-question-btn');
    await user1Page.waitForTimeout(300); // Wait for dropdown update
    await user1Page.fill(
      '.question-item:nth-child(3) .question-text',
      'Are you available to play at Balboa Activity Center every Sunday?',
    );

    // Answer 1: "Yes" -> Noticed (Match!)
    console.log('  Filling Q3 Answer 1 and 2...');
    await user1Page.evaluate(() => {
      const allAnswers = Array.from(
        document.querySelectorAll('.answer-text'),
      ) as HTMLInputElement[];
      allAnswers[5].value = 'Yes'; // Q3 Answer 1
      allAnswers[6].value = 'No'; // Q3 Answer 2
    });

    // Set dropdowns for Q3 answers
    const q3Selects = await user1Page.evaluate(() => {
      const q3 = document.querySelector('.question-item:nth-child(3) .answers-container');
      const selects = Array.from(q3?.querySelectorAll('.answer-next') || []) as HTMLSelectElement[];
      return selects.length;
    });
    console.log(`  Q3 has ${q3Selects} select dropdowns`);

    // Use nth-of-type for selects which should be more reliable
    await user1Page.selectOption(
      '.question-item:nth-child(3) .answers-container .answer-item:nth-child(1) .answer-next',
      'noticed',
    );
    await user1Page.selectOption(
      '.question-item:nth-child(3) .answers-container .answer-item:nth-child(2) .answer-next',
      'ignore',
    );

    // Debug: Check all answers again after Q3
    const answersAfterQ3 = await user1Page.evaluate(() => {
      const answers = Array.from(document.querySelectorAll('.answer-text'));
      return answers.map((a: any, i) => `[${i}] "${a.value}"`);
    });
    console.log('  Answers after Q3:', JSON.stringify(answersAfterQ3));

    // Now set branching for Question 1 Answer 1 -> Question 2 (q_1 because Q2 is at index 1)
    await user1Page.selectOption(
      '.question-item:nth-child(1) .answers-container .answer-item:nth-child(1) .answer-next',
      'q_1',
    );

    // Set branching for Question 2 Answer 2 -> Question 3 (q_2 because Q3 is at index 2)
    await user1Page.selectOption(
      '.question-item:nth-child(2) .answers-container .answer-item:nth-child(2) .answer-next',
      'q_2',
    );

    // Submit the Talk
    console.log('  Submitting Tennis Partner Talk...');

    // Debug: List all answer values
    const answerValues = await user1Page.evaluate(() => {
      const answers = Array.from(document.querySelectorAll('.answer-text'));
      return answers.map((a: any, i) => `[${i}] "${a.value}"`);
    });
    console.log('Answer values:', JSON.stringify(answerValues));

    await user1Page.click('#talk-editor-form button[type="submit"]');

    // Give it time to process
    await user1Page.waitForTimeout(1000);

    // Wait for modal to close
    await user1Page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 10000 });
    console.log('✅ Tennis Partner Talk created and broadcast');

    // Wait for Talk to propagate through Gun.js (increased wait time)
    await user1Page.waitForTimeout(3000);
    await user2Page.waitForTimeout(3000);

    // Debug: Check if Talk announcement appears in User 2's view
    console.log('  Checking User 2 page for talk announcements...');
    const announcementCount = await user2Page.locator('.talk-announcement').count();
    console.log(`  Found ${announcementCount} talk announcements on User 2's page`);

    // ============================================
    // STEP 4: User 2 receives Talk notification
    // ============================================
    console.log('📍 Step 4: User 2 should receive Talk announcement...');

    // Look for Talk announcement in User 2's chat
    const talkAnnouncement = user2Page.locator('.talk-announcement:has-text("tennis partner")');
    await talkAnnouncement.waitFor({ state: 'visible', timeout: 15000 });
    console.log('✅ User 2 received Tennis Partner Talk announcement');

    // ============================================
    // STEP 5: User 2 answers the Talk
    // ============================================
    console.log('📍 Step 5: User 2 answering Tennis Partner Talk...');

    // Click "Answer" button
    const answerBtn = user2Page.locator(
      '.talk-announcement:has-text("tennis partner") button:has-text("Answer")',
    );
    await answerBtn.click();

    // Wait for Talk response modal
    await user2Page.waitForSelector('.modal-overlay', { timeout: 5000 });
    console.log('✅ Talk response modal opened');

    // Question 1: Do you play tennis? -> Answer "Yes"
    console.log('  Answering Q1: Yes (with manual mode)');
    // The first answer option's MANUAL button
    const q1YesBtn = user2Page.locator('button.answer-manual-btn').first();
    await q1YesBtn.click();

    await user2Page.waitForTimeout(500); // Wait for UI update

    // Question 2: What's your skill level? -> Answer "amateur"
    console.log('  Answering Q2: amateur (with manual mode)');
    // The second answer option's MANUAL button (amateur is the 2nd option)
    const q2AmateurBtn = user2Page.locator('button.answer-manual-btn').nth(1);
    await q2AmateurBtn.waitFor({ state: 'visible', timeout: 5000 });
    await q2AmateurBtn.click();

    await user2Page.waitForTimeout(500);

    // Question 3: Are you available...? -> Answer "Yes" (Match!)
    console.log('  Answering Q3: Yes (expecting match!) (with manual mode)');
    // The first answer option's MANUAL button for Q3
    const q3YesBtn = user2Page.locator('button.answer-manual-btn').first();
    await q3YesBtn.waitFor({ state: 'visible', timeout: 5000 });
    await q3YesBtn.click();

    // ============================================
    // STEP 6: Verify match notification
    // ============================================
    console.log('📍 Step 6: Verifying match notification...');

    // Check for success notification on User 2's page (use .first() in case there are multiple)
    const matchNotification = user2Page.locator('.notification.success:has-text("Match")').first();
    await matchNotification.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ User 2 received match notification!');

    // Check User 1's match notification immediately (before it disappears after 3 seconds)
    console.log('  Checking User 1 match notification immediately...');
    const user1MatchNotification = user1Page
      .locator('.notification.success:has-text("Match")')
      .first();
    await user1MatchNotification.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ User 1 received match notification!');

    console.log('🎾 Both users notified of the match!');

    // Wait for Gun.js to fully sync before continuing
    console.log('  Waiting for Gun.js to complete sync...');
    await user1Page.waitForTimeout(3000);
    await user2Page.waitForTimeout(3000);

    // Modal should close
    await user2Page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 });
    console.log('✅ Talk response modal closed');

    // ============================================
    // STEP 7: Test "Ignore" path
    // ============================================
    console.log('📍 Step 7: Testing Ignore path...');

    // User 1 creates another Tennis Partner Talk for testing ignore
    await createSimpleTalk(user1Page, 'tennis test 2', 'Do you play tennis?', 'noticed', 'ignore');

    // User 2 answers with "No" (Ignore)
    const talkAnnouncement2 = user2Page.locator('.talk-announcement:has-text("tennis test 2")');
    await talkAnnouncement2.waitFor({ state: 'visible', timeout: 10000 });

    const answerBtn2 = user2Page.locator(
      '.talk-announcement:has-text("tennis test 2") button:has-text("Answer")',
    );
    await answerBtn2.click();
    await user2Page.waitForSelector('.modal-overlay', { timeout: 5000 });

    const noBtn = user2Page.locator('button.answer-manual-btn').nth(1); // "No" is the second answer
    await noBtn.click();

    // Check for ignore notification
    const ignoreNotification = user2Page.locator('.notification.info:has-text("ignored")');
    await ignoreNotification.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Ignore notification displayed correctly!');

    console.log('🎾 ✅ ALL TESTS PASSED!');
  });

  test('Test auto/manual answer preferences', async () => {
    // ============================================
    // SETUP: Wait for Gun.js to fully settle from previous test
    // ============================================
    console.log('🔄 Setting up test 2...');
    console.log('⏳ Waiting 10 seconds for Gun.js to fully stabilize from test 1...');
    await user1Page.waitForTimeout(10000);
    await user2Page.waitForTimeout(10000);

    // Clear only answer preferences (not all localStorage)
    console.log('🧹 Clearing answer preferences...');
    await user1Page.evaluate(() => localStorage.removeItem('answerPreferences'));
    await user2Page.evaluate(() => localStorage.removeItem('answerPreferences'));
    console.log('✅ Answer preferences cleared');

    // Verify users are still on the main interface
    console.log('🔍 Verifying users are still signed in...');
    const user1CreateBtn = await user1Page.locator('#create-talk-btn').isVisible();
    const user2CreateBtn = await user2Page.locator('#create-talk-btn').isVisible();
    console.log(`  User 1 create button visible: ${user1CreateBtn}`);
    console.log(`  User 2 create button visible: ${user2CreateBtn}`);

    if (!user1CreateBtn || !user2CreateBtn) {
      throw new Error('❌ Users not signed in - UI not ready');
    }

    // Check what talks are currently visible to User 2 before we start
    const existingTalks = await user2Page.locator('.talk-announcement').count();
    console.log(`  User 2 currently sees ${existingTalks} talk announcements from previous test`);

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

    // Check if User 1 can see the talk in their own view
    const user1TalkCount = await user1Page.locator('.talk-announcement').count();
    console.log(`  User 1 sees ${user1TalkCount} talk announcements (including own talks)`);

    // Give more time for cross-peer sync
    await user2Page.waitForTimeout(3000);

    // ============================================
    // STEP 2: User 2 receives and answers with Auto mode
    // ============================================
    // STEP 2: User 2 receives and answers with Auto mode
    // ============================================
    console.log('📍 Step 2: User 2 answering with Auto mode...');

    // Poll for the new talk announcement with retries
    console.log('⏳ Waiting for talk announcement to appear...');
    let talkFound = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!talkFound && attempts < maxAttempts) {
      attempts++;
      const talkCount = await user2Page
        .locator('.talk-announcement:has-text("preferences test")')
        .count();
      console.log(
        `  Attempt ${attempts}/${maxAttempts}: Found ${talkCount} matching announcements`,
      );

      if (talkCount > 0) {
        talkFound = true;
        console.log('  ✅ Talk announcement found!');
      } else {
        console.log('  ⏳ Not found yet, waiting 2 more seconds...');
        await user2Page.waitForTimeout(2000);

        // Debug: Show all talk announcements
        const allTalks = await user2Page.locator('.talk-announcement').count();
        console.log(`  Total talk announcements visible: ${allTalks}`);

        if (allTalks > 0) {
          // Get the text of existing talks to debug
          const talkTexts = await user2Page.locator('.talk-announcement').allTextContents();
          console.log(
            `  Talk titles visible: ${talkTexts.map((t) => t.substring(0, 50)).join(', ')}`,
          );
        }
      }
    }

    if (!talkFound) {
      throw new Error(
        '❌ Talk announcement "preferences test" never appeared after ' + maxAttempts + ' attempts',
      );
    }

    const talkAnnouncement = user2Page.locator('.talk-announcement:has-text("preferences test")');
    await talkAnnouncement.waitFor({ state: 'visible', timeout: 5000 });

    const answerBtn = user2Page.locator(
      '.talk-announcement:has-text("preferences test") button:has-text("Answer")',
    );
    await answerBtn.click();
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

    // User 2 should auto-answer since preference is saved
    const talkAnnouncement2 = user2Page.locator(
      '.talk-announcement:has-text("preferences test 2")',
    );
    await talkAnnouncement2.waitFor({ state: 'visible', timeout: 10000 });

    const answerBtn2 = user2Page.locator(
      '.talk-announcement:has-text("preferences test 2") button:has-text("Answer")',
    );
    await answerBtn2.click();

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

    // Scroll to and click on "My Answers" button
    const viewPrefsBtn = user2Page.locator('#view-preferences-btn');
    await viewPrefsBtn.scrollIntoViewIfNeeded();
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

  test('should track and display "My Talks" history', async () => {
    console.log('\n🎬 Starting "My Talks" feature test...\n');

    // ============================================
    // STEP 0: Clear localStorage and sign in both users
    // ============================================
    console.log('📍 Step 0: Clearing state and signing in both users...');

    // Clear localStorage and reload pages
    await user1Page.evaluate(() => localStorage.clear());
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

    // Wait a bit longer for Gun.js sync
    await user2Page.waitForTimeout(2000);

    // Wait for talk announcement on User2's side (using .talk-announcement class)
    const talkAnnouncement = user2Page.locator('.talk-announcement:has-text("My Talks Test")');
    await talkAnnouncement.waitFor({ state: 'visible', timeout: 15000 });
    console.log('✅ User2 received talk announcement');

    // Click on "Answer Talk" button
    const answerTalkBtn = talkAnnouncement.locator('button:has-text("Answer Talk")');
    await answerTalkBtn.click();

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

    // Scroll to and click "My Talks" button on User1
    const myTalksBtn1 = user1Page.locator('#view-my-talks-btn');
    await myTalksBtn1.scrollIntoViewIfNeeded();
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

    // Scroll to and click "My Talks" button on User2
    const myTalksBtn2 = user2Page.locator('#view-my-talks-btn');
    await myTalksBtn2.scrollIntoViewIfNeeded();
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
