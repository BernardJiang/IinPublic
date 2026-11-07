# 37-compact-talk-rows-out

covers: SPEC-26.2, SPEC-3.6

Outgoing flow/survey/route rows in the Talks list collapse to 2 visible lines — a header
(broadcast checkbox, type icon badge, title, chevron) and a status-line summary — with no
dedicated action-icon row. Delete is a swipe-left gesture, details is a long-press opening the
item-details popup (which now also hosts the survey-results entry), and the broadcast toggle is a
real checkbox firing on 'change'. Verifies the collapse, the popup round-trip, the checkbox
toggle classes, survey stats reachable from the popup, and swipe-to-delete.
