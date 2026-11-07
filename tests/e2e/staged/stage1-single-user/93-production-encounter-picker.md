# 93-production-encounter-picker

covers: SPEC-6.1, SPEC-12.4

The website's encounter location in a production bundle — the path real website users take.
Location refused: the person is placed at a random point as a Traveler ✈, in Nearby (never
Contacts only), and asked to pick; the typed point is saved and Nearby resolves from it. Location
allowed: a Resident at the browser's fix, no encounter point and no picker. Both people share the
one Nearby room. Needs a production dist/web served statically
(`npm run test:e2e:production-web`).
