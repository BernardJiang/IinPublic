# 08 — Nearby v3: personal lists and a gossip swap

Nearby v3 (`docs/design/nearby-and-place-chatrooms.md` §3.7). Two phone-like nodes in the same
square:

1. Each signs a Nearby card and sends it to the hub.
2. The hub introduces them to each other, so each one's personal list holds the other (distance 0).
3. Alice runs one gossip swap with Bob. Her phone knocks on Bob's signalling channel, Bob's phone
   opens its side of the link, and the swap crosses the real WebRTC link: Alice gets an answer and
   Bob counts one more answered swap.

One-sided lists (Bob does not list Alice) are covered by `src/test/unit/nearby-v3-link.test.ts`.
