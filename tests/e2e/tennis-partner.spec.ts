import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';

test.describe('Tennis Partner Talk - Two User Interaction', () => {
  let browser: Browser;
  let user1Context: BrowserContext;
  let user2Context: BrowserContext;
  let user1Page: Page;
  let user2Page: Page;

  test.beforeAll(async () => {
    // Launch Chrome browser with headed mode
    browser = await chromium.launch({
      headless: false,
      slowMo: 100, // Slow down actions by 100ms to make them visible
    });

    // Create separate browser contexts for two users (simulates 2 separate tabs)
    user1Context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    user2Context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    // Create a page in each context - these will appear as separate tabs
    user1Page = await user1Context.newPage();
    user2Page = await user2Context.newPage();

    // Listen to console messages from both pages
    user1Page.on('console', (msg) => console.log(`[User1 Browser]:`, msg.text()));
    user2Page.on('console', (msg) => console.log(`[User2 Browser]:`, msg.text()));

    console.log('🚀 Launched 2 Chrome tabs for User 1 and User 2');
  });

  test.afterAll(async () => {
    await user1Context.close();
    await user2Context.close();
    await browser.close();
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
    await user1Page.waitForTimeout(5000);
    await user2Page.waitForTimeout(5000);

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

    // Wait for Gun.js to sync the response to User 1
    console.log('  Waiting for Gun.js to sync response to User 1...');
    await user1Page.waitForTimeout(5000);

    // Check browser console for any errors
    const user1ConsoleMessages = await user1Page.evaluate(() => {
      // Check if any notifications are present
      const notifications = document.querySelectorAll('.notification');
      return Array.from(notifications).map((n) => n.textContent);
    });
    console.log('  User 1 notifications on page:', user1ConsoleMessages);

    // Also verify User 1 receives match notification
    const user1MatchNotification = user1Page
      .locator('.notification.success:has-text("Match")')
      .first();
    await user1MatchNotification.waitFor({ state: 'visible', timeout: 10000 });
    console.log('✅ User 1 received match notification!');

    console.log('🎾 Both users notified of the match!');

    // Modal should close
    await user2Page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 });
    console.log('✅ Talk response modal closed');

    // ============================================
    // STEP 7: Test "Ignore" path
    // ============================================
    console.log('📍 Step 7: Testing Ignore path...');

    // User 1 creates another Tennis Partner Talk for testing ignore
    await user1Page.click('#create-talk-btn');
    await user1Page.waitForSelector('.modal-overlay', { timeout: 5000 });

    // Quick setup: Just title and one question
    await user1Page.fill('#talk-title', 'tennis test 2');
    await user1Page.selectOption('#talk-type', 'matching');
    await user1Page.fill('.question-item .question-text', 'Do you play tennis?');
    await user1Page.fill('.answer-item:nth-child(1) .answer-text', 'Yes');
    await user1Page.selectOption('.answer-item:nth-child(1) .answer-next', 'noticed');
    await user1Page.fill('.answer-item:nth-child(2) .answer-text', 'No');
    await user1Page.selectOption('.answer-item:nth-child(2) .answer-next', 'ignore');

    await user1Page.click('#talk-editor-form button[type="submit"]');
    await user1Page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 });
    await user1Page.waitForTimeout(2000);

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
});
