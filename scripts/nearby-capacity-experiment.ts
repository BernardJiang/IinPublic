/**
 * OPEN-40 capacity experiment: adaptive shared-room split/coalescing at 2, 498, 499, 10,000 and
 * 1,000,000 people for C = 32/64/128/256/498/1000, through the production split rule
 * (src/test/support/nearby-capacity-model.ts). Writes docs/testing/nearby-capacity-experiment.md.
 *
 *   npx tsx scripts/nearby-capacity-experiment.ts            # everything (~10 min)
 *   npx tsx scripts/nearby-capacity-experiment.ts --no-million
 *
 * Deterministic: the same commit gives the same tables.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  checkDirectLinks,
  coalescePass,
  measure,
  newModel,
  pointNear,
  removeUsers,
  seededRandom,
  settleSplits,
  type ModelMetrics,
} from '../src/test/support/nearby-capacity-model';
import { NEARBY_PARTITION_MERGE_DWELL_MS } from '../src/shared/nearby-partition';
import type { GPSCoordinate } from '../src/shared/types';

const CAPACITIES = [32, 64, 128, 256, 498, 1000];
const K = 12;
/** src/server/services/nearby-partition-store.ts MAX_TRANSITIONS_PER_STATE. */
const TRANSITION_BOUND = 16_384;
const STAY_SHARE = 0.25;

const CITIES: Array<[string, number, number]> = [
  ['Tokyo', 35.68, 139.69], ['Delhi', 28.61, 77.21], ['Shanghai', 31.23, 121.47], ['São Paulo', -23.55, -46.63],
  ['Mexico City', 19.43, -99.13], ['Cairo', 30.04, 31.24], ['Mumbai', 19.08, 72.88], ['Beijing', 39.9, 116.41],
  ['Dhaka', 23.81, 90.41], ['Osaka', 34.69, 135.5], ['New York', 40.71, -74.01], ['Karachi', 24.86, 67.0],
  ['Buenos Aires', -34.6, -58.38], ['Istanbul', 41.01, 28.98], ['Kolkata', 22.57, 88.36], ['Manila', 14.6, 120.98],
  ['Lagos', 6.52, 3.38], ['Rio de Janeiro', -22.91, -43.17], ['Los Angeles', 34.05, -118.24], ['Moscow', 55.76, 37.62],
  ['Paris', 48.86, 2.35], ['London', 51.51, -0.13], ['Bangkok', 13.76, 100.5], ['Lima', -12.05, -77.04],
  ['Seoul', 37.57, 126.98], ['Jakarta', -6.21, 106.85], ['Chicago', 41.88, -87.63], ['Tehran', 35.69, 51.39],
  ['Bogotá', 4.71, -74.07], ['Sydney', -33.87, 151.21], ['San Diego', 32.72, -117.16], ['Nairobi', -1.29, 36.82],
  ['Berlin', 52.52, 13.4], ['Madrid', 40.42, -3.7], ['Toronto', 43.65, -79.38], ['Singapore', 1.35, 103.82],
  ['Johannesburg', -26.2, 28.05], ['Riyadh', 24.71, 46.68], ['Santiago', -33.45, -70.67], ['Auckland', -36.85, 174.76],
];

type Population = { name: string; locations: GPSCoordinate[] };

function populations(includeMillion: boolean): Population[] {
  const sanDiego = { latitude: 32.7157, longitude: -117.1611 };
  const city = (count: number, seed: number) => {
    const random = seededRandom(seed);
    return Array.from({ length: count }, () => pointNear(sanDiego, 5_000, random));
  };
  const random10k = seededRandom(10_000);
  const out: Population[] = [
    { name: '2 (San Diego, London)', locations: [pointNear(sanDiego, 10, seededRandom(1)), pointNear({ latitude: 51.5072, longitude: -0.1276 }, 10, seededRandom(2))] },
    { name: '498 (one city)', locations: city(498, 498) },
    { name: '499 (one city)', locations: city(499, 498) },
    {
      name: '10,000 (stadium 5,000 + city 5,000)',
      locations: [
        ...Array.from({ length: 5_000 }, () => pointNear({ latitude: 32.7076, longitude: -117.157 }, 60, random10k)),
        ...city(5_000, 10_001),
      ],
    },
  ];
  if (includeMillion) {
    // 40 cities with Zipf weights (σ 8 km) plus two 50,000-seat stadiums, below everyone's privacy floor.
    const random = seededRandom(1_000_000);
    const weights = CITIES.map((_, rank) => 1 / (rank + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const locations: GPSCoordinate[] = [];
    for (const [index, [, latitude, longitude]] of CITIES.entries()) {
      const count = Math.round((900_000 * weights[index]!) / total);
      for (let i = 0; i < count; i += 1) locations.push(pointNear({ latitude, longitude }, 8_000, random));
    }
    for (const stadium of [{ latitude: 35.7056, longitude: 139.7519 }, { latitude: 51.556, longitude: -0.2796 }]) {
      for (let i = 0; i < 50_000; i += 1) locations.push(pointNear(stadium, 80, random));
    }
    out.push({ name: `${locations.length.toLocaleString('en-US')} (40 cities + two 50,000-seat stadiums)`, locations });
  }
  return out;
}

type Row = {
  population: string;
  capacity: number;
  settled: ModelMetrics;
  links: ReturnType<typeof checkDirectLinks>;
  merged: ModelMetrics;
  mergePasses: number;
  seconds: number;
};

function run(population: Population, capacity: number): Row {
  const started = Date.now();
  const state = newModel(population.locations, capacity);
  settleSplits(state);
  const settled = measure(state);
  const links = checkDirectLinks(state, K, 25);
  const random = seededRandom(capacity * 7 + population.locations.length);
  const stay = new Uint8Array(state.users.length);
  for (let index = 0; index < stay.length; index += 1) stay[index] = random() < STAY_SHARE ? 1 : 0;
  removeUsers(state, (index) => stay[index] === 1);
  let mergePasses = 0;
  while (coalescePass(state) > 0) mergePasses += 1;
  return { population: population.name, capacity, settled, links, merged: measure(state), mergePasses, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

const fmt = (n: number) => n.toLocaleString('en-US');
const km = (m: number) => (m >= 10_000 ? `${fmt(Math.round(m / 1000))} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${fmt(m)} m`);

function markdown(rows: Row[]): string {
  const lines = [
    '# Nearby capacity experiment (OPEN-40)',
    '',
    'Generated by `npx tsx scripts/nearby-capacity-experiment.ts`; do not edit by hand. Model and its',
    'limits: `src/test/support/nearby-capacity-model.ts` (production split rule, server split/coalesce',
    'thresholds, real direct-link scheduler; no signatures, presence expiry or network timing).',
    `Coalescing: ${Math.round(STAY_SHARE * 100)} % of the people stay online; one pass = one merge dwell (${NEARBY_PARTITION_MERGE_DWELL_MS / 60_000} min).`,
    `K = ${K}. The server keeps at most ${fmt(TRANSITION_BOUND)} transitions per checkpoint.`,
    '',
    '## Settled after arrivals',
    '',
    '| People | C | Rooms | Empty groups | Occupancy p50 / p95 / max | In rooms < C/4 | Lineage reads p50 / p95 / max | Room diameter p50 / p95 | Moves per person (mean / max) | Splits (control writes) | Over transition bound | Links max / asymmetric |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const s = row.settled;
    lines.push(`| ${row.population} | ${row.capacity} | ${fmt(s.rooms)} | ${fmt(s.emptyGroups)} | ${s.occupancy.p50} / ${s.occupancy.p95} / ${s.occupancy.max} | ${s.usersInSmallRoomsPct} % | ${s.controlReadsPerUser.p50} / ${s.controlReadsPerUser.p95} / ${s.controlReadsPerUser.max} | ${km(s.diameterMeters.p50)} / ${km(s.diameterMeters.p95)} | ${s.movesPerUser.mean} / ${s.movesPerUser.max} | ${fmt(s.controlWrites.splits)} | ${s.controlWrites.splits > TRANSITION_BOUND ? '**yes**' : 'no'} | ${row.links.maxLinks} / ${row.links.asymmetric} |`);
  }
  lines.push('', `## After ${Math.round((1 - STAY_SHARE) * 100)} % leave and the rest coalesce`, '',
    '| People | C | People left | Rooms | Occupancy p50 / p95 / max | In rooms < C/4 | Merge passes (dwells) | Coalesces | Room diameter p50 / p95 |',
    '|---|---|---|---|---|---|---|---|---|');
  for (const row of rows) {
    const m = row.merged;
    lines.push(`| ${row.population} | ${row.capacity} | ${fmt(m.users)} | ${fmt(m.rooms)} | ${m.occupancy.p50} / ${m.occupancy.p95} / ${m.occupancy.max} | ${m.usersInSmallRoomsPct} % | ${row.mergePasses} (${row.mergePasses * NEARBY_PARTITION_MERGE_DWELL_MS / 60_000} min) | ${fmt(m.controlWrites.coalesces)} | ${km(m.diameterMeters.p50)} / ${km(m.diameterMeters.p95)} |`);
  }
  return `${lines.join('\n')}\n`;
}

const includeMillion = !process.argv.includes('--no-million');
const rows: Row[] = [];
for (const population of populations(includeMillion)) {
  for (const capacity of CAPACITIES) {
    const row = run(population, capacity);
    rows.push(row);
    process.stdout.write(`[capacity] ${population.name} C=${capacity}: ${row.settled.rooms} rooms, ${row.settled.controlWrites.splits} splits, max ${row.settled.occupancy.max}, ${row.mergePasses} merge passes (${row.seconds} s)\n`);
  }
}
const out = path.resolve(__dirname, '..', 'docs', 'testing', 'nearby-capacity-experiment.md');
writeFileSync(out, markdown(rows));
writeFileSync(out.replace(/\.md$/, '.json'), `${JSON.stringify(rows, null, 1)}\n`);
process.stdout.write(`[capacity] wrote ${path.relative(process.cwd(), out)}\n`);
