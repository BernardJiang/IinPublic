# First-run Demo Contacts and Starter Talks

Status: implementation design, revised 2026-10-24 (starter interest tags)
Tracking: `OPEN-32`, `OPEN-87`

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

Completion or closing sets `iinpublic_actionable_guide_seen_v1` and then opens the **Talks** tab on
the incoming list, where the starter interest tags come first (below). Existing users are not enrolled
retroactively: enrollment occurs only when the identity has no real Talks, contacts, or non-support
conversations. Enrollment state is stored per user ID, so answering the first Talk does not make
the remaining demo contacts disappear.

## Starter interest tags (OPEN-87)

After the introduction (finished or skipped) the user lands on the Talks tab. The incoming list
starts with about 24 **starter interest tags** (🥾 Hiking, ☕ Coffee, 📚 Books, …), followed by the
demo contacts' Talks below. The demo Talks come last on purpose: once the user has liked a few
interests, the Tag Guide and the other guides lead to the next step, creating their own Tags.

- **Ordinary incoming tags.** A starter tag is a normal single-keyword `tag` Talk rendered by the
  normal incoming list. Its only difference from a tag received from a nearby person is that no
  person sent it: it comes from a local starter source that is not a Contact (no Demo bot row), so
  answering it sends no response and creates no exchange record or Contact.
- **Answering uses the normal logic.** Like records the answer, teaches the chatbot its answer for
  that content (`saveChatbotTemplate`), and auto-copies the tag into My Talks (tags copy on answer;
  `copyTalkAutoSave` default on). The copy is the user's own Talk: it carries no starter marker, so
  it is delivered to the Nearby list like any active Talk and receivers answer it normally. Pass
  records an ignore, which the chatbot repeats for that content later.
- **Matching identical tags.** A starter tag has one canonical form in every UI language (type
  `tag`, language `en`, the English keyword); the UI shows the localized label by catalog id. All
  copies therefore share one content identity key: when Bob's copy of 🥾 Hiking reaches Alice, who
  liked the same starter, her chatbot answers it from the stored template, the tag matches, and they
  become Contacts exactly as with any tag match today.
- **One-tap answering.** Tapping a tag likes it: the chip moves right, then down into a **My tags**
  tray. Tags above it that were scrolled past without a tap are passed and fly left, then up off the
  screen; reaching the end passes the rest. Swipe right likes, swipe left passes; tapping a tray chip
  undoes a like. Two-step transforms of about 250 ms; with reduced motion the chips fade. The same
  list behaviour is meant for every incoming tag later, not only starter tags.
- **Catalog.** `src/shared/starter-tags.ts`: about 24 interest tags `{ id, emoji, en, zh }` with a
  version. Interests only; buy/sell intents stay in TODO2 (DRAFT-OPEN-82).
- **After matches** the user travels a person↔tag graph built from local data, in any order: a tag
  page lists who likes the tag (senders of that tag ∪ people who liked my copy); a person page lists
  their tags, shared first; a tag directory lists every known tag with its local like count.

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

- Starter interest tags (OPEN-87): unit coverage for canonical identity keys across UI languages,
  starter answers sending nothing and creating no Contact, the chatbot template on Like, copies
  without the starter marker, and the like/pass ordering; a journey where five users like
  overlapping starter tags and Talk exchange matches exactly the shared ones.
- Unit coverage validates all seven seeded Talks, per-user enrollment, localization, removal,
  ordinary Q&A persistence, outgoing-filter isolation, and contact rendering.
- Browser coverage checks the direct first-run introduction, the opening repeat promise, simple
  navigation, seven incoming Talks, four removable demo contacts, persistence, and 320px layout.
- Android and iOS use the same web runtime; one phone is enough for final shell smoke testing.
