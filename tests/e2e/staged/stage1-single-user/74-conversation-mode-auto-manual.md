# 74-conversation-mode-auto-manual

covers: SPEC-7.6, SPEC-12.3

Spec §7.6 rule: "Even in Auto mode the chatbot never repeats manual answers."

Single user drives `showTalkResponseDialog` directly with synthetic flow talks:

1. Answering with the **manual** radio keeps the answer out of what the chatbot reuses (the
   device graph remembers it as Just once), and a later talk with the same question text must
   render the question (no auto-completion).
2. Answering with the **auto** radio makes it an answer the chatbot reuses, and a later talk with
   the same question opens pre-filled for one Confirm.
3. Answering Apple with **Whenever offered** puts Apple on the question's Whenever offered list
   (`ix/whenever`) rather than remembering one choice set. It pre-fills Apple for Carol's Banana/Apple set and for a four-choice set.
4. Changing the broad choice to Kiwi stores the deterministic priority `[Kiwi, Apple]`: Kiwi is
   used whenever available, Apple remains the fallback, and an unrelated set still asks the user.

Closes the previously untested §7.6 anchor (coverage-matrix gap list, Part 3 P0 #2).
