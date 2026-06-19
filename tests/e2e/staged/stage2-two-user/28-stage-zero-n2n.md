# Test: Stage Zero N2N Smoke

**File:** 28-stage-zero-n2n.spec.ts  
**Features tested:** Node-to-node data flow end-to-end — single user creates a talk, stores it locally, broadcasts to empty room, validates server-side persistence contract. Regression against node connectivity issues introduced after refactoring.

---

## What this test does (in plain English):

Tests the basic Gun.js peer/node data lifecycle to verify the "stage zero" invariant: that a talk created by a user propagates correctly through the local→server replication path and round-trips back as persisted. Acts as regression gate for data-layer plumbing.

1. **Setup:** Launch one browser at 640×1000. Log in as TechSupport, configure settings including name, avatar (🎾), profile language en, distance filters, grammar/dirty-words on, copy-talk autosave on, chatbot enabled, home room selection, then enable P2P local node via Settings → "启用本地节点复选" checkbox.
2. **Create 4 talks in bulk:** tag talk (food), flow talk (tennis partner), survey talk (foodies), route talk (job searching). Publish via company page UI and click broadcast until ack'd for each one. Verify myTalks localStorage contains all 4 entries with role "created".
3. **Validate propagation:** Check that server Gun graph has received the talks by inspecting both `talks` and `peerTalkOffers/techsupport-id` subtrees (count matches). Wait up to 45 seconds for sync.
4. **Round-trip verify:** Switch to Talks tab → click each talk in myTalks list to open response modal → confirm that title, questions, and answer choices load from persisted graph (not stale local cache).

## Verifications:

- ✅ Four different talk types created, stored, and broadcast successfully
- ✅ Local storage `myTalks` reflects all entries with role "created"
- ✅ Server-side gun graph has matching talk + offer subtrees after sync window
- ✅ Round-trip: reopening talks from persisted graph shows title/questions unchanged

> **Why this matters:** Validates the fundamental data pipeline — local create → server replicate → round-trip read. Breakage here means no other E2E flow can function. Stage zero regression guard for N2N connectivity and talk persistence.

---

**Helpers used:** `clearGunForStage2Spec`, `injectIdbClear`, `gotoWebApp`, `afterLoad`, `afterSync`, `createTalksFromCompanyPage`, `clickBroadcastUntilBulkAck`
