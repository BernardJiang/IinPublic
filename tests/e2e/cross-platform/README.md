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

Both run as two browser contexts against the shared per-worker hub — the runnable
form in this repo. The true website↔Electron and mobile-profile variants layer on
top via the device-profile projects (`E2E_DEVICE_PROFILES=1`) and the native-app
config (`npm run test:e2e:native-app`).

## Nightly (X3–X6)

`x3`–`x6` are scaffolded as skipped specs describing the setup each needs (native
Electron build, mobile device profile, offline mailbox across platforms). They are
run on the nightly cross-platform lane once the harness is wired to a real
website/native build on the CI runners (Mac mini P2, Windows P3, Linux P4).

## Real-device pass

Per release, run the `@smoke` platform smoke set on a physical iPhone and Android
device (WebKit/Chromium) in addition to the emulated device-profile projects.
