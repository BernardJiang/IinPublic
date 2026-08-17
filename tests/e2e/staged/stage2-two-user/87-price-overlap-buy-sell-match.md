# Test: Reciprocal Buy/Sell Matching with Overlapping Price Ranges

covers: docs/TODO.md §BB ("price overlap" + "real cross-browser route matching")

**File:** 87-price-overlap-buy-sell-match.spec.ts
**Features tested:** `Talk.selfTag`/`preferenceSet` (spec §30.2, replaces the earlier
`Talk.role` binary), `Question.builtIn` typed `priceRange` comparison via `intervalsOverlap`
(spec §30.3), chatbot exact-question-text auto-reply, two independent talk-level matches
between the same pair landing in one conversation thread.

---

## Scenario

Adam wants to buy a used iPhone for $500–600 and sell his used notebook for $300–400. Eve is
the mirror image: selling a used iPhone for $550–650, buying a used notebook for $350–450.

Both pairs of ranges **overlap without being identical** — deliberately: $500–600 and $550–650
share only $550–600; $300–400 and $350–450 share only $350–400. Using identical ranges would
make this indistinguishable from ordinary exact-text matching; the point of `builtIn.priceRange`
is that it's a real numeric interval-overlap comparison, not string equality.

Each talk is a single-question `type: 'flow'` talk (a DAG/route talk turned out unnecessary — see
the file header) — one terminal `builtIn` `priceRange` question, with the title and question text
already naming the item unambiguously ("Used iPhone Deal" / "Used Notebook Deal"). One
question/answer pair encodes item+price as one declarative sentence pair rather than separate
structured criteria fields, exactly the shape 86-builtin-quantity-match.spec.ts already proves.

Adam's two talks declare `selfTag: 'buy'`/`'sell'`; Eve's complementary talks auto-derive their
`preferenceSet` from the same seeded `tag-opposite-pairs.ts` registry (buy⇄sell) the talk
editor's tag-pair preview already uses. Only Adam broadcasts — Eve's two talks exist purely to
seed her own typed-preference store (the `resolveBuiltInQuestion` scope-key lookup needs her own
declared price on file to resolve Adam's incoming builtIn question), mirroring how the dealmaker
and taxi specs have each stranger create their own talk before ever broadcasting or meeting.

**Both users bootstrap (join the shared Global room) before either creates a talk** — required,
not stylistic. The app's late-joiner catch-up (`broadcastPendingTalksOnRoomEntry`, `app.ts`)
auto-delivers a member's already-created, not-yet-explicitly-broadcast talks to any peer who
later *joins* the room, ~350ms after they join. If one side created its talks first and the
other bootstrapped afterward, the second side's join would be a genuine "late joiner relative to
an existing unsent talk," triggering that catch-up before it had a chance to create its own
complementary talk or enable its own chatbot — a real, reproduced race (chatbot-disabled and
no-self-answer-yet incoming talks have no retry), not a hypothetical one. Bootstrapping both
first, exactly like 86-builtin-quantity-match.spec.ts and 04-dealmaker-chatbot-match.spec.ts
already do, means neither side is ever a "late joiner" relative to the other's talks.

### Verifications

- ✅ Adam and Eve end up with a conversation with each other, checked from both sides.
- ✅ Despite two independent talk-level matches forming (iPhone side and notebook side),
  exactly one conversation thread exists between them — `createConversation` keys on the user
  pair, not per-talk.
- ✅ Zero manual clicks anywhere — the chatbot resolves both directions purely from each side's
  own typed preference + self-answer history.

**Helpers used:** `bootstrapUser`, `broadcastFromGlobalChatroom`,
`submitTalkEditorAndWaitForOut`, `openSettingsSection`/`SETTINGS_SECTION.talkBehavior`,
`clearGunForStage2Spec`.
