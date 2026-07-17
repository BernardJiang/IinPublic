# 74-conversation-mode-auto-manual

covers: SPEC-7.6, SPEC-12.3

Spec §7.6 rule: "Even in Auto mode the chatbot never repeats manual answers."

Single user drives `showTalkResponseDialog` directly with synthetic flow talks:

1. Answering with the **manual** radio must keep the question OUT of exact chatbot
   memory, and a later talk with the same question text must render the question
   (no auto-completion).
2. Answering with the **auto** radio must record the question in exact chatbot
   memory, and a later talk with the same question must auto-complete without
   showing the dialog.

Closes the previously untested §7.6 anchor (coverage-matrix gap list, Part 3 P0 #2).
