# 70-reply-triage-grouping-multi

Covers TODO item **F** (catalog Part 5 option matrix).

3-responder reply matrix: none/responder/talk grouping partitions the same 9 replies.

Seeding: the replies panel derives rows from the creator's `localTalkExchanges`
store (P0 step 5 — pair-edge records, no server call), so the spec seeds one
`direction: 'sent'` exchange record per talk × responder directly in the
creator's browser instead of importing a server snapshot (the snapshot path
feeds `talkResponsesMap`, which the local reply panel no longer reads — same
reason 00v/00ad are excluded from the default shard).
