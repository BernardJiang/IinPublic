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
| Photos, videos, files (talk/chat attachments) | **No** | No | Sent directly device-to-device over IPFS (a peer-to-peer file network), not through our servers | Yes | N/A — never held by us |
| Messages (in-app chat) | Yes* | No | App functionality (talks and post-match conversations) | N/A (core feature) | Local-only storage; see note below |
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
