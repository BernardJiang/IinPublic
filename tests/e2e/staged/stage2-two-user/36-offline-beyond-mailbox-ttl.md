# 36 — Offline beyond the mailbox TTL

covers: SPEC-19.4, SPEC-9.1  <!-- auto-seeded; refine by hand -->

## What this proves

The encrypted offline mailbox (`src/server/services/mailbox-store.ts`) is a TTL store.
When a message is announced to a recipient who is offline for **longer than the envelope's
TTL**, the defined behavior is: the expired envelope is **pruned and never delivered**, and
a fresh (non-expired) envelope for the same recipient still drains normally. The recipient's
app recovers cleanly.

## The TTL knob

- `MAILBOX_DEFAULT_TTL_MS = 48h`, `MAILBOX_MAX_TTL_MS = 72h` (constants, not env-configurable).
- Senders may attach a per-envelope `ttlMs` on `POST /api/mailbox/:recipientId`
  (`WebMailboxClient.postEnvelope` → body `ttlMs`), clamped server-side to `[1, MAX_TTL_MS]`.
- Because the Playwright `webServer` command sets its own env, we cannot change the constants
  from a spec (would require editing `playwright.config.ts`, which is forbidden). So we use the
  **client-supplied `ttlMs` override**: an envelope posted with `ttlMs: 1` is effectively expired
  after a ~50ms wait.

## Aging mechanism used

`ttlMs: 1` on the POST. The store sets `expiresAt = now + 1ms`; after a short `waitForTimeout(50)`
that timestamp is in the past. `MailboxStore.list()` (backing `GET /api/mailbox/:recipientId`,
which the client drain loop calls) runs `pruneExpired()` first, so the expired envelope is
physically dropped and never returned — no redelivery loop, no wedge.

No product bug was found: the server already prunes on read. This spec is the regression guard
for that defined behavior on the offline-drain path.

## Flow

1. A and B match via `setupLeanMatchedPair` (a lighter variant of `fast-dm-setup` that skips the
   overlay-open WebRTC connect attempts — see `helpers/fast-match-lean.ts`). Both epubs are
   resolvable, so A can SEA-ECDH-encrypt for B exactly as its live client does.
2. B's `storageState` is saved; B's context is **closed** (offline).
3. From A, two envelopes are written into B's mailbox through the app's own `WebMailboxClient`:
   - an **EXPIRED** `conversation-message-v1` envelope (`ttlMs: 1`), and
   - a **FRESH** control envelope (default TTL).
4. Direct server assertion: after the 1ms TTL lapses, `GET` B's mailbox returns exactly the
   fresh envelope; the expired id is absent (pruned) and `count === 1`.
5. B reconnects in a new context with the **same identity** (`storageState`), asserted by
   `currentUser.id === userIdB`.
6. B's drain loop runs at boot: the fresh DM is ingested into B's durable message store
   (read back via `conversationService.subscribeToMessages`), the expired text never appears,
   the mailbox ends empty, and the matched conversation is still present (app healthy).

The fresh control proves that pruning the expired envelope did not break normal drain.

## Result

`1 passed` (~24s).
