# Test: TechSupport Conversation-UI Answer Flow

**File:** 00n-techsupport-conversation-answer-flow.spec.ts
**Features tested:** TechSupport operator replying to an ordinary user through the normal DM
conversation UI (peer click → type → Send), as opposed to the dedicated Support Inbox panel.

---

## What this test does (in plain English):

Regression coverage for a real bug found via manual testing (2026-09-15): when a TechSupport
operator opened a conversation with an ordinary user the same way anyone opens a DM — clicking
the peer in a shared chatroom's member list and typing a reply — the reply used to land in a
completely different, disconnected conversation than the one the user was writing into. The
operator's `findOrCreateDirectConversation` call only special-cased an ordinary user opening a
chat *with* TechSupport, not TechSupport's own session replying *to* an ordinary user, so it fell
through to the generic path and minted an unrelated `conv_pair_...` id on the ordinary WebRTC
transport instead of reusing the shared `conv_support_...` id on the durable star-gun transport.
Neither side ever saw the other's messages, and the server's
`POST /api/support/messages/:conversationId` route 400'd anything sent that way.

This is deliberately **not** the same path `07-support-inbox-answer-flow.spec.ts` and
`00l-techsupport-faq-cross-user.spec.ts` exercise — both of those answer via the dedicated
Support Inbox panel (`.support-inbox-item` / `handleAnswerSupportQuestion`), which never calls
`findOrCreateDirectConversation` and would not have caught this regression.

1. **Setup:** One ordinary user ("Wendy") boots normally; a second browser boots as TechSupport
   itself (K3 mode — real signed DM keypair injected before navigation).
2. **User asks 3 distinct new questions** via the ordinary support-contact conversation (opened
   by tapping the pinned support contact's name in Contacts) — each is a genuinely new question
   (never FAQ-known), so each gets its own signed "a human will get back to you" ack.
3. **TechSupport finds the user via the Global chatroom's member list** (the same mechanism any
   two ordinary peers use to find each other) and clicks their row — this is the exact click that
   used to mint a disconnected `conv_pair_` conversation.
4. **Operator sees all 3 questions** in the conversation that opens — proof it's the same shared
   conversation the user has been writing into, not a different one.
5. **Operator answers each question inline**, typing into the same ordinary conversation
   composer (`#conversation-message-input` / `#send-conversation-message`) used for any DM —
   never the Support Inbox.
6. **User's already-open thread receives all 3 replies** — proof the replies landed in the
   shared `conv_support_...` conversation on the durable transport, not a disconnected one.
7. **No regression console errors** (`"...persist failed..."` / `"Not a TechSupport conversation
   id"`) appeared on either side throughout.

## Verifications:

- ✅ User's 3 new questions each get the signed "will get back to you" ack
- ✅ TechSupport reaches the user's conversation via the ordinary chatroom-member-click flow (not
  the Support Inbox) and sees all 3 questions there
- ✅ TechSupport's 3 replies, sent from the ordinary conversation composer, all land in the same
  conversation the user is watching
- ✅ No "server persist failed" / "Not a TechSupport conversation id" console errors on either side

> **Why this matters:** The Support Inbox path and the ordinary conversation-UI path are two
> genuinely different code paths to the same conversation record, and only one of them had E2E
> coverage before this spec. A regression in the ordinary-UI path (exactly what shipped and was
> caught manually) would have passed the whole existing TechSupport E2E suite undetected.

---

**Helpers used:** `clearGunForStage2Spec`, `bootstrapUser`, `injectIdbClear`, `gotoWebApp`,
`ensureWindowFitsViewport`, `afterLoad`, `afterNav`, `afterSync`, `expectCurrentUserIsTechSupportRoot`,
`attachE2eBrowserTabLabel`, `WEBRTC_CHROMIUM_ARGS`
