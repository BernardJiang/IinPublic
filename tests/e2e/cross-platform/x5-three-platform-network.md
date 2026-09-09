# x5-three-platform-network

covers: SPEC-3.6

Three independently-launched Chromium browsers (Website/Webapp/Native) on the
shared per-worker hub. Ports `staged/stage3-three-user/
71-thread-isolation-multi` — which already proves this exact scenario with
three simultaneous browsers and no native app involved — into the
cross-platform harness with one client per named platform:

1. The same talk id seeds two separate pair threads: Website↔Webapp and
   Website↔Native. Isolation must come from the pair, not the talk, so the two
   conversation ids must differ.
2. Website writes into the Website↔Webapp thread. Webapp (parked on Website's
   User layout) gets a per-thread unread badge, which clears on read and shows
   the message.
3. Native's thread with Website, for the *same* talk, stays empty of Webapp's
   message — proving pair-private isolation holds across the three-platform
   boundary, not just within one browser engine.

Run: `npm run test:e2e:cross-platform` (part of the P0 merge-gate set alongside
X1/X2/X4/X6; X3/X7 remain nightly/native-shell-gated per this folder's
README).
