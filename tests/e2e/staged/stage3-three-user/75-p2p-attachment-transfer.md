# 75 — Shared media link is delivered (byte retrieval needs the dev relay)

covers: SPEC-19.4  <!-- shared-media link delivery; P2P byte retrieval via relay -->

Adam publishes a photo to his own content node and broadcasts a tag talk carrying it. Bob
matches → the matched-talk auto-share drops the `ipfs://` link into the Adam↔Bob thread, and
this test asserts that link (with the correct cid) reaches Bob.

Actually fetching the bytes is P2P and content-addressed via IPFS: the recipient's content node
peers with the sender's through a libp2p **circuit relay** (`scripts/dev-libp2p-relay.mjs`,
wired into `npm run dev:multi`). The plain Playwright harness doesn't run that relay, so byte
retrieval is verified manually in `dev:multi`, not here — this spec guards the share/link
pipeline against regressions.
