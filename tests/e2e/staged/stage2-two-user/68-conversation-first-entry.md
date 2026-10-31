# 68 — Person-first entry

covers: SPEC-7.6, SPEC-19.4  <!-- auto-seeded; refine by hand -->

Person-first entry (OPEN-94, docs/design/nearby-and-place-chatrooms.md "Four tabs as graph
views", which superseded redesign rule N2a) with two users:

1. **Member entry (C3)** — clicking a chatroom member row opens the person page ⟨User⟩; the
   conversation does not open by itself. Message is explicit: a DM sent from the person page's
   composer, then its DM thread row opens ⟨Conv⟩ (no talk scope line).
2. **Back chain** — back pops Conversation → User layout (thread list shows the DM row)
   → opener (room detail).
3. **Contact entry (K1)** — the peer clicking the contact row lands on the same person page; the
   pair share one `conv_pair_…` thread: a DM sent from the member-entry side is visible from the
   contact-entry side, and both sides hold the same conversation id.
4. Back chain on the contacts side ends at the Contacts list.
