# 75 — Shared media bytes travel P2P over the DM DataChannel

covers: SPEC-19.4  <!-- attachment bytes pulled peer-to-peer, no server/gateway -->

The recipient retrieves a shared file's bytes directly from the sender over the existing DM
WebRTC DataChannel — no central server, no public gateway, and without the flaky IPFS
content-node peering.

1. Adam publishes a photo to his own content node and broadcasts a tag talk carrying it.
2. Bob matches → the matched-talk auto-share drops the link into the Adam↔Bob thread.
3. Bob's app requests the bytes over the DM DataChannel; Adam serves them from his blockstore.
4. Bob ends up with the full decrypted bytes — WITHOUT seeding Bob's blockstore, proving the
   bytes moved P2P (the previous IPFS-auto-share test had to seed the block because the
   content node couldn't peer).
