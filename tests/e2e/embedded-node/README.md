# S3 embedded-node E2E specs

Specs in this directory exercise the **embedded local node** (S3
cross-platform native clients — see `docs/design/S3-embedded-node-shell.md`)
as a real WebRTC P2P participant, not just a server that boots and serves
static files.

## What's different about these specs

Every other E2E spec in `tests/e2e/` runs against the per-worker web+gun
server pair Playwright's root `playwright.config.ts` manages (`ports.ts`:
web `3001+N`, gun `8080+N`). These specs additionally spawn a REAL
`dist/server/node-app/embedded-node.js` process — exactly what every
desktop/mobile shell (Electron, Android, iOS) boots — peered upstream to that
worker's Gun server, and drive a second browser against the embedded node's
own served origin instead of the webpack dev server.

Because of that extra process and the need for a prebuilt `dist/web` (the
embedded node always serves the static bundle, never the webpack dev server),
these specs run under their own `playwright.config.ts` in this directory
rather than the root one, and are excluded from the root config's `chromium`
project (`/embedded-node\//` in its `testIgnore`) so they never get swept
into the normal light/heavy/mesh sharded runs.

## Running

```bash
npm run test:e2e:embedded-node
```

This builds `dist/web` + `dist/server` (including
`dist/server/node-app/embedded-node.js`) first, then runs the spec with one
worker, one ordinary web+gun pair (slot 0), and one embedded-node process per
test file.

## What `01-browser-and-embedded-node-peer.spec.ts` proves

1. The embedded-node process boots, peers upstream to the worker's Gun server
   (`IINPUBLIC_HUB_GUN_URL` pointed at the worker instead of the real public
   hub), and serves the SPA on its own loopback port.
2. An ordinary browser peer and the embedded-node peer can see each other as
   Gun peers, exchange a talk, and match — i.e. mesh talk delivery works
   across the embedded node's upstream hub link, not just within one worker's
   browsers.
3. After matching, both sides open a direct-P2P conversation and the WebRTC
   DataChannel reaches `connected` (`tests/e2e/helpers/p2p-transport-e2e.ts`,
   the same helper the all-browser P2P specs use) — the embedded-node peer is
   a real WebRTC mesh participant, not a passive file server.

This spec is also what surfaced and pinned a real bug while it was being
written: `attachGun()` in `src/server/bootstrap/http-bootstrap.ts` gated the
embedded node's upstream hub dial on a flag that had silently become
always-true once mesh talk delivery shipped, so embedded nodes never actually
connected to the hub despite logging that they had. See
`resolveUpstreamHubPeers()` in that file and
`src/test/unit/embedded-node-hub-dial.test.ts` for the fix + regression test.

## Sandboxed/CI environments without a working Chromium

This spec needs a real Chromium with WebRTC support
(`playwright install chromium --with-deps`, which needs root to install OS
dependencies). It was written and unit/type-checked, and its components were
verified individually (embedded-node boot, upstream hub peering, build-id
drift detection) in an environment where Chromium could not be launched
(missing system libraries, no root access) — so the full spec itself has not
been run end-to-end there. Run it in CI or any environment with a working
`playwright install --with-deps chromium` to get the actual pass/fail signal.
