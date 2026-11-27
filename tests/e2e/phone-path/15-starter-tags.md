# Phone path 15 — starter tags across two phones
covers: SPEC-3.7, OPEN-87

Ann is on phone A and Ben on phone B. Both opt back into the starter tags (the harness turns them
off for ordinary specs) and decide all 60: each likes 30 picked by a fixed seed and passes the rest.

**J-TAGS-01:** each one's Contacts lists the other with exactly the number of liked tags they have
in common (15 with the default seed), ranked first. Checked on both phones.

The browser version is `staged/stage5-multi-user/starter-tags-similar-people` and the real-phone
one `native-app/43`; all three use `tests/e2e/journeys/starter-tags-shared.ts`.
Added 2026-11-26 (OPEN-121). First runs: both Contacts settled 6–13 s after deciding.
