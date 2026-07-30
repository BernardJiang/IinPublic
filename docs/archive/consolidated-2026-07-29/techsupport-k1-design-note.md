# K1 Design Note — Built-in identity + relay-light presence

Implementation guide for TODO.md **K1** (decisions K1-1, K1-2, K1-3 are locked; this note turns
them into concrete edits). Companion to `docs/design/techsupport-bootstrap-contract.md`, which must
be amended as part of this work (see §Contract amendments at the end).

Audience: the implementing engineer. Every item below gives **Where** (file + function), **What
changes**, and **Risks**. The recommended landing order is first because several items are only
safe in sequence.

---

## Recommended implementation order (across all 7 items)

The governing constraint: **item 4 deletes the only thing that currently makes TechSupport appear
in a fresh network.** If 4 lands before 1 and 2, a fresh relay shows headcount 0 / no support
contact — a broken intermediate state that will red the whole `stage1` suite. So:

1. **Item 5 first (unify the graph builders into one shared factory).** Pure refactor, no behavior
   change, and it gives items 2 and the tests a single `TechSupportBaseline` source of truth to
   call. Landing it first means the member-row shape only has to be defined once.
2. **Item 2 (relay seeds the member row + identity on boot; eviction immunity).** This makes the
   *server alone* sufficient to produce headcount 2 in `stage1`. Eviction immunity already exists
   (`chatroom-manager.ts:416`); the new part is the boot-time member-row seed. Must land before 4.
3. **Item 1 (client synthesizes TechSupport from compiled constants).** Client-side, additive, and
   dedup-by-id makes it safe to run *alongside* the still-present browser write path. This is the
   client-side guarantee that empty network = 1 even against a bare relay.
4. **Item 3 (online/away indicator).** Purely additive UI + a presence read; independent of 1/2 but
   easiest to reason about once the synthetic entry from item 1 exists to attach the badge to.
5. **Item 4 (delete `bootstrapTechSupportRootIfMissing()` write path).** Only safe once 1 **and** 2
   are both in: item 1 guarantees the client still renders/counts TechSupport, item 2 guarantees the
   relay still has the row and identity. Delete write path, keep local rendering.
6. **Items 6 + 7 (tests) last.** `stage0-bootstrap` (item 6) asserts the item-2 boot seed; `stage1`
   (item 7) asserts items 1+2+3 together with the browser device absent. Writing them earlier just
   means re-editing them as the behavior settles.

Why 1 and 2 are belt-and-suspenders rather than redundant: item 2 gives the relay a discoverable
member row + signed identity (so presence and identity survive with no browser at all); item 1
guarantees the count floor of 1 **client-side** even if the relay row is momentarily missing (cold
Gun sync, or a future deployment that hasn't run the boot seed). They dedup by canonical id, so
running both never yields headcount 3 — see the double-count risk under item 1.

---

## Item 1 — Client renders TechSupport as a built-in Global member from compiled constants

**Where**
- `src/web/app/app.ts` — `countRoomMembers()` (line 323), and the four `subscribeToMembers` /
  status-bar call sites that feed it (`initializeChatrooms` at ~1200–1214 and ~1243–1254, the
  eviction handler at ~1137–1151, plus the boot subscribe at ~5011/5046/5292).
- `src/web/services/web-chatroom-service.ts` — `subscribeToMembers()` (line 606), `getMemberCount()`
  (746), `subscribeToMemberCount()` (755), and `observeActiveMemberIds()` (551).
- `src/web/ui/ui-manager.ts` — `updateChatroomMembers` (renderChatroomMembers, line 7455) for the
  in-room roster row; `setChatroomMemberCount` for the room-list badge.
- `src/shared/techsupport.ts` — add a single exported factory (see below) so the synthetic member
  object has one definition.

**What changes**

Add one exported helper to `src/shared/techsupport.ts`:

```
export interface TechSupportRosterMember { userId: string; stageName: string; builtIn: true; }
export function techSupportRosterMember(): TechSupportRosterMember { ... TECHSUPPORT_ROOT_USER_ID / TECHSUPPORT_STAGE_NAME ... }
export const TECHSUPPORT_GLOBAL_ROOM_ID = 'global';
```

Then, at the point where the client turns a raw member list into the roster + headcount for the
Global room, **inject the synthetic member if and only if the room is `global` and no entry with
`TECHSUPPORT_ROOT_USER_ID` is already present.** The cleanest single choke point is
`web-chatroom-service.ts::subscribeToMembers` (line 660-664, inside the debounced emit): before
calling `this.membersListCallback(...)`, if `chatroomId === 'global'` and the map has no
`TECHSUPPORT_ROOT_USER_ID` key, push `techSupportRosterMember()` into the emitted array. Because
`countRoomMembers` (app.ts:324) already dedups with `new Set(members.map(m => m.userId))`, and
`subscribeToMemberCount`'s `activeMembers` map (web-chatroom-service.ts:777) is keyed by userId,
injecting under the canonical id is automatically idempotent against a real seeded row.

For the room-list **badge** count (not the status bar): `subscribeToMemberCount` (line 755) already
passes `includeTechSupport: true` to `observeActiveMemberIds`, so it counts a *real* row. Add a
floor: in `emitCount()` (line 783) and in the `getMemberCount()` fallback (746), if `chatroomId ===
'global'` and no TechSupport id is in `activeMembers`, add 1. This yields the required "empty
network = 1" without depending on any Gun row existing.

Leave `observeActiveMemberIds`'s `includeTechSupport` default of `false` (line 578) untouched — that
default is deliberately used by broadcast-receiver / roster-scan paths where TechSupport must be
excluded (it is never a talk recipient; `acceptsIncomingTalks` in techsupport.ts:123). Do **not**
flip the default; only the count/roster paths get the synthetic entry.

**Risks / gotchas**
- **Double count → headcount 3.** The single most important invariant: inject only when no
  `TECHSUPPORT_ROOT_USER_ID` entry already exists, and always under the canonical id. If item 2's
  seeded row and item 1's synthetic entry ever land under different ids, the Set dedup fails. Both
  use `TECHSUPPORT_ROOT_USER_ID`, so this holds — but it must be asserted by the `stage1` test.
- `subscribeToMembers` has a "reopen same room" fast path (lines 615-621) that replays
  `activeMembersForList` without re-running the map handler. The synthetic injection must live in
  the emit, not in the map handler, or the fast-path replay will drop TechSupport.
- The status bar uses `countRoomMembers(members)` on the list `subscribeToMembers` provides, so once
  the injection is in that emitted array, the status bar is covered for free — no separate change to
  the four app.ts call sites beyond confirming they pass the *injected* array.

---

## Item 2 — Relay keeps exactly one member row + signed identity, republished on boot from the public half; never evictable

**Where**
- `src/server/index.ts` — `publishPublicBootstrap()` (line 128), already called from boot (line 124)
  and re-run after an E2E graph reset. This is where the identity is republished today
  (`publishIdentity()`, line 135).
- `src/server/services/chatroom-manager.ts` — add a `seedTechSupportGlobalMembership()` method;
  eviction immunity already exists at `pruneStaleRoomMemberships` (line 416,
  `if (isTechSupportId(record.userId)) continue;`).
- `src/shared/techsupport.ts` — reuse the factory from item 5.

**What changes**

Today the relay publishes the *identity* record on boot but seeds **no chatroom member row** — the
Global member row only exists because a browser bootstrap (`app.ts:1068`) or the E2E baseline seed
(`clear-database.ts:229`) wrote it. Under K1 the relay must own that row itself.

In `publishPublicBootstrap()`, after `publishIdentity()`, call a new
`chatroomManager.seedTechSupportGlobalMembership()` that writes exactly the one row:
`chatrooms/global/users/<TECHSUPPORT_ROOT_USER_ID>` and `chatroomMembers/global/<id>` with
`{ userId, stageName, joinedAt, lastSeen, isActive: true }`, mirroring the shape in
`clear-database.ts:232-241`. Then call `publishRoomMemberCount('global')` so
`public/room-member-counts/global` reflects 1. This is the "one member row" the checklist names —
do **not** seed a full user record / reputation / filters here; the relay carries "bytes, not a
database" (TODO.md:166). The richer user record is only needed by clients that open TechSupport's
detail view, and that is served from the compiled constant + the signed identity record, not from a
server-side user row.

Crucially the boot seed must stamp a **fresh `lastSeen`/`joinedAt`** each boot (republish "from the
public half"), because `roomMembershipIsStale` (line 346) compares `lastSeen` against
`ROOM_MEMBERSHIP_TTL_SECONDS`. Even though eviction skips TechSupport, a stale `lastSeen` would make
the row read as inactive in `isFreshActiveMember` on the client and drop it from the roster. Stamp
`new Date().toISOString()` at seed time.

Eviction immunity (K1-3) is already implemented at the single cheapest point
(`chatroom-manager.ts:416`) and needs no change. Confirm there is no *capacity/FIFO* path that
could evict TechSupport: FIFO is disabled in E2E (`CHATROOM_ENABLE_FIFO=false`), and grep confirms
no server-side capacity eviction of existing members exists today (capacity is only a stored meta
field, `chatroom-manager.ts:213`). If a FIFO eviction path is added later, it must reuse
`isTechSupportId`.

**Risks / gotchas**
- `predatesReset(data)` (chatroom-manager.ts ~64) drops rows whose `joinedAt/lastSeen` predates the
  last E2E reset. The boot seed runs inside `publishPublicBootstrap`, which *is* re-invoked after an
  E2E reset — so ordering matters: the seed must run **after** the reset fence is updated, else the
  freshly-seeded row is itself judged a pre-reset ghost. Verify `publishPublicBootstrap` runs after
  the reset bumps its fence; if not, seed with `bypassResetFence`-equivalent (stamp `lastSeen` to
  `now`, which is post-reset by construction).
- Best-effort vs awaited: `publishIdentity` is awaited and its failure only logs (index.ts:136).
  Seed membership the same way — a seed failure must not crash boot, but should log loudly, because
  a missing row silently drops the relay-provided presence (item 1's client floor still saves the
  count, which is the safety net).

---

## Item 3 — Online/away indicator sourced from real peer presence, decoupled from headcount

**Where**
- `src/web/app/app.ts` — `subscribeToPublicAnnouncements()` (line 843) already subscribes to
  `public/techsupport-identity`; presence is a separate signal. Add a small presence subscription
  near `initP2PPresenceAndBridge()` (called at line 1265).
- `src/web/ui/contacts-view.ts` — the support row render (line 727-738); add the indicator element
  next to `contactsSupportBuiltIn` copy (line 732).
- `src/web/ui/ui-manager.ts` — `updateChatroomMembers` (7455) for the roster row badge; a setter to
  push the online/away state into the support contact + roster row.
- `src/web/ui/conversations-view.ts` already contains an online/away pattern — reuse its CSS class
  convention (`grep online/away` in that file) rather than inventing a new one.

**What changes**

The indicator is **liveness, never headcount** (K1-2). Source it from real peer presence, not from
the seeded member row (the seeded row is always `isActive:true` and says nothing about whether the
device is reachable). Two viable sources, in order of preference:

1. **P2P presence / mesh**: whether a live peer connection to `TECHSUPPORT_ROOT_USER_ID` exists
   (the mesh session wired in `initP2PPresenceAndBridge`). If a datachannel/presence entry for the
   TechSupport id is present → **online**, else **away**. This is the truest signal and matches
   "real peer presence."
2. Fallback heuristic: the freshness of TechSupport's `lastSeen` on `chatrooms/global/users/<id>` —
   but note the item-2 boot seed stamps `lastSeen` even when the device is *not* running, so this
   alone is **not** a valid liveness signal. Only use it if the boot seed is changed to *not*
   refresh lastSeen on the presence sub-key. Prefer source 1.

Render: a small dot/label ("online" / "away") on (a) the built-in support contact row
(contacts-view.ts:732 area) and (b) the Global roster row for TechSupport. Default to **away** until
a positive online signal arrives, so a not-running device reads "away" (exactly what `stage1` item 7
asserts). Add translation keys `contactsSupportOnline` / `contactsSupportAway` (EN + 中文,
`ui-translations.ts`).

**Risks / gotchas**
- Do not let the indicator feed back into `countRoomMembers` or the badge — they must stay
  decoupled (K1-2). Keep the presence state in a separate field/setter.
- The presence signal for a peer that has *never* connected must resolve to "away" quickly, not hang
  pending — initialize to away and only flip on a positive event.

---

## Item 4 — Delete `bootstrapTechSupportRootIfMissing()`'s write path; keep only local rendering

**Where**
- `src/web/app/app.ts` — `bootstrapTechSupportRootIfMissing()` (line 1049) and its helper
  `seedTechSupportGlobalMembership()` (line 1068, the browser one — distinct from the new server
  method in item 2). Call site: `initializeUser()` line 985.

**What changes**

`initializeUser()` calls `bootstrapTechSupportRootIfMissing()` on the first-ever user (the
`else` branch, line 984-988) — this is a *browser minting the root*, the behavior K1 forbids. After
items 1+2 land, TechSupport is guaranteed by the relay (item 2) and rendered/counted locally (item
1), so the browser must stop writing.

Delete `bootstrapTechSupportRootIfMissing()` (1049-1066) and the browser
`seedTechSupportGlobalMembership()` (1068-1106) entirely, and remove the call at line 985. Do **not**
delete `discoverTechSupportIdentityFromGun()` (866) or `subscribeToPublicAnnouncements()` (843) —
those are read paths and stay.

Note this is only the *root-minting* write path. The **support-conversation greeting** write
(app.ts:2425-2512, `supportState` / `support_welcome_<userId>` / `sendMessage(... TECHSUPPORT_ROOT_USER_ID ...)`)
is a **different** invariant-4 violation owned by **K2**, not K1. Leave it alone in K1 — K1's tests
(`01-login-single-user-headcount.spec.ts:78-92`) still assert the welcome message exists, so
deleting it here would red K1's own gate. Flag for the K2 implementer, do not touch in K1.

**Risks / gotchas**
- **The bootstrap write path is currently what `stage1` depends on outside the staged pipeline.**
  `clearGunForStage1Spec()` (e2e-stage-pipeline.ts) has two branches: in the staged pipeline it
  loads the stage0 snapshot (which contains the baseline seed with the TechSupport member row); off
  the pipeline it calls `clearGunDatabases()` which reseeds via `seedTechSupportRootBaseline()`. So
  the *test* infra already seeds the row independently of the browser bootstrap — good. But any test
  that runs against a **truly bare** relay (item 6's new `stage0-bootstrap` test) will now rely on
  item 2's boot seed, not the browser. Confirm item 2 is merged before deleting.
- `createTechSupportRoot` on `WebUserService` and `hasTechSupportRoot` become unused after this
  deletion **only if** no other caller remains — grep confirms `createTechSupportRoot` is also used
  by the dev stage-zero login (`createNewUser` rootTechSupport branch, app.ts:1025). That path is
  K3's concern (dev login as TechSupport with a keypair); leave `createTechSupportRoot` in place.
- After deletion, `initializeUser`'s `else` branch (984) just creates the ordinary user. Verify no
  code downstream assumes `bootstrapTechSupportRootIfMissing` populated `chatrooms/global/users`
  before the user's own join — the user's join (`initializeChatrooms`) writes its own row
  independently, so this is safe.

---

## Item 5 — Reconcile the three competing TechSupport graph builders into one shared factory

**Where (the three current builders, all near-identical)**
- `tests/e2e/helpers/clear-database.ts` — `seedTechSupportRootBaseline()` (line 127-276), builds the
  full snapshot graph and POSTs `/api/test/import-snapshot`.
- `scripts/dev-techsupport-bootstrap.js` — `createTechSupportSnapshotGraph()` (line 25-129), a JS
  copy of the same graph (cannot import TS; see risk).
- `src/web/app/app.ts` — the browser `seedTechSupportGlobalMembership()` (1068) — being deleted in
  item 4, so it collapses into "not a builder" rather than being unified.

**What changes**

Extract one authored source in `src/shared/techsupport.ts` (or a new
`src/shared/techsupport-baseline.ts`) that returns the canonical baseline graph as a plain object,
parameterized by `now`/`state`:

```
export function techSupportBaselineGraph(now = new Date()): Record<string, unknown> { ...the graph currently duplicated in clear-database.ts:163-257... }
```

Then:
- `clear-database.ts::seedTechSupportRootBaseline` calls `techSupportBaselineGraph()` instead of
  inlining lines 163-257.
- The new server boot seed (item 2) reuses the `chatrooms/global/users/<id>` slice of the same
  factory (or a narrower `techSupportGlobalMemberRow()` helper the factory is built from), so the
  member-row shape has exactly one definition.
- `scripts/dev-techsupport-bootstrap.js`: this is plain `require()` JS and cannot import the TS
  module directly. Two options — (a) point the dev script at the compiled `dist/shared/...` and make
  the graph builder dependency-free, or (b) keep the script but have it call the same
  `/api/test/import-snapshot` with a graph produced by a tiny compiled helper. Prefer (a): move the
  `node()`/graph helpers into the shared TS module, build them into `dist`, and have the script
  `require('../dist/shared/techsupport-baseline')`. Document that the dev script now needs
  `build:server` (it already targets a running server, so this is a small note).

**Risks / gotchas**
- The three builders have drifted subtly — compare `dev-techsupport-bootstrap.js:56-69` vs
  `clear-database.ts:168-181`: both set the same fields today, but the whole point of unifying is to
  stop them drifting. Diff them field-by-field before extracting so the unified factory is a strict
  superset (it already appears to be identical — verify `reputation`, `filters`, `visits`,
  `uniqueVisitors` all match).
- `import-snapshot` shape: `clear-database.ts` posts `{version, gunGraph, incomingTalks, conversations, talkResponses, statsIdx}` (line 263-270) while the dev script posts `{version, gunGraph}` (line 178-180). Keep the factory returning only `gunGraph`; each caller wraps it with the envelope it needs.
- `assertTechSupportBaseline` (clear-database.ts:3, techsupport-baseline.ts helper) validates the
  seeded graph — if the factory changes any souls, update that assertion in lockstep or the
  post-seed `verifyTechSupportBaseline` (line 117) will throw.

---

## Item 6 — Test: `stage0-bootstrap` — fresh relay, no browser: identity record present, no support DB

**Where**
- New spec under `tests/e2e/staged/stage0-bootstrap/` (the dir already exists). Name it e.g.
  `00-relay-only-techsupport-presence.spec.ts` + companion `.md`. Model structure on the existing
  `stage1-single-user/00-techsupport-identity-bootstrap.spec.ts` (which already asserts the identity
  record is discoverable), but this one asserts the **relay-only** guarantees with **no browser
  user created**.

**What changes**

Assert, hitting the server HTTP/Gun export directly (no `IinPublicApp` user creation):
1. `public/techsupport-identity` is present and signature-valid (reuse the assertion style from the
   stage1 identity spec, lines 29-42, but read via `GET /api/test/export-snapshot` rather than
   creating a browser user).
2. Exactly **one** TechSupport member row: `chatrooms/global/users/<TECHSUPPORT_ROOT_USER_ID>` is
   present and `isActive:true`, and `public/room-member-counts/global` reads 1 (the item-2 boot
   seed).
3. **No support DB**: assert there is no per-user support user record beyond the single member row —
   i.e. no `conversations/*`, no `messages/support_welcome_*` souls in the export
   (`Object.keys(gunGraph).filter(...)` === 0), matching the "bytes not a database" contract.

Drive it from a clean relay: call `clearGunDatabases()` then (in the staged pipeline)
`loadStageSnapshot('stage0')` — but the stronger form is to clear, **not** seed the browser
baseline, and rely on the item-2 boot seed. Use `clearGunDatabases({ seedTechSupportRoot: false })`
(the option exists, clear-database.ts:69) to prove the *server boot* produced the row, not the test
harness.

**Risks / gotchas**
- `clearGunDatabases({ seedTechSupportRoot: false })` skips `seedTechSupportRootBaseline`, so this
  test genuinely exercises item 2. But `clearGunDatabases` does not restart the server — the boot
  seed runs on server *start*, not on reset, unless `publishPublicBootstrap` is re-invoked on reset.
  Confirm the E2E reset path (`POST /api/test/clear-database`) re-runs `publishPublicBootstrap`
  (it already re-publishes identity per the identity-bootstrap spec's premise, line 13). If it does,
  the member seed rides along. If the reset does **not** re-run the boot seed, this test needs the
  reset handler to call `seedTechSupportGlobalMembership()` too — wire that in item 2.

---

## Item 7 — Test: `stage1` — TechSupport device not running: headcount is still 2, contact listed, away indicator shown

**Where**
- New spec under `tests/e2e/staged/stage1-single-user/`, e.g.
  `02-techsupport-away-headcount.spec.ts` + `.md`. Reuse helpers from
  `01-login-single-user-headcount.spec.ts` (headcount locator lines 94-97; the
  `.chatroom-item[data-chatroom-id="global"] .chatroom-headcount` selector).

**What changes**

With one ordinary browser user and **no TechSupport device process running**:
1. Global headcount badge reads **2** (ordinary user + built-in TechSupport) — same locator as
   line 95-97. This proves items 1+2 together.
2. The TechSupport contact is present in the contacts list: assert
   `[data-support-contact="true"][data-contact-user-id="iinpublic-root-techsupport"]` is visible
   (contacts-view.ts:729).
3. The **away** indicator is shown on that contact (item 3): assert the away class/label from item
   3's render is present, and the online one is not.

The "device not running" condition is the default in the staged pipeline — no test spins up a
TechSupport client, so presence source 1 (item 3) never sees a live peer and stays "away". No extra
setup needed beyond *not* launching a TechSupport device.

**Risks / gotchas**
- This test is the guard against the **double-count** risk from item 1. Explicitly assert headcount
  is exactly `2`, not `>=2` — a `3` here means the synthetic injection and the seeded row are not
  deduping by id.
- Timing: the away indicator defaults to away, but if item 3 briefly shows "online" during a
  presence probe, the assert may flake. Assert with `expect.poll` on the *settled* away state, and
  ensure item 3 initializes to away rather than "unknown/pending".
- The existing `01-login` spec already asserts headcount 2 via the browser bootstrap. After item 4
  deletes that bootstrap, `01-login` must still pass on the item-2 boot seed — treat `01-login`
  green as a precondition for merging item 4, and only then add this `02` spec for the away case.

---

## Contract amendments (part of K1, `docs/design/techsupport-bootstrap-contract.md`)

Update these lines to match the revised model:
- Line 8/20: "an empty network must create or seed TechSupport" → the **relay** seeds the identity
  record + one Global member row on boot; the client also synthesizes it from compiled constants.
- Line 20: remove `bootstrapTechSupportRootIfMissing()` from "Current Enforcement" (deleted in item
  4); replace with "the relay seeds membership on boot (`publishPublicBootstrap`) and the client
  renders TechSupport from `src/shared/techsupport.ts` constants."
- Line 14: keep "counts as exactly 1" but add that liveness is a separate online/away indicator,
  never reflected in the count (K1-2).
- Add a Verification entry for the two new specs (items 6, 7).

Leave the `support_welcome_<userId>` invariant (line 11-12) untouched — that is K2's to rework.
