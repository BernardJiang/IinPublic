# 69 — Matched-talk threads

covers: SPEC-3.6, SPEC-3.4, SPEC-7.6  <!-- auto-seeded; refine by hand -->

Per-talk Thread pages (gui-redesign-plan §5, T8) with two users. The matched
conversation is seeded through the app's own conversation service (the same records a
real match produces — the full match round-trip is covered by 00e and the
talks-matching suites).

1. **Thread rows** — the User layout's messaging area lists one email-style row per
   matched talk (title from the talk) plus the DM entry row.
2. **Thread page** — opening a row shows the shared Conversation component scoped to
   the talk (`#conversation-thread-scope` shows the title) with a working reply
   composer; back returns to the User layout and the row snippet updates.
3. **Isolation, sender side** — the DM thread never shows thread replies; a DM sent
   afterwards stays in the DM thread.
4. **Isolation, receiver side** — the peer sees the thread reply only inside that
   talk's Thread page, and the DM text only inside the DM thread.
