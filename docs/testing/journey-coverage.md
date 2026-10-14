# Journey coverage — everyday use cases × where they run

`coverage-matrix.md` maps design-spec sections to spec files. This page asks the user's question
instead: **for each simple thing a person does, is there a test that does it, on the route a real
phone takes, and checks the result on someone else's screen?**

## Why this page exists (2026-10-13/14)

Five phone-only bugs reached users or a phone while every browser spec passed:

| Bug | Why the browser suite could not see it |
|---|---|
| Place creation threw on Android (`crypto.subtle` undefined) | Browser specs talk to a desktop Node hub, which has WebCrypto. The phone's Node has none. |
| Phone Places never reached the hub | The phone node's relay to the hub was not on any spec's route. |
| Entering a Place on a phone always failed (browser gave up after 4 s; the relay takes ~7 s) | In-memory test hubs answer at once; through a phone node the same call makes two hub trips. |
| One Place with people made every phone's room list fail (503) | The hub's room list spent 2–3 s on visit counters; the phone relay waits 2.5 s. |
| Durable presence never saved on phones (`Invalid data: Date`) | Only the embedded node's presence store hit it. |

The last three were found by the phone-path suite below on its first runs. They are fixed in
`src/web/services/web-chatroom-service.ts` (`PLACE_ADMISSION_REQUEST_TIMEOUT_MS`),
`ChatroomManager.getChatroomMeta`, and `toGunPresenceRow`, each with a unit test.

## The four places a journey can run

| Column | What runs | Command |
|---|---|---|
| **Web** | Browser → desktop hub (the root Playwright suite) | `npm run test:e2e` |
| **Phone path** | Browser → phone-like embedded node (production relay mode, no global WebCrypto, release capacity) → hub. Two phone nodes, so "the other user" is on another phone. | `npm run test:e2e:phone-path` |
| **Slow hub** | Phone path with 400 ms added to every hub API call (mobile round trip) | `npm run test:e2e:phone-path:slow-hub` |
| **Real phone** | The Android app on real phones against a LAN test hub | `npm run test:android:release-smoke` (short) / `scripts/run-android-phone-e2e-sweep.mjs` (full) |

Phone-path files: `tests/e2e/phone-path/` (config, helpers, specs),
`scripts/e2e-phone-node.mjs` (starts one phone node), `scripts/e2e-phone-runtime.cjs` (hides
`globalThis.crypto` like Node 18 on the phone), `src/server/middleware/e2e-latency.ts` (slow hub).

What the phone path does **not** cover: the Android shell itself (WebView quirks, permissions,
backgrounding, the native location bridge, Honor's log filtering). That is the Real phone column.

## The matrix

✅ covered and checked on the other user's side (or in the hub's data) · ◐ covered only on the
actor's own screen, or only part of the case · — not covered · ⏳ written, not yet run

| ID | Use case | Web | Phone path | Real phone |
|---|---|---|---|---|
| **Start** | | | | |
| J-START-01 | Fresh install opens, an identity is made, app is usable | ✅ `stage0/*`, `platform-smoke/00` | ✅ every phone-path spec | ✅ `native-app/05` |
| J-START-02 | Restart keeps the same identity | ✅ `platform-smoke/01` | — | ✅ `native-app/12` |
| J-START-03 | Location given → placed in the right Nearby room | ✅ `stage1/27` | ✅ `phone-path/02` | ✅ `native-app/30` |
| J-START-04 | Location refused → still usable | ✅ `platform-smoke/02` (opt-in, production bundle) | — | — (OPEN-54) |
| **Rooms** | | | | |
| J-ROOM-01 | Two people nearby share one room and see each other in it | ✅ `stage2/01` | ✅ `phone-path/02` | ✅ `native-app/30` |
| J-ROOM-02 | A full room splits, people move down, and come back up when it thins | ✅ `stage4/08`–`14` | — | ✅ `native-app/31` |
| J-ROOM-03 | Leaving a room updates everyone else's headcount | ✅ `stage2/01`, `stage2/42`, `43` | — | — |
| **Places** | | | | |
| J-PLACE-01 | Create a Place; the creator stands in it | ✅ `stage1/54-place-creation-rules` | ✅ `phone-path/01` | ✅ `native-app/33` |
| J-PLACE-02 | The hub has the Place and lists it as a room with people | — | ✅ `phone-path/01` | ✅ `native-app/33` |
| J-PLACE-03 | Another user (another phone) finds it in their list and enters | — | ✅ `phone-path/01` | ✅ `native-app/33` |
| J-PLACE-04 | Both see each other in the Place | — | ✅ `phone-path/01` | ✅ `native-app/33` |
| J-PLACE-05 | Everyone leaves; the empty Place is still listed for others | ◐ `stage1/54` (creator only) | ✅ `phone-path/01` | ✅ `native-app/33` |
| J-PLACE-06 | A plain web user sees a Place made on a phone | — | ✅ `phone-path/01` | — |
| J-PLACE-07 | An empty Place can be entered again | ◐ `stage1/54` | ✅ `phone-path/01` | ✅ `native-app/33` |
| J-PLACE-08 | Refusals: too few contacts, one live Place per person | ✅ `stage1/54` | — | — |
| J-PLACE-09 | Refusals: same name in the cell, cell full | ◐ unit + integration only | — | — |
| J-PLACE-10 | Hub unreachable while creating → clear error, nothing kept locally | ◐ integration only | — | — |
| J-PLACE-11 | A Place with no visits for 30 days disappears from lists and the map | ◐ unit only | — | — |
| J-PLACE-12 | The Place shows on the map as a block at the right spot | ◐ `stage1/54-chatroom-tree-and-map` | — | — |
| **Talks** | | | | |
| J-TALK-01 | Write and broadcast a Talk in the room | ✅ many (`talks-matching/*`, `stage2/*`) | ✅ `phone-path/02` | ✅ `native-app/07` |
| J-TALK-02 | The other person receives it and answers | ✅ many | ✅ `phone-path/02` | ◐ `native-app/11` (received across devices) |
| J-TALK-03 | Matching answer → both get a conversation | ✅ many | ✅ `phone-path/02` | ◐ `native-app/12` (match made through a shortcut, not the answer UI) |
| J-TALK-04 | Non-matching answer → no conversation for either | ✅ `stage3/11` | — | — |
| J-TALK-05 | Blocked person's Talks stop arriving | ✅ `stage2/15b` | — | — |
| **Chat** | | | | |
| J-CHAT-01 | A message sent appears on the other person's screen | ✅ `stage2/09` | ✅ `phone-path/02` | ◐ `native-app/12` |
| J-CHAT-02 | Message to someone offline arrives when they come back | ✅ `cross-platform/x6`, `talks-matching/05` | — | ✅ `native-app/13` |
| J-CHAT-03 | A sleeping phone is notified and the message is there on wake | — | — | ✅ `native-app/28` |
| **TechSupport** | | | | |
| J-SUPPORT-01 | New user gets the signed greeting | ✅ `stage1/03` | — | ◐ `native-app/08` (support conversation) |

### Gaps worth filling next (in order)

1. **J-PLACE-08…11 on the phone path.** Refusals and expiry run only against the desktop hub or
   in unit tests, and the phone node's relay sits between the dialog and the hub's 409.
2. **J-TALK-04/05 and J-ROOM-03 on the phone path.** Mismatch, block and leave are where two
   people's views must agree.
3. **J-START-02/04 on the phone path.** Restarting the phone node with the same data dir.

## Rules for new tests

1. **Assert on the other side.** A step one user takes is checked on another user's screen or in
   the hub's data (`hubListsPlace`, `hubRoomMembers`, `hubActiveRoomIds` in
   `tests/e2e/phone-path/phone-path-helpers.ts`), never only on the actor's screen.
2. **Every bug found on a device gets two tests:**
   - the smallest one that reproduces it (a unit or integration test at the layer that broke —
     e.g. `cid.test.ts` for no-WebCrypto hashing, `place-admission-timeouts.test.ts` for the
     timeout budget, `presence-durable-row.test.ts` for the Date write);
   - a journey that walks the user's steps to it, on the phone path if a phone was involved.
   Add the journey's row (or ✅) to the matrix above in the same commit, and name the bug in the
   spec header so the reason survives.
3. **Cover the empty and first-use states**: an empty room, a new user with no contacts, a Place
   nobody is in, no location.
4. **Never create a Place against www.iinpublic.com** in a test: Places are public and cannot be
   deleted. The phone path and the release smoke both run their own hub.

## Release smoke (before every Play upload)

```bash
NATIVE_APP_ANDROID_SERIALS=<serial1>,<serial2> npm run test:android:release-smoke -- --install
```

Builds `dist/`, optionally builds and installs the debug APK on the two named phones, runs the
phone-path journeys, then on real phones: fresh-install boot and Talk commit
(`native-app/05`, `07`) and the two-phone Place journey (`native-app/33`). About 15–25 minutes.
It **clears IinPublic app data** on the named phones — the phones are shared, so always name them.
`--plan` prints the steps without running them. A failure means: do not upload.

## Exploratory runs (weekly, or after a large UI change)

Scripts only find what someone thought to check. Once a week, run an agent session (or a person)
against a phone with this brief, and file what it finds as OPEN items:

> You are a new user on <phone>. Starting from a fresh install, try to: get placed in a room,
> find people near you, make a Place for a shop, find a Place someone else made, enter and leave
> rooms, write a Talk, answer one, chat with a match, block someone, change language, and restart
> the app. Tap every button you see at least once. Record each step that fails, takes more than
> 5 seconds, shows an error, or leaves you unsure what happened, with a screenshot and the time.

The phone WebView can be driven over CDP (debug builds; `adb forward tcp:<port>
localabstract:webview_devtools_remote_<pid>`). Keep the session's log in
`docs/testing/exploratory/<date>-<phone>.md`.

## Room-move timings on the phone path (OPEN-58)

Measured on the phone path with a local hub (the `[timing]` lines and test annotations); in
brackets, with 400 ms added to every hub call:

| Step | Before (2026-10-14) | After the OPEN-58 fixes |
|---|---|---|
| Create Place → creator inside | ~31 s (34 s) | ~9 s (12 s) |
| Enter a Place from the list | 7–16 s (10–19 s) | 4–7 s (7–10 s) |
| Return home | 5–6 s (6–7 s) | ~2 s (3 s) |

What was slow, and what fixed it:
- The room catalogue (`GET /api/chatrooms`, used by the one-Place-per-person check before a
  create) read Gun with the default 2 s wait / 3 s timeout, twice: 6 s on the hub, 10 s through a
  phone. Now short waits, and the phone reads its own and the hub's list in parallel.
- An empty room's member read ran three Gun reads one after another (~2.6 s), twice per Place
  entry. Now one parallel read (~0.6 s).
- The phone node also read its own member list during reserve and commit, then ignored it.
- Every join and leave read-modify-wrote `chatrooms/<id>/headcount`, which nothing reads (~2.5 s).
- A room move waited for the leave's server DELETE; it now runs in the background, and a later
  reserve or join of the same room waits for it.

On two real phones (P30 + PH-1, 1.0.150, LAN test hub, `native-app/33`): create → inside 9.1 s,
enter 6.1 s, return home 2.2 s, re-enter the empty Place 8.2 s.

The journeys allow 60 s per move so they test correctness; the timings are recorded on every run
so a regression shows up as a number.

The faster moves also exposed two real bugs, both fixed:
- A phone node never dropped hub members who had left, so an empty Place kept a phantom
  headcount (`ChatroomManager.dropRelayedMembers`).
- The app loaded the Place catalogue only at boot and after its own create, so a Place someone
  else made later dropped out of the list once it emptied (`placesMissingFromCatalogue`). The old
  ~10 s catalogue fetch had hidden this.
