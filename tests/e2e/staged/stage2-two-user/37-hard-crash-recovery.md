# 37 — Hard browser-process crash + recovery

## What this proves

A matched user B whose browser is **hard-killed** (SIGKILL, not a graceful close) recovers
fully on relaunch: same identity, same conversation, and any messages A sent while B was dead
are delivered from the encrypted offline mailbox once B comes back. B boots cleanly (no stuck
empty state).

## Kill mechanism used (documented per task requirement)

B runs in a **persistent chromium context** (`chromium.launchPersistentContext(userDataDir)`)
pinned to a unique temp `userDataDir`. The crash is a genuine **SIGKILL of the chromium OS
process**, delivered via `pkill -9 -f <userDataDir>` (see `helpers/crash-recovery.ts`
`launchPersistentUser().kill`).

Why not `browser.process()?.kill('SIGKILL')`? In this Playwright version (1.57) a persistent
context runs the browser out-of-process behind the RPC connection: `context.browser()` does
not expose a public `.process()`, and the underlying `ChildProcess` is not reachable through
the client object graph (verified by probing `_browser` / `_connection` internals — all
undefined). Matching the unique `--user-data-dir` on the process table and sending SIGKILL is
therefore the reliable hard kill. `context.close()` was explicitly rejected as "not a crash":
it lets chromium flush and run shutdown handlers. SIGKILL gives the process no such chance —
the `context`'s `close` event is used only to confirm the process actually died.

## Why persistent context (not storageState)

Playwright `storageState` captures localStorage/cookies but **NOT** the Web Worker IndexedDB
where Gun-on-device (`localStorage:true` main thread + IndexedDB worker) persists the graph.
A fixed on-disk `userDataDir` reused across the kill preserves BOTH, so the relaunched profile
boots with the same `iinpublic_user_id`, the same SEA keypair, and the same local Gun graph —
which is what makes B "the same user" after the crash.

## Flow

1. Bootstrap A (regular browser) and B (persistent context) in parallel; match them via the
   pair-direct response path (`submitTalkResponsePairDirect`), yielding a shared conversation id.
2. **SIGKILL** B's chromium process; wait for the context `close` event to confirm death.
3. While B is dead, A sends 2 DMs. WebRTC delivery fails (peer gone), so each is persisted to
   A's local Gun and queued to B's encrypted offline mailbox. (Sends run concurrently so the
   two 10s WebRTC connect timeouts overlap rather than serialize.)
4. Relaunch B from the SAME `userDataDir`.
5. Assertions:
   - `currentUser.id === userIdB` and stage name unchanged → same user survived the crash.
   - The A↔B conversation is recovered with the SAME conversation id. This is read via the
     durable Gun-backed path (`getConversationIdBetween`), NOT raw `localStorage.myConversations`
     — a SIGKILL ~200ms after match creation can predate chromium flushing that localStorage key
     to disk, whereas the authoritative Gun graph (IndexedDB) is restored and the app rehydrates
     the list from it.
   - Both offline messages arrive after B's mailbox drain (≤3s poll loop), read from the durable
     message store via `subscribeToMessages`.
   - The chatrooms nav shell is rendered → clean boot, no wedged empty state.

## Compromises

- The identity/data survival relies on the persistent-context profile (IndexedDB + localStorage
  on disk). This is the correct model for "same user after crash"; `storageState` alone would
  not preserve the Gun graph.
- The conversation-presence assertion intentionally uses the Gun-backed durable check rather than
  raw localStorage, because SIGKILL can beat the localStorage disk flush (documented above). The
  message-delivery assertion (the real point of the recovery) is unchanged and strict.

## Result

`1 passed` (~34s). No product bug found — crash recovery, identity persistence, and mailbox
drain all behave as designed.
