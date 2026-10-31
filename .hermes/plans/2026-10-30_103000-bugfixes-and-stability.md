# IinPublic Bugfix & Stability Plan (no new features)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Restore the canonical full-test safety net (red for ~30 days), fix the config drift behind it, and close the process gaps that let it stay red.

**Architecture:** No product-code changes except test/build guards. Work is config repair, verification re-run, and small tooling/process hardening.

**Tech Stack:** Node/Jest/Playwright, bash, the existing `scripts/techsupport-key-tool.js` vault tooling.

---

## Verified current status (2026-10-30)

GREEN (verified this session):
- Working tree clean on dev.qwen, version 1.0.207, typecheck + lint pass (nightly cron 10-30).
- Both architecture-budget suites pass: `ui-manager.ts` 3,147/3,160 lines; all extracted modules <= 1,200 (commit 4dba21e2 fixed the 10-28 world-map overflow).
- Product work is healthy: OPEN-91 device-core migration landing in verified slices; phones on 1.0.202/1.0.203 with real-device gates passing.

RED (verified this session):
- `npm run test:all` has FAILED every night since at least 2026-10-01 (30 consecutive cron reports, `~/.hermes/cron/output/7c9724ccb9f2/`). All 9 E2E phases die at webServer boot; ~13 jest suites fail. Zero full-suite signal for a month, spanning the 1.0.200–1.0.203 releases.
- Root cause: `.env.local` in THIS worktree still sets `TECHSUPPORT_SEA_PAIR_JSON` to the pre-rotation key (`mYRexx…`). Trust anchors (`src/shared/techsupport-trust-anchors.json`) were rotated 2026-09-27 (commit b4b58d6c, current = `g35P25RL…`). The server correctly fails closed: "Configured TechSupport announcement key … is not the current announcement key".
- The current key exists on this machine: `/Users/hongyujiang/IinPublic.claude/.env.local` has the correct pair; the encrypted vault is `/Users/hongyujiang/IinPublic.claude/secrets/techsupport-master.key.json` (+ `.passphrase`). The 9/27 rotation happened in that worktree; this one was never synced.

RISKS / DEBT:
- 27 unpushed commits on dev.qwen (single-machine durability risk).
- The nightly failure was reported to Telegram 30× without anyone converting it into a tracked issue — a process gap, not a tooling gap (the server guard worked as designed).
- 141 `test.skip`/`describe.skip`/`fixme` markers in `tests/` — never audited; mix of intentional env-conditional skips and possibly stale disabled coverage.
- Xcode license unaccepted: `/usr/bin/git` and `python3` shims exit 69 (workaround: CLT git at `/Library/Developer/CommandLineTools/usr/bin/git`); blocks OPEN-26 iOS custody adapter.
- Windows NSIS installer still unbuildable on this M4 Mac (electron-builder ships x86-only Wine); only a Windows runner/VM fixes it (ties to deferred OPEN-12/OPEN-07).
- `src/web/app/app.ts` is 10,083 lines and grew ~220 lines since 10-26; extraction continues under OPEN-91 P4/P5.4 (already queued — keep as-is).

---

## Phase 0 — Restore the safety net (do first, same day)

### Task 1: Sync the TechSupport key into this worktree's `.env.local`

**Objective:** Make `npm run test:all` boot again by giving this worktree the post-rotation pair.

**Files:**
- Modify: `.env.local` (git-ignored, never committed)
- Source of truth: `/Users/hongyujiang/IinPublic.claude/.env.local` (verified pub prefix `g35P25RL1NgXjTZz` = anchor current)

**Step 1: Replace only the `TECHSUPPORT_SEA_PAIR_JSON` line** in `/Users/hongyujiang/IinPublic/.env.local` with the line from `/Users/hongyujiang/IinPublic.claude/.env.local`. Do not print the value to chat/logs; copy file-to-file (e.g. a small node script that reads both files and rewrites the one line). Keep file mode 600.

**Step 2: Verify pub matches anchor without printing secrets**

Run:
```bash
node -e "
const fs=require('fs');
const raw=fs.readFileSync('.env.local','utf8').match(/TECHSUPPORT_SEA_PAIR_JSON=(.*)/)[1].trim().replace(/^['\"]|['\"]\s*$/g,'');
const pub=JSON.parse(raw).pub;
const a=JSON.parse(fs.readFileSync('src/shared/techsupport-trust-anchors.json','utf8')).announcement.current;
console.log('MATCH:', pub===a);
"
```
Expected: `MATCH: true`

**Step 3: Sanity-boot the compiled config path**

Run: `npx jest src/test/unit/system-routes.test.ts 2>&1 | tail -5` (one of the 13 previously failing suites)
Expected: PASS (previously "Expected 200, got non-200")

### Task 2: Full verification run

**Step 1:** Run `npm run test:all` (10–20 min, sequential — user prefers sequential over parallel for comparable results).
**Step 2:** Expected: type PASS, lint PASS, jest ~3,6xx pass with only the known intentional skips, all 9 E2E phases execute. If anything else fails, record it as a new OPEN-xx in `docs/TODO.md` before proceeding — do not fix forward blindly.

### Task 3: Prevent silent env drift recurring

**Objective:** A stale `.env.local` must fail loudly and locally before a full suite run, with a remediation hint.

**Files:**
- Create: `scripts/check-env-drift.js` — compares `TECHSUPPORT_SEA_PAIR_JSON` pub against `techsupport-trust-anchors.json` `announcement.current`; prints the exact fix (vault path / sibling-worktree sync) and exits 1 on mismatch. Tolerates the var being unset (documented "unconfigured" mode).
- Modify: `package.json` — add `"doctor:env": "node scripts/check-env-drift.js"` and wire it as `"pretest:all"` so `test:all` fails in <5s with a clear message instead of 30 days of red nights.

**Step 1:** Write `scripts/check-env-drift.js` (compare pubs only; never print private fields).
**Step 2:** Run `npm run doctor:env` — Expected: exit 0 after Task 1.
**Step 3:** Temporarily break `.env.local` (comment the line to a bogus pub), run `npm run doctor:env` — Expected: exit 1 with remediation text. Restore.
**Step 4:** Commit: `git add scripts/check-env-drift.js package.json && git commit -m "chore: fail fast on TechSupport env/anchor drift before test:all"`

## Phase 1 — Close the process gaps

### Task 4: Make nightly cron failures actionable

**Objective:** A red night must surface in the agent's own context, not only Telegram.

**Files:**
- Modify: the cron job prompt (`cronjob_manage`, job `7c9724ccb9f2`) — add: "On FAIL, also append a dated summary to `memory/YYYY-MM-DD.md` and add a 'NIGHTLY RED' line to `HEARTBEAT.md`; on PASS, remove any 'NIGHTLY RED' line."

**Step 1:** Update the cron job prompt.
**Step 2:** Verify next scheduled run (or manual trigger) writes the memory note on failure.

### Task 5: Push the 27 unpushed commits

**Step 1:** `git push origin dev.qwen` (after Phase 0 is green).
**Step 2:** Add "unpushed commits" to the nightly cron summary so drift is visible going forward.

## Phase 2 — Debt burn-down (after Phase 0/1)

### Task 6: Audit skipped tests

**Step 1:** List all 141 skip/fixme sites: `grep -rn "test.skip\|describe.skip\|it.skip\|test.fixme" tests/ --include="*.ts"`.
**Step 2:** Classify each: (a) intentional env/hardware-conditional (e.g. `describeWithRealTechSupportPair`, browser-matrix), (b) stale/disabled coverage. Write the classification to `docs/testing/skipped-tests-audit.md`.
**Step 3:** File one OPEN-xx per stale cluster in `docs/TODO.md`; do not mass-unskip without owners.

### Task 7: Environment fixes needing the owner (list in OWNER-TODO, no agent action)

- `sudo xcodebuild -license accept` — repairs git/python3 shims, unblocks OPEN-26.
- Windows installer: decide between a Windows CI runner (OPEN-12) or a local VM; NSIS cannot build on this Mac (x86-only Wine in electron-builder).

### Task 8: Continue OPEN-91 P4/P5.4 extraction as already queued

No scope change — `app.ts` extraction and host-command migration proceed per `docs/TODO.md`. This plan adds nothing new here; it only unblocks the full-suite verification those slices need.

---

## Risks / open questions

- Key material handling: `.env.local` is git-ignored and must stay so; never print `priv`/`epriv` to logs or chat; the vault in `IinPublic.claude/secrets/` remains the durable local copy until OPEN-77's offline-backup ceremony.
- If Task 2 surfaces real product failures hidden by the month of red, they become new OPEN issues — that is the expected cost of the safety net being down, and the reason Phase 0 comes first.
- Long-term, the three worktrees (`IinPublic`, `IinPublic.claude`, `IinPublic.codex`) each keep their own `.env.local`; `doctor:env` makes drift visible but syncing remains manual by design (secrets don't belong in git).
