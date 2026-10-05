# 91 — TechSupport recovery anchor: stale-cache catch-up (OPEN-29)

Signs real recovery-anchor records in the test process (key from `.env.local`,
`TECHSUPPORT_RECOVERY_SEA_PAIR_JSON`; the spec skips without it) and checks the browser cache
`iinpublic_techsupport_recovery_anchor_v1` end to end:

1. The relay holds a record stamped "now". A browser that boots with an hour-older record in its
   cache replaces it with the relay's record.
2. A browser that boots with an hour-NEWER record keeps it through several relay-poll ticks and a
   reload, so the relay can never roll local trust backward.
3. A record published while the first browser runs reaches it (live Gun subscription or the 5 s
   HTTP relay poll).
4. Re-posting the earlier record to the relay returns 409.

Only "now" records are posted, and none revoke a key, so the relay's durable store stays
monotonic across reruns and other specs' trust is unchanged.
