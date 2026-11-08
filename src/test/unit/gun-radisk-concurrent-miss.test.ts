/** @jest-environment node */

// Gun 0.2020's radisk loses the answer to some of several concurrent reads of absent souls when
// the node is loaded from disk (a fresh Gun over existing radata, as every phone start is): the
// once() callback never comes, and the device core's read failed with "storage did not answer"
// (Android sweep 2026-11-08, native-app/06 on every native core: `exchange.state()` reads each
// peer's ix/exchanged and ix/co at once, and ix/co is absent until that peer answered).
// gunNodeReader asks again; this runs the real reader over real radisk in a child process, as on
// the phone (Jest's module sandbox does not load Gun's storage plugins the same way).

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

// Phase "write" fills a radata folder and exits; phase "read" is a fresh process over it (a phone
// start): empty memory, every read comes from disk.
const SCRIPT = `
console.log = () => {};
const Gun = require('gun'); const fs = require('fs'); const crypto = require('crypto');
const { gunNodeReader } = require(${JSON.stringify(path.join(ROOT, 'src/core/graph-store.ts'))});
const [phase, dir, reaskMs] = [process.argv[2], process.argv[3], Number(process.argv[4])];
const gun = Gun({ file: dir + '/radata', peers: [], multicast: false, axe: false, localStorage: false, WebSocket: function () {} });
(async () => {
  if (phase === 'write') {
    const put = (soul, v) => new Promise((ok, no) => gun.get(soul).put(v, (a) => a && a.err ? no(new Error(a.err)) : ok()));
    const peers = Array.from({ length: 8 }, () => crypto.randomUUID());
    fs.writeFileSync(dir + '/peers.json', JSON.stringify(peers));
    for (let i = 0; i < 8; i++) await put('local/ev/e' + i, { v: 1, title: 'x'.repeat(100), seq: i });
    for (const [i, p] of peers.entries()) {
      await put('local/ix/exchanged/' + p, { ['a' + i]: { '#': 'local/ev/e' + i } });
      if (i % 2 === 0) await put('local/ix/co/' + p, { ['a' + i]: { '#': 'local/ev/e' + i } });
    }
    setTimeout(() => process.exit(0), 1500); // radisk flushes
    return;
  }
  const peers = JSON.parse(fs.readFileSync(dir + '/peers.json', 'utf8'));
  const read = gunNodeReader(gun, { missWaitMs: 0, getTimeoutMs: 6000, reaskMs });
  const souls = peers.flatMap((p) => ['local/ix/exchanged/' + p, 'local/ix/co/' + p]);
  const results = await Promise.all(souls.map((s) => read(s).then((d) => (d ? 'found' : 'absent'), () => 'no answer')));
  process.stdout.write(JSON.stringify({
    found: results.filter((r) => r === 'found').length,
    absent: results.filter((r) => r === 'absent').length,
    noAnswer: results.filter((r) => r === 'no answer').length,
  }));
  process.exit(0);
})().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e) })); process.exit(1); });
`;

function run(reaskMs: number): { found: number; absent: number; noAnswer: number; error?: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gun-concurrent-miss-'));
  const script = path.join(dir, 'run.cjs');
  fs.writeFileSync(script, SCRIPT);
  const node = (phase: string) => execFileSync(process.execPath, ['--import', 'tsx', script, phase, dir, String(reaskMs)], {
    cwd: ROOT, env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') }, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'],
  });
  try {
    node('write');
    const out = node('read');
    return JSON.parse(out.slice(out.indexOf('{')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Radisk concurrent reads of absent souls (Android sweep 2026-11-08)', () => {
  jest.setTimeout(90_000);

  it('without asking again some reads of absent souls are never answered (the Gun bug)', () => {
    // Documents the behaviour the re-ask works around; if a Gun upgrade fixes it, this flips.
    expect(run(0).noAnswer).toBeGreaterThan(0);
  });

  it('every read answers when the reader asks again: 12 found, 4 absent, none lost', () => {
    expect(run(500)).toEqual({ found: 12, absent: 4, noAnswer: 0 });
  });
});
