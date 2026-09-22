#!/usr/bin/env node
/**
 * Load test: what does the Gun relay pay for room heartbeats, and does ROOM SIZE matter?
 *
 * Every chatroom member re-publishes its membership record on a heartbeat
 * (src/web/services/web-chatroom-service.ts, every min(30s, TTL/3) = 30s). The question this
 * answers is how that scales, because there are two very different models:
 *
 *   selective relay  each heartbeat is forwarded only to the room's members   -> deliveries/put = room size - 1
 *   flooding relay   each heartbeat is forwarded to EVERY connected client    -> deliveries/put = all clients - 1
 *
 * Under flooding, room size does not change relay cost at all — total connected clients does — so a
 * capacity cap could not protect the relay. The report's "fan-out per put" column tells you which model
 * the relay actually follows, and `--runs 500x498,500x3` runs the same crowd as one big room and as
 * many tiny rooms so you can compare directly.
 *
 * Members are simulated with raw WebSocket clients speaking Gun's wire protocol (put / get / the DAM
 * hello), NOT real Gun instances: the repo notes that several Gun() instances in one Node process are
 * unreliable (scripts/relay-only-verification/gun-put.js), and one process per member does not scale.
 * The relay is a real one, started the way production runs it (RELAY_ONLY_HUB, memory-only).
 *
 *   npm run build:server                                   # the test starts dist/server/server/index.js
 *   node scripts/load-test-room-heartbeat.mjs              # default matrix (see DEFAULT_RUNS)
 *   node scripts/load-test-room-heartbeat.mjs --runs 500x498,500x3 --duration 60
 *   node scripts/load-test-room-heartbeat.mjs --runs 2000x498 --heartbeat-ms 5000   # 6x stress
 *   node scripts/load-test-room-heartbeat.mjs --url http://127.0.0.1:8080 --runs 300x498
 *   node scripts/load-test-room-heartbeat.mjs --json results.json
 *   node scripts/load-test-room-heartbeat.mjs --axe --subscribe-members --runs 500x498,500x3   # relay with AXE on
 *   node scripts/load-test-room-heartbeat.mjs --slim --heartbeat-ms 60000                       # what-if: lighter beats
 *
 * Flags: --axe (relay routes by subscription, IINPUBLIC_HUB_AXE=1), --subscribe-members (every client also
 * subscribes to each room-mate's record, as the app's roster does — needed for AXE to have anything to route
 * to), --slim (after the join beat, heartbeats omit the ~174-byte SEA keys).
 *
 * A run is `<clients>x<roomSize>`: <clients> connected members split into rooms of <roomSize>.
 * Results are for THIS machine running relay + load generator together; the report includes
 * generator CPU so you can tell when the generator, not the relay, was the limit (results are then a
 * lower bound on relay capacity).
 */
import { fork, spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER_ENTRY = path.join(ROOT, 'dist/server/server/index.js');
const DEFAULT_RUNS = ['100x498', '250x498', '500x498', '1000x498', '500x3', '1000x3'];
// The real heartbeat carries the member's SEA keys (~87 chars each); keep messages realistically sized.
const FAKE_KEY = 'x'.repeat(87);
const rid = () => Math.random().toString(36).slice(2, 11);

// ─────────────────── worker: hosts a slice of the simulated members over raw WebSockets ───────────────────

function runWorker() {
  const members = [];
  let steadyStartMs = Infinity;
  let deliveries = 0;
  let puts = 0;
  let bytes = 0;
  let latencies = [];
  let opened = 0;
  let closed = 0;
  let errors = 0;
  let bytesAll = 0;

  const startMember = (member, cfg) => {
    const ws = new WebSocket(`${cfg.url.replace(/^http/, 'ws')}/gun`);
    member.ws = ws;
    const room = `lt-room-${member.room}`;
    const soul = `${room}/${member.id}`;
    const roomSoul = `${room}/users`;
    let stateTick = 0;
    ws.on('open', () => {
      opened += 1;
      // Subscribe like the app does (the room roster), then publish the join and start beating.
      ws.send(JSON.stringify({ '#': rid(), get: { '#': roomSoul } }));
      if (cfg.subscribeMembers) {
        // The app's roster is `users.map().on(...)`: one subscription per room-mate's record.
        const roommates = cfg.roomMemberIds[member.room].filter((id) => id !== member.id);
        for (let i = 0; i < roommates.length; i += 50) {
          ws.send(JSON.stringify(roommates.slice(i, i + 50).map((id) => ({ '#': rid(), get: { '#': `${room}/${id}` } }))));
        }
      }
      let beats = 0;
      const beat = (extra = {}) => {
        const state = Date.now() + (stateTick++ % 1000) / 1000;
        const fields = {
          isActive: true,
          userId: member.id,
          stageName: member.id,
          lastSeen: new Date().toISOString(),
          ...(cfg.slim && beats > 0 ? {} : { epub: FAKE_KEY, pub: FAKE_KEY }),
          ...extra,
        };
        beats += 1;
        const meta = Object.fromEntries(Object.keys(fields).map((k) => [k, state]));
        ws.send(JSON.stringify({ '#': rid(), put: { [soul]: { _: { '#': soul, '>': meta }, ...fields } } }));
        if (Date.parse(fields.lastSeen) >= steadyStartMs) puts += 1;
      };
      beat({ joinedAt: new Date().toISOString() });
      // Random phase so heartbeats spread across the interval like independent devices.
      setTimeout(() => {
        member.timer = setInterval(() => ws.readyState === ws.OPEN && beat(), cfg.hbMs);
        ws.readyState === ws.OPEN && beat();
      }, Math.random() * cfg.hbMs);
    });
    ws.on('message', (raw) => {
      const text = raw.toString();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      const now = Date.now();
      bytesAll += text.length;
      for (const msg of Array.isArray(parsed) ? parsed : [parsed]) {
        if (msg.dam === '?' && !msg['@']) {
          ws.send(JSON.stringify({ '#': rid(), '@': msg['#'], dam: '?', pid: rid() })); // DAM hello reply
        } else if (msg.put) {
          for (const node of Object.values(msg.put)) {
            const writtenAt = Date.parse(node?.lastSeen);
            if (writtenAt >= steadyStartMs) {
              deliveries += 1;
              latencies.push(now - writtenAt);
            }
          }
        }
      }
      if (now >= steadyStartMs) bytes += text.length;
    });
    ws.on('close', () => {
      closed += 1;
      clearInterval(member.timer);
    });
    ws.on('error', () => {
      errors += 1;
    });
  };

  process.on('message', (msg) => {
    if (msg.type === 'start') {
      msg.members.forEach((member, i) => {
        members.push(member);
        setTimeout(() => startMember(member, msg), (i / msg.members.length) * msg.rampMs);
      });
    } else if (msg.type === 'steady') {
      steadyStartMs = msg.at;
    } else if (msg.type === 'stop') {
      members.forEach((m) => {
        clearInterval(m.timer);
        m.ws?.terminate();
      });
      process.exit(0);
    }
  });

  setInterval(() => {
    const sample = latencies.length > 4000 ? latencies.filter((_, i) => i % Math.ceil(latencies.length / 4000) === 0) : latencies;
    process.send?.({ type: 'stats', pid: process.pid, opened, closed, errors, bytesAll, deliveries, puts, bytes, latencies: sample });
    deliveries = 0;
    puts = 0;
    bytes = 0;
    latencies = [];
  }, 2000);
  process.send?.({ type: 'ready' });
}

// ─────────────────────────────────────── orchestrator ───────────────────────────────────────

function parseArgs(argv) {
  const opts = { runs: DEFAULT_RUNS, duration: 60, hbMs: 30_000, port: 18300, url: '', json: '', rampSec: 0, axe: false, subscribeMembers: false, slim: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=');
    const value = () => inline ?? argv[++i];
    if (key === '--runs') opts.runs = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === '--duration') opts.duration = Number(value());
    else if (key === '--heartbeat-ms') opts.hbMs = Number(value());
    else if (key === '--port') opts.port = Number(value());
    else if (key === '--url') opts.url = value().replace(/\/$/, '');
    else if (key === '--json') opts.json = value();
    else if (key === '--ramp-sec') opts.rampSec = Number(value());
    else if (key === '--axe') opts.axe = true;
    else if (key === '--subscribe-members') opts.subscribeMembers = true;
    else if (key === '--slim') opts.slim = true;
    else if (key === '--help' || key === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  return opts;
}

/** Cumulative CPU seconds of a process (portable: `ps -o cputime`, "[[H:]M:]S[.ff]" on mac and linux). */
function cpuSeconds(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'cputime=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return out.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  } catch {
    return 0;
  }
}

function rssMb(pid) {
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024;
  } catch {
    return 0;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);

async function startServer(port, axe) {
  if (!fs.existsSync(SERVER_ENTRY)) throw new Error(`Missing ${SERVER_ENTRY} — run \`npm run build:server\` first.`);
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      RELAY_ONLY_HUB: '1', // how production runs the hub (no application radata; AXE off unless --axe)
      ...(axe ? { IINPUBLIC_HUB_AXE: '1' } : {}),
      E2E_GUN_MEMORY_ONLY: '1',
      NODE_OPTIONS: '--max-old-space-size=8192',
      IINPUBLIC_DOWNLOADS_DIR: '__load_test_no_downloads__',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return { child, url };
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  child.kill();
  throw new Error(`Relay did not become healthy on ${url}`);
}

async function runOne(spec, opts, index) {
  const [clients, roomSize] = spec.split('x').map(Number);
  if (!(clients > 0 && roomSize > 0)) throw new Error(`Bad run "${spec}" — expected <clients>x<roomSize>, e.g. 500x498`);
  const external = !!opts.url;
  const server = external ? { child: null, url: opts.url } : await startServer(opts.port + index, opts.axe);
  const relayPid = server.child?.pid;
  const workerCount = Math.max(1, Math.min(Math.max(1, os.cpus().length - 2), Math.ceil(clients / 150), 12));
  const rampMs = (opts.rampSec || Math.max(10, clients / 40)) * 1000;
  const members = Array.from({ length: clients }, (_, i) => ({ id: `lt-${i}`, room: Math.floor(i / roomSize) }));
  const roomMemberIds = Array.from({ length: Math.ceil(clients / roomSize) }, () => []);
  members.forEach((m) => roomMemberIds[m.room].push(m.id));
  const workers = [];
  const latest = new Map();
  const latencies = [];
  let steady = { deliveries: 0, puts: 0, bytes: 0 };
  let inSteady = false;

  for (let w = 0; w < workerCount; w += 1) {
    const worker = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    worker.on('message', (msg) => {
      if (msg.type !== 'stats') return;
      latest.set(msg.pid, msg);
      if (inSteady) {
        steady.deliveries += msg.deliveries;
        steady.puts += msg.puts;
        steady.bytes += msg.bytes;
        latencies.push(...msg.latencies);
      }
    });
    workers.push(worker);
  }
  await sleep(1000);
  workers.forEach((worker, w) =>
    worker.send({
      type: 'start',
      url: server.url,
      hbMs: opts.hbMs,
      rampMs,
      slim: opts.slim,
      subscribeMembers: opts.subscribeMembers,
      roomMemberIds,
      members: members.filter((_, i) => i % workerCount === w),
    }),
  );

  // Join phase: wait until every socket is open (or give up).
  await sleep(rampMs + 2000);
  for (let i = 0; i < 30; i += 1) {
    const opened = [...latest.values()].reduce((sum, s) => sum + s.opened, 0);
    if (opened >= clients) break;
    await sleep(2000);
  }
  await sleep(Math.min(opts.hbMs, 15_000)); // let the join burst drain before measuring

  const joinBytes = [...latest.values()].reduce((sum, st) => sum + st.bytesAll, 0);

  // Steady phase: heartbeats only.
  const steadyStart = Date.now() + 1500;
  workers.forEach((worker) => worker.send({ type: 'steady', at: steadyStart }));
  await sleep(2500);
  inSteady = true;
  const relayCpu0 = relayPid ? cpuSeconds(relayPid) : 0;
  const genCpu0 = workers.reduce((sum, w) => sum + cpuSeconds(w.pid), 0);
  const t0 = Date.now();
  let peakRss = 0;
  let peakWindowCpu = 0;
  let lastCpu = relayCpu0;
  let lastAt = t0;
  while (Date.now() - t0 < opts.duration * 1000) {
    await sleep(5000);
    if (relayPid) {
      peakRss = Math.max(peakRss, rssMb(relayPid));
      const now = Date.now();
      const cpu = cpuSeconds(relayPid);
      peakWindowCpu = Math.max(peakWindowCpu, ((cpu - lastCpu) / ((now - lastAt) / 1000)) * 100);
      lastCpu = cpu;
      lastAt = now;
    }
  }
  const wall = (Date.now() - t0) / 1000;
  const relayCpuPct = relayPid ? ((cpuSeconds(relayPid) - relayCpu0) / wall) * 100 : NaN;
  const genCpuPct = ((workers.reduce((sum, w) => sum + cpuSeconds(w.pid), 0) - genCpu0) / wall) * 100;
  inSteady = false;

  const stats = [...latest.values()];
  const sorted = latencies.sort((a, b) => a - b);
  const rooms = Math.ceil(clients / roomSize);
  const putsPerSec = steady.puts / wall;
  const result = {
    run: spec,
    clients,
    roomSize,
    rooms,
    heartbeatMs: opts.hbMs,
    workers: workerCount,
    cores: os.cpus().length,
    socketsOpened: stats.reduce((sum, s) => sum + s.opened, 0),
    socketsClosedEarly: stats.reduce((sum, s) => sum + s.closed, 0),
    socketErrors: stats.reduce((sum, s) => sum + s.errors, 0),
    putsPerSec,
    deliveriesPerSec: steady.deliveries / wall,
    fanOutPerPut: putsPerSec > 0 ? steady.deliveries / steady.puts : NaN,
    // A writer is not echoed its own put, so the fan-out is one less than the audience size.
    selectiveModelFanOut: Math.min(roomSize, clients) - 1,
    floodModelFanOut: clients - 1,
    egressMbPerSec: steady.bytes / wall / 1e6,
    axe: opts.axe,
    subscribeMembers: opts.subscribeMembers,
    slim: opts.slim,
    // What ONE client receives (this is what a phone's radio/data plan pays):
    perClientKBps: steady.bytes / wall / clients / 1e3,
    perClientMsgsPerSec: steady.deliveries / wall / clients,
    bytesPerDelivery: steady.deliveries > 0 ? steady.bytes / steady.deliveries : NaN,
    joinMbPerClient: joinBytes / clients / 1e6,
    latencyMs: { p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99), max: sorted[sorted.length - 1] ?? NaN },
    relayCpuPctOfOneCore: relayCpuPct,
    relayPeakWindowCpuPct: peakWindowCpu,
    relayPeakRssMb: peakRss,
    generatorCpuPctTotal: genCpuPct,
  };

  workers.forEach((worker) => worker.send({ type: 'stop' }));
  await sleep(500);
  workers.forEach((worker) => worker.kill());
  server.child?.kill();
  await sleep(500);
  return result;
}

function model(r) {
  if (!Number.isFinite(r.fanOutPerPut)) return 'n/a';
  if (r.clients === r.roomSize || r.roomSize >= r.clients) return 'one room (models coincide)';
  const flood = Math.abs(r.fanOutPerPut - r.floodModelFanOut) / r.floodModelFanOut;
  const selective = Math.abs(r.fanOutPerPut - r.selectiveModelFanOut) / r.selectiveModelFanOut;
  return flood < selective ? 'FLOODS all clients' : 'selective (room only)';
}

function verdict(r) {
  const flags = [];
  if (r.socketsOpened < r.clients) flags.push(`only ${r.socketsOpened}/${r.clients} sockets opened`);
  if (r.socketsClosedEarly > 0) flags.push(`${r.socketsClosedEarly} sockets dropped`);
  if (r.latencyMs.p95 > 2000) flags.push('p95>2s');
  if (r.relayPeakWindowCpuPct > 90) flags.push('relay CPU saturated');
  if (r.generatorCpuPctTotal > 80 * Math.max(1, r.cores - 2)) flags.push('generator saturated (lower bound)');
  return flags.length ? flags.join(', ') : 'ok';
}

const fmt = (n, digits = 0) => (Number.isFinite(n) ? n.toFixed(digits) : 'n/a');

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `Room heartbeat load test — runs ${opts.runs.join(', ')}; heartbeat ${opts.hbMs} ms; steady window ${opts.duration}s; ` +
      `${opts.url ? `relay ${opts.url}` : `local RELAY_ONLY_HUB relay per run${opts.axe ? ' (AXE on)' : ''}`}; ` +
      `${opts.subscribeMembers ? 'members subscribed to room-mates; ' : ''}${opts.slim ? 'slim heartbeats; ' : ''}${os.cpus().length} cores\n`,
  );
  const results = [];
  for (const [index, spec] of opts.runs.entries()) {
    process.stdout.write(`… ${spec} `);
    const result = await runOne(spec, opts, index);
    results.push(result);
    console.log(`done (${verdict(result)})`);
  }
  console.log(
    '\n| run (clients x room) | rooms | puts/s | deliveries/s | fan-out per put | relay behaves as | egress MB/s | per-client KB/s (msgs/s) | join MB / client | latency p50 / p95 / p99 (ms) | relay CPU avg / peak (% of 1 core) | relay RSS (MB) | generator CPU (%) | verdict |',
  );
  console.log('|---|---:|---:|---:|---:|---|---:|---|---:|---|---|---:|---:|---|');
  for (const r of results) {
    console.log(
      `| ${r.run} | ${r.rooms} | ${fmt(r.putsPerSec, 1)} | ${fmt(r.deliveriesPerSec)} | ${fmt(r.fanOutPerPut, 1)} (room ${r.selectiveModelFanOut}, all ${r.floodModelFanOut}) ` +
        `| ${model(r)} | ${fmt(r.egressMbPerSec, 2)} | ${fmt(r.perClientKBps, 2)} (${fmt(r.perClientMsgsPerSec, 1)}) | ${fmt(r.joinMbPerClient, 2)} | ${fmt(r.latencyMs.p50)} / ${fmt(r.latencyMs.p95)} / ${fmt(r.latencyMs.p99)} ` +
        `| ${fmt(r.relayCpuPctOfOneCore)} / ${fmt(r.relayPeakWindowCpuPct)} | ${fmt(r.relayPeakRssMb)} | ${fmt(r.generatorCpuPctTotal)} | ${verdict(r)} |`,
    );
  }
  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify({ options: opts, results }, null, 2));
    console.log(`\nWrote ${opts.json}`);
  }
}

if (process.argv.includes('--worker')) {
  runWorker();
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
