# Actionable First Run and Starter Talks

Status: implementation design, revised 2026-10-03
Tracking: `OPEN-32`

## Product goal

A person who has just installed IinPublic should experience the chatbot before being asked to
author its data model or learn the app's information architecture. The first prompt is therefore
not “create a Talk from scratch,” but:

> Build your own bot—one answer at a time.

The guide makes IinPublic's value concrete: accept or reject a realistic incoming Talk, approve an
answer, and then see that answer reused when the same exact question returns. It does not claim
that AI will invent an answer. Practice Talks are explicitly local-only: they never sync, publish,
broadcast, submit to a peer, or create a fake contact/conversation.

The interaction follows established conversational and service-design guidance: Microsoft
documents suggested actions as a way to answer by tapping instead of typing and recommends a small
set of context-specific next steps; the GOV.UK question-page pattern recommends one focused
question at a time and carrying forward information users have already supplied.

- https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-add-suggested-actions
- https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/suggested-actions
- https://design-system.service.gov.uk/patterns/question-pages/

## First-run flow

The automatic guide is three short, mobile-first steps:

1. **Build your own bot—one answer at a time.** Explain the promise and approval boundary.
2. **Which practice bot should teach you first?** Choose one of three instructors, or enter a
   custom prompt. Selection and custom text remain local UI state.
3. **Your bot follows your answers.** Preview the choice and choose **Start**. A practice choice
   opens a local incoming Talk; custom text still opens the normal editable Talk draft.

Skip, close, backdrop, and Escape dismiss the guide. Completion or dismissal sets the versioned
device-local `iinpublic_actionable_guide_seen_v1` flag. The legacy
`iinpublic_walkthrough_seen=true` flag also suppresses automatic display, so existing users are not
treated as brand-new users after upgrading.

The last step also offers **See how IinPublic works**. It temporarily opens the existing six-slide
product introduction and returns to the guide with the user's selection intact when closed.

## Reference introduction

The six slides about Chatrooms, Talks, Contacts, Me, Settings, and the product's principles remain
available, but do not appear automatically. Settings → Help & Tour contains two durable actions:

- **Practice building my bot** opens the actionable guide at any time.
- **How IinPublic works** opens the reference slides at any time.

Viewing the reference introduction does not change the actionable-guide seen flag.

## Practice instructors

The three-card limit keeps the first decision small while covering all five Talk primitives over
six short exercises:

1. **Builder Bot** — a Simple Tag followed by a complementary Pair Tag.
2. **Echo Bot** — two Flows with an identical root frame; the second reuses the approved root
   answer and asks only its new follow-up.
3. **Pathfinder Bot** — a Survey followed by a branching Route.

When an instructor has another step, it opens that step immediately after completion. This is most
visible in Echo Bot: its second Flow reuses the first approved answer, briefly explains the reuse,
and advances directly to the one new question.

Each generated Talk carries `practiceOnly: true`, the synthetic
`iinpublic-practice-guide` author ID, and versioned bot/step metadata. Completion is retained only
to show instructor progress and to teach local exact-answer memory. Practice records are excluded
from real Talk lists, answered-by-content indexes, normal answer history, peer delivery, profile
sync, chatbot response submission, and contact/conversation creation.

When there is no real incoming or outgoing Talk history, the Talks tab displays the three practice
instructors with start/continue/completed progress. **Build from a template** and **Build from
scratch** remain beside them, so demonstration leads directly into authoring rather than replacing
it.

## Authoring template catalog

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

Once any real Talk history exists, filters that happen to produce zero visible rows show the
ordinary empty-filter state instead of the practice shelf.

## TechSupport boundary

The signed, verified welcome greeting remains a useful first contact. New installations no longer
receive five synthetic tab-tip messages in that conversation; education belongs in local UI, not
in apparent messages from a person. Existing signed tip bundles and their verifier stay in the
codebase so previously stored messages remain authenticatable.

## Accessibility and acceptance

- English and Chinese copy are first-class.
- Dialog focus is trapped, Escape closes, focus is restored, controls have names and 44px mobile
  targets, and the card grids collapse to one column on narrow screens.
- Unit tests cover valid/localized practice Talks, exact-frame reuse, progress, local-only
  completion, choice retention, Settings entry points, and empty-state behavior.
- Browser E2E covers first launch, practice/custom choice, reference-tour return, the local-only
  response dialog, persistence of the seen gate, and 320px layout. Android reuses the same web
  runtime; its normal release matrix provides the final physical-shell acceptance when hardware
  is available.
