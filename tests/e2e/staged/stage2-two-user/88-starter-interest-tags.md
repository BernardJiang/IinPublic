# Test: Starter interest tags

covers: OPEN-87 (docs/design/actionable-first-run-starter-talks.md)

**File:** `88-starter-interest-tags.spec.ts`

Starter interest tags are ordinary incoming tags with no sender. A fresh identity re-enables the
starter seeds the harness turns off for ordinary specs.

## 1. One tap likes a tag and passes the ones scrolled past

1. Una opens Talks and taps ♡ on the third starter tag.
2. The two tags above it fly left and up (passed); the tapped one moves right and down (liked).
3. The liked tag is copied into My Talks as Una's own Talk: her id as author, no starter marker,
   same content identity key. The two above are passed; tags below are untouched.
4. Nothing is sent and no Contact or conversation appears.

## 2. Same starter tag, ordinary Talk exchange, a match

1. Alice and Bob like 🥾 Hiking; Carol likes ☕ Coffee, which passes Hiking above it.
2. Bob sends his Talks as Broadcast does.
3. Alice's chatbot answers Bob's Hiking from her own Like: both have a match.
4. Bob's Hiking reaches Carol; her chatbot passes it from her pass, and she has no match.

## 3. Travel the person↔tag graph

From Alice's side: Contacts → 🏷️ Tags → search "hik" → 🥾 Hiking (marked as hers) → the tag page
says "In your tags" and lists Bob → Bob's person view lists his tags with Hiking marked shared →
tapping it opens the Hiking tag page again.
