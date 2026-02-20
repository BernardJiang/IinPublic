# E2E Test Suite for IinPublic Talk System

## Overview

This directory contains end-to-end tests for the IinPublic real-time Talk system using Playwright. These tests simulate multiple users in separate browser instances to verify the complete Talk flow including creation, broadcasting, answering, and branching logic.

## Test Files

### `tennis-partner.spec.ts`

Comprehensive test that simulates two users interacting through the Tennis Partner Talk:

**User 1:**

- Signs in as "TennisPlayer1"
- Creates a Tennis Partner Talk with branching questions
- Broadcasts the Talk to the chatroom

**User 2:**

- Signs in as "TennisPlayer2"
- Receives the Talk announcement
- Answers questions following the branching logic
- Receives match/ignore notifications

**Test Coverage:**

- ✅ User authentication
- ✅ Talk creation with 3 questions
- ✅ Branching logic (downward-only)
- ✅ Real-time Talk broadcasting via Gun.js
- ✅ Talk response with dynamic question flow
- ✅ Match notification (isMatch: true)
- ✅ Ignore notification (isIgnore: true)

## Running Tests

### Prerequisites

Ensure both servers are running:

```bash
# Terminal 1: Backend server (port 8080)
npm run dev:server

# Terminal 2: Frontend server (port 3001)
npm run dev:web
```

**Note:** The Playwright config is set to automatically start these servers if they're not running.

### Run Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run tests in headed mode (see browsers)
npx playwright test --headed

# Run tests with UI (interactive mode)
npx playwright test --ui

# Run specific test file
npx playwright test tennis-partner.spec.ts

# Debug mode (step through with inspector)
npx playwright test --debug
```

### View Test Report

After running tests, view the HTML report:

```bash
npx playwright show-report
```

## Test Architecture

### Multi-User Simulation

The tests use separate **BrowserContext** instances to simulate independent users:

```typescript
user1Context = await browser.newContext();
user2Context = await browser.newContext();

user1Page = await user1Context.newPage();
user2Page = await user2Context.newPage();
```

This ensures:

- Separate cookies/localStorage
- Independent Gun.js connections
- Realistic peer-to-peer communication testing

### Test Flow

1. **User Setup**: Both users sign in with different stage names
2. **Talk Creation**: User 1 creates Tennis Partner Talk with branching
3. **Broadcasting**: Talk propagates through Gun.js to User 2
4. **Talk Response**: User 2 answers questions following branches
5. **Outcome Verification**: Check for match/ignore notifications

### Key Selectors

- `#stage-name` - User creation input
- `#create-talk-btn` - Open Talk editor
- `.talk-announcement` - Talk announcement in chat
- `.modal-overlay` - Modal dialogs
- `.notification.success` - Success notifications
- `.notification.info` - Info notifications

## Debugging Tips

### View Browser Actions

Run with headed mode to see what's happening:

```bash
npx playwright test --headed --slowmo=1000
```

### Take Screenshots

Tests automatically capture screenshots on failure. To force screenshots:

```typescript
await page.screenshot({ path: 'debug.png' });
```

### Console Logs

The test includes detailed console logging for each step:

```
📍 Step 1: User 1 signing in...
✅ User 1 signed in as TennisPlayer1
📍 Step 2: User 2 signing in...
```

### Trace Viewer

View detailed execution traces:

```bash
npx playwright show-trace trace.zip
```

## Adding More Tests

### Template for New Talk Tests

```typescript
test('Your Talk Scenario', async () => {
  // 1. Sign in users
  await user1Page.goto('/');
  await user1Page.fill('#stage-name', 'User1Name');
  await user1Page.click('button[type="submit"]');

  // 2. Create Talk
  await user1Page.click('#create-talk-btn');
  // ... fill form

  // 3. User 2 receives and responds
  await user2Page.locator('.talk-announcement').click();
  // ... answer questions

  // 4. Verify outcome
  await expect(user2Page.locator('.notification')).toBeVisible();
});
```

## CI/CD Integration

The tests are configured for CI environments:

```yaml
# .github/workflows/e2e-tests.yml
- name: Install Playwright Browsers
  run: npx playwright install --with-deps

- name: Run E2E Tests
  run: npm run test:e2e
```

## Known Issues / Limitations

1. **Gun.js Propagation Delay**: Tests include `waitForTimeout(2000)` to allow Gun.js to sync data between peers
2. **Modal Animations**: Some modals have CSS transitions; use `waitForSelector` with adequate timeouts
3. **Single Worker**: Tests run sequentially (`workers: 1`) to avoid race conditions in Gun.js

## Future Enhancements

- [ ] Test multi-user matching (3+ users responding to same Talk)
- [ ] Test Talk editing/deletion
- [ ] Test survey-type Talks with result aggregation
- [ ] Test offline/reconnection scenarios
- [ ] Performance benchmarks for Gun.js sync speed
