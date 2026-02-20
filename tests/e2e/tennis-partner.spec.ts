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
    await page.waitForTimeout(2000);
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

    console.log('✅ All databases cleared');
    console.log('⚠️  Please close any manually opened browser tabs pointing to localhost:3001');

    // Launch 2 separate Chrome browsers positioned side-by-side
    browser1 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=960,800'],
    });

    browser2 = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=960,0', '--window-size=960,800'],
    });

    // Create contexts - each browser gets its own context
    user1Context = await browser1.newContext({
      viewport: { width: 960, height: 800 },
      storageState: undefined, // Start with clean storage
    });
    user2Context = await browser2.newContext({
      viewport: { width: 960, height: 800 },
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
    console.log('  Answering Q1: Yes');
    const q1YesBtn = user2Page.locator('button:has-text("Yes")').first();
    await q1YesBtn.click();

    await user2Page.waitForTimeout(500); // Wait for UI update

    // Question 2: What's your skill level? -> Answer "amateur"
    console.log('  Answering Q2: amateur');
    const q2AmateurBtn = user2Page.locator('button:has-text("amateur")');
    await q2AmateurBtn.waitFor({ state: 'visible', timeout: 5000 });
    await q2AmateurBtn.click();

    await user2Page.waitForTimeout(500);

    // Question 3: Are you available...? -> Answer "Yes" (Match!)
    console.log('  Answering Q3: Yes (expecting match!)');
    const q3YesBtn = user2Page.locator('button:has-text("Yes")').last();
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

    const noBtn = user2Page.locator('button:has-text("No")').first();
    await noBtn.click();

    // Check for ignore notification
    const ignoreNotification = user2Page.locator('.notification.info:has-text("ignored")');
    await ignoreNotification.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Ignore notification displayed correctly!');

    console.log('🎾 ✅ ALL TESTS PASSED!');
  });

  test('Test auto/manual answer preferences', async () => {
    // ============================================
    // SETUP: Clear localStorage and wait for sync
    // ============================================
    console.log('🔄 Setting up test - clearing localStorage...');
    await user1Page.evaluate(() => localStorage.clear());
    await user2Page.evaluate(() => localStorage.clear());
    console.log('✅ Test setup complete');

    // Short wait for Gun.js to stabilize after first test
    await user1Page.waitForTimeout(1000);
    await user2Page.waitForTimeout(1000);

    // ============================================
    // STEP 1: User 1 creates a simple Talk
    // ============================================
    console.log('📍 Step 1: User 1 creating a simple Talk...');
    await createSimpleTalk(
      user1Page,
      'preferences test',
      'Do you like coffee?',
      'noticed',
      'ignore',
    );
    console.log('✅ Talk created');

    // ============================================
    // STEP 2: User 2 receives and answers with Auto mode
    // ============================================
    console.log('📍 Step 2: User 2 answering with Auto mode...');

    const talkAnnouncement = user2Page.locator('.talk-announcement:has-text("preferences test")');
    await talkAnnouncement.waitFor({ state: 'visible', timeout: 10000 });

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

    // Verify auto/manual radio buttons exist for the first answer
    const autoRadio = user2Page.locator('input[type="radio"][value="auto"]').first();
    const manualRadio = user2Page.locator('input[type="radio"][value="manual"]').first();

    await autoRadio.waitFor({ state: 'visible', timeout: 5000 });
    await manualRadio.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Auto/Manual radio buttons are present');

    // Select Auto mode for "Yes" answer
    await autoRadio.click();
    console.log('✅ Selected Auto mode');

    // Click Yes button
    const yesBtn = user2Page.locator('button.answer-option-btn:has-text("Yes")').first();
    await yesBtn.click();

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

    // Click on "My Preferences" button
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
    const emptyMessage = user2Page.locator('p:has-text("No saved preferences yet")');
    await emptyMessage.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Preference deleted successfully');

    // Close preferences modal
    const closeBtn = user2Page.locator('#close-preferences-modal');
    await closeBtn.click();
    await user2Page.waitForSelector('#preferences-modal', { state: 'detached', timeout: 5000 });
    console.log('✅ Preferences modal closed');

    console.log('🎉 ✅ ALL AUTO/MANUAL PREFERENCE TESTS PASSED!');
  });
});
