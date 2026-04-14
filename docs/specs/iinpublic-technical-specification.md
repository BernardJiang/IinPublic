# IinPublic — Technical Specification
## Architecture, Security, Data, Network, Mobile & API Interfaces

> **Version:** 2.0 (merged from v1 and Design Spec v2)
> **Date:** 2026-04-13
> **Status:** Authoritative

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Security & Privacy](#2-security--privacy)
3. [Data Integrity & Conflict Resolution](#3-data-integrity--conflict-resolution)
4. [Network & Scalability](#4-network--scalability)
5. [Mobile-Specific Cases](#5-mobile-specific-cases)
6. [API & Interface Standardization](#6-api--interface-standardization)
7. [Gun.js Data Model Specifications](#7-gunjs-data-model-specifications)
8. [UI/UX Component Specifications](#8-uiux-component-specifications)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Testing Strategy & Quality Assurance](#10-testing-strategy--quality-assurance)
11. [Key Technical Decisions](#11-key-technical-decisions)

---

## 1. Architecture Overview

### 1.1 Chatroom Hierarchy (Hybrid Approach)
```
/chatrooms
├── global (capacity: 1000)
├── /continent/{continent}
│   ├── /country/{country}
│   │   ├── /state/{state}
│   │   │   ├── /city/{city}
│   │   │   │   ├── /district/{district}
│   │   │   │   │   └── /gps-grid/{grid-hash}
```

**Implementation Details:**
- Gun.js native spatial queries for GPS grid lookups
- Custom geographical nodes for administrative boundaries
- Automatic room splitting when capacity exceeded (FIFO eviction of oldest users)
- Room merging when occupancy drops below threshold

### 1.2 Bulk Send Architecture (Batched Delivery)
```javascript
class BulkTalkSender {
  constructor() {
    this.queues = new Map(); // userId -> Queue
    this.batchSize = 50;
    this.batchDelay = 1000; // 1 second between batches
  }

  async sendTalk(talkId, targetUsers, options) {
    const batches = this.createBatches(targetUsers);
    for (const batch of batches) {
      await this.sendBatch(talkId, batch, options);
      await this.delay(this.batchDelay);
    }
  }
}
```

### 1.3 Location Privacy (Dynamic Blur Radius)
```javascript
class LocationPrivacy {
  constructor(user) {
    this.user = user;
    this.blurRadius = user.settings.privacyRadius || 1000; // meters
  }

  getPublicLocation() {
    return this.blurGPS(this.user.trueLocation, this.blurRadius);
  }

  canViewLocation(requester) {
    return this.user.settings.privacyExceptions.includes(requester.id);
  }
}
```

### 1.4 Advanced Talk Editor
```javascript
class TalkEditor {
  constructor() {
    this.graph = new Cytoscape({
      container: document.getElementById('talk-editor'),
      layout: 'dagre',
      elements: []
    });
    this.setupDragDrop();
    this.setupRealTimeCollaboration();
  }

  addQuestionNode(position) {
    const nodeId = `q_${Date.now()}`;
    this.graph.add({
      data: { id: nodeId, label: 'New Question', type: 'question' },
      position: position
    });
  }
}
```

### 1.5 Mobile Architecture (Native Android + JS Bridge)
```java
public class GunBridge extends WebView {
    private GunNode gunNode;

    public GunBridge(Context context) {
        super(context);
        this.addJavascriptInterface(new JsInterface(), "Android");
        this.embeddedNode = new EmbeddedNode(context);
    }

    public class JsInterface {
        @JavascriptInterface
        public String getGPSLocation() {
            return LocationManager.getCurrentLocation();
        }

        @JavascriptInterface
        public void showNotification(String message) {
            NotificationManager.show(message);
        }
    }
}
```

---

## 2. Security & Privacy

### 2.1 Data Collection Policy

IinPublic is a decentralized application. **No user data is collected, stored, or transmitted to any central server**, with one narrow exception:

| Data Type | Collected Centrally? | Where Stored |
|---|---|---|
| Profile, answers, talks, messages | No | Gun.js peer graph only |
| GPS / location | No | Blurred, stored in user's own Gun node |
| Session analytics, telemetry | No | — |
| Tech support interactions | Yes (minimal, opt-in) | Centralised support channel only |

Tech support data is limited to the content the user voluntarily sends through the in-app support flow. It is never cross-referenced with user identity nodes in the Gun graph.

**Peer-to-peer direct conversations are not persisted.** When two users chat one-on-one (outside of a talk/survey), no message data is written to the Gun graph's shared nodes. The conversation exists only in the two peers' local memory for the duration of the session. Only talk Q&A pairs answered by a user are saved as that user's attributes and reused by the chatbot later.

### 2.2 Peer-to-Peer Communication Design

All application-level communication **must travel peer-to-peer via Gun.js**. This means:

- No message content is relayed through or persisted on any application server.
- Relay nodes (Gun super-peers) forward encrypted datagrams but cannot decrypt them.
- `server.js` is limited to: serving the static bundle, acting as a Gun relay peer, and handling tech support tickets.

```
User A  ──[Gun P2P]──  User B
          ╲        ╱
           relay peer   (can forward, cannot read)
```

Any feature that requires reading message content on the server side is **prohibited by design**.

### 2.3 Privacy-Sensitive Question Handling

When a talk contains a question that the chatbot classifies as potentially privacy-sensitive, the system **must prompt the user** before auto-answering.

**Privacy-sensitive categories:**
- Full legal name, home address, phone number, email
- Government ID, passport, driver's licence numbers
- Health, medical, or financial information
- Religious, political, or ethnic identity
- Any question whose answer uniquely identifies the user's offline identity

**Chatbot behaviour on privacy-sensitive questions:**
```typescript
if (isSensitive(question)) {
  pause auto-answer flow
  display: "This question may reveal private information.
            Do you want to answer it, skip it, or mark it private?"
  // user selects: Answer / Skip / Mark Private
  // 'Answer' resumes normal flow; 'Skip' sends no answer;
  // 'Mark Private' stores locally, never sent to chatbot relay
}
```

The sensitivity classifier runs locally (no server round-trip) in `src/filters/privacyClassifier.ts`.

### 2.4 Credit Card & Financial Data Filter

All outgoing answer strings **must pass through a financial data filter** before being written to the Gun graph or sent to any peer.

**Patterns blocked:**

| Category | Pattern | Example match |
|---|---|---|
| Credit/debit card numbers | `\b(?:\d[ -]?){13,19}\b` + Luhn check | `4111 1111 1111 1111` |
| CVV codes | `\b\d{3,4}\b` (in financial context) | `123` |
| IBAN | `\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,}[A-Z0-9]{0,16}\b` | `GB29NWBK60161331926819` |
| US routing/account | `\b\d{9}\b` / `\b\d{5,17}\b` | `021000021` |
| Sort code | `\b\d{2}-\d{2}-\d{2}\b` | `20-00-00` |
| Crypto wallet | BTC/ETH address patterns | `1A1zP1eP5Q...` / `0x123...` |

```typescript
// src/filters/financialDataFilter.ts
export function filterBeforeWrite(answer: string): FilterResult {
  if (containsFinancialData(answer)) {
    return {
      blocked: true,
      reason: 'Financial or card data detected. Please do not share payment details.',
      sanitized: null
    };
  }
  return { blocked: false, sanitized: answer };
}
```

The filter runs on **every write path**: chat message send, talk answer submission, and profile attribute update. A blocked write shows an inline warning; the data is never written to Gun.

### 2.5 Answer Visibility Model (Public vs. Private)

Every answer to a talk question carries a **visibility flag**:

| Flag | Value | Meaning |
|---|---|---|
| Public | `"auto"` | Chatbot may repeat this answer to other users automatically |
| Private | `"manual"` | Stored encrypted; chatbot never repeats it; only the user manually decides to share |

**Default:** new answers default to `"auto"`. The user can downgrade to `"manual"` at any time.

```typescript
function chatbotCanRepeat(answer: AnswerRecord): boolean {
  return answer.visibility === 'auto';
}
```

Private answers are stored in the user's own SEA-encrypted Gun node (`~<pub>/answers/private/...`). They are **never placed in a shared chatroom node** and are never returned by the chatbot's answer-fetch queries.

**UI requirement:** Each answer chip/card shows a lock icon toggle. Locked = private/manual. Unlocked = public/auto.

### 2.6 Conversation Modes (Green / Red / Yellow)

Every user operates in one of three conversation modes that control how aggressively the chatbot acts on their behalf. The mode is set per user and can be changed at any time.

| Mode | Colour | Chatbot behaviour | Scope |
|---|---|---|---|
| **Auto** | 🟢 Green | Chatbot automatically asks and answers questions in the public chatroom using all public/auto answers. Everything is public. | Public chatroom |
| **Manual** | 🔴 Red | User asks and answers all questions manually. Chatbot is silent. | Any channel |
| **Semi-auto** | 🟡 Yellow | Chatbot operates under a rule set (location, friend circle, time window). One-on-one chat only; rules determine when the chatbot fires. | One-on-one / known persons |

```typescript
// src-shared/data/models.ts
export type ConversationMode = 'green' | 'red' | 'yellow';

export interface YellowModeRules {
  locationRadius?: number;       // only fire chatbot when peer is within N metres
  allowedLabels?: string[];      // only fire for 'friend', 'coworker', etc.
  activeHours?: { from: string; to: string }; // e.g. { from: '09:00', to: '21:00' }
}
```

```typescript
// Chatbot firing decision
function shouldChatbotFire(
  mode: ConversationMode,
  peer: UserContext,
  rules?: YellowModeRules
): boolean {
  if (mode === 'green') return true;
  if (mode === 'red')   return false;

  // Yellow: evaluate rules
  if (rules?.locationRadius && distanceTo(peer) > rules.locationRadius) return false;
  if (rules?.allowedLabels  && !rules.allowedLabels.includes(peer.label)) return false;
  if (rules?.activeHours    && !isWithinActiveHours(rules.activeHours))   return false;
  return true;
}
```

**Relationship to answer visibility (§2.5):** The conversation mode controls *when* the chatbot fires; the answer visibility flag controls *which* answers it may use. Even in Green mode the chatbot never repeats `"manual"` (private) answers.

### 2.7 Answer Mutability & Immutable History

- **Answers are mutable.** A user can change their answer to any question at any time.
- **History is append-only and immutable.** Every change creates a new history entry, signed with the user's SEA keypair. No entry can be deleted or modified.

```typescript
interface AnswerRecord {
  questionId: string;
  current: {
    value: string;
    visibility: 'auto' | 'manual';
    updatedAt: number;
    signature: string;       // SEA.sign(value + updatedAt, userPrivKey)
  };
  history: {                 // append-only log, never overwritten
    [timestamp: string]: {
      value: string;
      visibility: 'auto' | 'manual';
      signature: string;
    }
  };
}
```

Gun paths:
- Active answer: `~<userPub>/answers/<questionId>/current`
- History log: `~<userPub>/answers/<questionId>/history/<timestamp>`

Because Gun's Last-Write-Wins CRDT operates on `current` and history entries are keyed by unique timestamp (never overwritten), the history is naturally tamper-evident. Any peer can verify the signature chain.

### 2.8 SEA Encryption per User Dataset

All personally owned data is encrypted using **Gun SEA** under the user's own key pair.

```typescript
// Writing a private answer
const encrypted = await SEA.encrypt(answerValue, userPair);
gun.user().get('answers').get('private').get(questionId).put(encrypted);

// Reading it back
const enc = await gun.user().get('answers').get('private').get(questionId).once();
const value = await SEA.decrypt(enc, userPair);
```

**Encrypted data:**
- All `private/manual` answers
- All messages exchanged with a known person (see §2.8)
- Location data beyond the blurred public value

**Intentionally public (not encrypted):**
- Stage name (display name)
- Public/auto answers
- Public chatroom messages

**Key storage:** Keys are stored in Gun's `user` space backed by browser IndexedDB or Android Keystore. Keys never leave the device unless the user explicitly exports them.

### 2.9 Stranger Model & Known-Person Trust

**Default state — Stranger:**
- Every user starts as a stranger to every other user.
- All communications to/from strangers are sent in plaintext over the Gun graph (publicly readable by anyone with the path).
- The chatbot may answer talks on the user's behalf using public/auto answers.

**Marking a Known Person:**

When User A marks User B as a known person:
1. User A records User B's Gun public key (`pub`) and user ID in A's own encrypted trust store:
   ```
   ~<userA_pub>/knownPersons/<userB_id>/  →  { pub: userB_pub, label: 'friend' }
   ```
2. From this point forward, messages from A to B are encrypted using B's public key.
3. A assigns a relationship label: `friend | relative | coworker | acquaintance | partner | <custom>`.
4. The marking is **unilateral** — B cannot see that A has labelled them.

```typescript
interface KnownPerson {
  userId: string;
  pub: string;              // their SEA public key
  label: string;            // friend | relative | coworker | acquaintance | partner | custom
  addedAt: number;
  notes?: string;           // optional private notes, encrypted
}
```

### 2.10 Encrypted vs. Public Message Marking

All messages in the Gun graph carry a `channel` field:

| `channel` | Meaning | Encryption |
|---|---|---|
| `"public"` | Stranger-to-stranger or open chatroom | None — plaintext |
| `"known"` | A → B (A has marked B, unilateral) | Encrypted with B's public key |
| `"mutual"` | Both A and B have marked each other | ECDH shared secret from both key pairs |

**Mutual encryption:**
```typescript
// Derive shared secret using both key pairs
const secret = await SEA.secret(theirPub, myPair);
const encrypted = await SEA.encrypt(messageText, secret);

const envelope = {
  channel: 'mutual',
  from: myPub,
  to: theirPub,
  payload: encrypted,
  timestamp: Date.now(),
  sig: await SEA.sign(encrypted, myPair)
};
```

**UI display rules:**
- `"public"`: globe icon or no badge
- `"known"`: single-lock icon (one-way trust)
- `"mutual"`: double-lock icon (mutual encrypted)

The chatbot relay logic **only touches `"public"` channel messages.** It must never read or repeat `"known"` or `"mutual"` content.

---

## 3. Data Integrity & Conflict Resolution

### 3.1 Gun.js CRDT as the Conflict Authority

IinPublic delegates **all conflict resolution to Gun.js's built-in HAM (Hypothetical Amnesia Machine) CRDT**. No custom conflict resolution code should override or bypass Gun's native merge behaviour.

This applies to:
- User profile attributes
- Talk question/answer records
- Chatbot auto-generated answers
- Reputation counters
- Chatroom membership lists

```typescript
// ❌ Never override HAM
gun.get('answers').get(id).put({ value: 'new', _: { '#': 'custom-soul' } });

// ✅ Let Gun assign soul and resolve
gun.get('answers').get(id).put({ value: 'new' });
```

### 3.2 Concurrent Edit / Concurrent Answer Handling

**Scenario:** User A is editing a talk while User B starts answering the current (pre-edit) version.

**Rule:** Treat them as two separate live objects until A's edit is complete.

**Implementation:**

1. When User A begins editing, an **edit lock** is created:
   ```
   talks/<talkId>/editLock  →  { lockedBy: userA_id, lockedAt: timestamp, version: N }
   ```

2. Incoming answers from User B are written against **version N** (the pre-edit snapshot):
   ```
   talks/<talkId>/answers/v<N>/<userB_id>/<questionId>
   ```

3. When User A saves the edit, the version increments to N+1. A **merge task** runs:
   - Answers to questions that were **not changed** are migrated to v(N+1).
   - Answers to questions that **were changed** (text, options, or order) are flagged; the original respondent receives a notification to re-answer.

4. The edit lock is released. Future answers go to v(N+1).

```typescript
async function mergeAnswersAfterEdit(
  talkId: string,
  oldVersion: number,
  changedQuestionIds: Set<string>
): Promise<void> {
  const oldAnswers = await getTalkAnswers(talkId, oldVersion);
  const newVersion = oldVersion + 1;

  for (const ans of oldAnswers) {
    if (!changedQuestionIds.has(ans.questionId)) {
      await writeTalkAnswer({ ...ans, version: newVersion });
    } else {
      await notifyUser(ans.userId, {
        type: 'answer_stale',
        talkId,
        questionId: ans.questionId
      });
    }
  }
}
```

No answer is silently dropped. Users are always notified when their answer becomes stale due to an edit.

---

## 4. Network & Scalability

### 4.1 Limited-Retry Drop Policy

If a peer becomes unreachable, the system retries a fixed number of times then removes the peer from the active routing table.

```typescript
// src/config/network.ts
export const NETWORK_CONFIG = {
  maxRetries: 3,
  retryBackoffMs: [1000, 3000, 8000],  // backoff per attempt
  dropAfterMs: 15_000,                  // remove peer after this much silence
};
```

**Behaviour:**
```
Peer B unreachable →
  Retry 1 (after 1s)  → still unreachable
  Retry 2 (after 3s)  → still unreachable
  Retry 3 (after 8s)  → still unreachable
  → Mark B as dropped; stop sending to B
  → Gun's peer list updated (remove B)
```

Dropped peers are not permanently blacklisted. If B reconnects, the new-peer discovery flow (§4.2) handles it automatically.

**No retries for:**
- Chatroom presence pings (fire-and-forget)
- Public broadcast talks (eventual consistency handles delivery)

### 4.2 Automatic New-Peer Discovery

When a new peer joins the Gun graph the app automatically reaches out to bootstrap the connection:

```typescript
gun.on('hi', (peer) => {
  onNewPeer(peer);
});

async function onNewPeer(peer: GunPeer): Promise<void> {
  // 1. Exchange public keys
  await exchangePublicKeys(peer);

  // 2. Register in local peer list
  peerRegistry.add(peer.id, { connectedAt: Date.now(), status: 'active' });

  // 3. If in the same chatroom, announce presence
  if (await isInSameChatroom(peer.id)) {
    await announcePresence(peer.id);
  }
}
```

No manual peer management is required. Gun's built-in mesh topology handles routing; the application layer only adds the presence announcement.

---

## 5. Mobile-Specific Cases

### 5.1 Tit-for-Tat Fair Peer Mode

Mobile devices operate on a **tit-for-tat (T4T) fairness principle**: a device contributes relay capacity in proportion to the capacity it consumes, preventing free-riding.

```typescript
interface PeerContribution {
  bytesRelayed: number;     // bytes forwarded on behalf of others
  bytesConsumed: number;    // bytes the local user sent/received
  ratio: number;            // bytesRelayed / bytesConsumed
}
```

- `ratio >= 1.0`: net contributor → full relay privileges.
- `0.5 <= ratio < 1.0`: slightly behind → relay continues, throttled.
- `ratio < 0.5`: net consumer → local relay paused until ratio recovers.

T4T accounting resets at the start of each session (app foreground event).

### 5.2 Battery-Level Feature Tiering

Mobile features are tiered by battery level. Defaults below are user-adjustable in Settings > Power.

| Battery Level | State | Features Disabled |
|---|---|---|
| > 30% | Normal | None |
| 20 – 30% | **Low** | Stop relaying messages for other peers |
| 10 – 20% | **Critical** | Stop chatbot (no auto-answers); relay already off |
| < 10% | **Emergency** | Stop all new outgoing messages; read-only mode |

```typescript
// src-shared/battery/BatteryPolicy.ts

export enum BatteryState {
  Normal    = 'normal',
  Low       = 'low',
  Critical  = 'critical',
  Emergency = 'emergency',
}

export function getBatteryState(levelPercent: number): BatteryState {
  if (levelPercent > 30)  return BatteryState.Normal;
  if (levelPercent > 20)  return BatteryState.Low;
  if (levelPercent > 10)  return BatteryState.Critical;
  return BatteryState.Emergency;
}

export function applyBatteryPolicy(state: BatteryState, services: AppServices): void {
  switch (state) {
    case BatteryState.Low:
      services.relay.stop();
      break;
    case BatteryState.Critical:
      services.relay.stop();
      services.chatbot.stop();
      break;
    case BatteryState.Emergency:
      services.relay.stop();
      services.chatbot.stop();
      services.messaging.setReadOnly(true);
      break;
    case BatteryState.Normal:
      services.relay.start();
      services.chatbot.start();
      services.messaging.setReadOnly(false);
      break;
  }
}
```

**Android integration:**
```kotlin
// android/app/src/main/kotlin/com/iinpublic/BatteryReceiver.kt
class BatteryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val pct   = (level / scale.toFloat() * 100).toInt()
        webView.evaluateJavascript("window.__iinpublic.onBatteryChange($pct)", null)
    }
}
```

**User notifications:**
- Entering Low: subtle banner "Relay paused to save battery."
- Entering Critical: banner "Chatbot paused — battery low."
- Entering Emergency: prominent banner "Messaging paused — battery critical. Plug in to resume."
- Recovering to Normal: silent restore.

### 5.3 Native Android Components

```javascript
const MobileComponents = {
  locationService: {
    native: 'AndroidLocationManager',
    features: ['gpsTracking', 'backgroundLocation', 'permissionHandling', 'batteryOptimization']
  },
  notifications: {
    native: 'AndroidNotificationManager',
    features: ['pushNotifications', 'messageAlerts', 'matchNotifications', 'soundVibration']
  },
  offlineSync: {
    native: 'AndroidSyncManager',
    features: ['localQueue', 'backgroundSync', 'conflictResolution', 'storageManagement']
  }
};
```

---

## 6. API & Interface Standardization

This section defines the **contracts** between the three major boundary layers. All interfaces are expressed as TypeScript types. Platform-specific implementations must satisfy these contracts exactly.

### 6.1 Frontend ↔ Backend Interface

The frontend communicates with the backend over **HTTP REST** (static resources and tech support) and **WebSocket** (Gun.js relay peer). No other protocols are used.

#### REST Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/` | Serve static web bundle | None |
| `POST` | `/api/support` | Submit tech support ticket | None (anon) |
| `GET` | `/api/health` | Server health check | None |

**Tech support ticket payload:**
```typescript
// POST /api/support
interface SupportTicketRequest {
  message: string;        // max 2000 chars, no user identity included
  appVersion: string;     // semver from package.json
  platform: 'web' | 'android';
}

interface SupportTicketResponse {
  ticketId: string;
  estimatedResponseHours: number;
}
```

#### WebSocket (Gun Relay Peer)

The Gun relay peer is mounted on the same WebSocket server. Gun manages the framing — **application code must not send custom WebSocket messages** through the Gun relay connection.

```typescript
// ✅ Correct — let Gun manage the connection
const gun = Gun({ peers: ['wss://relay.iinpublic.app/gun'] });

// ❌ Never send raw WS messages on the Gun socket
```

### 6.2 App ↔ Gun Database Interface

All reads/writes to the Gun graph go through a **typed data access layer** (`src/data/`). Direct `gun.get()` / `gun.put()` calls in UI components are prohibited.

#### Gun Path Conventions

```
Root graph layout:

users/
  <userId>/
    profile/          ← public profile (stage name, avatar hash)
    knownPersons/     ← encrypted, only readable by this user
    answers/
      public/         ← auto/public answers
      private/        ← SEA-encrypted private answers
      history/        ← immutable append-only log

chatrooms/
  global/
  continent/<name>/
    country/<name>/
      state/<name>/
        city/<name>/
          district/<name>/
            gps-grid/<hash>/

talks/
  <talkId>/
    meta/             ← creator, tags, location filter
    questions/        ← question nodes
    editLock/         ← set while creator is editing
    answers/
      v<N>/           ← versioned answer bucket (see §3.2)

messages/
  public/<chatroomId>/
    <msgId>/          ← plaintext public messages
  known/<userA_id>_<userB_id>/
    <msgId>/          ← one-way encrypted messages
  mutual/<userA_id>_<userB_id>/
    <msgId>/          ← ECDH mutually encrypted messages
```

#### Data Access Layer Interface

```typescript
// src/data/DataAccess.ts — the single interface all app code uses

export interface IUserRepo {
  getProfile(userId: string): Promise<UserProfile>;
  updateProfile(fields: Partial<UserProfile>): Promise<void>;

  getPublicAnswer(userId: string, questionId: string): Promise<AnswerRecord | null>;
  setAnswer(questionId: string, value: string, visibility: 'auto' | 'manual'): Promise<void>;
  getAnswerHistory(questionId: string): Promise<AnswerHistory[]>;

  addKnownPerson(person: KnownPerson): Promise<void>;
  getKnownPerson(userId: string): Promise<KnownPerson | null>;
  listKnownPersons(): Promise<KnownPerson[]>;
}

export interface IMessageRepo {
  sendPublic(chatroomId: string, text: string): Promise<void>;
  sendKnown(toUserId: string, text: string): Promise<void>;
  sendMutual(toUserId: string, text: string): Promise<void>;
  subscribeToRoom(chatroomId: string, onMessage: (msg: Message) => void): Unsubscribe;
  subscribeToInbox(onMessage: (msg: Message) => void): Unsubscribe;
}

export interface ITalkRepo {
  createTalk(talk: NewTalk): Promise<string>;           // returns talkId
  getTalk(talkId: string): Promise<Talk>;
  startEdit(talkId: string): Promise<void>;             // acquires edit lock
  saveEdit(talkId: string, updated: Partial<Talk>): Promise<void>;
  submitAnswer(talkId: string, version: number, answers: AnswerMap): Promise<void>;
}

export interface IChatroomRepo {
  joinRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  getRoomForLocation(coords: GpsCoord): Promise<string>;
  subscribeToMembers(roomId: string, onUpdate: (members: string[]) => void): Unsubscribe;
}
```

**Implementation:** `src/data/GunDataAccess.ts` implements all four interfaces against the live Gun graph. Tests use `src/data/MockDataAccess.ts` (same interfaces, in-memory).

#### Write Pipeline (with Filters)

Every write to the Gun graph must pass through this pipeline:

```
User input
    │
    ▼
[1] financialDataFilter.filterBeforeWrite()   ← block card numbers etc.
    │
    ▼
[2] privacyClassifier.check()                 ← prompt on sensitive questions
    │
    ▼
[3] SEA.sign() / SEA.encrypt()                ← sign public, encrypt private
    │
    ▼
[4] gun.put()                                 ← write to graph
```

### 6.3 Shared Logic ↔ Platform-Specific Logic Interface

Business logic identical on both platforms lives in `src-shared/`. Platform-specific code lives in `src/` (web) and `android/app/src/` (Android).

#### Directory Structure

```
IinPublic/
├── src-shared/               ← platform-independent logic
│   ├── filters/
│   │   ├── financialDataFilter.ts
│   │   └── privacyClassifier.ts
│   ├── data/
│   │   ├── DataAccess.ts     ← interface definitions only
│   │   └── models.ts         ← all shared TypeScript types
│   ├── talks/
│   │   ├── TalkEngine.ts     ← talk flow execution
│   │   └── ConflictMerge.ts  ← versioned answer merge (§3.2)
│   ├── network/
│   │   ├── RetryPolicy.ts    ← limited retry logic (§4.1)
│   │   └── PeerDiscovery.ts  ← new peer on-join logic (§4.2)
│   └── battery/
│       └── BatteryPolicy.ts  ← tiering logic (§5.2) — logic only, no native calls
│
├── src/                      ← Web platform
│   ├── data/
│   │   └── GunDataAccess.ts  ← implements IUserRepo, IMessageRepo, etc.
│   └── platform/
│       └── WebCapabilities.ts
│
└── android/app/src/          ← Android platform
    └── kotlin/com/iinpublic/
        ├── data/
        │   └── AndroidGunDataAccess.kt
        └── platform/
            ├── BatteryReceiver.kt
            └── JsBridge.kt
```

#### Platform Capability Interface

Each platform must implement `IPlatformCapabilities`. Shared code calls this interface exclusively; it never calls platform APIs directly.

```typescript
// src-shared/platform/IPlatformCapabilities.ts
// Interface version: 1

export interface IPlatformCapabilities {
  // Battery
  getBatteryLevel(): Promise<number>;           // 0–100 integer
  onBatteryChange(cb: (level: number) => void): Unsubscribe;

  // Location
  getCurrentLocation(): Promise<GpsCoord>;
  onLocationChange(cb: (coord: GpsCoord) => void): Unsubscribe;

  // Storage
  getStorageAdapter(): GunStorageAdapter;       // IndexedDB on web, SQLite on Android

  // Notifications
  showLocalNotification(opts: NotificationOpts): Promise<void>;

  // Crypto keystore
  loadKeyPair(): Promise<SEAPair | null>;
  saveKeyPair(pair: SEAPair): Promise<void>;    // secure enclave on Android
}
```

**Web implementation** (`src/platform/WebCapabilities.ts`):
- `getBatteryLevel` → `navigator.getBattery()`
- `getCurrentLocation` → `navigator.geolocation`
- `getStorageAdapter` → IndexedDB via `gun/lib/radix`
- `loadKeyPair` / `saveKeyPair` → `gun.user()` local store

**Android implementation:**
- `getBatteryLevel` → `BatteryManager` system service
- `getCurrentLocation` → `FusedLocationProviderClient`
- `getStorageAdapter` → SQLite via `gun/lib/rs`
- `loadKeyPair` / `saveKeyPair` → Android Keystore system

#### Shared ↔ Platform Boundary Rules

1. **Shared code must never import platform-specific modules.** Any `if (platform === 'android')` in `src-shared/` is a bug.
2. **Platform code may import from `src-shared/`**, but not vice versa.
3. **Shared business logic must be unit-testable without any platform.** Tests in `src-shared/__tests__/` run in plain Node.js.
4. **All native-to-JS calls on Android** go through `JsBridge.kt` with typed payloads — no raw untyped `evaluateJavascript` strings outside that file.
5. **Breaking changes to `IPlatformCapabilities`** require a version bump comment at the top of the file.

---

## 7. Gun.js Data Model Specifications

### 7.1 Core Data Structure
```javascript
/iinpublic
├── /users/{userId}
├── /chatrooms/{chatroomId}
├── /talks/{talkId}
├── /conversations/{conversationId}
├── /surveys/{surveyId}
├── /reputation/{userId}
└── /tags/{tagId}
```

### 7.2 Data Schemas
```javascript
// User schema
const UserSchema = {
  _id: 'string',
  stageName: 'string',
  created: 'number',
  attributes: 'object',       // Q&A pairs
  reputation: {
    questionsAnswered: 'number',
    talksSent: 'number',
    matchesFound: 'number',
    starRating: 'number',
    blockCount: 'number',
    ageVerified: 'boolean'
  },
  settings: {
    privacyRadius: 'number',
    languageFilters: 'array',
    chatbotAutoAnswers: 'boolean'
  }
};

// Talk schema
const TalkSchema = {
  _id: 'string',
  creator: 'string',
  type: 'matching|survey',
  questions: [{
    id: 'string',
    text: 'string',
    answers: ['string'],
    autoAnswer: 'boolean',
    nextQuestion: 'string|null'
  }],
  tags: ['string'],
  locationFilter: {
    type: 'gps-grid|city|custom',
    coordinates: 'array',
    radius: 'number'
  },
  created: 'number',
  isSurvey: 'boolean',
  aggregationConfig: 'object|null'
};
```

### 7.3 First-Run Experience

On the very first launch, before the user has set anything up:

1. The app **auto-generates a unique ID** (a Gun SEA public key pair) and a random **stageName** (e.g. `user_7f3a`).
2. The user can change their stageName at any time to any value — including their real first name. Stage names are **not unique**; only the underlying ID (public key) is unique and immutable.
3. The user's SEA key pair is stored locally and is the sole proof of identity. No registration with a server is required.
4. The app immediately uses the device's location to place the user in the appropriate chatroom (see §1.1).
5. The initial screen shows three lists: **nearby users**, **public chatroom**, and **talk list**.

```typescript
// First-run initialisation
async function initFirstRun(): Promise<UserSession> {
  const pair = await SEA.pair();                        // generate unique ID
  const stageName = generateRandomStageName();          // changeable at any time

  gun.user().auth(pair);
  gun.user().get('profile').put({ stageName, created: Date.now() });

  const location = await platform.getCurrentLocation();
  const chatroomId = await chatroomRepo.getRoomForLocation(location);
  await chatroomRepo.joinRoom(chatroomId);

  return { pair, stageName, chatroomId };
}
```

### 7.4 User Management API
```javascript
class UserManager {
  static createUser(stageName, password) {
    return gun.user().create(stageName, password)
      .then(() => {
        const userProfile = gun.get(stageName).put({
          stageName,
          created: Date.now(),
          attributes: {},
          settings: {
            privacyRadius: 1000,
            languages: ['en'],
            autoAnswer: true,
            conversationMode: 'green',   // green | red | yellow (see §2.6)
            filters: { language: true, grammar: false, dirtyWords: true }
          },
          location: {
            trueGPS: null,
            publicRegion: null,
            travelMode: false,
            homeChatroom: null
          }
        });
        gun.get('userlist').set(userProfile);
        return userProfile;
      });
  }

  static updateLocation(userId, gpsCoords, blurRadius) {
    const publicLocation = this.blurLocation(gpsCoords, blurRadius);
    gun.get(userId).get('location').put({
      trueGPS: gpsCoords,
      publicRegion: publicLocation,
      lastUpdated: Date.now()
    });
    this.updateChatroomMembership(userId, publicLocation);
  }
}
```

### 7.4 Talk System API
```javascript
class TalkManager {
  static createTalk(creatorId, talkConfig) {
    const talkId = `talk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const talk = {
      id: talkId,
      creator: creatorId,
      created: Date.now(),
      type: talkConfig.type || 'matching',
      isSurvey: talkConfig.isSurvey || false,
      tags: talkConfig.tags || [],
      locationFilter: talkConfig.locationFilter || null,
      questions: talkConfig.questions || [],
      stats: { sent: 0, responses: 0, matches: 0, ignores: 0 }
    };
    gun.get('talks').get(talkId).put(talk);
    return talkId;
  }

  static sendBulkTalk(talkId, senderId, targetUsers, options = {}) {
    const batchedUsers = this.batchUsers(targetUsers, 50);
    batchedUsers.forEach((batch, batchIndex) => {
      setTimeout(() => {
        batch.forEach(targetId => {
          this.createConversation(talkId, senderId, targetId);
        });
      }, batchIndex * 1000);
    });
  }

  static createConversation(talkId, senderId, recipientId) {
    const conversationId = `conv_${senderId}_${recipientId}_${Date.now()}`;
    gun.get('conversations').get(conversationId).put({
      id: conversationId,
      talkId,
      sender: senderId,
      recipient: recipientId,
      created: Date.now(),
      status: 'pending',
      currentQuestion: 0,
      answers: {},
      isAutoAnswer: false
    });
    this.notifyRecipient(recipientId, conversationId);
  }
}
```

### 7.5 Survey Aggregation API
```javascript
class SurveyManager {
  static addSurveyResponse(conversationId, questionId, answer) {
    const surveyId = gun.get('conversations').get(conversationId).get('talkId').once();
    gun.get('survey-responses').get(surveyId).get(conversationId).get(questionId).put(answer);
    this.updateLiveAggregation(surveyId, questionId, answer);
  }

  static updateLiveAggregation(surveyId, questionId, answer) {
    const aggPath = gun.get('survey-aggregations').get(surveyId).get(questionId);
    aggPath.get('total').once().then(total => aggPath.get('total').put(total + 1));
    aggPath.get('answers').get(answer).once().then(count => {
      aggPath.get('answers').get(answer).put((count || 0) + 1);
    });
  }
}
```

---

## 8. UI/UX Component Specifications

### 8.1 Main Navigation Components
```javascript
const AppLayout = {
  header: {
    component: 'NavigationHeader',
    features: ['stageName', 'onlineStatus', 'chatroomIndicator', 'settings']
  },
  sidebar: {
    component: 'NavigationSidebar',
    features: ['chatroomList', 'activeTalks', 'messages', 'reputation']
  },
  mainContent: {
    routes: ['/dashboard', '/talks', '/chat', '/profile', '/surveys']
  },
  footer: {
    component: 'StatusBar',
    features: ['connectionStatus', 'syncStatus', 'locationPrivacy', 'batteryState']
  }
};
```

### 8.2 Talk Editor Components
```javascript
const TalkEditorComponents = {
  editorCanvas: {
    component: 'CytoscapeTalkEditor',
    features: ['dragDropNodes', 'connectQuestions', 'validateNoCycles', 'autoLayout', 'zoomPan', 'exportJSON', 'importTalk']
  },
  questionPanel: {
    component: 'QuestionProperties',
    fields: ['questionText', 'answerOptions', 'autoAnswerToggle', 'nextQuestionSelector', 'questionTags']
  },
  toolbar: {
    component: 'EditorToolbar',
    actions: ['addQuestion', 'addBranch', 'deleteNode', 'previewTalk', 'saveTalk', 'testTalk']
  },
  collaborationPanel: {
    component: 'RealTimeCollab',
    features: ['activeUsers', 'cursorTracking', 'changeHistory', 'editLockIndicator']
  }
};
```

### 8.3 Chat Interface Components
```javascript
const ChatComponents = {
  messageList: {
    component: 'MessageList',
    features: ['autoDetectPattern', 'renderAnswerChips', 'chatbotOverlay', 'channelBadge', 'timestampFormatting', 'readReceipts']
    // channelBadge shows globe / single-lock / double-lock per §2.9
  },
  messageInput: {
    component: 'SmartMessageInput',
    features: ['talkPatternDetection', 'answerChipGeneration', 'autoComplete', 'characterCount', 'sendButton']
  },
  answerCard: {
    component: 'AnswerChip',
    features: ['visibilityToggle', 'lockIcon', 'editAnswer', 'viewHistory']
    // visibilityToggle implements public/auto vs private/manual (§2.5)
  }
};
```

### 8.4 Bulk Send Dashboard
```javascript
const BulkSendComponents = {
  targetingPanel: {
    component: 'TargetingCriteria',
    fields: ['locationSelector', 'tagFilter', 'distanceRadius', 'userCount', 'audiencePreview']
  },
  sendProgress: {
    component: 'SendProgressTracker',
    metrics: ['totalSent', 'pendingDelivery', 'responsesReceived', 'matchesFound', 'ignoredCount', 'errorRate']
  },
  resultsView: {
    component: 'MatchResults',
    features: ['conversationList', 'matchFiltering', 'bulkActions', 'exportData', 'followUpActions']
  }
};
```

### 8.5 Survey Analytics Dashboard
```javascript
const SurveyComponents = {
  resultsChart: {
    component: 'SurveyChartRenderer',
    chartTypes: ['barChart', 'pieChart', 'distributionPlot', 'timeSeries', 'comparisonChart']
  },
  questionAnalysis: {
    component: 'QuestionAnalytics',
    metrics: ['responseRate', 'answerDistribution', 'skipRate', 'timeToAnswer', 'demographics']
  },
  respondentManagement: {
    component: 'RespondentList',
    features: ['individualResponses', 'anonymityToggle', 'followUpMessages', 'exportResponses', 'filterRespondents']
  }
};
```

### 8.6 User Interaction Patterns

**Question / Answer Syntax Rules:**

The following grammar defines how the app detects and parses questions and answers from free-text chat input:

| Syntax element | Rule | Example |
|---|---|---|
| Question | Any sentence/phrase ending with `?` | `Do you like tennis?` |
| Answer | A sentence/phrase ending with `.` that immediately follows a question | `Yes I do.` |
| Inline own-answer | `**` prefix before an option — marks the user's own default answer | `** yes` |
| Alternative option | `*` prefix — marks an additional option for the recipient to choose | `* no` |
| Option separator | `;` separates multiple options on one line | `** yes; * no; * maybe` |

```
Examples:

What's your name?
→ One question, no suggested options.

My name is Bernard.
→ Standalone answer (saved as user attribute).

What's your name? ** My name is Bernard.
→ Question with the user's own inline answer on the same line.

Are you a doctor? ** yes; * no.
→ Question with two options; "yes" is the user's own answer, "no" is an alternative.

Do you like to play tennis? ** yes; * no.
→ Same pattern; recipient sees answer chips "yes" and "no".
```

**Auto-Capture Pattern Detection:**
```javascript
// Full pattern: "Question? [**ownAnswer;] [*option; ...] ."
const AutoCapturePattern = {
  // Matches: <question?> <** own> [; * alt ...] .
  detection: /([^?]+\?)\s*(\*\*[^;.]+)?((?:;\s*\*[^;.]+)*)\.?/,
  ownAnswerMarker: '**',
  altOptionMarker: '*',
  optionSeparator: ';',
  uiFlow: {
    step1: 'Highlight detected pattern in input field',
    step2: 'Render answer chips to recipient (own answer highlighted)',
    step3: 'Record the chosen answer path',
    step4: 'Auto-save as linear talk draft',
    step5: 'Prompt user to add tags / location preamble before bulk-send'
  }
};
```

**Reputation Privacy Controls:**
```javascript
const ReputationPrivacy = {
  levels: {
    public: ['questionsAnswered', 'starRating'],
    connections: ['questionsAnswered', 'starRating', 'matchesFound'],
    private: ['allMetrics'],
    hidden: ['minimalInfo']
  },
  ui: {
    toggleComponent: 'PrivacyToggle',
    previewMode: 'ReputationPreview',
    permissionManager: 'AccessControl'
  }
};
```

---

## 9. Implementation Roadmap

### Phase 1: Core Infrastructure (Weeks 1-4)

#### Week 1-2: Gun.js Backend Setup
**Development Tasks:**
- Extend Entity.js with hierarchical chatroom system
- Implement location blur with dynamic radius
- Add user authentication with Gun SEA
- Basic talk storage and retrieval
- Implement `financialDataFilter` and `privacyClassifier` (§2.3, §2.4)

**Test Plan:**
```javascript
describe('Chatroom Management', () => {
  test('should create global chatroom and handle users up to capacity', async () => {
    const chatroom = ChatroomManager.getChatroomForLocation({lat: 0, lng: 0});
    await ChatroomManager.joinChatroom('user1', 'global');
    await ChatroomManager.joinChatroom('user2', 'global');
    const members = await chatroom.get('members').once();
    expect(Object.keys(members).length).toBe(2);
  });

  test('should split chatroom when capacity exceeded (1000 users)', async () => {
    for(let i = 0; i < 1001; i++) {
      await ChatroomManager.joinChatroom(`user${i}`, 'global');
    }
    const subrooms = await ChatroomManager.getSubrooms('global');
    expect(subrooms.length).toBeGreaterThan(1);
  });
});

describe('Security Filters', () => {
  test('should block credit card numbers from being written', () => {
    const result = filterBeforeWrite('My card is 4111 1111 1111 1111');
    expect(result.blocked).toBe(true);
  });

  test('should flag privacy-sensitive answers', () => {
    const result = privacyClassifier.check('What is your home address?');
    expect(result.isSensitive).toBe(true);
  });
});

describe('Authentication', () => {
  test('should create user with Gun SEA authentication', async () => {
    const user = await UserManager.createUser('testuser', 'password123');
    expect(user.stageName).toBe('testuser');
    expect(user.created).toBeDefined();
  });
});
```

**Exit Criteria:**
- All unit tests pass (90%+ coverage)
- Integration tests validate core flows
- Performance benchmarks meet requirements
- Security filters verified

---

#### Week 3-4: Basic Talk System
**Development Tasks:**
- Enhance Talks.js with question/answer validation
- Implement answer visibility model (§2.5)
- Implement immutable answer history (§2.6)
- Implement versioned answer buckets for concurrent editing (§3.2)
- Add basic bulk sending with queuing

**Test Plan:**
```javascript
describe('Answer Visibility', () => {
  test('chatbot should not repeat private/manual answers', () => {
    const privateAnswer = { value: 'yes', visibility: 'manual' };
    expect(chatbotCanRepeat(privateAnswer)).toBe(false);
  });

  test('answer history should be immutable', async () => {
    await setAnswer('q1', 'yes', 'auto');
    await setAnswer('q1', 'no', 'auto');
    const history = await getAnswerHistory('q1');
    expect(history.length).toBe(2);
    // Attempt to alter history — should fail
    await expect(alterHistory('q1', 0, 'maybe')).rejects.toThrow();
  });
});

describe('Concurrent Edit / Answer', () => {
  test('answers during edit go to prior version bucket', async () => {
    await talkRepo.startEdit('talk1');
    await talkRepo.submitAnswer('talk1', 0, { q1: 'yes' }); // version 0
    await talkRepo.saveEdit('talk1', { /* changed q1 */ });
    const v0Answers = await getTalkAnswers('talk1', 0);
    expect(v0Answers).toHaveLength(1);
  });
});
```

**Exit Criteria:**
- All unit tests pass (95%+ coverage)
- End-to-end talk scenarios complete successfully
- Security vulnerabilities addressed

---

### Phase 2: Advanced Features (Weeks 5-8)

#### Week 5-6: Visual Talk Editor
**Development Tasks:**
- Drag-drop question nodes with Cytoscape
- Talk graph validation (no cycles)
- Branching and OR logic support
- Real-time collaboration with edit lock (§3.2)

**Test Plan:**
```javascript
describe('Visual Talk Editor', () => {
  test('should validate no cycles in talk graph', () => {
    const editor = new TalkEditor();
    editor.connectQuestions('q1', 'q2');
    editor.connectQuestions('q2', 'q1');
    expect(editor.hasCycle()).toBe(true);
    expect(editor.canSave()).toBe(false);
  });

  test('edit lock prevents concurrent version conflicts', async () => {
    await talkRepo.startEdit('talk1');
    // Second user tries to edit simultaneously
    await expect(talkRepo.startEdit('talk1')).rejects.toThrow('locked');
  });
});
```

**Exit Criteria:**
- All unit tests pass (90%+ coverage)
- Real-time collaboration stable with 5+ users
- Complex talks (50+ questions) render smoothly

---

#### Week 7-8: Reputation, Moderation & Trust
**Development Tasks:**
- Permission-based reputation system
- Rate limiting and spam prevention
- Age verification for adult content
- Block/unblock functionality
- Known-person trust model (§2.8)
- Message channel marking (§2.9)

**Test Plan:**
```javascript
describe('Known Person Trust', () => {
  test('messages to known persons are encrypted', async () => {
    await userRepo.addKnownPerson({ userId: 'userB', pub: 'pubB', label: 'friend', addedAt: Date.now() });
    const envelope = await messageRepo.sendKnown('userB', 'hello');
    expect(envelope.channel).toBe('known');
    expect(envelope.payload).not.toBe('hello'); // encrypted
  });

  test('mutual known persons get ECDH shared-secret encryption', async () => {
    // Both sides have marked each other
    const envelope = await messageRepo.sendMutual('userB', 'hello');
    expect(envelope.channel).toBe('mutual');
  });
});

describe('Rate Limiting', () => {
  test('should prevent spam bulk sending', async () => {
    for(let i = 0; i < 10; i++) {
      const result = await RateLimiter.canSendBulk('testuser');
      if (i < 3) expect(result).toBe(true);
      else expect(result).toBe(false);
    }
  });
});
```

**Exit Criteria:**
- All security tests pass
- Reputation system resists manipulation
- Trust/encryption model verified end-to-end

---

### Phase 3: Mobile & Performance (Weeks 9-12)

#### Week 9-10: Android App
**Development Tasks:**
- Native Android with embedded Node.js
- JavaScript bridge for GPS/notifications
- Battery tiering integration (§5.2)
- Tit-for-tat peer relay (§5.1)
- `IPlatformCapabilities` implementation for Android (§6.3)

**Test Plan:**
```javascript
describe('Battery Tiering', () => {
  test('relay stops at low battery', () => {
    const state = getBatteryState(25);
    expect(state).toBe(BatteryState.Low);
    applyBatteryPolicy(state, services);
    expect(services.relay.isRunning()).toBe(false);
    expect(services.chatbot.isRunning()).toBe(true);
  });

  test('chatbot stops at critical battery', () => {
    const state = getBatteryState(15);
    applyBatteryPolicy(state, services);
    expect(services.chatbot.isRunning()).toBe(false);
  });

  test('read-only mode at emergency battery', () => {
    const state = getBatteryState(8);
    applyBatteryPolicy(state, services);
    expect(services.messaging.isReadOnly()).toBe(true);
  });
});
```

**Android instrumentation tests:**
```java
@Test
public void testBatteryReceiverNotifiesJS() {
    Intent intent = new Intent(Intent.ACTION_BATTERY_CHANGED);
    intent.putExtra(BatteryManager.EXTRA_LEVEL, 15);
    intent.putExtra(BatteryManager.EXTRA_SCALE, 100);
    batteryReceiver.onReceive(context, intent);
    verify(webView).evaluateJavascript(contains("onBatteryChange(15)"), any());
}
```

**Exit Criteria:**
- Battery tiering verified on real devices
- T4T relay accounting tested under simulated load
- All instrumentation tests pass
- App runs on 95%+ of target Android devices (API 24+)

---

#### Week 11-12: Performance Optimization
**Development Tasks:**
- Bulk send optimization
- Offline sync with Gun native handling
- Survey aggregation with live queries
- Stress testing for 1000+ concurrent talks

**Performance Benchmarks:**
- Bulk send: 50 users/second sustained
- Query response: <100ms for 10k record searches
- Memory usage: <200MB per 1000 active users
- Network efficiency: <500KB/hour per active user
- Storage growth: <10MB/day per 1000 users
- App startup time (Android): <3 seconds

**Exit Criteria:**
- All performance tests pass
- System handles 1000+ concurrent users
- Memory leaks eliminated
- Production readiness checklist completed

---

## 10. Testing Strategy & Quality Assurance

### 10.1 Continuous Testing Pipeline
```yaml
stages:
  - lint_and_format
  - unit_tests             # src-shared/ tests run in plain Node.js (no platform)
  - integration_tests
  - performance_tests
  - security_tests
  - end_to_end_tests
  - deployment_tests

coverage_threshold: 90%
performance_baseline:
  response_time_p95: 200ms
  memory_usage_max: 200MB
  error_rate_max: 1%
```

### 10.2 Test Environment Setup
```javascript
const testEnvironments = {
  unit: {
    framework: 'Jest',
    coverage: 'Istanbul',
    mocks: 'MockDataAccess (in-memory, implements same interfaces as GunDataAccess)'
  },
  integration: {
    framework: 'Playwright / Cypress',
    docker: 'Multi-node Gun.js cluster',
    data: 'Seed with realistic datasets'
  },
  performance: {
    tools: 'Artillery, k6',
    metrics: 'Response time, throughput, memory',
    scenarios: 'Load, stress, spike tests'
  },
  mobile: {
    framework: 'AndroidJUnit, Espresso',
    devices: 'Emulator matrix (API 24–34)',
    automation: 'Appium for cross-platform'
  }
};
```

### 10.3 Quality Gates

**Phase 1 Gate:**
- [ ] 90%+ unit test coverage
- [ ] All integration tests pass
- [ ] Security filters (financial data, privacy classifier) verified
- [ ] Performance benchmarks met
- [ ] Code review approved

**Phase 2 Gate:**
- [ ] Phase 1 regression tests pass
- [ ] New features 95%+ coverage
- [ ] Trust/encryption model end-to-end verified
- [ ] Usability testing complete
- [ ] Security audit passed

**Phase 3 Gate:**
- [ ] All previous tests pass
- [ ] Battery tiering verified on physical devices
- [ ] T4T accounting stress-tested
- [ ] Load testing completes successfully
- [ ] Production deployment verified
- [ ] User acceptance testing passed

### 10.4 Security-Specific Tests
```javascript
describe('Write Pipeline Security', () => {
  test('financial data never reaches Gun graph', async () => {
    await expect(
      messageRepo.sendPublic('room1', 'call me at 4111111111111111')
    ).rejects.toThrow('Financial data detected');

    const messages = await getMessages('room1');
    expect(messages.some(m => m.text.includes('4111'))).toBe(false);
  });

  test('private answers never appear in public Gun paths', async () => {
    await userRepo.setAnswer('q1', 'secret', 'manual');
    const publicNode = await gun.get('users').get(userId).get('answers').get('public').get('q1').once();
    expect(publicNode).toBeNull();
  });

  test('stranger messages are plaintext; mutual messages are ciphertext', async () => {
    const publicMsg = await messageRepo.sendPublic('room1', 'hi');
    expect(publicMsg.channel).toBe('public');
    expect(publicMsg.payload).toBe('hi');

    await userRepo.addKnownPerson({ userId: 'b', pub: pubB, label: 'friend', addedAt: Date.now() });
    // Simulate B marking A too (mutual)
    const mutualMsg = await messageRepo.sendMutual('b', 'hi');
    expect(mutualMsg.channel).toBe('mutual');
    expect(mutualMsg.payload).not.toBe('hi');
  });
});
```

### 10.5 Regression Test Suite
```javascript
const regressionTests = [
  'user_authentication_flow',
  'chatroom_membership_management',
  'talk_creation_and_delivery',
  'answer_visibility_enforcement',
  'answer_history_immutability',
  'concurrent_edit_versioning',
  'financial_data_filter',
  'privacy_classifier_prompt',
  'trust_model_encryption',
  'battery_tiering_android',
  'tit_for_tat_relay',
  'limited_retry_drop_policy',
  'auto_peer_discovery',
  'auto_capture_functionality',
  'bulk_send_performance',
  'reputation_system_integrity',
  'content_filtering_accuracy',
  'mobile_sync_reliability',
  'offline_data_persistence',
  'survey_aggregation_correctness'
];
```

---

## 11. Key Technical Decisions

- **Hybrid chatroom hierarchy**: Gun.js spatial queries combined with custom geographical nodes for multi-scale location coverage.
- **Batched bulk sending**: 50-user batches with 1-second delays to prevent network flooding.
- **Dynamic location privacy**: User-controlled blur radius from 100m to 10km.
- **Stranger-first trust**: All users start as strangers; encryption is opt-in per relationship.
- **Three-tier message channels**: public / known (one-way) / mutual (ECDH) with distinct UI indicators.
- **Public/private answer visibility**: Users control whether chatbot may repeat each answer; private answers are SEA-encrypted and never leave the user's own node.
- **Immutable signed history**: Answer history is append-only with SEA signatures; current answer is mutable.
- **Gun CRDT authority**: No custom conflict resolution overrides HAM — Gun's own merge is the single source of truth.
- **Versioned talk answers**: Concurrent edits and answers are isolated by version number and merged after the edit is saved.
- **Three-retry drop policy**: Unreachable peers are ignored after 3 attempts; automatically reconnected via Gun's `hi` event.
- **Battery tiering (Android)**: Four tiers (Normal / Low / Critical / Emergency) progressively shut down relay, chatbot, and messaging to preserve battery.
- **Tit-for-tat relay fairness**: Mobile devices relay for others proportional to what they consume, preventing free-riding.
- **Typed data access layer**: All Gun reads/writes go through `IUserRepo`, `IMessageRepo`, `ITalkRepo`, `IChatroomRepo` — no raw Gun calls in UI code.
- **`IPlatformCapabilities` interface**: Shared logic never calls platform APIs directly; each platform provides its own implementation.
- **Write pipeline with filters**: Financial data filter + privacy classifier + SEA encryption run on every Gun write before data is committed.
- **Native Android + JS bridge**: Mobile implementation uses embedded Node.js with a typed `JsBridge.kt` for all native-to-JS communication.
- **Permission-based reputation**: Users control who sees their reputation data at public / connections / private / hidden levels.
- **Live Gun aggregation**: Real-time survey statistics updated incrementally on each response.

---

## Appendix: Cross-Reference Matrix

| Requirement | Section | Implemented in |
|---|---|---|
| No central data collection | §2.1 | Architecture — no server writes |
| P2P only; P2P chats not persisted | §2.1, §2.2 | `server.js`, Gun relay config |
| Privacy question prompt | §2.3 | `src-shared/filters/privacyClassifier.ts` |
| Credit card filter | §2.4 | `src-shared/filters/financialDataFilter.ts` |
| Public/private answer flag | §2.5 | `src-shared/data/models.ts`, answer chip UI |
| Green/Red/Yellow conversation modes | §2.6 | `src-shared/data/models.ts`, `shouldChatbotFire()` |
| Immutable answer history | §2.7 | `ITalkRepo.submitAnswer`, Gun path design |
| SEA encryption per user | §2.8 | `GunDataAccess.ts` write pipeline |
| Stranger model / known person | §2.9 | `IUserRepo.addKnownPerson`, Gun path design |
| Message channel marking | §2.10 | `IMessageRepo.send*`, `Message.channel` field |
| First-run ID + stageName generation | §7.3 | `initFirstRun()`, Gun SEA key pair |
| Question/answer syntax (`**`, `*`) | §8.6 | `AutoCapturePattern`, `SmartMessageInput` |
| Gun CRDT authority | §3.1 | All `gun.put()` calls — no HAM override |
| Concurrent edit/answer | §3.2 | `src-shared/talks/ConflictMerge.ts` |
| Limited retry | §4.1 | `src-shared/network/RetryPolicy.ts` |
| Auto peer discovery | §4.2 | `src-shared/network/PeerDiscovery.ts` |
| Tit-for-tat relay | §5.1 | `src-shared/network/PeerContribution.ts` |
| Battery tiering | §5.2 | `src-shared/battery/BatteryPolicy.ts` |
| Frontend ↔ Backend API | §6.1 | `server.js`, REST + WebSocket |
| App ↔ Gun interface | §6.2 | `src-shared/data/DataAccess.ts` |
| Shared ↔ Platform interface | §6.3 | `src-shared/platform/IPlatformCapabilities.ts` |
