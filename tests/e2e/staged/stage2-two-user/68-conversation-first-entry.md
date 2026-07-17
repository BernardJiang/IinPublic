# 68 — Conversation-first entry

covers: SPEC-7.6, SPEC-19.4  <!-- auto-seeded; refine by hand -->

Rule N2a (gui-redesign-plan §5/§7, T8) with two users:

1. **Member entry (C3)** — clicking a chatroom member row opens the DM ⟨Conv⟩ directly,
   with the shared ⟨User⟩ layout underneath (two levels pushed in one action); the DM
   thread shows no talk scope line.
2. **Back chain** — back pops Conversation → User layout (thread list shows the DM row)
   → opener (room detail).
3. **Contact entry (K1)** — the peer clicking the contact row lands on the identical
   destination; the pair share one `conv_pair_…` thread: a DM sent from the member-entry
   side is visible from the contact-entry side, and both sides hold the same
   conversation id.
4. Back chain on the contacts side ends at the Contacts list.
