# Test Plan - IinPublic

## 1. Introduction
This document outlines the comprehensive testing strategy for **IinPublic**, a decentralized, location-based chatbot communication system. It is derived from the functional requirements in `projectplan.md` and the technical architectures defined in the Backend, Web Frontend, and Android Frontend technical plans.

## 2. Testing Scope & Strategy

**Testing Levels:**
1.  **Unit Testing**: Isolated testing of individual functions, classes, and components.
2.  **Integration Testing**: Testing interactions between modules (e.g., UI <-> Logic, Java <-> JS Bridge, Gun.js Sync).
3.  **System / End-to-End (E2E) Testing**: Validating complete user flows simulating real-world usage.
4.  **Performance Testing**: Verifying scalability (1000 concurrent conversations) and responsiveness.
5.  **Security & Privacy Testing**: Verifying location blurring, encryption, and reputation integrity.

---

## 3. Backend & Core Logic Testing (Node.js/Gun.js)

Ref: `plan-backend.prompt.md`

### 3.1 Unit Tests (Jest/Mocha)
*   **Data Schema Validation**:
    *   Verify `UserProfile` schema enforces mandatory fields (`stageName`, `userID`).
    *   Verify `Talk` structure validation (DAG check: no cycles allowed).
*   **Algorithms**:
    *   **ReputationCalculator**: Test `calculateOverallRating` with various metric combinations (boundary values, negative inputs).
    *   **GeographicPartitioner**: Test `calculateBoundingBox` and clustering logic with mock coordinate sets.
    *   **AutoLinearCapture**: Test parsing of regex patterns for `Question? Answer1; Answer2.` format. 
    *   **GrammarAnalyzer & OffensiveContentFilter**: Test with sample valid/invalid strings and offensive dictionary matches.
*   **Location Privacy**:
    *   **LocationPrivacy**: Verify `blurCoordinates` returns coordinates within the specified `blurRadius` and never the exact original coordinates.

### 3.2 Integration Tests
*   **Gun.js Synchronization**:
    *   **Peer Sync**: Spin up two local Gun instances. Write to Instance A, verify data appears on Instance B within X ms.
    *   **Offline Queue**: Disconnect Instance B. Write to A. Reconnect B. Verify B receives the update.
    *   **Conflict Resolution**: Simulate simultaneous writes to the same key from two peers; verify eventual consistency convergence.
*   **WebSocket Manager**:
    *   Test connection pooling, heartbeat handling, and automatic reconnection triggers.

---

## 4. Web Frontend Testing

Ref: `plan-webFrontend.prompt.md`

### 4.1 Component Testing (Vue Test Utils / Jest)
*   **Chat Components**:
    *   `ChatMessageComponent`: Verify rendering of own vs. other messages, avatar rendering, "Traveller" badge visibility.
    *   `AutoLinearCaptureUI`: Simulate typing trigger phrases and verify `answer-chips` render correctly.
*   **Talk Editor**:
    *   `TalkGraphEditor`: Mock the canvas. Verify adding nodes updates the internal graph model.
    *   `QuestionEditor`: Test form validation (required text, at least one answer option).
*   **Dashboards**:
    *   `BulkSendDashboard`: Verify progress bar calculation based on mock metrics.
    *   `SurveyResultsDisplay`: Verify chart data formatting matches input prop structure.

### 4.2 Application Logic (Browser Node Runtime)
*   **BrowserNodeRuntime**:
    *   Verify polyfills (`path`, `crypto`) behave as expected in the browser environment.
    *   Test Service Worker caching strategies (Offline First).
*   **PWA**:
    *   Verify manifest loading and "Add to Home Screen" prompt triggers (using Lighthouse/Audit tools).

### 4.3 E2E Testing (Cypress / Playwright)
*   **Flow: New User Onboarding**:
    *   Open App -> Auto-generate ID -> Landing in Global Chatroom.
*   **Flow: Talk Creation**:
    *   Enter Talk Editor -> Create Question -> Add Options -> Save -> Verify appearing in list.
*   **Flow: Location Filtering**:
    *   User A (Location X) sends talk.
    *   User B (Location X) receives it.
    *   User C (Location Y, far away) does *not* receive it (checking UI list).

---

## 5. Android Frontend Testing

Ref: `plan-androidFrontend.prompt.md`

### 5.1 Unit Tests (JUnit / Mockito)
*   **Native Modules**:
    *   `LocationManager`: Mock `FusedLocationProvider`. Verify `onLocationResult` processes and blurs data.
    *   `LocationPrivacyManager`: Verify blurring algorithm produces valid offsets.
*   **JS Bridges**:
    *   `FileSystemBridge`: Test `readFile`/`writeFile` against temporary local files.
    *   `HttpBridge`: Test mapping of Java OkHttp responses to the JSON format expected by JS.

### 5.2 Instrumentation Tests (Espresso)
*   **UI Interaction**:
    *   Verify switching between Bottom Navigation tabs (Chat -> Talk Editor -> Profile).
    *   Verify `ChatFragment` RecyclerView updates when ViewModel receives new messages.
*   **Permissions**:
    *   Test "Deny" flow for Location Permission. Verify graceful degradation (e.g., user stays in "Global" room).

### 5.3 Hybrid Integration Tests
*   **NodeRuntimeManager**:
    *   Execute a sample script: `var x = 1+1; x;`. Verify Java callback receives `2`.
    *   **GunPeerService**: Start service, verify notification appears, and Gun instance initializes via log/status check.

---

## 6. System Scenarios & Acceptance Criteria (Manual & Automated)

Referencing `projectplan.md` Section 6 Scenarios.

### 6.1 TC-TEN-01: Tennis Partner Matching
*   **Preconditions**: Two users (A & B) in standard proximity.
*   **Action**: A sends "Tennis" talk (tagged "sports"). B has matching tags.
*   **Check**:
    1.  B receives notification/talk.
    2.  B answers Yes -> Available -> Let's Talk.
    3.  A receives match notification.
    4.  Direct chat opens between A and B.

### 6.2 TC-LIN-01: Auto Linear Talk Capture
*   **Action**:
    1.  User A types: `Do you like coffee? Yes; No.` -> Send.
    2.  Verify: User B sees "Yes" and "No" chips.
    3.  User B taps "Yes".
    4.  User A types: `Great!`.
*   **Check**:
    1.  System saves a "Draft Talk" in User A's profile.
    2.  Draft contains 1 node: "Do you like coffee?" with answers "Yes", "No".

### 6.3 TC-PRES-01: Global Chat Presence Lifecycle
*   **Action**:
    1.  User A opens the application.
    2.  User B (already online) checks the "Global Chat" online user list.
    3.  User A closes the application.
*   **Check**:
    1.  Upon opening, User A automatically joins "Global Chat".
    2.  User B sees User A appear in the list immediately.
    3.  User B sees User A disappear from the list immediately upon User A's exit.

### 6.4 Offline & Sync Resilience
*   **Scenario**:
    1.  User A (Online) sends message to User B (Offline).
    2.  User B comes Online.
    3.  **Check**: User B receives the queued message.
*   **Scenario (Architecture)**:
    1.  Android App process killed.
    2.  Restart App.
    3.  **Check**: GunPeerService restarts, `gun.js` re-initializes, and local data persistence is verified (Profile data still exists).

### 6.5 TC-DATA-01: Relationship Tagging
*   **Action**:
    1.  User A views User B's profile.
    2.  User A tags User B as "Friend".
    3.  User A views User C's profile.
    4.  User A tags User C as "Coworker".
*   **Check**:
    1.  Verify `userA.relationships[userB_ID]` equals "Friend".
    2.  Verify `userA.relationships[userC_ID]` equals "Coworker".
    3.  Restart app (simulate storage reload). Verify tags persist.

### 6.6 TC-DATA-02: History & Statistics Persistence
*   **Action**:
    1.  User A sends a talk to 5 users.
    2.  2 users reply.
*   **Check**:
    1.  Verify `userA.history.talksInitiated` contains the new talk ID.
    2.  Verify `userA.history.contactedUsers` contains the IDs of the 5 recipients.
    3.  Verify `userA.statistics.totalTalksSent` increments by 1.
    4.  Verify `userA.statistics.totalRepliesReceived` increments by 2.
    5.  Verify stats persist across restarts.

### 6.7 TC-ONB-01: First Run Onboarding
*   **Action**:
    1.  Clear app data or install fresh.
    2.  Launch application.
    3.  Observe "StageName" prompt.
    4.  Verify default text is "John Doe".
    5.  Change name to "Alice" and confirm.
*   **Check**:
    1.  Verify internal User ID is a long SEA public key string (not a simple UUID).
    2.  Verify `user.stageName` is saved as "Alice".
    3.  Restart app. Verify user is NOT prompted again and logs in as "Alice".

### 6.8 TC-SYNC-01: Chatroom Entry Broadcast
*   **Preconditions**: User A has 5 public talks. Room has 10 other users.
*   **Action**:
    1.  User A enters the chatroom.
    2.  Wait for sync.
    3.  User A exits and re-enters immediately.
*   **Check**:
    1.  **First Entry**: Verify User A sends `SYNC_REQUEST`. Verify peer 10 users receive User A's 5 talks. Verify User A receives public talks from 10 peers.
    2.  **Second Entry**: Verify `SYNC_REQUEST` is sent but data payload is empty (peers recognize timestamps match). **Zero** talks resent.

---

## 7. Performance & Security Testing

### 7.1 Performance
*   **Load Testing**:
    *   Simulate 1000 connected peers using a headless script fleet.
    *   Measure latency of a "Broadcast Talk" propagation. **Target**: < 5 seconds for initialization.
*   **Mobile Resource Usage**:
    *   Monitor Battery and RAM usage of the `GunPeerService` (background process) over 1 hour.
    *   **Constraint**: Must not trigger Android "App Not Responding" (ANR) or aggressive battery kill.

### 7.2 Security & Privacy
*   **Location Leak Check**:
    *   Intercept network traffic (Wireshark/Fiddler).
    *   Verify that `trueLocation` coordinates are **never** sent over the wire/WebSocket. Only `blurredRegion` or `blurredLocation` should be transmitted.
*   **Reputation Tampering**:
    *   Attempt to manually write to `user.reputation` via console/script injection.
    *   **Expected**: Write fails or is rejected by security rules (if implemented via Gun.js SEA/security rules).

## 8. CI/CD Integration
*   **Pipeline Triggers**:
    *   Push to `main`: Run Unit Tests (Backend + Web).
    *   Pull Request: Run Unit Tests + Linting.
    *   Release Tag: Run E2E Tests + Android Build.
*   **Tools**:
    *   GitHub Actions for orchestration.
    *   Jest (JS/TS), JUnit (Android), Cypress (E2E).
