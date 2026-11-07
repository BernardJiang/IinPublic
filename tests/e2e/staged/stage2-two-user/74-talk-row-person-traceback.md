# 74-talk-row-person-traceback

covers: SPEC-26.1, SPEC-26.2

Verifies person traceback from Talks rows: who did I exchange this talk with, then DM them.
On an OUT row, clicking the matched-names line opens that responder's person page (peer-detail
overlay), from which the DM thread opens on the correct conversation with the right
`otherUserId`. On an IN row, the sender line in the row's details popup (long-press) navigates
to the sender's person page without opening the talk response view. With two matched responders,
clicking the matched line opens a "choose who to DM" picker listing both, and picking one opens
that person's DM thread.
