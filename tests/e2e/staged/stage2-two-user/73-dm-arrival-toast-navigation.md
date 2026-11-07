# 73-dm-arrival-toast-navigation

covers: SPEC-26.1, SPEC-13.3

Verifies that a DM-arrival toast is clickable and navigates to the conversation with the sender.
Jerry leaves the conversation for an unrelated tab so the arriving message isn't suppressed by
the "already viewing" check; the toast fires only on a genuine message delta (the first message
seeds the notification baseline silently). Clicking the "New message from …" toast opens the
conversation-detail overlay showing the newly arrived message — the same land-on-the-conversation
destination every other click-to-a-person surface uses, rather than just dismissing.
