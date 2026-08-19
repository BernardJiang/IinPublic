# TODO — UI God-Object Refactor & Unused React Dependency Cleanup

**Status:** Proposed work order (not started). No code has been changed.
**Written:** 2026-08-18 by Hermes Agent (from an architecture study of the repo).
**Intended executor:** Claude Code.
**Branch:** Create a fresh branch off `dev` when this work begins.
**⚠️ In-flight collision:** As of 2026-08-18 the working tree on `dev` has **uncommitted** changes to
`src/web/ui/ui-manager.ts` (a route-editor self-answer fix: `buildRouteSelfAnswers`,
`routeEditorQuestions` reset in `showTalkEditorDialog`) and `scripts/run-test-all.sh`
(worker tuning 12→14). **Do not start the extraction (Section B) until that in-flight work
is committed/landed and `npm run test:all` is green**, so any regression is attributable to the
refactor and not to concurrent edits in the same file.

This document captures two issues found during an architecture study of `src/`:

- **Issue #1** — `src/web/ui/ui-manager.ts` is an 11,148-line singleton god-object.
- **Issue #2** — React 19 and a React toolchain are declared as dependencies, but the real UI is
  framework-free hand-rolled DOM; the only React consumers are a legacy `src/examples/` demo that
  is excluded from every build and test pipeline and is not even installable (it imports packages
  that are not in `package.json`).

Both issues share one root cause: an early **Gun + React proof-of-concept** was superseded by a
framework-free TS UI, but (a) the UI monolith was never decomposed and (b) the React manifest
entries and babel preset were never removed.

---

## Evidence (verified, 2026-08-18)

### Issue #1 — the god-object

- `src/web/ui/ui-manager.ts` = **11,148 lines**, a single `export class UIManager extends EventEmitter`.
  It is the largest file in `src/` by more than 7× (next is `src/web/app/app.ts` at 6,373).
- `src/web/` = 40,050 LOC; `src/test/` = 23,141 LOC; `src/shared/` = 15,241; `src/server/` = 5,327.
  Testing is ~28% of the codebase and there is **already a working extraction pattern** to follow:
  - `src/test/unit/ui-extracted-modules.test.ts` imports from `my-talks-dialog`, `preferences-dialog`,
    `conversations-view`, `user-detail-view`, `talk-editor-form-helpers`, `ui-settings-storage`, etc.
  - So "extract a cohesive cluster into `src/web/ui/<module>.ts` and have `ui-manager.ts` delegate"
    is the established, tested convention — not a new risk.

### Issue #2 — unused React dependency graph

- **Zero `.tsx` files** in `src/`. `grep` for React imports in `src/{web,server,shared}` (excluding
  `examples`) returns **nothing**.
- All React usage is confined to `src/examples/gun-react/` and `src/examples/opencodedemo/`:
  - `src/examples/gun-react/*.js` import `react`, `react-dom`, `react-cytoscapejs`, and also
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

- [ ] **2.1 Freeze the evidence.** Re-run and record:
      - `find src -name '*.tsx' | wc -l`  → expect `0`
      - `grep -rn "from ['\"]react\|require(['\"]react\|ReactDOM" src/test src/web src/server src/shared` (excl. `examples`) → expect empty
      - `grep -rn "react" .eslintrc` → expect empty
      Confirm none of the table in the Evidence section is imported outside `src/examples/`.
- [ ] **2.2 Decide disposition of `src/examples/`** (ask the owner if unsure):
      - Recommended: move `src/examples/gun-react/` and `src/examples/opencodedemo/` into
        `docs/archive/` (or a top-level `archive/`) so they are clearly historical and out of the
        active source tree; this makes the dependency removal unambiguous and future-proofs the
        "examples look like live code" confusion.
      - If the owner prefers to keep the demos in-tree, then keep the deps and **stop** — do not
        remove them. Do not do both.
- [ ] **2.3 Remove the dead `devDependencies`** from `package.json` (only if 2.2 = move/archive):
      `react`, `react-dom`, `react-cytoscapejs`, `cytoscape`, `@testing-library/react`,
      `@babel/preset-react`.
- [ ] **2.4 Remove `@babel/preset-react`** from `babel.config.js` (line 1). Keep `@babel/env` and
      the three transform plugins.
- [ ] **2.5 Clean stale React hooks:**
      - `webpack.config.prod.js:10` — remove the `styled-components` `ProvidePlugin` entry (or the
        whole ProvidePlugin if it becomes empty). It references a package that isn't a dependency.
      - Verify no other `webpack.*` / `jest` / `.eslintrc` / `tsconfig*` React-specific config
        (`jsx`, `jsxFactory`, `jsxImportSource`, `emotion`/`styled-components` globals) remains.
- [ ] **2.6 Reinstall to sync the lockfile:** `rm -rf node_modules package-lock.json && npm install`
      (this is a devDependency-only change; do **not** `npm prune --production` before any build).
- [ ] **2.7 Verify:** `npm run type` (or `npm run test:type`) + `npm run lint` +
      `npm run test:unit` all green. Then `npm run build:web` and `npm run build:server` succeed.
      Confirm the produced `dist/web/bundle.js` is still > 500 KB and the app boots
      (`npm run dev` → health check 200).
- [ ] **2.8 Commit** with a message like:
      `chore: remove unused React 19 dependency graph (framework-free TS UI; examples archived)`.

**Definition of done #2:** `package.json` no longer lists any React artifact; `npm ls react react-dom`
returns "empty" / not-found; the app builds and boots identically; all unit tests + type check green.

---

## Issue #1 — Decompose the `ui-manager.ts` god-object  (the big one — do phase-by-phase)

> Strategy: **extract, don't rewrite.** Use the existing `ui-extracted-modules` pattern. Keep public
> API stable by leaving re-export / delegation shims in `ui-manager.ts` so `src/web/app/app.ts`
> import sites don't change. One cluster per commit, verified by the full suite each time. Do NOT
> attempt to rewrite the 11k lines in one move.

- [ ] **1.0 Baseline (mandatory gate).** Ensure the in-flight work in `dev` is committed/landed.
      Get a clean tree, then run the canonical gate and record numbers:
      - `npm run test:all` → must end **green** (this is the project's canonical full-verification
        script — prefer it over partial e2e variants).
      - Record: wall-clock duration, per-phase timings, and `find src/web/ui/ui-manager.ts | xargs wc -l`.
- [ ] **1.1 Add a growth guardrail (small, safe, do first).** Add a Jest test that asserts
      `src/web/ui/ui-manager.ts` line count stays **at or below the post-refactor baseline** (so
      future work can't re-bloat it). Also add a size-budget test on the whole `src/web/ui/` folder
      if useful. This makes the refactor self-enforcing.
- [ ] **1.2 Profile coupling before extracting (measured, not guessed).** For each candidate cluster,
      count how many of its methods reference shared `this.` state or other clusters (e.g. grep for
      `this\.` inside the candidate range). **Pick the largest cluster with the fewest cross-refs
      first.** Strong candidates (verify at execution time that coupling is low):
        - Route-talk DAG editor (`routeEditorQuestions`, `ensureRouteEditorRendered`,
          `buildRouteSelfAnswers`, `toValidatorQuestions`, route self-answer logic) — *but this is
          the area currently being edited in-flight, so it is a natural **second** target once the
          in-flight change lands.*
        - Contacts / local-contacts rendering + `contact-groups` interplay.
        - Survey/analytics dashboard rendering clusters.
        - Chatroom navigation / hierarchy rendering.
      Record the chosen first target + its measured cross-ref count in this doc before starting.
- [ ] **1.3 Extract cluster #N** (repeat 1.3–1.5 per cluster):
      - Create `src/web/ui/<cluster-name>.ts` exporting focused, pure-or-injected functions
        (dependency-injected callbacks, exactly like `talk-editor-form-helpers.ts` /
        `my-talks-dialog.ts` do), **not** more `singleton.instance` calls.
      - Move the code verbatim first (preserving behavior), then only touch internals if tests demand.
      - Add re-export / delegation in `ui-manager.ts` so `app.ts` and any existing internal call
        sites keep compiling unchanged.
      - Add/extend a unit test in the `ui-extracted-modules` style covering the extracted functions.
- [ ] **1.4 Verify after every extraction:**
      - `npm run test:type` + `npm run lint` + `npm run test:unit` green.
      - `npm run test:all` green **before** starting the next cluster.
      - If a cluster is causing flakes unrelated to the extraction, stop and isolate it before
        continuing (don't stack unexplained failures on the refactor).
- [ ] **1.5 Record progress** in `docs/completed.md` per the docs maintenance rule
      ("when a feature ships, record concrete file/test evidence") and check off the relevant box
      here.

**Targets / definition of done #1:**
- [ ] `ui-manager.ts` reduced from **11,148 → < 3,000 lines** (aim to make it a thin router of
      delegations; the substance lives in cohesive `src/web/ui/*.ts` modules).
- [ ] No change to public behavior: `test:all` fully green with **no** test edits other than adding
      new unit tests for extracted units and removing tests that only existed to cover now-private
      internals.
- [ ] The growth guardrail (1.1) is in place and passing.
- [ ] `src/web/app/app.ts` import surface unchanged (shims in `ui-manager.ts` preserve it).

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

## Suggested branch & sequence

```
git switch -c refactor/ui-decompose-and-deps-clean dev   # from dev, AFTER in-flight work lands
# Commit A (Section B, Issue #2): deps cleanup — small, verified, shippable on its own.
# Commit B..N (Section A, Issue #1): one UI cluster per commit, each gated by a green `npm run test:all`.
```

Keep Section B (Issue #2) and Section A (Issue #1) as **separate commits / PRs** so a UI refactor
flake can never be blamed on the dependency cleanup (or vice versa).

## Open question for the owner

1. **Dispositon of `src/examples/`** (Issue #2, step 2.2): archive it and drop the React deps
   (recommended), or keep the demos in-tree and retain the deps? Your call — I did not want to
   delete anything or change the manifest without that decision.
