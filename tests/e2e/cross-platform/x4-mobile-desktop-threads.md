# x4-mobile-desktop-threads

covers: SPEC-7.6, SPEC-19.4, SPEC-6.5

A desktop client (chromium, ordinary 900×1100 window) and a mobile-profile client
(chromium at the 390×844 mobile viewport, `isMobile`/`hasTouch` — the same
`bootstrapMobileUser`/`setupFastMatchedMobileDm` helper `staged/stage2-two-user/38`
and `39` already use) are matched via the fast pair-direct setup on the shared
per-worker hub, then exchange one thread message in each direction.

The conversation-overlay-stays-usable-at-390px contract is already covered in
depth by spec 39 (overlay/input/send-button bounds, no horizontal overflow,
tap-to-send). This spec's own contribution: after messaging, the mobile client
leaves the conversation overlay (`#back-from-conversation`) and returns to the
main chatrooms view, and the AppBar/bottom-nav stays fully usable there — no
horizontal clipping, and the create-talk action reachable either inline or
behind the `⋯` overflow button (`[data-testid="app-bar-overflow-btn"]`) — the
same T1/T2 contract `platform-smoke` asserts for the `iphone-webkit`
device-profile project, here exercised after a real cross-client match+thread
rather than a single idle client.

Run: `npm run test:e2e:cross-platform` (part of the P0 merge-gate set alongside
X1/X2; X3/X5-X8 remain nightly-only per this folder's README).
