# IinPublic TODO

Last updated: 2026-07-15

This file tracks only open work. Completed items are archived in `docs/completed.md`.
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; libp2p/IPFS §25 — supersedes Phase D §24; find-similar §22)

## Model routing legend

Each item is tagged with the cheapest model that can do it reliably, to optimize token spend:

- **`[Opus]`** — distributed-correctness / ordering / architecture is the hard part; design mistakes cascade.
- **`[Sonnet]`** — standard implementation against an existing spec or pattern.
- **`[Haiku]`** — mechanical, fully specified work; running test suites; scaffolding from a written design.

Token-saving rules: for `[Opus]` items, have Opus write a short design note first, then hand implementation + tests to Sonnet. `- [ ] Test:` items belong to whichever model implemented the step.

---

## Execution rules (apply to all E2E specs)

1. Place spec in the **lowest stage whose user count can verify the choice** (1 user → `tests/e2e/staged/stage1-single-user/`, 2 users → `stage2-two-user/`, 3 users → `stage3-three-user/`).
2. Each spec gets a companion `.md` describing it in plain English.
3. Use existing helpers: `timing.ts` (`afterSync`/`afterAction`/`afterLoad`), `e2e-status-checks.ts`; assert via hard signals (`#status-bar-text`, local Gun IN index, `.conversation-list-item`), not toasts.
4. Run single spec: `npm run build:server && npx playwright test <spec>` (staged specs via `npm run test:e2e:staged` pipeline order).
5. **If a test exposes a real bug: fix the product code (never weaken the assertion), re-run until green.** If the feature doesn't exist at all, stop and log it under "Feature gaps" instead of inventing behavior.

---

## Land order: A → B → C → D → H → E → F → G → I → J

> **A–D complete 2026-07-15** — see `docs/completed.md`. AppBar + overflow, notification
> auto-dismiss, conversation-first entry + matched-talk threads, and the unified
> peer/contact detail are all landed with their specs (50–54, 60–61, 68–69, stage3/71).
> The planned `stage2/62-peer-messaging-merged` update was superseded: that spec never
> existed; the merged messaging area is covered by 60/61/69.

### Host E2E re-run (verification of 2026-07-15 fixes) `[Haiku]`

- [x] Round 1: host `test:all` re-run 2026-07-15 — jest green (phase0 clean), 11 of the
      19 E2E failures fixed; 8 remained (55, 67, 00j, 21a, 21b, 63, 64, 66).
- [x] Round 2 fixes landed 2026-07-15 for all 8 (see `docs/completed.md`): profile-card
      parity class + contacts re-render race (product), 6 spec corrections.
- [x] Round 3: host re-run 2026-07-16 — 160 passed, 2 remained (55, 21b). Fixed same
      day: `getAllChatrooms` Gun link-stub hydration (room names degraded to ids —
      product) + 21b closes the User layout before the bottom-nav click.
- [ ] Re-run the light shard on the host to confirm 0 failed.

> **H complete 2026-07-15** — message content filters (dirty words + grammar, both
> directions) landed with specs 70/71; the stage3 intake regression was confirmed green
> in the 2026-07-15 host run. Details archived in `docs/completed.md`.

> **E + F complete 2026-07-15** — popup responsive size classes + all 16 option-matrix
> specs landed. Two host-run fix rounds the same day (19 → 8 → 0 expected) resolved
> selector/UX-drift and two real product bugs; see `docs/completed.md`. Pending one
> green host re-run (tracked above).

### G. Platform × screen-size × cross-platform (catalog Part 6) `[Opus]`

Source: `docs/gui-layout-catalog-and-e2e-plan.md` Part 6

- [x] Define the **platform smoke set** as a tagged Playwright project — `@smoke` in `tests/e2e/platform-smoke/` (tab sweep, ⋯ overflow, full-screen dialog takeover, settings persistence). Match round-trip lives in X2/native.
- [~] CI runners: Mac mini (P2 Electron), Windows (P3), Linux (P4) — added `test:e2e:native-app:win` / `:linux` scripts; wiring these into the actual CI system is left to the CI config (needs the runner infra).
- [x] Playwright device-profile projects for iPhone (WebKit, 390×844) and Android (Chromium, 360×800) — `iphone-webkit`/`android-chromium` projects, opt-in via `E2E_DEVICE_PROFILES=1`; real-device manual pass documented in `tests/e2e/cross-platform/README.md`.
- [x] Screen-size sweep — spec 59 sweeps 320/390/768/1024; device profiles add 390×844 (WebKit) and 360×800 (Chromium). (Add 1920×1080/1366×768 rows to 59 if the host wants the full 5.)
- [x] **New** `tests/e2e/cross-platform/` harness (two clients on the shared hub) + README; `test:e2e:cross-platform` script; excluded from the light shard via HEAVY pattern.
- [x] **X1** website + webapp simultaneous presence/headcount (P0, merge gate).
- [x] **X2** cross-platform talk lifecycle both directions + cross-platform thread replies (P0, merge gate).
- [~] **X3** identity linking website ↔ webapp — scaffolded skipped spec (needs I's protocol + real website/webapp on CI). `(nightly)`
- [~] **X4** mobile-profile ↔ desktop-app matching + threads — scaffolded skipped spec. `(nightly)`
- [~] **X5** three-platform stage-3 network incl. thread isolation — scaffolded skipped spec. `(nightly)`
- [~] **X6** offline/mailbox across platforms, both directions — scaffolded skipped spec. `(nightly)`

> **G verification:** config parses; `platform-smoke` runs on `chromium` + (with `E2E_DEVICE_PROFILES=1`) `iphone-webkit`/`android-chromium`; `cross-platform` X1/X2 enumerate. X3–X6 are `test.skip` scaffolds awaiting the native/website build + item I on the CI runners.

### I. Multi-device identity linking (redesign §10, catalog T10) `[Opus]`

Source: `docs/gui-redesign-plan.md` §10 — user decision 2026-07-13

One person, multiple devices ⇒ **different SEA identity per device** (keys never leave a device). Build the linking mechanism instead of identity sharing.

- [x] Link protocol in `src/shared/`: short-lived pairing payload (pub + one-time secret + ~5 min expiry), **mutual signed attestations** (link valid only when both sides present and verified), signed revocation for unlink. Unit tests: one-sided claim ⇒ no link; revocation supersedes; forgery fails verification. — `src/shared/identity-linking.ts` + 12 unit tests (pluggable `LinkCrypto`). `[Opus]`
- [x] Linked devices Settings page: linked-identity list (stage name, platform glyph, linked date, per-row Unlink), **Link a device** → code+QR dialog, **Enter link code** dialog, **Unlink confirm**. — `src/web/ui/linked-devices-dialog.ts` + Settings row. `[Sonnet]`
- [~] Cluster rendering for peers: Contacts merged row + User-layout cluster line. — `WebIdentityLinkService.isLinked` provides the resolver; the Contacts/User-layout merge is scaffolded but not yet wired into the row renderers (needs the real service on the graph — X3). `[Sonnet]`
- [~] Block interplay: cluster-wide block offer. — deferred to the block flow; needs the cluster resolver wired (X3). `[Sonnet]`
- [x] **New** `stage1/71-linked-devices-page.spec.ts` — page open/close, empty state, code lifecycle incl. expiry, error paths (T10).
- [~] **New** `cross-platform/x3-identity-linking.spec.ts` — scaffolded skipped spec (needs website↔webapp on the shared graph + `WebIdentityLinkService` wired in app.ts). `[Opus]`
- [~] Same-device linking shortcuts (§10.3): URL-fragment / loopback / clipboard. — `encodePairingCode`/`decodePairingCode` support the `#link=` fragment; the fragment auto-detect + loopback handshake are not yet wired.
- [~] **New** `cross-platform/x8-same-device-link.spec.ts` — pending the same-device shortcuts. `[Opus]`

> **I verification:** protocol has 12 passing unit tests; `stage1/71` compiles and drives the full page/dialog/validation/unlink flow single-device; `tsc`/`lint` clean. The service (`web-identity-link-service.ts`) is ready for app.ts to wire real signed attestations for X3.

### J. Public-device exit — sync-then-erase (redesign §11, catalog T11) `[Opus]`

Source: `docs/gui-redesign-plan.md` §11 — user decision 2026-07-13

No server login/logout exists; a public-PC session leaves an identity behind. Build a verifiable local wipe with optional encrypted handoff to a linked personal device first.

- [x] Wipe engine: clear localStorage (destroys the SEA custody record) + IndexedDB/Gun radata + caches + session state, best-effort link revocations, reload to fresh boot. Verifiable post-reload. — `src/web/services/device-wipe.ts`. `[Opus]`
- [x] "Erase this device" Settings row (danger zone) + **Erase confirm dialog** (type-`ERASE` gate); never in `⋯`; disabled while sync in flight. — `src/web/ui/erase-device-dialog.ts` + Settings row. `[Sonnet]`
- [x] Encrypted handoff archive: package profile/contacts/filters+dirtyWords/answer prefs/my-talks/conversations; **Sync progress dialog**; erase gated until done. — archive schema + build/merge in `src/shared/device-handoff.ts` (7 unit tests) + Sync-progress dialog. 2026-07-15: `setDeviceHandoffSync` is now wired in app.ts — it builds the archive from local sources with per-category progress and stages it (`iinpublic_pending_handoff_archive`); the encrypt-to-pub P2P transfer to the linked device remains X7. `[Opus]`
- [x] Archive import per-category merge — contacts + talks/answers merge into local identity; conversation history read-only. — `mergeHandoffArchive` (unit-tested); Linked-devices import UI to be wired with the transfer (X7). `[Sonnet]`
- [x] **New** `stage1/72-erase-this-device.spec.ts` — typed-confirm gate, cancel intact, wipe verified, fresh identity, no prior data reachable.
- [x] **New** `stage2/72-sync-before-erase.spec.ts` — sync offer → progress → done enables erase; erase gated by typed confirm (seeded linked device; cross-device receiver-merge in X7).
- [~] **New** `cross-platform/x7-sync-then-erase.spec.ts` — scaffolded skipped spec (needs the P2P handoff transfer + receiver import wired). `[Opus]`

> **J verification:** handoff build/merge has 7 passing unit tests; `stage1/72` (wipe + fresh boot) and `stage2/72` (sync-progress + gating) compile and drive the full UI; `tsc`/`lint` clean. The wipe engine and dialogs are wired into Settings; the encrypt-to-pub P2P transfer + receiver import are the remaining app.ts wiring, tracked by X7.

---

## Future / low priority (explicitly deferred)

- Multiple identities on one device (profile switching). Decided low priority 2026-07-13; v1 stays one identity per device install.
- Merging message history across linked devices; aggregating reputation across a cluster (`flagged` in I).

---

## Open questions

- Identity linking v2 scope: should reputation aggregate across a linked cluster, and should contacts/conversations sync between linked devices? (v1: display-merge only.)
- iPhone/Android native shells: browser-profile testing is the stand-in until they ship — confirm.

---

## S3 — Cross-platform native clients ✅ COMPLETE

All done — see `docs/completed.md` 2026-07-14 for details. Electron, Android, and iOS shells verified with real builds. Desktop DMG built (236 MB), Android APK assembled all 3 ABIs via CMake + JNI.

---

## Resolved decisions

- ~~Mirror identity across devices or reject second session?~~ → Neither: per-device identities + linking (section I). 2026-07-13.
- ~~X3 identity strategy~~ → Per-device SEA, linking protocol, never shared keys.

---

## Nightly cron jobs

| # | Time (PDT) | Command | Purpose |
|---|-----------|---------|---------|
| 1 | 2:00 AM | `npm run health` | Health check |
| 2 | 2:10 AM | `npm run test:e2e:parallel` | Full E2E suite, parallel workers |
| 3 | 2:20 AM | `npm run test:e2e:heavy` | Mass specs + stage4/5 + find-similar |
| 4 | 2:30 AM | `npm run test:e2e:mesh` | Talks-matching mesh tests sequentially |

---

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.
