# 15 — Nearby audience shapes at C = 3 (OPEN-86 E5)

Eight browser users arrive one at a time with a page size of three, so the first San Diego user
passes through every Nearby audience shape from §3.7:

1. **Everyone fits** — three, then four people in two cities: every other person is on the only
   page, and there is no paging action (`2 nearby · 3 online`, then exactly `3 nearby · 4 online`).
2. **Sparse area** — a fifth person: more than three people online, but only two in San Diego. The
   page is the nearest three worldwide and still has no page 2 (`3 nearby · 5 online`). With a third
   San Diego neighbor (exactly three in the area) the page is all San Diego, still one page.
3. **Crowded area** — four others in San Diego plus one person 1.5 km away in another cell:
   `4 nearby · 8 online`, "Meet new people" shows page 2 (the one remaining San Diego person) and then
   disappears. A Los Angeles user stays on the sparse fallback. On the map, all four San Diego people
   are green (including the one on page 2) and the person 1.5 km away is yellow.
4. **Travel and area size** — the first user travels to Los Angeles: back to group 1, a sparse
   audience there. A second San Diego user chooses the 50 km area in Settings: their area now holds
   four others and pages, while a neighbor with the 1 km area still does not (one-way eligibility).
