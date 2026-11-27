#!/usr/bin/env node
// Prints the phone-path spec files for shard <i> of <n>, balanced by measured run time.
// Used by scripts/run-test-all.sh, which runs each shard on its own hub and phone nodes.
// Files are dealt longest first to the shard with the least time so far. A file missing from
// SECONDS (a new spec) counts as 60 s; update the table when a spec's time changes a lot.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Seconds per file, from test:all 2026-11-26 (OPEN-121 run 1, three shards beside mass).
const SECONDS = {
  '01-place-journey': 50,
  '02-talk-match-chat-journey': 45,
  '03-place-refusals-and-expiry': 193,
  '04-mismatch-block-leave': 202,
  '05-restart-keeps-identity': 25,
  '06-rename': 45,
  '07-mesh-reconnect-delivery': 23,
  '07b-reconnect-from-either-side': 23,
  '08-nearby-v3-gossip': 19,
  '09-tag-graph-tour': 42,
  '10-hung-hub-responsiveness': 102,
  '11-delete-answer': 42,
  '12-signed-exchange-chain': 52,
  '13-phone-and-browser-talk': 18,
};

export function phonePathShards(files, n) {
  const cost = (f) => SECONDS[path.basename(f, '.spec.ts')] ?? 60;
  const shards = Array.from({ length: n }, () => ({ total: 0, files: [] }));
  for (const f of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
    const least = shards.reduce((a, b) => (b.total < a.total ? b : a));
    least.files.push(f);
    least.total += cost(f);
  }
  return shards.map((s) => s.files.sort());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [i, n] = process.argv.slice(2).map(Number);
  const dir = 'tests/e2e/phone-path';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts')).map((f) => `${dir}/${f}`);
  console.log((phonePathShards(files, n)[i - 1] ?? []).join(' '));
}
