# 79-compact-talk-row-in

covers: SPEC-13.1, SPEC-3.6

An incoming talk row collapses to 2 visible lines: a header (direction/type icon badge, title,
chevron) and a status-line summary (time · sender count · location · question progress). No
View/Details icon buttons — the title itself is the tap target that opens the response flow, and a
long-press (no drag) opens the same details popup the old ℹ️ button did, with full sender identity,
chip row, and co-exchanged people moved off the row but not dropped. Driven by a real flow talk
broadcast from a second user.
