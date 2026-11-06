/**
 * Storage stress test for a phone's embedded node (OPEN-106 benchmark, 2026-11-02).
 *
 * Runs Gun + Radisk on the device's own file system in a separate Gun instance, with its own
 * folder (`<dataDir>/storage-stress-<id>`), no peers and no network, so the user's graph is never
 * touched; the folder is deleted afterwards. It writes a synthetic device graph shaped like the
 * device-graph spec (§31): people, events with links, and large list nodes that span several
 * Radisk files. A second Gun instance on the same folder starts with an empty memory graph, so
 * every read after the "restart" comes from disk.
 *
 * Reported: write time, disk size, whether every list entry and link state survived the restart
 * (the yson defect fixed in scripts/patch-gun-radix.js lost them), cold and warm read latency,
 * and how much heap Gun keeps after reading everything (Gun never evicts its memory graph).
 */
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import Gun from 'gun';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface StorageStressOptions {
  /** Events in the big list (one Talk each). */
  talks: number;
  /** People nodes. */
  people: number;
  /** Fields per list put (Gun batches one put into one Radisk write). */
  batch: number;
}

export interface StorageStressReport {
  id: string;
  options: StorageStressOptions;
  node: string;
  phase: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  write?: { records: number; seconds: number; listSeconds: number; diskBytes: number; files: number; damagedOnDisk: number };
  restart?: {
    listKeysExpected: number;
    listKeysRead: number;
    listReadMs: number;
    listKeysAtAnswer: number;
    listAnswerMs: number;
    listKeysOverTime: Record<string, number>;
    coldEventReadMs: { p50: number; p95: number; max: number; misses: number };
    warmEventReadMs: { p50: number; p95: number };
    personHistoryMs: number;
    personHistoryRows: number;
  };
  memory?: { heapBeforeMB: number; heapAfterWriteMB: number; heapAfterReadAllMB: number; rssAfterReadAllMB: number; graphNodesKept: number };
}

const jobs = new Map<string, StorageStressReport>();
let running = false;

const MB = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const hex = (n: number, len: number) => n.toString(16).padStart(len, '0').slice(-len);

function dirStats(dir: string): { bytes: number; files: number; damaged: number } {
  let bytes = 0; let files = 0; let damaged = 0;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (!stat.isFile()) continue;
    bytes += stat.size; files += 1;
    damaged += (fs.readFileSync(file, 'utf8').match(/"undefined"/g) || []).length;
  }
  return { bytes, files, damaged };
}

function openGun(dir: string): any {
  return (Gun as any)({ file: dir, peers: [], multicast: false, axe: false, localStorage: false, radisk: true });
}

function put(gun: any, soul: string, value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`put timeout ${soul}`)), 120_000);
    gun.get(soul).put(value, (ack: any) => { clearTimeout(timer); if (ack?.err) reject(new Error(String(ack.err))); else resolve(); });
  });
}

function read(gun: any, soul: string, wait = 1): Promise<any> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 10_000);
    gun.get(soul).once((data: any) => { clearTimeout(timer); resolve(data); }, { wait });
  });
}

async function pool<T>(items: T[], width: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < items.length) { const item = items[next++]; await fn(item); }
  }));
}

async function run(report: StorageStressReport, dataDir: string): Promise<void> {
  const { talks, people, batch } = report.options;
  const dir = path.join(dataDir, `storage-stress-${report.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const gc = (globalThis as any).gc as (() => void) | undefined;
  try {
    gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const device = hex(0x263a4dbe, 32);
    const eventId = (k: number) => `${1760000000000 + k * 60000}-${device}-${k.toString(36)}`;
    const personPub = (p: number) => `pub${hex(p * 2654435761, 40)}`;

    // ---- write ----
    report.phase = 'write';
    const t0 = performance.now();
    let records = 0;
    await pool(Array.from({ length: people }, (_, p) => p), 50, async (p) => {
      await put(writer(), `person/${personPub(p)}`, { pub: personPub(p), name: `Person ${p}`, firstSeen: 1760000000000 });
      records += 1;
    });
    await pool(Array.from({ length: talks }, (_, k) => k), 50, async (k) => {
      await put(writer(), `ev/${eventId(k)}`, {
        v: 1, when: 1760000000000 + k * 60000, with: { '#': `person/${personPub(k % people)}` },
        rev: { '#': `rev/${hex(k * 40503, 64)}` }, gave: { '#': `s/${hex(k * 69069, 64)}` }, mode: 'chatbot', device,
      });
      records += 1;
    });
    const tList = performance.now();
    for (let start = 0; start < talks; start += batch) {
      const list: Record<string, unknown> = {};
      const byPerson = new Map<string, Record<string, unknown>>();
      for (let k = start; k < Math.min(talks, start + batch); k++) {
        list[eventId(k)] = { '#': `ev/${eventId(k)}` };
        const soul = `ix/person/${personPub(k % people)}`;
        (byPerson.get(soul) || byPerson.set(soul, {}).get(soul)!)[eventId(k)] = { '#': `ev/${eventId(k)}` };
      }
      await put(writer(), 'mine/talks', list);
      await pool([...byPerson], 20, async ([soul, value]) => { await put(writer(), soul, value); });
      records += 1 + byPerson.size;
    }
    const listSeconds = (performance.now() - tList) / 1000;
    await new Promise((r) => setTimeout(r, 1500)); // let Radisk flush its batch
    const disk = dirStats(dir);
    gc?.();
    const heapAfterWrite = process.memoryUsage().heapUsed;
    report.write = { records, seconds: Math.round((performance.now() - t0) / 100) / 10, listSeconds: Math.round(listSeconds * 10) / 10, diskBytes: disk.bytes, files: disk.files, damagedOnDisk: disk.damaged };
    writerGun._.graph = {};
    writerGun._.next = {};
    writerGun = null;

    // ---- restart: a second instance reads only from disk ----
    report.phase = 'restart';
    const reader = openGun(dir);
    const tl = performance.now();
    const listCount = () => Object.keys(reader._.graph['mine/talks'] || {}).filter((k) => k !== '_').length;
    const answered = await read(reader, 'mine/talks', 30); // the app's GraphStore waits 30 ms
    const listKeysAtAnswer = Object.keys(answered || {}).filter((k) => k !== '_').length;
    const listAnswerMs = Math.round(performance.now() - tl);
    // How the list fills in after Gun has answered (Radisk delivers one file at a time).
    const listKeysOverTime: Record<string, number> = {};
    for (const at of [500, 2000, 5000, 10000]) {
      await new Promise((r) => setTimeout(r, Math.max(0, at - (performance.now() - tl))));
      listKeysOverTime[`${at}ms`] = listCount();
    }
    const listKeysRead = listCount();
    const listReadMs = Math.round(performance.now() - tl);

    const sample = Array.from({ length: Math.min(200, talks) }, (_, i) => Math.floor((i * 7919) % talks));
    const cold: number[] = []; let misses = 0;
    for (const k of sample) {
      const t = performance.now();
      const node = await read(reader, `ev/${eventId(k)}`);
      cold.push(performance.now() - t);
      if (!node || typeof node.when !== 'number') misses += 1;
    }
    const warm: number[] = [];
    for (const k of sample) { const t = performance.now(); await read(reader, `ev/${eventId(k)}`); warm.push(performance.now() - t); }
    cold.sort((a, b) => a - b); warm.sort((a, b) => a - b);

    const tp = performance.now();
    const index = await read(reader, `ix/person/${personPub(1)}`, 300);
    const rows = Object.keys(index || {}).filter((k) => k !== '_');
    await Promise.all(rows.map((k) => read(reader, String(index[k]?.['#'] || ''))));
    const personHistoryMs = Math.round(performance.now() - tp);

    const round = (n: number) => Math.round(n * 10) / 10;
    report.restart = {
      listKeysExpected: talks, listKeysRead, listReadMs, listKeysAtAnswer, listAnswerMs, listKeysOverTime,
      coldEventReadMs: { p50: round(pct(cold, 0.5)), p95: round(pct(cold, 0.95)), max: round(cold[cold.length - 1] || 0), misses },
      warmEventReadMs: { p50: round(pct(warm, 0.5)), p95: round(pct(warm, 0.95)) },
      personHistoryMs, personHistoryRows: rows.length,
    };

    // ---- memory: read every event, as a "load everything" screen would ----
    report.phase = 'memory';
    await pool(Array.from({ length: talks }, (_, k) => k), 50, async (k) => { await read(reader, `ev/${eventId(k)}`); });
    gc?.();
    const usage = process.memoryUsage();
    report.memory = {
      heapBeforeMB: MB(heapBefore), heapAfterWriteMB: MB(heapAfterWrite), heapAfterReadAllMB: MB(usage.heapUsed), rssAfterReadAllMB: MB(usage.rss),
      graphNodesKept: Object.keys(reader._.graph || {}).length,
    };
    // Drop what this instance holds so the heap can be reclaimed (Gun has no close()).
    reader._.graph = {};
    reader._.next = {};
    report.phase = 'done';
  } catch (error) {
    report.error = (error as Error).message;
    report.phase = 'failed';
  } finally {
    writerGun = null;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    report.finishedAt = new Date().toISOString();
    running = false;
  }

  function writer(): any {
    if (!writerGun) writerGun = openGun(dir);
    return writerGun;
  }
}
let writerGun: any = null;

/** Start a run (one at a time). Returns the job report, updated in place as it runs. */
export function startStorageStress(dataDir: string, options: Partial<StorageStressOptions>): StorageStressReport {
  if (running) throw new Error('a storage stress run is already in progress');
  const opts: StorageStressOptions = {
    talks: Math.max(100, Math.min(50_000, Math.floor(Number(options.talks) || 2000))),
    people: Math.max(10, Math.min(5000, Math.floor(Number(options.people) || 1000))),
    batch: Math.max(10, Math.min(2000, Math.floor(Number(options.batch) || 500))),
  };
  const id = `${Date.now().toString(36)}`;
  const report: StorageStressReport = { id, options: opts, node: process.version, phase: 'starting', startedAt: new Date().toISOString() };
  jobs.set(id, report);
  running = true;
  void run(report, dataDir);
  return report;
}

export function getStorageStress(id: string): StorageStressReport | undefined {
  return jobs.get(id);
}
