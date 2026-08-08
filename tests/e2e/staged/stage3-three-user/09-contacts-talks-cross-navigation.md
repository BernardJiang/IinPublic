# 09-contacts-talks-cross-navigation

Covers three previously-missing pieces of the Contacts/Talks relationship, and the
navigation between them:

1. A match/mismatch outcome filter on the Contacts list (`#contacts-filter-outcome`).
2. A match/mismatch outcome filter on a contact's own talk-history list in the shared
   ⟨User⟩ layout (`.peer-outcome-tab`, alongside the existing sent/received direction
   filter).
3. A talk's "who responded, and did they match" list. `#creator-replies-panel` ("Replies
   To My Talks") already existed fully built — filterable, sortable, groupable by talk —
   but was permanently hidden (`display:none`, no trigger anywhere, tracked as TODO §M1).
   Surfaced it via a "View Responses (N)" button on each outgoing talk row's long-press
   details popup, scoped to that one talk.

And the cross-navigation: a talk's responses list → clicking a responder jumps to their
Contacts detail; a contact's own talk-history item (for a talk they authored) → clicking
its title jumps back to that talk's responses list, scoped. Both directions close/switch
away from whichever full-screen overlay was open first (the ⟨User⟩ layout is a separate
overlay from the tab panels, not hidden just by switching the bottom-nav tab underneath
it — an early draft of this spec caught that as a real bug, not a test artifact).

Setup: Tom creates "Book Club" and broadcasts it; Jerry creates "Chess" and broadcasts it.
Jerry answers Book Club as a match; Bob answers Book Club as a mismatch; Tom answers Chess
as a match. This gives Tom one contact with ≥1 match (Jerry, via both talks) and one with
zero matches (Bob, mismatch only) — enough to distinguish every filter state.

Assertions key off `data-contact-user-id`/`data-responder-id`, not display name — a
contact's name is best-effort self-healed from the live chatroom roster
(`ui-manager.ts`'s `getPeerName`) and can lag briefly right after an e2e bootstrap's
rename. That's a known, already-documented staleness window in the app, not something
this spec's own feature owns; matching by id sidesteps it rather than fighting it.
