# 41 — Stats aggregation across all four talk types

covers: SPEC-3.9  <!-- auto-seeded; refine by hand -->

**What it proves:** The LOCAL talk-stats surface (per-talk `.talk-item-stats` line on the Talks tab
plus the aggregate status-bar match count) aggregates author-side response outcomes correctly for
all four talk types. The server `/api/stats` talk aggregates were removed; this replaces that
coverage against the local-ledger surface (`getTalkLedgerDoc().outcomes` → `needTalkStats` →
`talkStatsMap`).

**Flow:**
1. Bootstrap two users, StatsA (author) and StatsB (responder).
2. StatsA authors four talks — one of each type — with distinct question text so their
   content-hashed ids do not collide:
   - flow: "do you want to grab lunch together?"
   - tag: "rock climbing enthusiast"
   - survey: "how often do you travel abroad?"
   - route: "which neighborhood do you live in?"
3. StatsB answers each via `submitTalkResponsePairDirect` with a designated outcome:
   - flow → MATCH (isMatch answer)
   - tag → MATCH (checked item)
   - survey → NEUTRAL (an answer that is neither match nor ignore)
   - route → TERMINAL (a terminal answer that is neither match nor ignore)
4. StatsA drains its mailbox until all four responses are recorded locally.
5. StatsA opens the Talks tab, re-rendering so `needTalkStats` populates `talkStatsMap`.

**Assertions (anchored to `src/shared/talk-engine.ts checkIfMatch`, which only returns true for
flow/tag with an `isMatch` last answer):**
- flow: `{ responses: 1, matches: 1 }`
- tag: `{ responses: 1, matches: 1 }`
- survey: `{ responses: 1, matches: 0 }` (checkIfMatch is false for survey)
- route: `{ responses: 1, matches: 0 }` (checkIfMatch is false for route)
- Overall: 4 responses, 2 matches.
- `uiManager.getTotalMatches()` (status-bar aggregate) = 2.
- The rendered per-talk `.talk-item-stats` lines for flow ("Responses: 1 … Matches: 1") and
  survey ("Responses: 1 … Matches: 0") reflect the counts.
