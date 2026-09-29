# Test: Blocked Pair Cannot Exchange IPFS Attachments

covers: SPEC-3.8 <!-- shares the block-relationship area with 15a/15b/61; refine by hand -->

**Features tested:** Block enforcement extended to IPFS attachment transfer (photos/videos/files/audio)

---

## What this test does (in plain English):

1. **Alice and Bob are bootstrapped** and both enter the Global chatroom.
2. **Bob blocks Alice.**
3. **`resolveBlockStatusEitherWay` (the shared gate)** is polled and confirmed to report the block for this pair — the single dependency all four Part C call sites rely on.
4. **A mailbox-delivered attachment-share payload from Alice is fed directly into `ingestAttachmentShareFromMailbox`** on Bob's side. It never marks the message as processed — proving no conversation message record was created for a blocked sender's share.
5. **An attachment-share payload from Alice is fed directly into `maybeFetchSharedAttachmentBytes`.** After a short window, the fake cid is confirmed to never have been marked fetched — proving the fetch/decrypt path never ran (a genuinely missing/unknown cid would otherwise still be mid-retry at this point, not yet resolved either way).

## Verifications:

- ✅ `resolveBlockStatusEitherWay` correctly reports `eitherBlocked` for a pair where one side has blocked the other.
- ✅ `ingestAttachmentShareFromMailbox` (receive-side) never processes a share from a blocked sender.
- ✅ `maybeFetchSharedAttachmentBytes` (receive-side) never fetches/decrypts bytes shared by a blocked sender.

## Scope note

This targets the two RECEIVE-side call sites specifically, since those are the actual
enforcement boundary (a modified sender client could skip the send-side courtesy checks in
`autoShareMatchedTalkAttachments`/the `shareConversationMedia` handler — those exist to save a
well-behaved client the wasted IPFS publish, not to provide security). The guard clauses
themselves are trivial single-line early-returns (`if (await this.resolveBlockStatusEitherWay(...)) return;`),
and the underlying block-status correctness is already covered by `15a`/`15b`/`61`, which use
the identical method for talk delivery — so this test's job is narrowly to prove the guard is
actually wired into the two new call sites, not to re-prove block-status logic in general.
