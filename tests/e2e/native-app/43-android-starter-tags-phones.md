# 43 — Starter tags on real phones

covers: SPEC-3.7, OPEN-87, OPEN-112, OPEN-113

The browser spec `staged/stage5-multi-user/starter-tags-similar-people` on 2–6 real phones
(4 is the usual run), with no test-only broadcast: on phones likes go out as they are made.

1. Each phone's app data is cleared and it starts as a new user ("Ann Starter", "Ben Starter", …),
   pinned to the same point, against a LAN test hub.
2. Every phone shows every other one on its Nearby list (release capacity has room for all).
3. Each phone decides all 60 starter tags: a seeded 30 are liked top-down (a tap passes the
   unanswered tags above it), the rest are passed with Delete. Picks are the browser spec's
   (`tests/e2e/journeys/starter-tags-shared.ts`, same seed → same picks).
4. Contacts sorted by **Most tags in common** shows the exact overlap with every other phone,
   in order, and the top row is "#1 most alike". The spec prints the overlap matrix and how many
   seconds each phone took to settle after its last decision.
5. Each phone marks its most similar person a Friend and sends "we share lots of interests.";
   the receiver's conversation shows it.

Clears every phone's app data at the end (`STARTER_PHONES_KEEP_DATA=1` keeps it).

```bash
npm run build:embedded   # the test hub serves dist/
E2E_REAL_ANDROID_STARTER_TAGS=1 NATIVE_APP_ANDROID_SERIALS=<a>,<b>,<c>,<d> \
  npx playwright test --config tests/e2e/native-app/playwright.config.ts \
  tests/e2e/native-app/43-android-starter-tags-phones.spec.ts --reporter=list
```

| Env | Default | Meaning |
|-----|---------|---------|
| `STARTER_SIMILAR_SEED` | `20261025` | Seed for the picks |
| `STARTER_SIMILAR_LIKES` | `30` | Tags each user likes. Likes count toward `TALK_SEND_DAILY` (1000 Talks per person per day), which phones cannot lift |
| `STARTER_PHONES_SETTLE_MS` | `900000` | How long Contacts may take to show every overlap |
| `STARTER_PHONES_MESSAGE` | on | `0` skips the Friend + message step |
| `STARTER_SIMILAR_SHOTS_DIR` | unset | Save each phone's Nearby, Contacts, Talks and Me as PNGs here |
