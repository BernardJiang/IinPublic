# Actionable First Run and Starter Talks

Status: implementation design, 2026-09-27
Tracking: `OPEN-32`

## Product goal

A person who has just installed IinPublic should reach a useful, personal Talk draft before being
asked to learn the app's information architecture. The first prompt is therefore not “here are the
tabs,” but:

> What do you wish you didn't have to repeat?

The guide makes IinPublic's value concrete: say something once, approve the words, and let the app
repeat those words when appropriate. It does not claim that AI will invent an answer, and it does
not save, publish, broadcast, or message anyone automatically.

## First-run flow

The automatic guide is three short, mobile-first steps:

1. **Say it once. Let IinPublic repeat it.** Explain the promise and the approval boundary.
2. **What do you wish you didn't have to repeat?** Choose one of six starter Talks or enter a
   custom prompt. Selection and custom text remain local UI state.
3. **You stay in control.** Preview the choice and choose **Review my first Talk**. This opens the
   normal editor with a draft. Only the editor's existing **Create** action persists it.

Skip, close, backdrop, and Escape dismiss the guide. Completion or dismissal sets the versioned
device-local `iinpublic_actionable_guide_seen_v1` flag. The legacy
`iinpublic_walkthrough_seen=true` flag also suppresses automatic display, so existing users are not
treated as brand-new users after upgrading.

The last step also offers **See how IinPublic works**. It temporarily opens the existing six-slide
product introduction and returns to the guide with the user's selection intact when closed.

## Reference introduction

The six slides about Chatrooms, Talks, Contacts, Me, Settings, and the product's principles remain
available, but do not appear automatically. Settings → Help & Tour contains two durable actions:

- **Create a starter Talk** opens the actionable guide at any time.
- **How IinPublic works** opens the reference slides at any time.

Viewing the reference introduction does not change the actionable-guide seen flag.

## Starter catalog

Catalog version 1 features six editable examples, ordered from the smallest concept to richer
real-life routes:

1. Shared Interest — tag
2. Activity / Meetup — flow
3. Quick Community Poll — survey
4. Buy / Sell — route
5. Job Seeker / Hiring — route
6. Lost & Found — route

Taxi, Dating, Roommate Search, Pet Sitting, and Study Buddy / Tutoring remain in the full template
picker under **More templates**. Builders return fresh drafts and include the current English or
Chinese locale; they contain no author, ID, timestamp, delivery target, or broadcast state.

When there is no incoming or outgoing Talk history, the Talks tab displays the six featured
starters plus **More templates** and **Start from scratch**. Once any Talk history exists, filters
that happen to produce zero visible rows show the ordinary empty-filter state instead of the
starter shelf.

## TechSupport boundary

The signed, verified welcome greeting remains a useful first contact. New installations no longer
receive five synthetic tab-tip messages in that conversation; education belongs in local UI, not
in apparent messages from a person. Existing signed tip bundles and their verifier stay in the
codebase so previously stored messages remain authenticatable.

## Accessibility and acceptance

- English and Chinese copy are first-class.
- Dialog focus is trapped, Escape closes, focus is restored, controls have names and 44px mobile
  targets, and the card grids collapse to one column on narrow screens.
- Unit tests cover catalog safety/localization, choice retention, draft-only completion, Settings
  entry points, and empty-state behavior.
- Browser E2E covers first launch, starter/custom choice, reference-tour return, editor review,
  persistence of the seen gate, and 320px layout. Android reuses the same web runtime; its normal
  release matrix provides the final physical-shell acceptance when hardware is available.
