#!/usr/bin/env node
/**
 * Fast local-env drift check, wired as `pretest:all` so a stale `.env.local` fails in
 * seconds with a remediation hint instead of producing a full night of red E2E phases.
 *
 * Checks that a configured TECHSUPPORT_SEA_PAIR_JSON matches the current TechSupport
 * announcement trust anchor in src/shared/techsupport-trust-anchors.json. The server
 * fails closed on this mismatch at boot, which is correct but expensive to discover
 * from a 20-minute suite run.
 *
 * Rules:
 * - Unset variable is OK: the server tolerates unconfigured mode and the real-pair
 *   jest suites skip themselves by design (see src/test/support/techsupport-real-pair.ts).
 * - Only public halves are ever printed. Never print priv/epriv.
 * - process.env wins over .env.local so the check can be exercised without editing
 *   the real file: TECHSUPPORT_SEA_PAIR_JSON='...' npm run doctor:env
 *
 * Background: each sibling worktree (IinPublic, IinPublic.claude, IinPublic.codex)
 * keeps its own git-ignored .env.local, so a key rotation performed in one worktree
 * silently breaks the others. After any rotation, sync the line into every worktree.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const anchorsPath = path.join(root, 'src', 'shared', 'techsupport-trust-anchors.json');
const envPath = path.join(root, '.env.local');

function fail(message, hints) {
  console.error(`doctor:env FAIL — ${message}`);
  for (const hint of hints) console.error(`  fix: ${hint}`);
  process.exit(1);
}

function readEnvValue(file, name) {
  if (!fs.existsSync(file)) return null;
  const line = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  if (!line) return null;
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]\s*$/g, '');
}

const anchors = JSON.parse(fs.readFileSync(anchorsPath, 'utf8'));
const current = anchors.announcement && anchors.announcement.current;
if (!current) fail('trust anchors file has no announcement.current', ['restore src/shared/techsupport-trust-anchors.json']);

const raw = process.env.TECHSUPPORT_SEA_PAIR_JSON || readEnvValue(envPath, 'TECHSUPPORT_SEA_PAIR_JSON');
if (!raw) {
  console.log(
    'doctor:env OK — TECHSUPPORT_SEA_PAIR_JSON unset (unconfigured mode; real-pair suites will skip)',
  );
  process.exit(0);
}

let pair;
try {
  pair = JSON.parse(raw);
} catch {
  fail('TECHSUPPORT_SEA_PAIR_JSON is not valid JSON', [
    're-copy the line from a worktree with a known-good .env.local (e.g. ~/IinPublic.claude/.env.local)',
  ]);
}

for (const field of ['pub', 'priv', 'epub', 'epriv']) {
  if (!pair[field]) fail(`TECHSUPPORT_SEA_PAIR_JSON is missing "${field}"`, ['re-copy the complete SEA pair JSON']);
}

if (pair.pub !== current) {
  const trusted = (anchors.announcement.trusted || []).map(String);
  const isRetired = trusted.includes(pair.pub);
  fail(
    `configured TechSupport announcement key (${pair.pub.slice(0, 12)}…) is ${
      isRetired ? 'a retired/trusted key, not' : 'not'
    } the current announcement key (${current.slice(0, 12)}…). The server refuses to boot with this drift.`,
    [
      'sync the TECHSUPPORT_SEA_PAIR_JSON line from a post-rotation worktree, e.g.:',
      '  grep ^TECHSUPPORT_SEA_PAIR_JSON= ~/IinPublic.claude/.env.local  → replace the line in this .env.local',
      'or decrypt the vault per docs/security/techsupport-key-custody-and-rotation.md',
      'or unset the variable to run in unconfigured mode (real-pair suites will skip)',
    ],
  );
}

console.log(`doctor:env OK — TechSupport announcement key matches current anchor (${current.slice(0, 12)}…)`);
