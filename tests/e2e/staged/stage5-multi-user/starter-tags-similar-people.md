# Find Similar People with Starter Tags

covers: SPEC-3.7, OPEN-87

**File:** `tests/e2e/staged/stage5-multi-user/starter-tags-similar-people.spec.ts`

## Scenario

1. **Six new users** (Ann, Ben, Cy, Dee, Eli, Fay) start at the same point, so they share one
   blurred region. Room capacity is 3 (`e2e_capacity=3`): each Nearby group holds 3 of the 5
   others. The intro tour is skipped with `skip_tour=1`.
2. **All 60 starter tags.** Each user opens Talks and sees the 60 English starter tags. They tap
   a pseudo-random 30 to like them, top to bottom; each tap passes the unanswered tags above it.
   The tags below the last pick are passed with Delete. Every tag ends up liked (`copied`) or
   passed (`ignored`), as picked.
3. **Broadcast.** Each user broadcasts their 30 likes to their Nearby group (the app's E2E
   broadcast path, without the audience preview). Every receiver has decided all 60 tags, so
   the receiver's chatbot answers every broadcast tag: a Like matches, a Pass passes.
4. **Feedback.** The chatbot's matches come back to the sender, and the receiver keeps the
   sender's tags. Either way, Contacts sorted by **Most tags in common** shows the true overlap
   for everyone a user exchanged with.
5. **Who is most similar.** The spec prints the 6×6 overlap matrix and each user's Contacts
   order, plus who is most similar overall (including people outside the user's exchanges).

6. **Friend and message.** Each user opens the top person in that list (their most similar), marks
   them a Friend, and sends them "we share lots of interests." The receiver's conversation with
   the sender shows the message.

Feedback takes minutes, not seconds: a phone admits 24 new Talks a minute from people who are not
its contacts (§3.7 "Balance", `incomingTalksPerMinute`), and each user receives up to 5 × 30.
Offers over the limit go unanswered and the sender's outbox offers them again, so the spec waits
up to 10 minutes for every count to settle.

Headed runs stay open on Contacts for 3 minutes at the end.

## Knobs

| Env | Default | Meaning |
|-----|---------|---------|
| `STARTER_SIMILAR_SEED` | `20261025` | Seed for the picks; the same seed repeats a run |
| `STARTER_SIMILAR_HOLD_MS` | `180000` headed, `0` in CI | How long the windows stay open at the end |
| `STARTER_SIMILAR_USERS` | `6` | Fewer users (2–6) for a quicker debugging run |
| `STARTER_SIMILAR_LIKES` | `30` | Tags each user likes |

The six windows sit side by side in one row (640 px each, 3,840 px in all).

## Assertions

- No intro tour is shown, and all 60 starter tags are listed for each user.
- Each user's 60 tags are decided exactly as picked: 30 liked, 30 passed.
- Each broadcast sends at least 30 Talks to exactly 3 receivers.
- Every person in a user's Contacts shows the number of liked tags they have in common, and
  each user knows at least 3 people. Who exactly cannot be predicted: at C = 3 the Nearby group
  keeps changing, and a newcomer to someone's group receives their active Talks without a new
  broadcast.
- Broadcasts keep delivery acks on, like the 📣 Broadcast button. Without them (an earlier
  version of this spec) a Talk lost between browsers was never sent again, and counts stayed
  short.
- Contacts are ordered by that count, and the top row is the most similar person the user knows.
- Each user's most similar person shows "Friend" in Contacts, and receives the message.
- No tag sent by a person waits in anyone's Incoming list: the chatbot matched the liked ones and
  passed the passed ones again (silently: a pass sends nothing back).

## Bugs this spec found (2026-10-25)

- **Chatbot replies stalled.** Before each response, the private chatbot-memory backup rewrote
  every remembered question (60 starter answers) as SEA writes. A broadcast fires one reply per
  matching tag at once, so replies queued for minutes and no feedback reached anyone. The backup
  now writes only what changed, one save at a time (`gun-chatbot-memory-repository.ts`).
- **Passed tags were never passed again.** The chatbot skips a passed ("suppressed") question,
  so a person's copy of a tag the user had passed stayed in Incoming. The chatbot now passes it
  again (`isPassedTag` in `app.ts`), sending nothing back.
