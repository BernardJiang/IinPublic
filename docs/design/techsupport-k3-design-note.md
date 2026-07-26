# K3 Design Note — Developer login as TechSupport

Implementation guide for TODO.md **K3** (decisions K3-1…K3-4 are locked; this note turns the
checklist into concrete edits). Companion to `docs/design/techsupport-k1-design-note.md`,
`docs/design/techsupport-k2-design-note.md`, and `docs/design/techsupport-bootstrap-contract.md`
(which is amended as part of this work — see §Contract amendments).

Audience: the implementing (Sonnet-tier) engineer. Every item gives **Where** (file +
function/line), **What changes**, and **Risks/gotchas**. Landing order is first because several
items are only safe in sequence.

The locked decisions this note builds on (do **not** re-litigate):
- **K3-1** two keys — announcement key (relay) + DM/greeting key (TechSupport device). Already split
  in `src/shared/techsupport.ts` (`TECHSUPPORT_ANNOUNCEMENT_TRUST_ANCHORS` vs
  `TECHSUPPORT_DM_TRUST_ANCHORS`, both currently seeded with the same dev key).
- **K3-2** rotation via trust-anchor list. Already in code. K3 **uses** it (sign with
  `currentTechSupportDmPub()`, verify with `isTrustedTechSupportDmPub()`); it does not rebuild it.
- **K3-3** run both headless-agent and browser mode. **This note covers browser mode only** — the
  K3 *checklist* asks for "boot the normal web client in TechSupport mode" and nothing else. The
  headless agent is out of scope (it appears only in the K3 narrative, not the checklist).
- **K3-4** production custody is redundant (server, laptops, dedicated machine). A deployment/ops
  concern; noted in the contract, **not implemented here**.

**The model is a reversal of an earlier rejected draft.** The private SEA pair lives in a key file
on the TechSupport *device*, loaded by a normal web-client boot, never in the web bundle, never on
the relay. Do not add a dev endpoint that vends the private key from the server — that is the
rejected model.

---

## The gap K3 closes (read first — it is not what "carries no keypair" sounds like)

TODO.md:207 says the current dev "login as TechSupport" "carries no keypair, and cannot sign." The
precise mechanism, confirmed in code:

- `src/web/index.ts:47-52` — when `isDevStageTechSupportLoginResolved()` (stage-zero/empty) or
  `isDevTechSupportDriver()` (`?devRole=techsupport`), the boot sets
  `localStorage['iinpublic_user_id'] = TECHSUPPORT_ROOT_USER_ID`.
- `app.ts initializeUser()` (959) then loads/creates the root; `createNewUser({ rootTechSupport:true })`
  (1018-1038) calls `WebUserService.createTechSupportRoot` (web-user-service.ts:481) using
  `this.gunService.getStoredPair()` (app.ts:1023) as the identity.
- But `getStoredPair()` (web-gun-service.ts:764) returns `this.seaPair`, which `ensureKeypairAndAuth`
  (668) sets to **a freshly generated `SEA.pair()`** (web-gun-service.ts:704). **Nothing loads the
  canonical DM private half into the browser today.**

So the current dev root adopts the correct *id* but authenticates its Gun user with a **random**
device pair whose `pub ≠ TECHSUPPORT_PUB`. Any DM/greeting it authors is signed under that random
key and is therefore **silently suppressed** at the receiver by K2/K6 signature verification
(`isTrustedTechSupportDmPub` is false). K3's job is to make the TechSupport-mode boot authenticate
with the **canonical DM pair loaded from the device key file**, so `getStoredPair().pub ===
TECHSUPPORT_PUB` and everything the operator sends verifies. Everything else (adopting the id,
joining Global, the support transport) already works from K1/K2.

---

## Recommended implementation order (across all 5 checklist items)

The governing constraint: item 2's "retire the old special case" removes the only current path that
logs a browser in as root, and the new browser-mode boot is what replaces it — land the replacement
before the deletion. Tests last so they aren't re-edited as behaviour settles.

1. **Pure validator + distinct-storage constant first** (foundation for the client boot and item 4's
   test). Add `assertTechSupportDmPair()` (or `loadTechSupportDmPair`) to `src/shared/techsupport.ts`
   and `TECHSUPPORT_KEYPAIR_STORAGE = 'iinpublic_techsupport_keypair_v1'` to
   `web-gun-service.ts`. Pure additions, `tsc`/unit-verifiable in isolation. Land item 4's unit test
   here.
2. **Client TechSupport-mode boot** (checklist item 1, client half): the branch in
   `ensureKeypairAndAuth()` that loads the injected pair, asserts `pub`, `auth()`s with it and skips
   ordinary custody; plus the permanent "TechSupport (root)" app-bar badge. Uses step 1's validator.
3. **`dev:techsupport` launcher + npm script + `.gitignore`/`.env.local` notes** (checklist item 1's
   docs half + item 2's `dev:techsupport` half). Now a human can actually boot it. This is the
   part with no existing analog — see §Item 1 for the concrete mechanism.
4. **Server de-gating + committed pre-signed identity blob** (checklist item 3). Independent of 1-3
   but sequence it here so the item-5 E2E exercises the final boot. Has a K1 blast radius — see
   §Item 3.
5. **Retire `isDevStageTechSupportLoginResolved()` + the `IINPUBLIC_STAGE_SEED` TechSupport special
   case** (checklist item 2's retire half). Only after step 3 provides the replacement. Update
   contract line 17.
6. **E2E stage1 two-context signed-DM spec** (checklist item 5) last.

**Single biggest risk (read first).** The DM private key must reach the browser **only at runtime,
through the launcher → localStorage injection channel** — never through the webpack bundle. The
gravest failure mode is a well-meaning implementer wiring `TECHSUPPORT_SEA_PAIR_JSON` into webpack's
`EnvironmentPlugin` (the same mechanism that inlines `IINPUBLIC_STAGE_SEED`, see `dev-stage-env.ts:6`)
to "let the client read the key." That would ship TechSupport's **private** half in every public
web bundle, letting anyone author messages as TechSupport — a total defeat of the entire K2/K3
signing model. Mitigate: (a) the client only ever obtains the pair from
`localStorage[TECHSUPPORT_KEYPAIR_STORAGE]`, populated by the Node launcher via Playwright
`addInitScript`; (b) add a guard test that the built web bundle contains neither `"priv"` from the
pair nor the literal env-var name `TECHSUPPORT_SEA_PAIR_JSON`; (c) the pair env var is only consumed
by Node processes (`dev:server`, the launcher, the signing scripts) that already load `.env.local`
via `set -a; . ./.env.local`, never by webpack.

---

## Item 1 — Key-file loading + `pub` assertion + TechSupport-mode boot; document + `.gitignore`

### 1a. The concrete mechanism to get the key file into a freshly-booted dev browser (no analog exists)

A browser process cannot read a local file, and the private key must not be inlined into the bundle.
The only channel that gets data into a fresh dev browser without either is the one
`launch-browsers.js` already uses for dev:multi: a **Node launcher that reads the key from disk and
injects it into the browser context via Playwright `addInitScript` before the page loads.** Disk →
Node → browser `localStorage` over the automation channel; the bundle and the relay never see the
private half.

**New script `scripts/dev-techsupport-login.js`** (model on `launch-browsers.js:1-163` and the
`addInitScript` pattern already in `tests/e2e/helpers/super-user-techsupport-shared.ts:64-66`):

- **Reads the pair** from `process.env.TECHSUPPORT_SEA_PAIR_JSON` (already present in `.env.local`,
  already the DM key today — same source `configuredPair()` and `sign-techsupport-greeting.js:38`
  use), OR, if `TECHSUPPORT_KEY_FILE` is set, `JSON.parse(fs.readFileSync(process.env.TECHSUPPORT_KEY_FILE))`.
  K3 says "`TECHSUPPORT_SEA_PAIR_JSON` **or a path to it**" — support both; prefer the env var for
  parity with the rest of the stack.
- **Asserts** `pair.pub === currentTechSupportDmPub()` in the launcher too (fail fast with a clear
  message before opening a browser), mirroring `sign-techsupport-greeting.js:48-54`. Requires
  `require('../dist/server/shared/techsupport')` with the auto-`build:server` fallback that script
  already establishes (`sign-techsupport-greeting.js:21-35`).
- **Launches** a `chromium.launchPersistentContext` (headed) against the **already-running** dev web
  server (K3: "launches this mode against the running relay" — the developer runs `npm run dev` in
  one terminal, `npm run dev:techsupport` in another), reusing `launch-browsers.js`'s TLS/URL
  detection (`launch-browsers.js:8-16`) and window/reset handling.
- **Injects, before navigation**, via `context.addInitScript`:
  ```js
  window.localStorage.setItem('iinpublic_user_id', TECHSUPPORT_ROOT_USER_ID);
  window.localStorage.setItem('iinpublic_techsupport_keypair_v1', JSON.stringify(pair));
  ```
  Then navigates to `${APP_URL}/` (no special query needed — the presence of the distinct key *is*
  the TechSupport-mode signal; see 1b). Keeps the Node process alive like `launch-browsers.js:156`.

**New npm script** (`package.json`), matching the `.env.local`-loading `dev:server`/`sign:*` idiom:
```
"dev:techsupport": "set -a; [ -f .env.local ] && . ./.env.local; set +a; node scripts/dev-techsupport-login.js"
```

**Docs + `.gitignore`.** `.env.local` is **already** gitignored (`.gitignore` "Runtime and local app
state" block lists `.env.local`), and `TECHSUPPORT_SEA_PAIR_JSON` already lives there, so the
env-var form needs no new ignore entry — only a comment in `.env.local`/`.env.example` noting this
pair is now the **TechSupport device DM key** loaded by `dev:techsupport`, not just a server secret.
If the operator uses the **file** form (`TECHSUPPORT_KEY_FILE`), standardize the path on
`secrets/techsupport-dm.key.json` and add **`secrets/`** to `.gitignore` (new entry, alongside the
existing `certs/` per-machine-secret convention).

**Risks / gotchas**
- Do **not** reuse `?devRole=techsupport` (`isDevTechSupportDriver`, dev-stage-env.ts:65) as the
  trigger — that path is dev:multi's and still mints a random-pair root. The distinct-localStorage
  key is the trigger, so the presence of the *injected pair* is what upgrades the boot to a real
  signing root. (dev:multi's driver window is out of scope; leave it as-is or, as a follow-up, have
  it inject the pair too.)
- The launcher assumes web+server are already up; it polls readiness like
  `launch-browsers.js:117-118`. Do not have it start its own server.

### 1b. Client TechSupport-mode boot (adopt the canonical pair, refuse on `pub` mismatch)

**Where**
- `src/web/services/web-gun-service.ts` — `ensureKeypairAndAuth()` (668); storage constants at
  19-20 (`KEYPAIR_STORAGE`, `KEY_CUSTODY_STORAGE`). Add `TECHSUPPORT_KEYPAIR_STORAGE =
  'iinpublic_techsupport_keypair_v1'` next to them — a **distinct** key so it never collides with
  the device's ordinary encrypted custody (`KEY_CUSTODY_STORAGE`), per the checklist.
- `src/shared/techsupport.ts` — add the pure validator (see below), next to
  `isTrustedTechSupportDmPub` (49) / `currentTechSupportDmPub` (54).
- `src/web/ui/ui-manager.ts` — app-bar stage-name render (the `[data-testid="user-stage-name"]`
  element the E2E helpers key on, `super-user-techsupport-shared.ts:89`) for the permanent
  "TechSupport (root)" badge.

**What changes**

1. Add a pure validator to `src/shared/techsupport.ts`:
   ```ts
   export interface TechSupportSeaPair { pub: string; epub: string; priv: string; epriv: string; }
   export const TECHSUPPORT_PAIR_MISMATCH_ERROR =
     'Loaded TechSupport key does not match a TechSupport DM trust anchor — refusing to start.';
   /** Throws unless `pair` is a well-formed SEA pair whose pub is a trusted DM anchor (K3-2). */
   export function assertTechSupportDmPair(pair: unknown): asserts pair is TechSupportSeaPair { ... }
   ```
   Validate shape (`pub/epub/priv/epriv` all present, strings) and `isTrustedTechSupportDmPub(pair.pub)`.
   **Use the DM trust-anchor list, not a literal `=== TECHSUPPORT_PUB`** — this honours K3-2
   (rotation), and today it is exactly equivalent because the list holds only `TECHSUPPORT_PUB`
   (techsupport.ts:35). The checklist's "`pub !== TECHSUPPORT_PUB` is rejected" is satisfied; the
   anchor-list form additionally survives rotation.

2. At the **top** of `ensureKeypairAndAuth()` (668), before the custody/legacy/new branch (677-706):
   read `localStorage[TECHSUPPORT_KEYPAIR_STORAGE]`. If present:
   - `JSON.parse` → `assertTechSupportDmPair(pair)`. On failure, **throw** — checklist: "Refuse to
     start if the loaded pair's `pub !== TECHSUPPORT_PUB` — no silent impersonation." Let it
     propagate so boot visibly fails (contrast the ordinary custody path, which silently regenerates).
   - Set `pair = <loaded>` and **skip** `persistCustodyRecord` (708) — do **not** write the
     TechSupport pair into the ordinary encrypted custody record; the two identities stay separate,
     and a later ordinary boot on the same profile must not inherit it.
   - Fall through to the existing `gun.user().auth(pair)` (738) and bridge login (750), then
     `this.seaPair = pair` (758). Everything downstream (`getStoredPair()`, `createTechSupportRoot`'s
     `pub/epub`, `publishIdentityKeys` at app.ts:982, the support DM signature) now uses the
     canonical DM pub automatically.

3. App-bar badge: when `currentUser.id === TECHSUPPORT_ROOT_USER_ID`, render a permanent
   "TechSupport (root)" badge next to the stage name. Small additive UI in `ui-manager.ts` where the
   user header is composed; gate on the id, not on dev-mode, so it also shows for a production
   operator device.

**Risks / gotchas**
- `ensureKeypairAndAuth` runs **before** `initializeUser()` sets/reads `iinpublic_user_id`. The pair
  branch keys only off `TECHSUPPORT_KEYPAIR_STORAGE`, so ordering is fine — but confirm the launcher
  injects **both** localStorage keys (id + pair) before navigation so the id is present when
  `initializeUser` (959) runs.
- The stage-zero storage wipe in `initializeUser` (964-970) removes `iinpublic_keypair` /
  `KEY_CUSTODY_STORAGE` when not root. `dev:techsupport` targets a **running relay, not a stage-zero
  reset** (no `IINPUBLIC_STAGE_SEED`), so `isDevStageZero()` (960) is false and this wipe never runs
  under `dev:techsupport` — no conflict. Do not add the TechSupport key to that wipe list.
- The pair sits in `localStorage` in plaintext (unlike the ordinary encrypted custody). That is
  acceptable and intended for the operator's own device (K3-4: "whoever holds the key file is
  TechSupport"); do not encrypt it under the device secret, which would defeat "load the same key on
  any machine." Note it in the contract.

---

## Item 2 — `npm run dev:techsupport`; retire `isDevStageTechSupportLoginResolved()` + the seed special case

The `dev:techsupport` script is specified in Item 1a. This item is the **retirement** half.

**Where**
- `src/web/dev-stage-env.ts:55-58` — `isDevStageTechSupportLoginResolved()`.
- `src/web/index.ts:4` (import) and `:47-53` — the only consumer: it sets `iinpublic_user_id = root`
  for stage-zero/empty.
- `src/web/app/app.ts:960-970` — the stage-zero "preserve the root id" special case, and `:988-990`
  the `rootTechSupport: existingUserId === TECHSUPPORT_ROOT_USER_ID` branch.

**What "retire" concretely means — full deletion, and why it doesn't break `dev:stage-zero`.**

Recommendation: **delete `isDevStageTechSupportLoginResolved()` outright and remove its single
consumer (index.ts:47-53)**, in the same commit as the `dev:techsupport` launcher. There is exactly
one consumer (grep-confirmed: `isDevTechSupportDriver` at index.ts:47 is a *separate* function), so
leaving it as an exported dead function only rots. Concretely:
- Delete `isDevStageTechSupportLoginResolved` (dev-stage-env.ts:55-58) and drop it from the
  `import` at index.ts:4.
- Delete the `if (isDevStageTechSupportLoginResolved() || isDevTechSupportDriver()) { … setItem(root) }`
  block (index.ts:47-53). Keep `isDevTechSupportDriver()` for dev:multi's driver window — decide
  whether to keep that branch: recommend **keeping** `isDevTechSupportDriver` and its own setItem so
  dev:multi is untouched, i.e. narrow the condition at index.ts:47 to `if (isDevTechSupportDriver())`.
- In `app.ts:960-970`, the stage-zero wipe's "preserve root id" guard (964) can stay as-is — it is
  keyed on the id already being `root`, which now only happens via the (kept) dev:multi driver or a
  real `dev:techsupport` boot; it does no harm.

**Does this break the documented "empty network = 1, browser boots as TechSupport" behaviour of
`dev`/`dev:stage-zero`?** It changes it, and the change is safe **because K1 already decoupled the
headcount floor from the browser being TechSupport.** Post-K1, an empty network shows the built-in
TechSupport member from (a) the relay boot seed (`seedTechSupportGlobalMembership`) and (b) the
client synthesizing it from compiled constants (`techSupportRosterMember()`, contract lines 12-16) —
neither depends on the browser logging in as root. After retirement:
- `npm run dev` / `dev:stage-zero` boots an **ordinary** user. Global headcount reads **2** (the
  ordinary dev user + built-in TechSupport), which is *more* faithful than the old "1" — a real user
  really is present.
- A developer who specifically wants to *be* TechSupport (headcount 1 view, or to answer questions)
  runs **`npm run dev:techsupport`** — the general, real-signing replacement.

This is the literal intent of the checklist ("retire … the `IINPUBLIC_STAGE_SEED` TechSupport
special case once it lands"). Update contract line 17 accordingly (see §Contract amendments). The
`stage-zero` graph-clear/self-heal logic (`isDevStageZero`, `isDevStageZeroSelfHeal`,
index.ts:38-59) is **separate** and stays untouched — only the *login-as-root* special case is
removed.

**Risks / gotchas**
- `docs/design/techsupport-bootstrap-contract.md:17` and `:55` and CLAUDE.md's "Dev stage seeds" /
  "npm run dev … logs in as built-in TechSupport (headcount 1)" both document the old behaviour.
  Update the contract (this note) and flag CLAUDE.md for a one-line correction so the docs don't lie.
- Grep for any E2E/helper that assumes `dev:stage-zero` yields a root-logged-in browser. The staged
  E2E pipeline seeds TechSupport independently (K1/K4 baseline), not via this dev path, so it is
  unaffected — but confirm no `dev:*` smoke script (`scripts/smoke-dev-multi.js`) asserts the root
  login.

---

## Item 3 — Move the pair out of the server: republish identity without the private half at boot

**Where**
- `src/server/services/techsupport-announcement-service.ts` — `configuredPair()` (13-22),
  `isConfigured()` (31-33), `publishIdentity()` (35-45).
- `src/server/index.ts` — `publishPublicBootstrap()` (128-147), the `if (!isConfigured())`
  early-return gate (130-133), and the reset path `onClearDatabase` (223-228) that re-invokes it.

**What "no longer require the private half at boot" concretely means.**

The identity record `public/techsupport-identity` is a fixed, public, verifiable blob (`userId, pub,
epub, role, signature`). To republish it with **no private key at boot**, pre-sign it once and commit
it — the exact pattern K2 established for the greeting. Mechanism:

1. **New committed artifact** `src/shared/techsupport-identity.signed.json` (mirrors
   `techsupport-greeting.signed.json`): `{ userId, pub, epub, role, signature }`.
2. **New signing script** `scripts/sign-techsupport-identity.js` + `npm run sign:techsupport-identity`,
   modelled line-for-line on `scripts/sign-techsupport-greeting.js`: reads `TECHSUPPORT_SEA_PAIR_JSON`,
   asserts `pair.pub === currentTechSupportAnnouncementPub()` (the identity record is signed by the
   **announcement** key per K3-1 and verified by clients against the announcement anchors),
   `SEA.sign(canonicalSerialize({userId,pub,epub,role}), pair)`, writes the committed JSON. Re-run
   and commit only on a key rotation.
3. **`publishIdentity()`** stops signing: it imports the committed blob and
   `putPath(['public','techsupport-identity'], blob)`. No SEA pair required.
4. **Remove the boot gate.** In `publishPublicBootstrap()` delete the `if (!isConfigured()) return`
   early-return (index.ts:130-133) so **both** `publishIdentity()` (now keyless) **and**
   `seedTechSupportGlobalMembership()` (always keyless — it is a plain Gun put) run unconditionally,
   on boot and on every E2E reset (index.ts:228).
5. **Keep `configuredPair()`/`isConfigured()`** solely for the on-demand admin routes
   (`createAnnouncement` 47-56, `verifyAdminAuthorization` 58-69) — those already guard with
   `if (!this.pair)` and degrade gracefully when the announcement private pair is absent. The
   announcement key remains a *legitimate* server-side secret (K3-1) for that feature; it is simply
   no longer required at **boot**.

**Blast-radius accounting (critical — K1 depends on the gate you are removing).**

- **K1's member-row seed is currently gated on `isConfigured()`.** `publishPublicBootstrap`
  early-returns at index.ts:130 *before* both `publishIdentity()` (135) **and**
  `seedTechSupportGlobalMembership()` (143). Today, a relay with no `TECHSUPPORT_SEA_PAIR_JSON`
  produces **no identity record and no Global member row** → headcount relies solely on K1's
  client-side floor. Removing the gate (step 4) makes the member seed fire regardless — this is
  strictly an *improvement* (the relay-light presence contract, lines 8-16, becomes true even with
  no key configured) but it **changes behaviour for a keyless relay**, so any test that asserts "no
  member row when unconfigured" must be updated. Grep `isConfigured` callers before editing: expected
  set is only index.ts:130.
- **E2E:** the reset path (index.ts:228) re-runs `publishPublicBootstrap`. After de-gating, resets
  seed the member row even when the E2E env has no pair — this *removes* a hidden dependency on
  `TECHSUPPORT_SEA_PAIR_JSON` being set in CI. Confirm `chatroom-manager.test.ts`
  (`seedTechSupportGlobalMembership` presence + eviction, contract line 92) still passes — the method
  is unchanged, only its call is now unconditional.
- **Client identity verification** (`discoverTechSupportIdentityFromGun`, app.ts:866;
  `subscribeToPublicAnnouncements`, 843) verifies the record's `signature` against the announcement
  anchors — unaffected, because the committed blob carries a real announcement-key signature (step 2).
  The blob's embedded `epub` must be the canonical epub clients encrypt DMs to (today one key, so no
  ambiguity).
- **The `stage0-bootstrap` relay-only spec** (contract line 79,
  `000-relay-only-techsupport-presence.spec.ts`) asserts the identity record + one member row on a
  bare relay. After this change it should pass **without** any pair configured — tighten it to run
  with `TECHSUPPORT_SEA_PAIR_JSON` unset if convenient, proving the keyless boot.

**Risks / gotchas**
- Do not delete `configuredPair()`/`isConfigured()` — the admin announcement feature still needs the
  announcement pair. Only the *boot* stops depending on it.
- Keep `publishIdentity()`'s failure best-effort/logged (index.ts:136-138 style) — a missing/corrupt
  committed blob must log loudly but not crash boot; the client floor is the safety net.

---

## Item 4 — Test (unit): a pair whose `pub` mismatches `TECHSUPPORT_PUB` is rejected

**Where**
- New `src/test/unit/techsupport-login.test.ts` (or extend `src/test/unit/techsupport.test.ts`).
  Model on `src/test/unit/techsupport-greeting.test.ts` (the "rejects a greeting signed by an
  untrusted key" case at 67-72 uses `await SEA.pair()` for a stranger key — reuse that idiom) and
  `techsupport-trust-anchors.test.ts`.

**What changes (assertions)** — target the pure `assertTechSupportDmPair()` from Item 1b:
1. A valid pair (`pub === TECHSUPPORT_PUB`, i.e. the committed dev pair from
   `techsupport-greeting.test.ts:12-17`) does **not** throw.
2. A pair from a stranger key (`const stranger = await SEA.pair()`) **throws**
   `TECHSUPPORT_PAIR_MISMATCH_ERROR` — this is the checklist's core case ("`pub` mismatches
   `TECHSUPPORT_PUB` is rejected").
3. Malformed input (missing `priv`/`epub`, `null`, non-object) throws without leaking — mirrors
   `techsupport-greeting.test.ts:79-84`.
4. (Optional, documents K3-2) a pair whose pub is a *non-first* DM anchor still passes — currently
   vacuous (one-element list) but guards the rotation contract.

**Risks / gotchas**
- Assert against the **anchor-list** validator, not a hand-rolled `=== TECHSUPPORT_PUB`, so the test
  encodes the K3-2 behaviour and won't need rewriting at rotation.

---

## Item 5 — Test (`stage1`): TechSupport-mode second browser posts a DM; user verifies the signature

**Where**
- New spec `tests/e2e/staged/stage1-single-user/05-techsupport-mode-signed-dm.spec.ts` + companion
  `.md`. Two independent browser contexts. Model the TechSupport context on
  `tests/e2e/helpers/super-user-techsupport-shared.ts` `bootstrapSuperUser(..., TECHSUPPORT_STAGE_NAME)`
  (which already `addInitScript`s the root id at 64-66) **extended** to also inject the pair; model
  the two-context structure on any `stage2-two-user/*` two-browser spec.

**Placement justification (stage1 is correct, not a misnomer).** TODO.md Execution Rule 1 places a
spec in "the lowest stage whose user count can verify the choice." This scenario needs **one
ordinary user** plus the **TechSupport device**. TechSupport is the built-in bootstrap presence, not
an "ordinary user" for staging purposes (stage1 = one ordinary user, and TechSupport is already part
of every stage's baseline per K4). So one ordinary user + the TechSupport operator device is a
`stage1` scenario — exactly as the checklist states. The TechSupport browser is *infrastructure
under test*, not the second graded user.

**What changes (assertions)**
1. **Context A** — ordinary stage1 user via the standard bootstrap.
2. **Context B** — TechSupport mode: `addInitScript` sets `iinpublic_user_id = TECHSUPPORT_ROOT_USER_ID`
   **and** `iinpublic_techsupport_keypair_v1 = JSON.stringify(DEV_PAIR)` (the known dev pair from
   `techsupport-greeting.test.ts:12-17`). Boot, assert `expectCurrentUserIsTechSupportRoot(page)`
   (super-user helper 95) and that `getStoredPair().pub === TECHSUPPORT_PUB` (via `page.evaluate`),
   proving the canonical pair is loaded (not a random one).
3. From Context B, send a support DM to user A (support conversation
   `conv_support_${TECHSUPPORT_ROOT_USER_ID}_${userA}` — see app.ts:2380) via the normal composer /
   `conversationService.sendMessage` path.
4. **On Context A**, assert the message **renders** in the support thread (a durable
   `.conversation-list-item` / rendered message signal per CLAUDE.md, not a toast) **and** its
   signature **verifies** against `TECHSUPPORT_DM_TRUST_ANCHORS`. The verify is the crux: read the
   stored message record via `page.evaluate` over local Gun and confirm `isTrustedTechSupportDmPub`
   holds for its author / the SEA signature checks out. The *negative control* is implicit — under
   the pre-K3 random-pair root this message would be **silently suppressed** by K2/K6 verification,
   so "it renders and verifies" is precisely what proves K3.

**Risks / gotchas**
- The message must be authored by Context B's **authenticated Gun user** (canonical pair) so its
  signature is intrinsic — do not fabricate a record client-side in the test. Drive the real send
  path.
- If the support transport is `TechSupportConversationTransport` (server-backed, contract line 29 /
  spec §19.7) rather than direct-P2P, confirm delivery works cross-context in the staged pipeline;
  use the two-context sync helpers the stage2 messaging specs use.
- Assert on the **settled** rendered state with `expect.poll`; support DMs sync via Gun and may lag.

---

## Contract amendments (`docs/design/techsupport-bootstrap-contract.md`)

- **Line 17** (Invariants — dev boot): replace "In dev (`npm run dev`, `dev:stage-empty`,
  `dev:stage-zero`) … the browser boots logged in as the TechSupport root — an empty network shows a
  headcount of 1." with: *"In dev, `npm run dev` / `dev:stage-zero` starts a clean database and boots
  an **ordinary** user; the built-in TechSupport member is provided by the relay boot seed and the
  client's compiled-constant floor (K1), so headcount is **2** (dev user + TechSupport). A developer
  acts **as** TechSupport by running **`npm run dev:techsupport`** (K3), which boots the normal web
  client in TechSupport mode: it loads the canonical DM SEA pair from the device key file
  (`TECHSUPPORT_SEA_PAIR_JSON` or `TECHSUPPORT_KEY_FILE`), refuses to start unless the pair's pub is a
  trusted DM anchor, `gun.user().auth(pair)`s, adopts `TECHSUPPORT_ROOT_USER_ID`, and shows a
  permanent 'TechSupport (root)' badge. `dev:multi` still seeds TechSupport server-side and keeps
  browsers as ordinary users."*
- **Add to Invariants:** *"The TechSupport DM/greeting private key lives **only** on the TechSupport
  device — a key file loaded at runtime into the distinct localStorage key
  `iinpublic_techsupport_keypair_v1` via the `dev:techsupport` launcher. It is never inlined into the
  web bundle and never held by the relay. The relay holds at most the **announcement** key (for
  on-demand system announcements) and republishes a **pre-signed** identity record; server boot and
  E2E reset require **no** private SEA pair (K3)."*
- **Current Enforcement — line 55:** remove the `isDevStageTechSupportLoginResolved` line (function
  deleted). Replace with: *"`scripts/dev-techsupport-login.js` (`npm run dev:techsupport`) launches
  the web client in TechSupport mode, injecting the root id + canonical DM pair into localStorage;
  `WebGunService.ensureKeypairAndAuth()` loads the pair from `TECHSUPPORT_KEYPAIR_STORAGE`, asserts it
  via `assertTechSupportDmPair()` (`src/shared/techsupport.ts`), and authenticates with it instead of
  generating a device pair."*
- **Current Enforcement — identity publish:** update the `publishPublicBootstrap()` /
  `TechSupportAnnouncementService.publishIdentity()` description to: republishes the committed,
  pre-signed `src/shared/techsupport-identity.signed.json`; the boot no longer gates on
  `isConfigured()`, so identity + Global member row are seeded unconditionally. Add
  `scripts/sign-techsupport-identity.js` (`npm run sign:techsupport-identity`) as the one-off signing
  step (announcement key), mirroring the greeting entry (contract lines 60-67).
- **Reword the stale `TECHSUPPORT_PUB` doc-comment** (`src/shared/techsupport.ts:5-11`, per K3's Open
  Questions): drop "Replace before production." / "together with the server secret." New wording:
  *"Compiled trust anchor for the TechSupport identity. Kept as the current single key while the
  announcement and DM anchor lists both hold it; rotation is via those lists (K3-2), not by editing
  this constant. The **private** halves live off the client: the DM key on the TechSupport device
  (and replicated across operator machines, K3-4), the announcement key on the relay. Never compiled
  into the client bundle."*
- **Verification:** add `stage1-single-user/05-techsupport-mode-signed-dm.spec.ts` (K3 — signed DM
  from a TechSupport-mode browser verifies at the receiver) and `src/test/unit/techsupport-login.test.ts`
  (K3 — pair with a non-anchor pub is rejected).
- Note the honest cost (mirror the greeting cost, contract line 67): rotating the DM/announcement key
  means shipping a new client build (compiled anchors) and re-running the signing scripts; the
  operator must redistribute the new key file.
