/** @jest-environment node */

// A node larger than one Radisk file (1 MB) must read back whole after a restart.
// Found 2026-11-02 (OPEN-106 size benchmark): Gun's yson JSON.parseAsync, used by radisk on
// Node, damaged entries when it paused mid-object (a link's state key came back as
// "undefined"), radisk wrote the damage back, and Gun's merge loop then dropped the rest of the
// node: a 10,000-entry list read back as 2,539. scripts/patch-gun-radix.js makes radisk use
// plain JSON. Runs in a real Node child process, as on the phone (Jest's module sandbox does
// not load Gun's storage plugins the same way).

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

const SCRIPT = `
console.log = () => {};
const Gun = require('gun'); const fs = require('fs');
const [dir, N] = [process.argv[2], Number(process.argv[3])];
const mk = () => Gun({ file: dir, peers: [], multicast: false, axe: false, localStorage: false, WebSocket: function () {} });
const id = (k) => (1760000000000 + k * 1000) + '-263a4dbe41488fb87214b0032339dbb9-' + k.toString(36);
const w = mk();
const put = (v) => new Promise((ok, no) => w.get('mine/talks').put(v, (a) => a && a.err ? no(new Error(a.err)) : ok()));
(async () => {
  for (let s = 0; s < N; s += 500) { const b = {}; for (let k = s; k < Math.min(N, s + 500); k++) b[id(k)] = { '#': 'ev/' + id(k) }; await put(b); }
  await put({ 'zz-last': { '#': 'ev/zz' } });
  const r = mk(); // empty memory graph: reads come from disk only
  r.get('mine/talks').once(() => {}, { wait: 300 });
  setTimeout(() => {
    const g = r._.graph['mine/talks'] || {};
    const raw = fs.readdirSync(dir).map((f) => fs.readFileSync(dir + '/' + f, 'utf8')).join('');
    process.stdout.write(JSON.stringify({ files: fs.readdirSync(dir).length, keys: Object.keys(g).filter((k) => k !== '_').length,
      last: g[id(N - 1)], undefinedOnDisk: (raw.match(/"undefined"/g) || []).length }));
    process.exit(0);
  }, 1500);
})().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e) })); process.exit(1); });
`;

describe('Radisk large node', () => {
  it('radisk uses synchronous JSON (yson parseAsync is not used)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'node_modules/gun/lib/radisk.js'), 'utf8');
    expect(source).not.toMatch(/var parse = JSON\.parseAsync/);
    // The phone's Node loads Gun from its own copy (installed by the android:* build scripts).
    const phone = path.join(ROOT, 'platforms/mobile/nodejs-project/node_modules/gun/lib/radisk.js');
    if (fs.existsSync(phone)) expect(fs.readFileSync(phone, 'utf8')).not.toMatch(/var parse = JSON\.parseAsync/);
  });

  it('keeps every link and its state across a restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-radisk-'));
    const script = path.join(dir, '..', `${path.basename(dir)}-probe.cjs`);
    fs.writeFileSync(script, SCRIPT);
    const entries = 15000;
    try {
      const out = execFileSync(process.execPath, [script, path.join(dir, 'radata'), String(entries)], {
        cwd: ROOT, env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') }, encoding: 'utf8', timeout: 90_000,
      });
      const result = JSON.parse(out);
      expect(result.files).toBeGreaterThan(2); // the node spans several Radisk files
      expect(result.undefinedOnDisk).toBe(0);
      expect(result.keys).toBe(entries + 1);
      expect(result.last).toEqual({ '#': expect.stringMatching(/^ev\//) });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(script, { force: true });
    }
  }, 120_000);
});
