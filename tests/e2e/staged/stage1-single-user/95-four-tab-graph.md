# Test: Four tabs as graph views

covers: OPEN-94 contextual graph traversal

**File:** `95-four-tab-graph.spec.ts`

A single browser at 390px uses deterministic GUI/core-view fixtures for a Flow-only peer, an
answered Flow, an answered tag, and exchanges in Nearby plus an unlisted historical Place.

- Follows all 12 directed tab pairs through rendered links, with scoped destination assertions.
- Verifies relationship navigation opens Contacts without opening a conversation.
- Checks Our Talks/My answers for a peer with no tags and restores the person through nested Back.
- Checks every tag Place is selectable; historical inspection does not change the active room.
- Checks keyboard activation follows the answer mark rather than acting on its parent tag.
- Checks phone-width layout and writes temporary screenshots for visual inspection.

Uses existing core collection edit hooks and the app exchange-recording method; no legacy
localStorage fixture schema and no physical phone required.
