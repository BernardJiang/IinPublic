# First-run Demo Contacts and Starter Talks

Status: implementation design, revised 2026-10-03
Tracking: `OPEN-32`

## Product promise

> Say it once. Let your digital you repeat it.

A new user should not face an empty Talks list or be asked to understand the Talk editor before
experiencing the product. IinPublic therefore enrolls a new local identity with four removable
demo contacts. Each contact sends ordinary incoming Talks of one type. The user learns the real
interaction model by answering, copying, or ignoring them; there is no separate tutorial wizard
or multi-step instructor state machine.

This follows established interaction guidance: suggested actions reduce typing and make available
choices explicit, while one-question-at-a-time flows reduce cognitive load.

- https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-add-suggested-actions
- https://design-system.service.gov.uk/patterns/question-pages/

## First run

First run opens the product introduction directly. The first slide leads with **Build your digital
you** and **Say it once. Let your digital you repeat it.** Later slides introduce Chatrooms, Talks,
Contacts, Me, and Settings. Back and Next move through the deck; the window close icon is the only
early-exit control. A new user is never asked to choose between unfamiliar product paths.

Completion or closing sets `iinpublic_actionable_guide_seen_v1`. Existing users are not enrolled
retroactively: enrollment occurs only when the identity has no real Talks, contacts, or non-support
conversations. Enrollment state is stored per user ID, so answering the first Talk does not make
the remaining demo contacts disappear.

## Demo contacts

The Contacts tab shows four clearly marked **Demo bot** rows:

1. **Tag Guide** sends simple Tags and complementary Tag pairs.
2. **Flow Guide** sends a short sequential Flow.
3. **Survey Guide** sends an aggregatable Survey.
4. **Route Guide** sends a branching Route.

Each row explains the single Talk type it sends and has a visible **Remove** action. Removal is
permanent for that local identity and removes the contact's still-pending seeded Talks. Answers
already given remain in the user's Q&A history.

The demo contacts are local fixtures, not network identities. Their Talks pass the same validator,
render in the same incoming list, and use the same answer/copy/ignore controls as Talks from real
people. Completion updates the normal answer-preference and flat Q&A stores, so Me shows questions
and answers—not Talk cards. The final peer-delivery step is skipped because no remote demo identity
exists.

## Seed catalog

The initial catalog is intentionally small:

- Tag Guide: Weekend hiking, Language exchange, mentoring pair, hiring/job-seeking pair.
- Flow Guide: Meet for coffee? (interest, then availability).
- Survey Guide: Which activity do you prefer?
- Route Guide: Find an activity that fits (indoor/outdoor branches).

All content is available in English and Chinese. IDs are content-derived and stable. The catalog
can be versioned later without changing the behavior of existing enrolled users.

## Visibility rules

- Seeded items are incoming Talks and respect the normal Incoming and type filters.
- Completion/outcome filters apply only to incoming rows; they must never hide newly authored
  outgoing Talks.
- Saving a newly created Talk turns on Outgoing, enables its type, and clears stale text/date
  filters so the user immediately sees what they created.
- Me remains a flat question/answer history regardless of whether an answer came from a real
  contact, a demo contact, or the user's own authored Talk.

## Product language

User-facing positioning is **Build your digital you**, not **Build your own bot**. The exact repeat
promise is **Say it once. Let your digital you repeat it.** “Bot” remains only as the concise badge
that distinguishes removable demo contacts from real people.

## Acceptance

- Unit coverage validates all seven seeded Talks, per-user enrollment, localization, removal,
  ordinary Q&A persistence, outgoing-filter isolation, and contact rendering.
- Browser coverage checks the direct first-run introduction, the opening repeat promise, simple
  navigation, seven incoming Talks, four removable demo contacts, persistence, and 320px layout.
- Android and iOS use the same web runtime; one phone is enough for final shell smoke testing.
