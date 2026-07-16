# stage2/70 — Dirty-word message filtering (send + receive)

Covers TODO item **H** (redesign §9.1, catalog T9): the dirty-word filter applied
to direct messages in both directions.

Two matched users (fast-DM setup). Both sides start with the filter enabled and
the default word list (`fuck`, `cunt`, `bitch`, `cock`).

## What it verifies

1. **Send block.** User A types `you fuck` into the real conversation composer and
   clicks Send. The message is not sent: a toast with
   `data-content-filter-notification="send"` appears, the composer keeps the text
   (`you fuck`), and peer B receives nothing.
2. **Clean passes.** `hello there friend` sends and appears on B.
3. **Whole-word.** `lets grab a cocktail` sends and appears on B — "cocktail"
   does not trip "cock".
4. **Receive hide.** B disables its own filter and sends `you cock`. A (filter on)
   renders a collapsed `hidden-message-placeholder` row + a
   `data-content-filter-notification="receive"` toast, and never shows the raw
   text. The message still exists in the pair's Gun graph.
5. **Reveal.** A disables its filter; the previously hidden message becomes visible
   and the placeholder disappears.

## Notes

The sender is never told the receiver filtered them (receiver-side privacy). The
send-side block concerns only the sender's own outgoing content.
