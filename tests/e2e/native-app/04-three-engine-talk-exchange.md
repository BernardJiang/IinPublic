# 04-three-engine-talk-exchange

Adam runs the real Electron desktop app, Eve runs Chromium, Bob runs WebKit (Safari's
engine). Each publishes one talk of every type (tag, flow, survey, route), broadcasts
to Global, and receives the other two's talks. Every received talk is answered as a
match. The spec then confirms all three see each other's stage name in Contacts (and
only each other — TechSupport is excluded from the count).

Unlike 02-browser-and-desktop-app-presence.spec.ts (presence + a single 1:1 DM only),
this exercises the actual talk-broadcast/match/contacts path across a topology mix
that had no prior coverage: Adam's Electron shell runs its own embedded local Gun
node (dials the shared hub for discovery/signaling only), while Eve and Bob connect
directly to the shared hub's Gun instance.
