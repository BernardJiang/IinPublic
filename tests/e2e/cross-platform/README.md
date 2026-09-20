# Cross-platform E2E (catalog Part 6, TODO item G)

These specs exercise two clients sharing one Gun hub, standing in for the
website ↔ webapp ↔ native-app matrix. They are **not** part of the default
`chromium` shard (excluded via `testIgnore` in `playwright.config.ts`); run them
explicitly:

```bash
npm run build:server
npm run test:e2e:cross-platform
```

## Merge gates (P0 — must pass before merge)

- **x1-website-webapp-presence** — two clients on the shared hub see each other's
  presence and a room headcount ≥ 2 (X1).
- **x2-cross-platform-talk-lifecycle** — a talk broadcast + answered across the
  two clients produces a match + a thread reply in both directions (X2).
- **x4-mobile-desktop-threads** — a desktop client and a 390×844 mobile-profile
  client (`bootstrapMobileUser`/`setupFastMatchedMobileDm`) match and exchange a
  thread reply in both directions, then the mobile client leaves the conversation
  and proves its main AppBar/bottom-nav stays usable at 390px (X4, 2026-09-08).
- **x6-offline-mailbox** — two matched clients (`setupLeanMatchedPair`); each
  direction in turn goes offline (context closed, storageState saved), the
  other sends a message that falls back to the encrypted mailbox, and the
  offline side reconnects with the same identity and drains it (X6, 2026-09-08).
- **x5-three-platform-network** — three independently-launched Chromium
  browsers (Website/Webapp/Native) share the same talk id across two pair
  threads; per-thread messages/unread badges stay pair-private (Bob-equivalent
  never sees Jerry-equivalent's message) — ports `staged/stage3-three-user/
  71-thread-isolation-multi` into the harness (X5, 2026-09-08).

All five run as independently-launched browsers against the shared per-worker
hub — the runnable form in this repo. The true website↔Electron and
mobile-profile variants layer on top via the device-profile projects
(`E2E_DEVICE_PROFILES=1`) and the native-app config
(`npm run test:e2e:native-app`).

## Physical Android X3 and nightly X7

`x3-identity-linking` is an opt-in physical website↔Android gate. Run
`npm run test:e2e:x3-android`; it checks that the selected configured phone is available before
building, installs the current APK with a bounded timeout, clears the app profile, and covers
one-sided cancellation plus durable mutual link/restart/revocation behavior. It is not included in
the ordinary cross-platform command because it is destructive to that app profile and requires
ADB hardware.

`x7` remains a skipped hosted-website/native-webapp sync-then-erase scaffold pending its managed
CI hardware. `x8-same-device-link` already runs for real (landed 2026-08-26; see
`docs/completed.md`).

## Real-device pass

Per release, run the `@smoke` platform smoke set on a physical iPhone and Android
device (WebKit/Chromium) in addition to the emulated device-profile projects.
