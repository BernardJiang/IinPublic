/**
 * Nearby v3 experiment (docs/design/nearby-and-place-chatrooms.md §3.7): personal nearby lists
 * built by gossip, ranked by cell distance then a per-viewer hash, seeded only by a bounded hub
 * sample (src/test/support/nearby-gossip-model.ts). Writes docs/testing/nearby-gossip-experiment.md.
 *
 *   npx tsx scripts/nearby-gossip-experiment.ts             # everything (~15 min)
 *   npx tsx scripts/nearby-gossip-experiment.ts --quick     # skips the 100,000-person population
 *
 * Deterministic: the same commit gives the same tables.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pointNear, seededRandom } from '../src/test/support/seeded-random';
import {
  addPerson,
  DEFAULT_GOSSIP_OPTIONS,
  gossipRound,
  measureAudience,
  measureViews,
  newGossipModel,
  removePeople,
  sampleViewers,
  type GossipOptions,
  type GossipState,
  type GossipVariant,
  type GossipViewMetrics,
} from '../src/test/support/nearby-gossip-model';
import type { GPSCoordinate } from '../src/shared/types';

const ROUNDS = 30;
const CHURN_ROUNDS = 20;
const CHURN_SHARE = 0.2;
const SYBIL_SHARE = 0.1;
const VIEWERS = 150;
/** Estimated compact signed card: public key, cell, timestamp, signature. */
const CARD_BYTES = 250;
const ROUND_SECONDS = 30;
const CHECKPOINTS = [1, 2, 3, 5, 10, 20, 30];
const VARIANTS: GossipVariant[] = ['public-hash', 'secret-salt'];

const CITIES: Array<[number, number]> = [
  [35.68, 139.69], [28.61, 77.21], [31.23, 121.47], [-23.55, -46.63], [19.43, -99.13], [30.04, 31.24],
  [19.08, 72.88], [39.9, 116.41], [23.81, 90.41], [34.69, 135.5], [40.71, -74.01], [24.86, 67.0],
  [-34.6, -58.38], [41.01, 28.98], [22.57, 88.36], [14.6, 120.98], [6.52, 3.38], [-22.91, -43.17],
  [34.05, -118.24], [55.76, 37.62], [48.86, 2.35], [51.51, -0.13], [13.76, 100.5], [-12.05, -77.04],
  [37.57, 126.98], [-6.21, 106.85], [41.88, -87.63], [35.69, 51.39], [4.71, -74.07], [-33.87, 151.21],
  [32.72, -117.16], [-1.29, 36.82], [52.52, 13.4], [40.42, -3.7], [43.65, -79.38], [1.35, 103.82],
  [-26.2, 28.05], [24.71, 46.68], [-33.45, -70.67], [-36.85, 174.76],
];

type Population = {
  name: string;
  locations: GPSCoordinate[];
  newcomer: (random: () => number) => GPSCoordinate;
  /** Score only these viewers (default: everyone). */
  focus?: (index: number) => boolean;
};

const sanDiego = { latitude: 32.7157, longitude: -117.1611 };
const arena = { latitude: 32.7076, longitude: -117.157 };

function populations(quick: boolean): Population[] {
  const city = (count: number, seed: number) => {
    const random = seededRandom(seed);
    return Array.from({ length: count }, () => pointNear(sanDiego, 5_000, random));
  };
  const arenaPoints = (count: number, seed: number) => {
    const random = seededRandom(seed);
    return Array.from({ length: count }, () => pointNear(arena, 60, random));
  };
  const out: Population[] = [
    { name: '498 (one city)', locations: city(498, 498), newcomer: (r) => pointNear(sanDiego, 5_000, r) },
    { name: '2,000 (one city)', locations: city(2_000, 2_000), newcomer: (r) => pointNear(sanDiego, 5_000, r) },
    { name: '10,000 (one arena)', locations: arenaPoints(10_000, 10_000), newcomer: (r) => pointNear(arena, 60, r) },
    {
      name: '10,000 (stadium 5,000 + city 5,000)',
      locations: [...arenaPoints(5_000, 10_001), ...city(5_000, 10_002)],
      newcomer: (r) => (r() < 0.5 ? pointNear(arena, 60, r) : pointNear(sanDiego, 5_000, r)),
    },
    {
      // 2,000 people scattered alone across the continental US, and a 10,000-person arena.
      name: '12,000 (2,000 alone across the US + a 10,000-person arena; lone people scored)',
      locations: [
        ...arenaPoints(10_000, 12_000),
        ...(() => {
          const random = seededRandom(12_001);
          return Array.from({ length: 2_000 }, () => pointNear({ latitude: 30 + random() * 18, longitude: -122 + random() * 47 }, 1, random));
        })(),
      ],
      newcomer: (r) => pointNear({ latitude: 30 + r() * 18, longitude: -122 + r() * 47 }, 1, r),
      focus: (index) => index >= 10_000,
    },
  ];
  if (!quick) {
    // 40 cities with Zipf weights (σ 8 km) plus one 10,000-seat stadium.
    const random = seededRandom(100_000);
    const weights = CITIES.map((_, rank) => 1 / (rank + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const locations: GPSCoordinate[] = [];
    for (const [index, [latitude, longitude]] of CITIES.entries()) {
      const count = Math.round((90_000 * weights[index]!) / total);
      for (let i = 0; i < count; i += 1) locations.push(pointNear({ latitude, longitude }, 8_000, random));
    }
    locations.push(...arenaPoints(10_000, 100_001));
    out.push({
      name: `${locations.length.toLocaleString('en-US')} (40 cities + a 10,000-seat stadium)`,
      locations,
      newcomer: (r) => {
        const [latitude, longitude] = CITIES[Math.floor(r() * CITIES.length)]!;
        return pointNear({ latitude, longitude }, 8_000, r);
      },
    });
  }
  return out;
}

type Seeding = GossipOptions['seeding'];

type Run = {
  population: string;
  variant: GossipVariant;
  seeding: Seeding;
  people: number;
  curve: Array<{ round: number; metrics: GossipViewMetrics }>;
  roundsToQuality95: number | null;
  roundsToRecall90: number | null;
  audience: ReturnType<typeof measureAudience>;
  cardsPerPersonPerRound: number;
  churn: Array<{ after: number; old: GossipViewMetrics; newcomers: GossipViewMetrics }>;
  seconds: number;
};

function options(variant: GossipVariant, seed: number, seeding: Seeding = 'pyramid'): GossipOptions {
  return { ...DEFAULT_GOSSIP_OPTIONS, variant, seed, seeding };
}

function run(population: Population, variant: GossipVariant, seeding: Seeding): Run {
  const started = Date.now();
  const reserve = Math.ceil(population.locations.length * CHURN_SHARE) + 1;
  const state = newGossipModel(population.locations, options(variant, population.locations.length, seeding), { reserve });
  const viewers = sampleViewers(state, VIEWERS, population.focus);
  const curve: Run['curve'] = [{ round: 0, metrics: measureViews(state, viewers) }];
  let roundsToQuality95: number | null = null;
  let roundsToRecall90: number | null = null;
  for (let round = 1; round <= ROUNDS; round += 1) {
    gossipRound(state);
    const needCurve = CHECKPOINTS.includes(round);
    const needThreshold = roundsToQuality95 === null || roundsToRecall90 === null;
    if (!needCurve && !needThreshold) continue;
    const metrics = measureViews(state, viewers);
    if (roundsToQuality95 === null && metrics.distanceQuality >= 0.95) roundsToQuality95 = round;
    if (roundsToRecall90 === null && metrics.recall >= 0.9) roundsToRecall90 = round;
    if (needCurve) curve.push({ round, metrics });
  }
  const audience = measureAudience(state);
  const cardsPerPersonPerRound = Math.round(state.cardsSent / (state.liveList.length * ROUNDS));

  // Churn: a fifth leave without a goodbye, as many new people arrive.
  const random = seededRandom(population.locations.length + 7);
  removePeople(state, () => random() < CHURN_SHARE);
  const oldViewers = viewers.filter((index) => state.live[index]);
  const newcomers: number[] = [];
  const arrivals = Math.min(reserve, Math.round(population.locations.length * CHURN_SHARE));
  for (let i = 0; i < arrivals; i += 1) newcomers.push(addPerson(state, population.newcomer(random)));
  if (population.focus) newcomers.splice(0, newcomers.length, ...newcomers.filter((index) => index >= population.locations.length));
  const newViewers = newcomers.slice(0, VIEWERS);
  const churn: Run['churn'] = [];
  for (let after = 1; after <= CHURN_ROUNDS; after += 1) {
    gossipRound(state);
    if ([1, 3, 5, 10, 20].includes(after)) {
      churn.push({ after, old: measureViews(state, oldViewers), newcomers: measureViews(state, newViewers) });
    }
  }
  return {
    population: population.name,
    variant,
    seeding,
    people: population.locations.length,
    curve,
    roundsToQuality95,
    roundsToRecall90,
    audience,
    cardsPerPersonPerRound,
    churn,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

type SybilRun = { variant: GossipVariant; metrics: GossipViewMetrics; audience: ReturnType<typeof measureAudience> };

function sybilRun(variant: GossipVariant): SybilRun {
  const random = seededRandom(31_337);
  const locations = Array.from({ length: 10_000 }, () => pointNear(arena, 60, random));
  const state: GossipState = newGossipModel(locations, options(variant, 31_337), {
    sybil: (index) => index % Math.round(1 / SYBIL_SHARE) === 0,
  });
  for (let round = 1; round <= ROUNDS; round += 1) gossipRound(state);
  return { variant, metrics: measureViews(state, sampleViewers(state, VIEWERS)), audience: measureAudience(state) };
}

const pct = (value: number) => `${Math.round(value * 1000) / 10} %`;
const fmt = (value: number) => value.toLocaleString('en-US');

function markdown(allRuns: Run[], sybils: SybilRun[]): string {
  const runs = allRuns.filter((r) => r.seeding === 'pyramid');
  const regionRuns = allRuns.filter((r) => r.seeding === 'region');
  const { capacity, swapCards, ttlRounds, refreshRounds, regionSeeds, globalSeeds, cellSeeds, cellMeters } = DEFAULT_GOSSIP_OPTIONS;
  const lines = [
    '# Nearby v3 gossip experiment',
    '',
    'Generated by `npx tsx scripts/nearby-gossip-experiment.ts`; do not edit by hand. Model and its limits:',
    '`src/test/support/nearby-gossip-model.ts` (no signatures, network timing, NAT failures or per-connection',
    'cost). Design: `docs/design/nearby-and-place-chatrooms.md` §3.7.',
    '',
    `C = ${capacity} cards per list; ${swapCards} cards each way per swap; one swap started per person per round`,
    `(a round is one gossip period, ${ROUND_SECONDS} s assumed below). A swap request carries a digest of the cards the`,
    `requester holds; the other side offers only cards missing from it, or ${refreshRounds}+ rounds fresher. Cards expire`,
    `after ${ttlRounds} rounds without a fresher copy; privacy-floor cells of ${fmt(cellMeters)} m. The hub seeds a newcomer from its headcount pyramid:`,
    `the finest level whose 3×3 block of cells around them holds ≥ C people, ${cellSeeds} sampled cards per cell (the`,
    `comparison table also runs the simpler ${regionSeeds} regional + ${globalSeeds} worldwide cards). Everyone arrives at round 0`,
    `(the hardest start).`,
    `${VIEWERS} sampled viewers per run. Card size assumed ${CARD_BYTES} bytes.`,
    '',
    '- **Distance quality**: share of the true nearest-C distance band a list covers. In an arena',
    '  everyone is in one cell, so any C people there score 1.',
    '- **Recall**: share of the viewer\'s exact first page (their own hash order) the list holds.',
    '- **Audience**: how many lists a person is on, i.e. how many broadcast loops reach them.',
    '',
    '## Convergence from a cold start',
    '',
    '| People | Tie-break | Quality ≥ 95 % at round | Recall ≥ 90 % at round | Quality / recall after 1, 3, 10, 30 rounds | Audience mean / p99 / max | Cards sent per person per round (≈ bytes/hour) | Run time |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of runs) {
    const at = (round: number) => r.curve.find((point) => point.round === round)?.metrics;
    const qr = [1, 3, 10, 30].map((round) => {
      const m = at(round);
      return m ? `${pct(m.distanceQuality)} / ${pct(m.recall)}` : '–';
    }).join(', ');
    const bytesPerHour = r.cardsPerPersonPerRound * CARD_BYTES * (3600 / ROUND_SECONDS);
    lines.push(`| ${r.population} | ${r.variant} | ${r.roundsToQuality95 ?? `> ${ROUNDS}`} | ${r.roundsToRecall90 ?? `> ${ROUNDS}`} | ${qr} | ${fmt(r.audience.mean)} / ${fmt(r.audience.p99)} / ${fmt(r.audience.max)} | ${r.cardsPerPersonPerRound} (${(bytesPerHour / 1e6).toFixed(1)} MB) | ${r.seconds} s |`);
  }
  lines.push('', `## After ${pct(CHURN_SHARE)} leave without a goodbye and as many arrive`, '',
    '| People | Tie-break | Rounds after | Old lists: quality / recall / stale | Newcomers: fill / quality / recall |',
    '|---|---|---|---|---|');
  for (const r of runs) {
    for (const c of r.churn) {
      lines.push(`| ${r.population} | ${r.variant} | ${c.after} | ${pct(c.old.distanceQuality)} / ${pct(c.old.recall)} / ${pct(c.old.stale)} | ${pct(c.newcomers.fill)} / ${pct(c.newcomers.distanceQuality)} / ${pct(c.newcomers.recall)} |`);
    }
  }
  lines.push('', '## Seeding: headcount pyramid (3×3 cells) vs regional + worldwide sample (public-hash)', '',
    '| People | Seeding | Quality after 0 / 1 / 3 rounds | Quality ≥ 95 % at round | Newcomers after churn: quality / recall at +5 and +20 |',
    '|---|---|---|---|---|');
  for (const r of [...runs.filter((x) => x.variant === 'public-hash'), ...regionRuns].sort((a, b) => a.population.localeCompare(b.population))) {
    const q = [0, 1, 3].map((round) => pct(r.curve.find((point) => point.round === round)?.metrics.distanceQuality ?? 0)).join(' / ');
    const c = (after: number) => {
      const m = r.churn.find((point) => point.after === after)?.newcomers;
      return m ? `${pct(m.distanceQuality)} / ${pct(m.recall)}` : '–';
    };
    lines.push(`| ${r.population} | ${r.seeding} | ${q} | ${r.roundsToQuality95 ?? `> ${ROUNDS}`} | ${c(5)}; ${c(20)} |`);
  }
  lines.push('', `## ${pct(SYBIL_SHARE)} fake accounts in the 10,000-person arena`, '',
    'The fake accounts sit in the arena like everyone else, never pass on an honest card, and push only',
    'each other. Fair share of a list is their population share. (Grinding keys against one victim is',
    'not modelled: it defeats `public-hash` by construction and is impossible against `secret-salt`.)',
    '',
    `| Tie-break | Share of honest lists taken by fakes (fair: ${pct(SYBIL_SHARE)}) | Honest quality / recall after ${ROUNDS} rounds | Honest audience mean / max |`,
    '|---|---|---|---|');
  for (const s of sybils) {
    lines.push(`| ${s.variant} | ${pct(s.metrics.sybilShare)} | ${pct(s.metrics.distanceQuality)} / ${pct(s.metrics.recall)} | ${fmt(s.audience.mean)} / ${fmt(s.audience.max)} |`);
  }
  return `${lines.join('\n')}\n`;
}

const quick = process.argv.includes('--quick');
const runs: Run[] = [];
for (const population of populations(quick)) {
  for (const [variant, seeding] of [['public-hash', 'pyramid'], ['secret-salt', 'pyramid'], ['public-hash', 'region']] as const) {
    const result = run(population, variant, seeding);
    runs.push(result);
    process.stdout.write(`[gossip] ${population.name} ${variant} ${seeding}: quality≥95% @${result.roundsToQuality95}, recall≥90% @${result.roundsToRecall90}, audience max ${result.audience.max} (${result.seconds} s)\n`);
  }
}
const sybils = VARIANTS.map((variant) => sybilRun(variant));
for (const s of sybils) process.stdout.write(`[gossip] sybil ${s.variant}: share ${s.metrics.sybilShare}, recall ${s.metrics.recall}\n`);
const out = path.resolve(__dirname, '..', 'docs', 'testing', 'nearby-gossip-experiment.md');
writeFileSync(out, markdown(runs, sybils));
writeFileSync(out.replace(/\.md$/, '.json'), `${JSON.stringify({ runs, sybils }, null, 1)}\n`);
process.stdout.write(`[gossip] wrote ${path.relative(process.cwd(), out)}\n`);
