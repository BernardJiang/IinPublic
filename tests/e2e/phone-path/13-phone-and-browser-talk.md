# Phone path 13 — a phone and a browser exchange Talks over their graph link
covers: SPEC-31.9

Alice is on phone A (her device core in the phone node); Web is a plain browser on the hub (its
core in the web worker). Once they share a Nearby room, Alice offers a Talk to Web right away
(`offerTalkForE2e` → `graph.offer`), and it must appear in Web's incoming list; then Web offers
one to Alice, which must appear in hers.

Found by native-app/12 on every phone (2026-11-08): the phone met the browser before the
browser's keys could be found, its graph link never opened, and the offer waited for good. The
bridge now retries opening such a link while the neighbor stays connected, and offers that waited
for it are made when it opens.
