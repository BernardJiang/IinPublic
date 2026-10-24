# IinPublic TODO2 (Draft)

Last updated: 2026-10-22.

This is a **separate draft** backlog requested by the product owner. It is intentionally not merged
into `docs/TODO.md` yet.

Scope in this file:

1. Zero-typing onboarding for average/new users.
2. Canonical **intent tag-pairs** (`buy/sell` style).
3. Small-business nearby e-coupons.
4. Follow-up review/survey Talks from customers.

---

## Draft execution queue (proposed)

- [ ] **DRAFT-OPEN-82 — Zero-typing onboarding with canonical buy/sell tag-pairs.**
  New users should not need to write or edit anything at first launch.
  The app should start with tap-only choices that immediately produce useful matches and talks.
  - [ ] **G1 — Canonical intent pair model (`BUY` / `SELL`).**
    - Add a shared schema for intent tag-pairs:
      - `intent`: `buy | sell`
      - `domainTag`: canonical tag id (e.g. `coffee_deals`)
      - optional `scope`: `nearby | place`
    - Keep storage and wire format stable and versioned.
    - Preserve compatibility with existing tag/flow/survey talk types.
  - [ ] **G2 — New-user tap-only onboarding.**
    - First-run onboarding presents curated chips only (no text input required).
    - Require selecting at least one `BUY` or `SELL` intent-pair.
    - Auto-save selected starter intent-pairs into user profile/preferences.
    - Offer “skip advanced setup” and return later from Settings.
  - [ ] **G3 — Auto-generated starter Talks from selected intent-pairs.**
    - Create starter Talks automatically from onboarding selections.
    - Use short, standardized prompts so users can answer in one tap.
    - Delay advanced Talk editing until after first successful interaction.
  - [ ] **G4 — Starter catalog (v1 curated list, 20 domains).**
    The launch set should include:
    1) Coffee/Tea deals 2) Lunch specials 3) Bakery/Desserts 4) Haircut/Salon
    5) Nail service 6) Massage/Wellness 7) Fitness class passes 8) Personal training
    9) Language tutoring 10) Math/Science tutoring 11) Device repair
    12) Home cleaning 13) Pet grooming 14) Dog walking/Pet sitting
    15) Event photography 16) Local rides 17) Used books 18) Used electronics
    19) Baby/Kids items 20) Furniture buy/sell
  - [ ] **G5 — Friend-growth prompt after first value moment.**
    - After first match/reply, show a one-tap invite CTA.
    - Message focus: “more relevant nearby matches when friends join.”
    - Add per-user invite cooldown and dismissal memory to avoid spammy UX.
  - [ ] **G6 — Qualification gate.**
    - Deterministic onboarding tests for tap-only path and persistence.
    - Stage1/Stage2 E2E journeys: first-run user reaches first reply without typing.
    - Metrics instrumentation: onboarding completion, first reply time, first match rate.

- [ ] **DRAFT-OPEN-83 — Nearby small-business e-coupons with abuse controls.**
  Allow verified local businesses to send controlled, relevant coupons to nearby users who opted into
  matching `BUY` intent domains.
  - [ ] **G1 — Business profile + eligibility.**
    - Add business account mode/profile metadata.
    - Define eligibility policy (verification tier, trust thresholds, block thresholds).
    - Keep sends disabled until eligibility is satisfied.
  - [ ] **G2 — Coupon payload and delivery policy.**
    - Standard payload: title, offer text, expiry, radius, tag domain, redemption hint.
    - Enforce strict caps (daily sends, per-user frequency, expiry max duration).
    - Deliver only to matching `BUY` users in scope.
  - [ ] **G3 — User controls and anti-spam guarantees.**
    - One-tap mute/hide for a business or domain.
    - Cooldown when user repeatedly ignores sender/domain.
    - Transparent reason on card: “You received this because BUY:<domain> is enabled.”
  - [ ] **G4 — Coupon lifecycle instrumentation.**
    - Track sent, delivered, opened, ignored, redeemed/claimed (if claim exists).
    - Add privacy-preserving aggregate stats for business and system quality.
  - [ ] **G5 — Qualification gate.**
    - Deterministic route/filter tests for domain and radius.
    - E2E tests for cap enforcement, mute/hide behavior, and non-recipient guarantees.
    - Abuse simulation tests (oversend attempts, duplicate sends, blocked business).

- [ ] **DRAFT-OPEN-84 — Post-coupon review/survey Talks.**
  Convert buyer outcomes into structured feedback Talks without long-form typing burden.
  - [ ] **G1 — Review Talk template (short form).**
    - Add 1–5 rating + quick sentiment chips + optional short note.
    - Default to one-tap completion; note field remains optional.
  - [ ] **G2 — Survey Talk template (2–3 questions max).**
    - Include standard outcomes (value, quality, recommend intent).
    - Keep completion under ~20 seconds target for average users.
  - [ ] **G3 — Trigger policy and cadence.**
    - Trigger review/survey only when coupon interaction qualifies.
    - Respect cooldown and suppression after repeated skips.
  - [ ] **G4 — Business analytics summary.**
    - Aggregate ratings and survey outcomes per domain/offer window.
    - No raw private identity exposure in business-facing summaries.
  - [ ] **G5 — Qualification gate.**
    - Unit tests for trigger/cooldown logic.
    - E2E path: receive coupon → interact → get review/survey → submit in one-tap flow.

---

## Product/UX guardrails for this draft

- Keep first-run onboarding **zero typing** by default.
- Treat intent tag-pairs as first-class (`BUY`/`SELL`) rather than generic co-interest tags.
- Never require advanced Talk editor before first successful interaction.
- Prioritize anti-spam controls and user muting before broad coupon rollout.
- Keep all new flows compatible with existing Nearby/Place and Talk delivery semantics.

---

## Open design questions before promotion into main TODO

- [ ] Should business mode require a separate profile type or just verified metadata on a normal user?
- [ ] What minimum verification is required before the first coupon send?
- [ ] Should coupon sends be limited to Places only, Nearby only, or both at launch?
- [ ] Should redemption be in-app only, or allow external/offline redemption proof?
- [ ] How should invite incentives work without distorting trust/reputation signals?

---

## Promotion rule

Do not merge this file into `docs/TODO.md` until:

1. The product owner confirms this scope and ordering.
2. Existing active release blockers are not jeopardized.
3. Abuse/rate-limit policy is accepted before enabling broad business sends.
