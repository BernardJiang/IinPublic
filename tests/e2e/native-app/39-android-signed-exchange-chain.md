# Native app 39 — signed exchange chain and tamper report on two real phones
covers: SPEC-31.13, SPEC-31.9

OPEN-108 on real phones (journey J-GRAPH-01/02, `tests/e2e/journeys/signed-exchange-chain-journey.ts`;
phone-path/12 runs the same journey with host phone nodes, stage2/97 in browsers). Both phones'
app data is cleared. Phone A and phone B exchange a Talk and its matching answer through the app;
each phone's own event chain verifies and each holds the other's signed acknowledgement.

Phone A's app is then force-stopped (WebView and node service together), its node's radata is
read with `run-as` (a debuggable build is required), the `title` of one of A's own chained Talk
events is rewritten, the file is pushed back, and the app is launched again on that data. The
relaunched core must report one chain break at that event's seq, by its signature.
