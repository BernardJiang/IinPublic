# Google Play Console submission text (draft)

This is prep material for the parts of Play Console's submission flow that
ask for free-text or form answers, grounded in what the app actually does
per the codebase as of 2026-09-27. It is a starting draft, not a substitute
for reading each Console screen yourself — Google's exact question wording
and categories change over time, and only you can submit the final form.

See also: `docs/guides/DEPLOY_PRODUCTION.md` (signed `.aab` build) and
`public/privacy.html` (the published privacy policy — its URL is
`https://iinpublic.com/privacy.html` once deployed; that's the URL to enter
in Play Console's "Privacy policy" field).

## Store listing text

Character limits verified against Play Console's current documentation
(2026-09-28) — 30 / 80 / 4,000, per-language.

**App name** (≤30 chars — "IinPublic" is 9, well under; a descriptor-
augmented name is optional, not required):
```
IinPublic
```

**Short description** (≤80 chars) — the app's own established meta-
description tagline (`src/web/index.html`), not a new paraphrase:
```
Build your digital you, one answer at a time.
```
(45 characters — room to spare if you'd rather use the longer established
tagline instead: "Talk to hundreds of people about hundreds of
topics—simultaneously." — 67 characters, also fits.)

**Full description** (≤4,000 chars; the draft below is ~2,100 — deliberately
not maxed out, a store listing that's skimmable beats one that's exhaustive):
```
Build your digital you, one answer at a time.

IinPublic lets you talk to hundreds of people about hundreds of topics at
once — without scrolling through profiles or repeating yourself. Write a
question in plain language (a "Talk"), other people answer it, and the app
surfaces who you're actually compatible with.

HOW IT WORKS
• Write a Talk once — a real question you'd genuinely ask or answer often.
• Your chatbot repeats your approved answer whenever the same question
  comes up again. It never invents an answer for you — only reuses one you
  already gave.
• When you and someone else answer a Talk compatibly, that's a match —
  find them in Contacts and start a real conversation.
• Join chat rooms by location or topic to discover who's around. The
  conversation itself always stays one-to-one.

NO ACCOUNT NEEDED
There's no email, password, or sign-up. Your identity is a cryptographic
key generated on your own device the first time you open the app.

PEER-TO-PEER BY DESIGN
Talks and messages travel directly between members' devices, not through a
central company database. Your precise location is never shared — only a
coarse (~2 km) region, and only if you allow location access at all.

YOU CONTROL WHAT'S PUBLIC
Every answer you give can be public, visible to contacts only, or private.
Change your mind later: switch an answer back to private, or remove it
from your profile — future sharing stops immediately.

SAFETY
• Age-gated content (like dating-related Talks) is only delivered to
  members the community has verified as 18+ — no ID upload required.
• Block anyone, any time — a blocked member can no longer reach you.
• IinPublic never supports payments or money transfers of any kind, and
  automatically blocks anything that looks like a payment card or bank
  account number before it can be sent.

OPEN SOURCE
IinPublic's full source code is public under the MIT license — you don't
have to take our word for how it handles your data.

This is a closed beta test build. Expect rough edges, and please tell us
what you find — TechSupport is one tap away inside the app.
```

**Category:** Social (Communication is the other reasonable fit — Social
matches the matching/Talks-based positioning better than a pure messenger).

**Contact details:** iinpublic2026@gmail.com (same address as the privacy
policy). Play also asks for a website — `https://iinpublic.com` — and
optionally a phone number, which can be left blank.

**Graphic assets** (generated 2026-09-28, `scripts/gen-app-icons.mjs` /
`scripts/gen-play-feature-graphic.mjs`, re-run either to regenerate from the
same brand SVG source if the design ever changes):
- App icon (512×512): `assets/icon/play-store-icon-512.png`
- Feature graphic (1024×500): `assets/icon/play-store-feature-graphic-1024x500.png`
- Phone screenshots (4, 1082×2202, real captures from a clean dev build,
  simulating a real Android client so no browser-only UI leaks in):
  `assets/screenshots/play-store/1-welcome.png` through `4-settings.png`

**Release notes for the first closed-testing release** (≤500 chars,
verified — draft is 385; written for testers specifically, since there's
no prior public version to compare against):
```
Welcome to the IinPublic closed beta! Build your digital you — write a
question once (a Talk), and your chatbot repeats your approved answer
whenever it comes up again. No account needed; your identity lives on
your own device.

This is our first Play Store test build. Expect rough edges — tell us
what you find via Contacts → TechSupport in the app, or on GitHub.
Thanks for testing!
```

## Data Safety form

Play's Data Safety form asks, per data type: does the app **collect** it
(transmit off-device), does it **share** it with third parties, is it
optional or required, and why. "Third party" in Play's sense means outside
the app's own ecosystem — other IinPublic members receiving your talks and
messages as the app's core function is not third-party sharing; an ad
network or analytics vendor would be. IinPublic has neither.

| Data type | Collected? | Shared with 3rd parties? | Purpose | Optional? | User can request deletion? |
|---|---|---|---|---|---|
| Approximate location | Yes | No | App functionality (regional chat rooms, distance-based matching) | Yes | Yes — local only, no server record beyond the coarse region |
| Precise location | **No** | No | Blurred to ~2km on-device before anything leaves the device; raw GPS is never transmitted | — | — |
| Photos (profile photo) | Yes | No | App functionality (profile photo) | Yes | Yes — removable from profile |
| Videos, files (talk/chat attachments) | **No** | No | Sent directly device-to-device over IPFS (a peer-to-peer file network), not through our servers | Yes | N/A — never held by us |
| Messages — "Other in-app messages" | Yes* | No | App functionality (talks and post-match conversations) | N/A (core feature) | Local-only storage; see note below |
| Messages — "SMS or MMS" | **No** | No | The app never uses the device's native SMS/telephony system at all (no SMS/MMS permission anywhere in the manifest) — everything is in-app messaging over its own P2P transport | — | — |
| Financial/payment info | No | No | Not a feature — the app has no payment or money-transfer functionality of any kind. As a safety measure it actively detects and blocks anything resembling a card number or bank account number from being sent, but does not collect this data itself | — | — |
| User IDs | Yes | No | App functionality — a device-generated cryptographic key pair identifies your account; no email/phone/username collected | No | Deleting the app removes the local identity |
| Name, email, phone number | No | No | Not collected — there is no sign-up | — | — |
| Government ID | No | No | Age verification is peer-confirmed, not ID-based | — | — |
| App activity / analytics | No | No | No analytics or crash-reporting SDK is integrated | — | — |
| Financial info | No | No | No payments or purchases in the app | — | — |

\* "Collected" here means transmitted off the device at all, not that it's
readable by the operator: talks and chat content travel device-to-device
(peer-to-peer/WebRTC), with the relay server used for discovery/delivery
notification rather than as a readable message store. If Play's checkbox
UI forces a binary "stored on our servers" answer with no P2P nuance,
answer "Yes, collected" for messages/photos (to stay conservative) and use
the purpose/description free-text field to note the peer-to-peer design.

**Exception — TechSupport:** conversations with the built-in TechSupport
account are handled server-side and are readable by the operator for
support purposes. If Play's form asks about this separately, disclose it:
"Support conversations with our in-app support account are received and
stored by us to respond to support requests."

**Encryption in transit:** Yes — mark this Yes for all collected types.

**Data deletion:** there's no server-side account to delete data *from* —
answer accordingly (e.g., "Not applicable — no account data is retained
server-side outside of TechSupport support conversations, which can be
deleted on request via the contact address in the privacy policy").

## Content rating questionnaire (IARC)

Relevant "yes" answers based on actual app behavior:

- **User interaction / user-generated content:** Yes — users exchange
  free-text questions, answers, and messages with people they may not know.
- **Users can share their location with other users:** Yes, but only a
  coarse (~2km) region, never precise coordinates.
- **Profanity / crude humor:** Possible — chat and talk content is
  free-text and not moderated by the operator; an optional profanity filter
  (`blockDirtyWords`) exists but is receiver-opt-in, not a default
  server-side content filter.
- **Dating or relationship-oriented content:** Yes — the app has an
  explicit "adult content (18+)" flag for talks involving dating/age-range
  questions, and per-content-type gating so that flagged content is only
  delivered to age-verified members.
- **Sexual content, nudity:** Not a built-in feature (no photo/video
  moderation pipeline exists), but since content is user-generated and
  unmoderated by the operator, answer honestly that user-generated content
  is not pre-screened.
- **Violence, gambling, controlled substances, real-money purchases:** No —
  none of these are app features.

Given the user-generated, unmoderated chat plus the 18+ content gate, expect
this to land at a **Teen** or **Mature 17+** rating depending on how IARC
weights "unmoderated user-to-user chat" versus the age-gating already in
place — the questionnaire's outcome isn't something to guess further than
that; answer the actual questions as above and let IARC compute it.

## Permission justifications

Play Console's "App content" section asks for a justification whenever the
app declares a sensitive runtime permission. Suggested text per permission
actually declared in `android/app/src/main/AndroidManifest.xml`:

**ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION**
> IinPublic uses location to place members into a regional chat room and to
> support distance-based matching between members. The precise coordinate
> never leaves the device — it is rounded to a coarse (~2km) area on-device
> before anything is shared with other members or our servers. Location
> access is optional; declining it only disables region-based features.

**CAMERA**
> Used only when a member chooses to take a profile photo or scan a QR code
> to link a second device to their existing account. The camera is never
> accessed in the background or without an explicit user action.

**NEARBY_WIFI_DEVICES / BLUETOOTH_SCAN / BLUETOOTH_ADVERTISE / BLUETOOTH_CONNECT**
> IinPublic is a peer-to-peer app. These permissions let a device discover
> and connect directly to other nearby IinPublic devices to deliver messages
> without requiring an internet connection (e.g., mesh delivery when
> offline). They are declared to Android as "never for location" and are
> not used to determine or track a member's physical location.

**POST_NOTIFICATIONS**
> Used to notify members of new incoming talks, matches, and messages.

## Still to decide (not text, decisions)

- Whether to enroll TechSupport support-chat retention in a stated retention
  window (e.g., "support conversations are kept for N days") — currently
  undefined in code; pick a number if Play or a privacy-conscious reviewer
  asks, or state "retained as long as needed to resolve the request."
- Whether IPFS-backed chat attachments sent with `enc: 'none'` (unencrypted)
  are still reachable in the codebase's current attachment flow — if so,
  the Data Safety "Photos"/"Files" purpose description above should note
  that some attachments may not be end-to-end encrypted; worth a quick check
  of `web-content-node-service.ts` before finalizing that row. (Note: this
  doesn't change the "not collected by us" answer either way — IPFS
  attachments never pass through our servers regardless of encryption — it
  only affects whether *other IPFS network participants* could read an
  unencrypted attachment in transit.)
