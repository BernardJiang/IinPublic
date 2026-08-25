# TODO — UI God-Object Refactor & Unused React Dependency Cleanup

**Status:** Issue #2 (React dependency cleanup) ✅ **DONE** in `2f0b7355`. Issue #1
(`ui-manager.ts` decomposition) is **in progress** as of 2026-08-24; extraction clusters #1
(route editor), #2 (survey statistics), and #3 (application shell) are complete.
**Written:** 2026-08-18; execution plan refreshed 2026-08-23 against merged `dev.codex` after
`origin/dev.claude` was merged at `28e92eca`.
**Execution rule:** work one cohesive cluster at a time. Preserve the public `UIManager` contract,
characterize behavior before moving it, ratchet the size ceiling down after the extraction, and
run the canonical verification gate before beginning another cluster.

This document captures two issues found during an architecture study of `src/`:

- **Issue #1** — `src/web/ui/ui-manager.ts` is an 11,793-line singleton god-object.
- **Issue #2** — React 19 and a React toolchain were declared as dependencies, but the real UI was
  framework-free hand-rolled DOM; the only React consumers were legacy demos that are now archived.

Both issues share one root cause: an early **Gun + React proof-of-concept** was superseded by a
framework-free TS UI, but (a) the UI monolith was never decomposed and (b) the React manifest
entries and babel preset were never removed.

---

## Evidence (refreshed 2026-08-23)

### Issue #1 — the god-object

- `src/web/ui/ui-manager.ts` = **11,793 lines** and 344 methods in one
  `export class UIManager extends EventEmitter`. `src/web/app/app.ts` = **6,531 lines**.
- `app.ts` currently uses about **132 distinct `UIManager` members**. Preserving its single import
  statement is not enough: method signatures, emitted event names/payloads, DOM IDs, focus behavior,
  and listener lifecycle are all compatibility contracts.
- There is already a working extraction pattern to follow:
  - `src/test/unit/ui-extracted-modules.test.ts` imports from `my-talks-dialog`, `preferences-dialog`,
    `conversations-view`, `user-detail-view`, `talk-editor-form-helpers`, `ui-settings-storage`, etc.
  - So "extract a cohesive cluster into `src/web/ui/<module>.ts` and have `ui-manager.ts` delegate"
    is the established, tested convention — not a new risk.

### Issue #2 — unused React dependency graph

- **Zero `.tsx` files** in `src/`. `grep` for React imports in `src/{web,server,shared}` (excluding
  `examples`) returns **nothing**.
- All historical React usage is confined to `docs/archive/examples/gun-react/` and
  `docs/archive/examples/opencodedemo/`:
  - `docs/archive/examples/gun-react/*.js` import `react`, `react-dom`, `react-cytoscapejs`, and also
    `react-router-dom`, `react-svg`, `react-load-image` — the last three are **not** in `package.json`,
    so the demo does not even build as-is.
- `webpack.config.js:95` **excludes** `/src\/examples/` from the babel rule; the real entry is
  `./src/web/index.ts` (a non-React TS entry).
- `jest.config.js:34` **excludes** `!src/examples/**/*.js` from test collection.
- `.eslintrc` has **no** `ecmaFeatures.jsx`, no `react` plugin, no `react/jsx-*` rules.
- `styled-components` and `@testing-library/react` are referenced **nowhere** in `src/` (non-examples).
  Note: `webpack.config.prod.js:10` still has a `ProvidePlugin` entry for `styled-components` even
  though it is not a declared dependency and the active config is `webpack.config.js`.

The following `devDependencies` are therefore part of the stale React graph (exact names/versions
as of `package.json` 2026-08-18):

| Package | Version | Only used by |
|---|---|---|
| `react` | ^19.2.4 | `src/examples/` (excluded) |
| `react-dom` | ^19.2.4 | `src/examples/` (excluded) |
| `react-cytoscapejs` | ^2.0.0 | `src/examples/` (excluded) |
| `cytoscape` | ^3.33.1 | only via `react-cytoscapejs` (excluded) |
| `@testing-library/react` | ^16.3.2 | nowhere (no .tsx/.jsx) |
| `@babel/preset-react` | ^7.28.1 | `babel.config.js` line 1 |

> **Keep** (these are general TS/JS transpilation, NOT React-specific): `@babel/preset-env`,
> `@babel/plugin-transform-arrow-functions`, `@babel/plugin-proposal-class-properties`,
> `@babel/plugin-transform-class-properties`, `@testing-library/jest-dom`, `jest-environment-jsdom`.
> Do **not** remove these.

---

## Issue #2 — Remove the unused React dependency graph  (start here: small, safe, verifiable)

> Order rationale: #2 is low-risk and independently verifiable, and it de-risks the bundle/manifest
> before the larger #1 refactor. Keep the two on separate commits.

- [x] **2.1 Freeze the evidence.** ✅ (2026-08-22) `find src -name '*.tsx'` → `0`; no react/ReactDOM imports outside the examples; no `react` in `.eslintrc`; no `@testing-library/react` usage. Confirmed. Also found `cytoscape-dagre` is dead too (missing from the table) — removed it as well.
      - `find src -name '*.tsx' | wc -l`  → expect `0`
      - `grep -rn "from ['\"]react\|require(['\"]react\|ReactDOM" src/test src/web src/server src/shared` (excl. `examples`) → expect empty
      - `grep -rn "react" .eslintrc` → expect empty
      Confirm none of the table in the Evidence section is imported outside `src/examples/`.
- [x] **2.2 Decide disposition of `src/examples/`** ✅ owner chose **archive + drop deps**: moved to `docs/archive/examples/` via `git mv` (88 files, git history preserved); note added to `docs/archive/README.md`.
      - Recommended: move `src/examples/gun-react/` and `src/examples/opencodedemo/` into
        `docs/archive/` (or a top-level `archive/`) so they are clearly historical and out of the
        active source tree; this makes the dependency removal unambiguous and future-proofs the
        "examples look like live code" confusion.
      - If the owner prefers to keep the demos in-tree, then keep the deps and **stop** — do not
        remove them. Do not do both.
- [x] **2.3 Remove the dead `devDependencies`** from `package.json` (2.2 = archive) ✅ dropped: `react`, `react-dom`, `react-cytoscapejs`, `cytoscape`, `@testing-library/react`, `@babel/preset-react`, and **`cytoscape-dagre`** (extra vs table).
      `react`, `react-dom`, `react-cytoscapejs`, `cytoscape`, `@testing-library/react`,
      `@babel/preset-react`.
- [x] **2.4 Remove `@babel/preset-react`** from `babel.config.js` (line 1) ✅ kept `@babel/env` + the transform plugins.
      the three transform plugins.
- [x] **2.5 Clean stale React hooks:**
      - `webpack.config.prod.js:10` — remove the `styled-components` `ProvidePlugin` entry (or the
        whole ProvidePlugin if it becomes empty). It references a package that isn't a dependency.
      - Verify no other `webpack.*` / `jest` / `.eslintrc` / `tsconfig*` React-specific config
        (`jsx`, `jsxFactory`, `jsxImportSource`, `emotion`/`styled-components` globals) remains.
        ✅ **DEVIATION (verified-irrelevant):** `webpack.config.prod.js` is a fully **orphaned**
        legacy config — referenced by NO build/test script (every webpack invocation uses
        `webpack.config.js`), and its `styled-components` reference sits in `externals` of an
        unrelated "ReactSimpleChatbot" UMD build, **not** a `ProvidePlugin`. It is already dead
        and out of every pipeline, so it was left untouched rather than force an edit describing
        a mechanism the file doesn't have. tsconfig/jest `src/examples/**` exclusions now resolve
        to nothing (harmless future-proof guard).
- [x] **2.6 Reinstall to sync the lockfile:** ✅ did `npm install` (deviation: lighter than the full `rm -rf` wipe, same lockfile result — npm removed 21 packages: the 7 + transitive react-dom/cytoscape tree). Also regenerated `docs/dependency-sbom.json` via `npm run sbom`.
      (this is a devDependency-only change; do **not** `npm prune --production` before any build).
- [x] **2.7 Verify:** ✅ all green (2026-08-22): `test:type` RC0, `lint` RC0, `test:unit` 1478/1478, `build:web` (bundle.js 1.3M > 500KB), `build:server` OK, live boot HTTPS :8080 serving SPA at `/` + `/health` → 200.
      `npm run test:unit` all green. Then `npm run build:web` and `npm run build:server` succeed.
      Confirm the produced `dist/web/bundle.js` is still > 500 KB and the app boots
      (`npm run dev` → health check 200).
- [x] **2.8 Commit** — done as `2f0b7355` on branch `refactor/ui-decompose-and-deps-clean`.
      `chore: remove unused React 19 dependency graph (framework-free TS UI; examples archived)`.

**Definition of done #2:** `package.json` no longer lists any React artifact; `npm ls react react-dom`
returns "empty" / not-found; the app builds and boots identically; all unit tests + type check green. ✅ **Met.** (Caveat: `npm ls react` is *not* empty — `react` survives as a react-native transitive via `helia → @libp2p/webrtc`, part of the native client, correct to keep. All *direct* React artifacts are gone; `npm ls react-dom` and each other return not-found.)

---

## Issue #1 — Decompose the `ui-manager.ts` god-object (phase-by-phase)

> Strategy: **extract, don't rewrite.** Use the existing `ui-extracted-modules` pattern. Keep the
> public API stable through delegation shims in `ui-manager.ts`. Extracted modules must take typed,
> explicit dependencies and must not import `UIManager`, reach through a singleton, or mutate a DOM
> subtree owned by another renderer.

- [x] **1.0 Baseline (mandatory gate).** The former route-editor collision has landed, including
      route reset/self-answer behavior and the stage2/93 fan-out E2E. Record the current baseline:
      - `ui-manager.ts`: 11,793 lines; `app.ts`: 6,531 lines.
      - Run `npm run test:all` and record wall-clock/per-phase timings.
      - Keep unrelated local files such as the user-owned `AGENTS.md` outside the refactor diff.
      The implementation baseline is not complete until the canonical gate ends green.
      - The first 2026-08-24 run exposed one real stage2/21c regression: a policy-rejected adult
        offer was written to the sender's anti-repeat ledger before the receiver accepted it, so
        reaching the three-vouch threshold could not make the offer retryable. Mesh delivery now
        reports signed recipient ACKs and the sender records only accepted deliveries.
      - Canonical rerun `run-20260824-181749-67574`: all static checks and all 12 browser blobs
        passed in 16m36s. Stage2/21c also passed twice alone after the fix, and stage2/93's real
        route fan-out E2E remains green.
- [x] **1.1 Add a ratcheting growth guardrail.** Started at 11,793, lowered with the first
      extraction to 11,197, with cluster #2 to 10,830, and with cluster #3 to a test-enforced
      ceiling of **10,280**
      lines. Lower the ceiling in the same commit as every extraction; never raise it merely to land
      unrelated feature work. Line count is a warning metric, not the architecture definition.
- [x] **1.2 Profile coupling before extracting (measured, not guessed).** The initial AST proxy
      counted method size and distinct `this.*` references, then checked DOM/event/state ownership:
      - **First: route-talk DAG editor.** `renderRouteEditor` is about 344 lines with only three
        distinct `this.*` dependencies; its state and model conversions are concentrated in one
        range. The former in-flight collision is now merged.
      - **Second: survey statistics.** The final measured block was 385 removed lines (dialog,
        dashboard rendering, filtering, CSVs, download side effect, and follow-up construction).
        Its only instance boundaries were local talk lookup, translations, notification/download,
        and opening the existing talk editor, so it was extracted as cluster #2.
      - **Third: application shell.** `setupBaseUI` was 460 lines with only six `this.*`
        references, and the adjacent `applyShellTranslations` was 112 lines with two dependencies.
        The 451-line template and repeatable localization pass are deterministic shell work;
        translation and language options are their only data inputs. Navigation and listener
        ownership stay in `UIManager`, making this a low-coupling cluster despite its broad DOM
        surface.
      - **Defer: `displayTalksList`.** It is about 679 lines and touches roughly 52 distinct instance
        members, so it is a poor first extraction despite its size.
      Re-measure after every cluster. `this.*` counts are only a filter; also inspect DOM ownership,
      event subscriptions, async callbacks, mutable collections, imports, and possible cycles.
- [x] **1.3 Characterize cluster #1 before moving it.** Tests freeze route fan-out ordering and
      thresholds, built-in compatible branching, self-answer traversal, safe escaping, input
      mirroring, and existing-talk rehydration. For later clusters, repeat these rules:
      - Freeze pure model results, meaningful DOM output, event behavior, focus/accessibility, and
        listener cleanup where applicable.
      - Existing tests may change imports, fixtures, and mocks during extraction, but behavioral
        expectations must not change unless a separate bug fix is documented.
      - Cluster #2 adds characterization for CSV quoting, low-cohort region masking, anonymity
        toggle state, time-filter reaggregation, escaped labels/titles, modal lifecycle, and bounded
        follow-up draft construction.
      - Cluster #3 freezes main-panel/navigation order, the active first-paint view, reply-language
        options, localized accessibility text, Chinese navigation labels, and retranslation of an
        already-open filter toggle before moving the shell template/localization pass.
- [x] **1.4 Extract cluster #1:** `route-editor-model.ts` now owns pure initialization,
      self-answer traversal, and validator serialization; `route-editor-controller.ts` owns its
      DOM and event wiring. `UIManager` retains thin state/text delegation and its existing call
      surface. For later clusters:
      - Create `src/web/ui/<cluster-name>.ts` exporting focused, pure-or-injected functions
        (dependency-injected callbacks, exactly like `talk-editor-form-helpers.ts` /
        `my-talks-dialog.ts` do), **not** more `singleton.instance` calls.
      - Move behavior first. Separate pure model conversion from DOM/event control when the cluster
        contains both; do not mix a behavior rewrite into the move.
      - Add re-export / delegation in `ui-manager.ts` so `app.ts` and any existing internal call
        sites keep compiling unchanged.
      - Cluster #2: `survey-statistics-model.ts` owns labels, CSV serialization, privacy threshold,
        metric cards, and follow-up drafts. `survey-statistics-dialog.ts` owns local aggregation,
        modal/dashboard DOM, filters, exports, and callbacks. `UIManager` retains a thin entry shim
        plus the browser download/notification side effect; neither extracted module imports it.
      - Cluster #3: `app-shell.ts` owns deterministic first-paint markup and repeatable shell
        localization with explicit translated-text, language-option, and language-label inputs.
        `UIManager.setupBaseUI()` remains the controller shim that installs listeners, bottom
        navigation, AppBar chrome, and the initial view state.
- [x] **1.5 Verify after every extraction:**
      - `npm run test:type` + `npm run lint` + `npm run test:unit` green.
      - `npm run test:all` green **before** starting the next cluster.
      - If a cluster is causing flakes unrelated to the extraction, stop and isolate it before
        continuing (don't stack unexplained failures on the refactor).
      - Cluster #1 evidence: typecheck and lint pass; 145 unit suites / 1,590 tests pass; the
        canonical route E2E passes; `test:all` run `run-20260824-181749-67574` passed every static
        check and all 12 browser blobs in 16m36s.
      - Cluster #2 evidence: typecheck/lint and 146 unit suites / 1,593 tests pass. The compact-row
        Results-popup E2E passes. The formerly stale-ignored full survey analytics E2E was restored,
        updated for the long-press popup contract, and passes both alone and in the 12-worker light
        shard. Canonical run `run-20260824-185020-77985` passed all 12 blobs before that test-config
        restoration. The post-restoration run `run-20260824-190943-86105` passed static checks, the
        restored analytics test, and 11/12 phases; its sole unrelated expired-talk visibility race
        passed immediately alone, then the complete light shard passed 233 tests (6 skipped) in
        9.6m. All other phases from that run were green.
      - Cluster #3 evidence: the original and injected shell template/localization statements are
        mechanically equivalent;
        typecheck/lint, the production web build, and 146 unit suites / 1,596 tests pass. Canonical
        run `run-20260824-203147-12032` passed all static checks and all 12 browser blobs in 16m46s,
        including the full light shard, WebKit/Firefox smoke coverage, and mass-user phase.
- [x] **1.6 Record progress** in `docs/completed.md` per the docs maintenance rule
      ("when a feature ships, record concrete file/test evidence") and check off the relevant box
      here.

**Targets / definition of done #1:**
- [ ] `ui-manager.ts` reduced from **11,793 → < 3,000 lines** (aim to make it a thin router of
      delegations; the substance lives in cohesive `src/web/ui/*.ts` modules).
- [x] No behavior regression: `test:all` is green and behavioral expectations remain stable.
- [x] The growth guardrail (1.1) is in place and passing.
- [ ] `src/web/app/app.ts` keeps its stable `UIManager` contract until a separately approved API
      reduction: methods, event payloads, DOM contracts, focus, and listener lifecycle are preserved.
- [ ] Extracted modules do not import `UIManager`, introduce singleton reach-through, or form cycles.
- [ ] The work has not merely moved the god-object: new modules are cohesive, explicitly injected,
      and small enough to review and test independently.

**Risks & guardrails for #1:**
- `ui-manager.ts` is an **EventEmitter singleton** — many methods rely on shared mutable `this.`
  state and event wiring. Extraction must preserve the *instance* (the singleton) for cross-cluster
  side effects; you are moving *pure render/calc/logic* functions to take explicit params, not
  splitting the singleton itself.
- Do **not** parallelize builds/testing while mutating `node_modules`.
- Keep every cluster small and independently green — bisectability is the whole point.
- The macOS case-insensitivity trap: `~/Iinpublic/` and `~/IinPublic/` resolve to the same path —
  verify target paths before any destructive file move.

---

## Current sequence

1. ~~Establish the canonical green baseline and add the 11,793-line ratchet.~~ Done.
2. ~~Add route-editor model and DOM characterization tests.~~ Done.
3. ~~Extract pure route-model conversion/self-answer logic.~~ Done.
4. ~~Extract the route-editor DOM/event controller behind `UIManager` delegation.~~ Done.
5. ~~Lower the ratchet, run the full gate, and record evidence.~~ Done; choose cluster #2 from the
   measured candidates before moving more code.
6. ~~Characterize and extract cluster #2 (survey statistics).~~ Done; model/controller split keeps
   the `UIManager` entry contract and isolates the browser download side effect.
7. ~~Lower the ratchet to 10,830 and restore the deterministic full analytics E2E.~~ Done; focused
   and full-shard coverage is green.
8. ~~Re-measure the remaining clusters before choosing cluster #3.~~ Done; `displayTalksList`
   remains deferred at about 685 lines / 52 dependencies, while the 460-line / six-dependency
   application shell was selected.
9. ~~Characterize and extract cluster #3 (application shell), lower the ratchet to 10,280, and
   close its canonical verification gate.~~ Done; canonical run `run-20260824-203147-12032` is green.
10. Re-measure and choose cluster #4 as a separate commit-sized change; keep
    `displayTalksList` deferred unless its ownership boundary is first reduced.

Issue #2 remains a separate completed commit. Its former owner question is resolved: the examples
were archived and the unused direct React dependency graph was removed. A future, intentional React
evaluation is specified separately in `docs/TODO-react-cross-platform-performance.md`.
