# 60 — Peer/contact layout parity

covers: SPEC-7.9  <!-- auto-seeded; refine by hand -->

Unified detail (gui-redesign-plan §5, T5): the chatroom-member entry and the
contact-row entry land on the identical shared ⟨User⟩ layout.

1. Both entries produce the same structural fingerprint: same body sections in the
   same order (context → stats → messaging → talk history), same header AppBar with
   📤, same peer name.
2. The retired `#contact-detail-container` page no longer exists in the DOM.
