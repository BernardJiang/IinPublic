# 73 — Multimedia link sharing (DM composer + talk editor)

covers: SPEC-19.4  <!-- share a link to any media via IPFS, not the bytes inline -->

The messenger-style media feature shares a *link* to a file (uploaded to IPFS), never the
raw bytes over the DM/talk channel.

1. Adam broadcasts a tag talk; Bob matches → a pair conversation exists both sides.
2. **DM composer path:** Adam attaches a document (`notes.txt`) with the composer's 📎 button.
   The app uploads it to IPFS and drops an attachment card (filename + `ipfs://` link, a
   non-image file icon) into the thread. Both Adam and Bob see the card; the raw `IPFS_SHARE:`
   payload is never shown as text.
3. **Talk editor path:** creating a talk with a file attached publishes it to IPFS and stores
   it as `ipfsAttachments`, so the existing matched-talk auto-share sends the link on match.
   The test asserts the created talk carries a real attachment cid.
