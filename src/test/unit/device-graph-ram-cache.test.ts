/** @jest-environment node */
/**
 * The device graph's RAM copy (`gunNodeStore(..., { cacheInRam: true })`, five-phone starter tags
 * 2026-11-21): repeat reads come from RAM, a write through the store updates the copy, and a write
 * by anything else (the page, a test, a peer) evicts it, so no read is stale. Runs over real Radisk
 * in a child process, as on the phone (Jest's sandbox does not load Gun's storage plugins).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

const SCRIPT = `
console.log = () => {};
const Gun = require('gun');
const { gunNodeStore } = require(${JSON.stringify(path.join(ROOT, 'src/core/device-graph/node-store.ts'))});
const dir = process.argv[2];
const gun = Gun({ file: dir + '/radata', peers: [], multicast: false, axe: false, localStorage: false, WebSocket: function () {} });
let reads = 0;
const realGet = gun.get.bind(gun);
const counted = Object.assign(Object.create(Object.getPrototypeOf(gun)), gun, { _: gun._, get: (soul) => { reads += 1; return realGet(soul); } });
const store = gunNodeStore(counted, { missWaitMs: 0, cacheInRam: true });
const settle = () => new Promise((r) => setTimeout(r, 400));
const direct = (soul, v) => new Promise((ok) => gun.get(soul).put(v, () => ok()));
(async () => {
  const out = {};
  // 1. Repeat reads from RAM; own writes merged.
  await store.put('local/ix/a', { x: 1 });
  out.first = await store.get('local/ix/a');
  const before = reads;
  out.again = await store.get('local/ix/a');
  out.readsForRepeat = reads - before;
  await store.put('local/ix/a', { y: 2 });
  out.merged = await store.get('local/ix/a');
  // 2. Absent, until someone writes it.
  out.absent = await store.get('local/ix/deleted/t1');
  await direct('local/ix/deleted/t1', { ev: { '#': 'local/ev/1' } });
  await settle();
  out.created = await store.get('local/ix/deleted/t1');
  // 3. Someone else's write evicts: directly, then from a peer.
  await store.put('local/conv/c', { lastMessage: 'one' });
  await store.get('local/conv/c');
  await direct('local/conv/c', { lastMessage: 'tampered' });
  await settle();
  out.tampered = (await store.get('local/conv/c')).lastMessage;
  gun._.on('in', { '#': 'peer-1', put: { 'local/conv/c': { _: { '#': 'local/conv/c', '>': { lastMessage: Date.now() } }, lastMessage: 'from peer' } } });
  await settle();
  out.fromPeer = (await store.get('local/conv/c')).lastMessage;
  // 4. A read that overlapped a write is not kept.
  await direct('local/ix/b', { v: 'old' });
  const pending = store.get('local/ix/b');
  await direct('local/ix/b', { v: 'new' });
  await pending;
  await settle();
  out.overlap = (await store.get('local/ix/b')).v;
  process.stdout.write(JSON.stringify(out));
  setTimeout(() => process.exit(0), 300);
})();
`;

describe('device graph RAM cache', () => {
  it('serves repeat reads from RAM, keeps its own writes, and never returns a stale copy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ram-cache-'));
    const script = path.join(dir, 'run.cjs');
    fs.writeFileSync(script, SCRIPT);
    try {
      const raw = execFileSync(process.execPath, ['--import', 'tsx', script, dir], {
        cwd: ROOT, env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') }, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      const out = JSON.parse(raw);
      expect(out.first).toEqual({ x: 1 });
      expect(out.again).toEqual({ x: 1 });
      expect(out.readsForRepeat).toBe(0);
      expect(out.merged).toEqual({ x: 1, y: 2 });
      expect(out.absent).toBeNull();
      expect(out.created).toEqual({ ev: { '#': 'local/ev/1' } });
      expect(out.tampered).toBe('tampered');
      expect(out.fromPeer).toBe('from peer');
      expect(out.overlap).toBe('new');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
