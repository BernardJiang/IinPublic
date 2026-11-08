# Phone path 12 — signed exchange chain and tamper report
covers: SPEC-31.13, SPEC-31.9

OPEN-108 on the phone route (journey J-GRAPH-01/02, `tests/e2e/journeys/signed-exchange-chain-journey.ts`).
Alice uses a phone node the spec starts on a kept data dir; Bob is on phone B. They exchange a
Talk and its matching answer through the app (the shared talk-match-chat journey). Then each
phone's `graph.status` shows its own event chain verified (`chain.ok`) and the other phone's
signed acknowledgement of its log on the link between them (`lastAck` with `skewMs`).

Alice's page and phone node are then stopped, one of her own chained Talk events
(`local/ev/<talkId>`, found by her device id) has its `title` rewritten in the node's `radata`
on disk, and both are started again on that data. The restarted core reports exactly one break
at that event's seq, by its signature (`reason: 'sig'`), and the rewritten value is still what
the phone stores: reported, never repaired. The web version is stage2/97; real phones run
native-app/39.
