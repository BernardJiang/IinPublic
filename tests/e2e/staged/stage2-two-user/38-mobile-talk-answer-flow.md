# Mobile Talk Answer Flow

User A (desktop) authors a flow talk via the same lower-level mesh-cache trick the fast-DM
setup helper uses (no talk-editor UI, since the point of this spec is B's mobile answer
dialog). User B (390x844 mobile viewport) receives it as a real incoming-talk cluster, seeded
through the same local-cluster-upsert code path a genuine mesh/mailbox delivery uses. B opens
the Talks tab, taps the incoming row's View button, and answers through the real response
modal by tapping the match radio button. The modal must fit the 390x844 viewport with no
horizontal page overflow and the answer options must be reachable within that width. Submitting
the match produces a real conversation, verified on both sides and via B's Me-tab conversation
list item.
