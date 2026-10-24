# 14 — 20 users: one tag per page in Nearby, a Place and another city

Fourteen users in San Diego and six in Los Angeles, page size C = 3. Every San Diego user sees
`13 nearby · 20 online`, every Los Angeles user `5 nearby · 20 online`.

The first San Diego user then exchanges one tag Talk per page:

1. **Nearby, San Diego:** `page1` … `page5` on pages of 3, 3, 3, 3 and 1 people.
2. **A Place:** the first user creates a custom room and five others enter it
   (`5 nearby · 20 online`, occupancy minus me). `custompage1` (3 people) and `custompage2` (2).
   Someone outside sees the Place on the map as one icon with its occupancy, 6.
3. **Los Angeles:** the first user travels there (`6 nearby · 20 online`): `LAPage1` and `LApage2`,
   three Los Angeles people each.

For every tag: each person on the current page receives it and likes it, the author collects
exactly those likes (one match conversation per person), and after a pause no one else among the
20 holds that tag. A broadcast carries all of the author's active Talks and each new page catches
up on them, so an older tag may reach people met later, but never anyone the author has not had
on a page.

This run found that catch-up sent the author's Talks to anyone who opened a link to them — someone
whose own page held the author, although the author's did not hold them. Catch-up in Nearby and
Places now goes only to the author's current list (`isCatchUpRecipient`).
