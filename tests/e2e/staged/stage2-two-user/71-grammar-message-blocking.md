# stage2/71 — Grammar message filtering (send + receive)

Covers TODO item **H** (redesign §9.2, catalog T9): the grammar filter applied to
direct messages in both directions, driven by `assessGrammar` vs
`CONFIG.GRAMMAR_THRESHOLD` (0.7).

Two matched users. The dirty-word filter is disabled throughout so the grammar
filter is isolated.

## What it verifies

1. **Send block.** A below-threshold message (heavily repetitive) typed into the
   composer is not sent: a `data-content-filter-notification="grammar-send"` toast
   fires, the composer keeps the text, and peer B receives nothing.
2. **Good grammar passes.** A well-formed sentence sends and appears on B.
3. **Receive hide.** B disables its own filter and sends the bad message. A
   (grammar on) renders a `hidden-message-placeholder` row + a
   `data-content-filter-notification="grammar-receive"` toast, never the raw text.
4. **Reveal.** A disables its filter; the hidden message becomes visible and the
   placeholder disappears.
