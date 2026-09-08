# TechSupport K7 Design Note — Delegated TechSupport Answers

Implementation guide for `docs/TODO.md` **Priority 5 → K7** ("Delegated TechSupport answers").
TODO.md explicitly gates implementation on this note being approved first — this is that note.
Companion to the archived K1–K5 notes in `docs/archive/consolidated-2026-07-29/` and
`techsupport-bootstrap-contract.md`, which this amends once approved.

## The problem this solves

Today there is exactly **one** TechSupport identity, `TECHSUPPORT_ROOT_USER_ID`, backed by exactly
one DM keypair (`TECHSUPPORT_PUB` / the private half in `TECHSUPPORT_SEA_PAIR_JSON`). Every
capability — signing the FAQ bundle, answering a pending question, replying in the support DM —
requires holding that one private key (`src/shared/techsupport.ts`, `assertTechSupportDmPair`).

The only way today to have a second human or device answer questions is to **copy the master
private key onto their machine**. That has three problems, all of which are exactly what motivated
K7 in TODO.md:
1. No audit trail — every answer is indistinguishable, authored by the same pub.
2. No revocation short of a full key rotation (new compiled trust anchor, re-sign every artifact,
   rebuild and redeploy every client — the "Honest cost" section of the bootstrap contract).
3. It directly defeats key custody — the whole point of holding the DM key privately is that it
   never has to leave the device(s) you trust; copying it to a phone puts full impersonation power
   on every device it touches.

K7 replaces "copy the key" with **delegation**: the master key never leaves the operator's own
device. Instead it mints small, revocable, expiring credentials that extend trust to other people's
*own* keypairs, scoped to "may answer TechSupport questions," with every delegated answer carrying
an internal (never user-facing) audit trail of who actually answered.

## Current trust model (recap, ties are load-bearing)

- `TECHSUPPORT_DM_TRUST_ANCHORS` (`src/shared/techsupport.ts`) is the **compiled** list of pubs
  allowed to sign a greeting, FAQ bundle, or support DM as TechSupport. `isTrustedTechSupportDmPub`
  checks membership; every verify path (`verifyFaqBundle`, `verifyTechSupportGreeting`, message
  render) calls it.
- The DM private key lives only where an operator process puts it: `dev-techsupport-login.js` /
  `techsupport-agent.js` read `TECHSUPPORT_SEA_PAIR_JSON`/`TECHSUPPORT_KEY_FILE` off disk and inject
  it into a fresh browser context's `localStorage` before the app boots. The server/relay never
  holds it and never needs it — production going live and the key staying local are already
  orthogonal (see "Answering your operational questions" below).
- Support inbox entries live in `techsupport-inbox/*` in **TechSupport's own local Gun graph**
  (K5-A), delivered there as an encrypted mailbox envelope so the relay only ever sees ciphertext.
- Publishing an answer writes `techsupport-faq/<key>` (per-entry) and `techsupport-faq/bundle`
  (the whole signed bundle every client caches) — both `public/`-style Gun paths, safe to mirror on
  the relay because the signature, not custody, is the authority.

K7 extends this model rather than replacing it: a delegate's messages must still verify against
something rooted in `TECHSUPPORT_DM_TRUST_ANCHORS`, just one hop removed.

## Design: signed delegation credentials ("signed redirect")

### Credential shape

```ts
// src/shared/techsupport-delegate.ts (new)
export interface TechSupportDelegateGrant {
  delegatePub: string;       // the delegate's OWN identity pub (an ordinary registered user)
  label: string;             // operator-chosen, e.g. "Alice's phone" — audit-only, never shown to askers
  issuedAt: string;
  expiresAt: string;         // hard cap; no grant is open-ended
  revokedAt: string | null;  // set (and republished) to revoke before expiry
  masterPub: string;         // which trust anchor issued this (supports future multi-anchor rotation)
  signature: string;         // SEA.sign over the canonical payload, by the DM private key
}
```

- Published at the deterministic soul `techsupport-delegates/<delegatePub>` — one grant per
  delegate pub, so re-issuing or revoking overwrites the same record (Gun has no true delete;
  revocation is "publish an update," identical to how K5 handles FAQ edits).
- Signed exactly like `signFaqBundle`/`signTechSupportIdentity`: `canonicalSerialize(...)` then
  `SEA.sign`, verified with `SEA.verify` + recompute-and-compare, `masterPub` checked against
  `TECHSUPPORT_DM_TRUST_ANCHORS` — mirror `verifyFaqBundle`'s shape exactly
  (`src/shared/techsupport-faq-bundle.ts:76`).
- `isValidDelegateGrant(grant, now)` — shape + signature + anchor + `now < expiresAt` +
  `revokedAt === null`. Pure function, unit-testable without Gun.

### Extending the trust check

`isTrustedTechSupportDmPub(pub)` today is a flat list lookup. K7 adds a second, async check used
everywhere a *message or bundle authored by a non-anchor pub* needs to be accepted:

```ts
// true if pub is a master anchor OR holds a currently-valid grant
export async function isTrustedTechSupportAuthorPub(pub: string, fetchGrant: (pub: string) => Promise<unknown>): Promise<boolean>
```

Call sites that currently gate on `isTrustedTechSupportDmPub` for *content the asker sees rendered
as TechSupport* (support DM replies, FAQ bundle authorship) move to this async check; anything that
must stay synchronous and master-only (e.g. issuing a grant itself, publishing the identity record)
keeps the existing anchor-only check. `verifyFaqBundle` and message-render verification both need
this — see "What changes" below.

### Delivery: keeping the inbox visible to N devices without a shared plaintext queue

K5-A deliberately keeps `techsupport-inbox/*` local to whichever device is running as TechSupport,
delivered as a mailbox envelope encrypted to one recipient. With delegates, more than one device
needs to see the same pending queue. Rather than introduce a shared plaintext store (which would
break the "relay holds no support data" invariant), **fan out the envelope at send time**:

- The asker's client, before calling `postSupportQuestionToMailbox`, reads the current delegate
  roster (`techsupport-delegates/*`, filtered to `isValidDelegateGrant`) plus the master's own
  `epub` from `public/techsupport-identity`, and posts one encrypted envelope **per valid
  recipient** (master + every live delegate), each independently landing in that device's own
  `techsupport-inbox/*` on drain. This is the same mailbox primitive already used, just addressed
  to more than one recipient — no new transport.
- Duplicate-answer avoidance across devices reuses plumbing that already exists: once anyone
  publishes `techsupport-faq/<key>`, every other device (master or delegate) that already
  subscribes to that path sees the entry exists and greys out / hides the pending row. No new
  "claim this question" locking mechanism needed for v1 — a genuine simultaneous double-answer is
  rare and harmless (`upsertSupportFaqEntry` just replaces by key; the second answer overwrites,
  and the asker sees whichever DM arrives, both correct).

### Answering as a delegate ("relayed answer" + audit trail)

A delegate signs the FAQ bundle and the support-DM reply **with their own keypair**, not the master
key — the master key is never present on their device. Concretely, `handleAnswerSupportQuestion`
(today: `app.ts`, K5 Item 5) gains a branch:

- If `this.currentUser.id === TECHSUPPORT_ROOT_USER_ID` (today's only case): sign with the loaded
  master DM pair, exactly as now.
- If the current user instead holds a **valid grant** for their own pub (checked against
  `techsupport-delegates/<ownPub>`, cached per-session, re-verified at answer time — not trusted
  from a stale cache): sign the FAQ bundle / DM reply with **their own** keypair, and stamp the
  published entry / message with `answeredByDelegate: <delegatePub>`.
- Either way, the DM reply is still displayed to the asker as **TechSupport** — the asker's render
  path already resolves the "TechSupport (root)" identity by conversation/sender-id, not by literal
  pub match, so no UI change is needed there; it just needs to *accept* a signature from a valid
  delegate pub instead of only the anchor pub (the trust-check extension above).
- `answeredByDelegate` is part of the **signed** payload (so it can't be forged onto someone else's
  answer) but is never rendered in the ordinary conversation view. It is surfaced only in a new
  "Delegate activity" section of the master's Support Inbox panel — visible only when
  `currentUserId === TECHSUPPORT_ROOT_USER_ID` (reusing the exact `isTechSupportRoot` gate
  `ui-manager.ts:1554` already uses for the root badge), so the master can audit who answered what.
  Ordinary delegates do not get a cross-delegate audit view in v1 — only their own answers, which
  they already know they wrote.

This is the "relayed answer" and "answeredByDelegate audit trail" TODO.md names, and the "signed
redirect" is the grant itself — trust flows master → grant → delegate pub → answer, at no point
handing over the master key.

### Assigning an agent (the operator-facing flow)

New "Delegates" section in the master's Support Inbox panel (`support-inbox-view.ts`, gated the
same way the inbox already is):

1. Operator enters the person's existing user id (a delegate is an ordinary registered account —
   no special onboarding) or pastes their pub directly, picks a label and an expiry (default 30
   days, hard-capped — no open-ended grants).
2. "Issue" signs and writes `techsupport-delegates/<pub>` with the master's loaded DM pair — this
   action only works from the one session holding the master key, same constraint K5's publish
   action already has.
3. The delegate's own client, on boot (or on a slow poll), checks whether `techsupport-delegates/
   <ownPub>` holds a currently-valid grant for them. If so, an explicit opt-in toggle appears in
   their own Me tab ("You've been asked to help answer TechSupport questions — enable?") — holding a
   valid grant does **not** silently turn on delegate mode; the person must accept. Once accepted,
   their Me tab gets the same Support Inbox UI the master sees, scoped by the fan-out delivery above.
4. "Revoke" on the master's Delegates panel republishes the same soul with `revokedAt: now`. Every
   client re-checks grant validity each session boot rather than trusting a long-lived cache, so
   revocation takes effect the next time the delegate's device is online — there is no way to force
   an already-open session offline, which is an honest, stated limitation (see below).

### Turning a phone into an agent, concretely

Two paths, depending on what "the phone" is running:

- **Master, on a phone**: still requires the raw master key, so it should stay rare and deliberate.
  Today's only injection path (`dev-techsupport-login.js`) is a Node/Playwright launcher — it does
  not run on a packaged mobile app. K7 adds a proper **in-app operator sign-in** screen (behind a
  non-discoverable entry point, e.g. a long-press on the app version string, matching how the
  desktop app already avoids exposing this to ordinary users) that accepts a pasted key JSON,
  validates it with `assertTechSupportDmPair` before use, and authenticates — replacing the
  chrome-inspect/localStorage hack the rollout notes currently describe as the only mobile path.
- **Delegate, on a phone** (the actual "assign an agent" case, and the one to prefer): the phone
  logs in as an **ordinary user** the normal way — no key handling at all. The master issues a
  grant to that user's existing pub from their own device. The phone never sees, needs, or could
  leak the master key. This is the answer to "keep the private key local while turning a phone into
  an agent": don't put the key on the phone — extend trust to the phone's own key instead.

### Timeouts, abuse controls, privacy boundaries

- **Timeouts**: `expiresAt` is mandatory and capped (default 30 days, operator can shorten, cannot
  exceed e.g. 90 days without re-issuing) — a forgotten delegate ages out on its own.
- **Abuse controls**: issuing a grant is master-key-gated, so the attack surface for minting bogus
  delegates is the same as compromising the master key itself, which is already the root of trust.
  The new surface is a **compromised delegate device**: bounded blast radius by design — a
  delegate's own priv key only lets them answer as a delegate (auditable, revocable, time-boxed),
  never lets them issue further grants, sign the identity record, or impersonate the master
  undetectably.
- **Privacy boundaries**: the delegate's stage name / profile never appears to the asker; the DM is
  authored and rendered as TechSupport exactly as today. `answeredByDelegate` is signed metadata,
  visible only in the master's own audit view. The Item 8 privacy rule from K5 (never promote an
  asker's personal detail verbatim into the public FAQ) applies unchanged to delegate-authored
  answers — the edit-before-promote affordance is not delegate-specific.

### Honest limitations (state plainly, don't hide)

- Revocation is eventually consistent: an already-open delegate session keeps whatever grant it
  last verified until its own next re-check. There is no remote kill switch for a live session —
  consistent with the whole architecture's "no server has that authority" stance, but worth saying
  out loud since it differs from a centralized admin panel's instant-revoke expectation.
- A delegate's already-published FAQ answers remain valid after their grant is revoked — revocation
  says "no longer speaks for us," not "everything they said was wrong." Re-reviewing a revoked
  delegate's answer history is a manual master action in v1, not automated.
- Fan-out delivery (encrypting one question to master + every live delegate) means the number of
  mailbox envelopes per question scales with delegate count. Fine at the scale this project
  operates at; would need batching if delegate count ever got large.

## Answering your operational questions directly

**"How do I keep the TechSupport private key in my own local environment while iinpublic.com is
live?"** You already can, with zero new code: the production relay (OVH VPS) never reads
`TECHSUPPORT_SEA_PAIR_JSON` — it isn't in the server's `.env`, isn't in `GunService`, isn't anywhere
in `src/server/`. The key only needs to exist wherever you run `npm run dev:techsupport` or
`npm run techsupport:agent`, pointed at production via `TECHSUPPORT_APP_URL=https://www.iinpublic.com`.
Turning the VPS's `iinpublic.service` on is completely orthogonal to where the key lives. The actual
blocker (per your rollout notes) is that a *real* production keypair was never generated —
`TECHSUPPORT_PUB` is still the placeholder dev key compiled into the client. That's a one-time
"generate a real pair, keep the private half only on your own machine(s), re-run the sign scripts,
rebuild and redeploy every client" step, independent of K7.

**"How do I turn one phone into a TechSupport agent that answers all questions?"** With K7: don't
put the master key on it. Log the phone in as an ordinary user, then issue it a delegate grant from
whichever device holds the master key. It gets the same Support Inbox UI and can answer real
questions, fully audited, revocable at any time, without ever touching the private key that must
stay in your custody.

**"How do I assign a TechSupport agent?"** That's the "Delegates" panel above: pick the person's
account, set an expiry, click Issue. No key handling on your side beyond the one device that
already holds the master key.

## Open decisions this note needs your call on before implementation starts

1. **Trust model**: build the delegation credential system above (master key never leaves your
   device), vs. the zero-code shortcut of literally copying the master key onto each phone. The
   note recommends delegation — it's the only option that satisfies "keep the key local."
2. **Phone sign-in UX for the master key itself**: worth building an in-app paste-key screen now
   (needed only if you personally want to run as master *from* a phone), or is that path fine to
   leave as "desktop/laptop only" indefinitely, since the actual agent-assignment case (delegates)
   never needs it?

## Implementation order (once approved)

1. `src/shared/techsupport-delegate.ts` — grant shape, sign/verify (`signDelegateGrant`,
   `verifyDelegateGrant`, `isValidDelegateGrant`), pure and unit-testable, mirrors
   `techsupport-faq-bundle.ts` exactly.
2. Trust-check extension (`isTrustedTechSupportAuthorPub`) wired into FAQ-bundle verify and
   support-DM render verify.
3. Mailbox fan-out (multi-recipient envelope) on the asker's send path.
4. Delegates panel (issue/revoke) in the master's Support Inbox view; delegate opt-in toggle in an
   ordinary user's Me tab.
5. `handleAnswerSupportQuestion`'s delegate-signing branch + `answeredByDelegate` audit surface.
6. In-app master sign-in screen (only if decision 2 above says yes).
7. Tests: grant sign/verify round-trip + tamper/expiry/revocation rejection (unit); issue → delegate
   answers → asker receives it attributed to TechSupport → master's audit view shows the delegate
   (e2e, `stage2`); revoked delegate's *new* session can no longer answer (their *already open*
   session limitation stated above is not testable as a "fix," only documented).
