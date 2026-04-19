/**
 * Shared logic: survey-type customer satisfaction demo (used by CLI + e2e).
 */

import { TalkValidator } from '../../../../src/shared/talk-engine';
import { computeTalkIdFromTalkData } from '../../../../src/shared/talk-content-id';
import type { Answer, Question, Talk } from '../../../../src/shared/types';

const IGNORE = { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true };

export function makeSurveyTalk(companyLabel: string): Talk {
  const questions: Question[] = [
    {
      id: 'q_staff',
      text: `How do you like staff who served you? (${companyLabel}) From one star for bad, to 5 stars for good.`,
      isAggregatable: true,
      contextHashId: '',
      answers: [
        ...([1, 2, 3, 4, 5] as const).map(
          (n): Answer => ({
            id: `staff_${n}`,
            text: String(n),
            isTerminal: true,
            counter: 0,
          }),
        ),
        IGNORE,
      ],
    },
    {
      id: 'q_service',
      text: `How do you like service quality? (${companyLabel}) From 1 for bad to 10 for good. (Answers 9–10 are grouped due to the 10-options-per-question limit.)`,
      isAggregatable: true,
      contextHashId: '',
      answers: [
        ...([1, 2, 3, 4, 5, 6, 7, 8] as const).map(
          (n): Answer => ({
            id: `svc_${n}`,
            text: String(n),
            isTerminal: true,
            counter: 0,
          }),
        ),
        {
          id: 'svc_9_10',
          text: '9-10',
          isTerminal: true,
          counter: 0,
        },
        { ...IGNORE, id: 'svc_ign' },
      ],
    },
    {
      id: 'q_nps',
      text: `How likely would you recommend us to your friends? (${companyLabel})`,
      isAggregatable: true,
      contextHashId: '',
      answers: [
        { id: 'nps_no', text: 'No.', isTerminal: true, counter: 0 },
        { id: 'nps_maybe', text: 'Maybe.', isTerminal: true, counter: 0 },
        { id: 'nps_yes', text: 'Yes.', isTerminal: true, counter: 0 },
        { ...IGNORE, id: 'nps_ign' },
      ],
    },
  ];

  return {
    id: 'demo-survey-sat',
    title: `Customer satisfaction — ${companyLabel}`,
    authorId: `company:${companyLabel}`,
    type: 'survey',
    isAdult: false,
    language: 'en',
    tags: [],
    questions,
    createdAt: new Date('2026-01-15T12:00:00.000Z'),
    isTemplate: false,
    usageCount: 0,
    authorLocation: { latitude: 37.7749, longitude: -122.4194 },
  };
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function npsNumeric(id: string): number | null {
  if (id === 'nps_no') return 1;
  if (id === 'nps_maybe') return 2;
  if (id === 'nps_yes') return 3;
  return null;
}

export function simulateUsers(talk: Talk, seed: number) {
  const rng = mulberry32(seed);
  const qStaff = talk.questions.find((q) => q.id === 'q_staff')!;
  const qSvc = talk.questions.find((q) => q.id === 'q_service')!;
  const qNps = talk.questions.find((q) => q.id === 'q_nps')!;

  const rows: { user: number; staff: string; service: string; nps: string }[] = [];

  for (let u = 1; u <= 10; u += 1) {
    const staffA = qStaff.answers.filter((a) => !a.isIgnore);
    const svcA = qSvc.answers.filter((a) => !a.isIgnore);
    const npsA = qNps.answers.filter((a) => !a.isIgnore);

    const staffPick = pick(rng, staffA);
    const svcPick = pick(rng, svcA);
    const npsPick = pick(rng, npsA);

    staffPick.counter = (staffPick.counter ?? 0) + 1;
    svcPick.counter = (svcPick.counter ?? 0) + 1;
    npsPick.counter = (npsPick.counter ?? 0) + 1;

    rows.push({
      user: u,
      staff: staffPick.text,
      service: svcPick.text,
      nps: npsPick.text,
    });
  }

  return rows;
}

export function averages(talk: Talk) {
  const qStaff = talk.questions.find((q) => q.id === 'q_staff')!;
  const qSvc = talk.questions.find((q) => q.id === 'q_service')!;
  const qNps = talk.questions.find((q) => q.id === 'q_nps')!;

  let staffSum = 0;
  let staffN = 0;
  for (const a of qStaff.answers) {
    if (a.isIgnore) continue;
    const c = a.counter ?? 0;
    const v = Number(a.text);
    if (Number.isFinite(v)) {
      staffSum += v * c;
      staffN += c;
    }
  }

  let svcSum = 0;
  let svcN = 0;
  for (const a of qSvc.answers) {
    if (a.isIgnore) continue;
    const c = a.counter ?? 0;
    if (c === 0) continue;
    if (a.id === 'svc_9_10') {
      const mid = 9.5;
      svcSum += mid * c;
      svcN += c;
    } else {
      const v = Number(a.text);
      if (Number.isFinite(v)) {
        svcSum += v * c;
        svcN += c;
      }
    }
  }

  let npsSum = 0;
  let npsN = 0;
  for (const a of qNps.answers) {
    if (a.isIgnore) continue;
    const c = a.counter ?? 0;
    const v = npsNumeric(a.id);
    if (v != null) {
      npsSum += v * c;
      npsN += c;
    }
  }

  return {
    staffAvg: staffN ? staffSum / staffN : 0,
    serviceAvg: svcN ? svcSum / svcN : 0,
    recommendAvg: npsN ? npsSum / npsN : 0,
    totalUsers: 10,
  };
}

export function runSurveyCustomerSatisfactionDemo(): void {
  const companyA = 'Acme Coffee';
  const companyB = 'Beta Bistro';

  const talkA = makeSurveyTalk(companyA);
  const talkB = makeSurveyTalk(companyB);

  TalkValidator.validateTalk(talkA);
  TalkValidator.validateTalk(talkB);

  const seed = 42;
  const rows = simulateUsers(talkA, seed);
  const stats = averages(talkA);

  console.log('=== Customer satisfaction survey (survey-type talk) ===\n');
  console.log('Per-user picks (pseudo-random):');
  console.table(rows);

  console.log('\n--- Summary ---');
  console.log(`Total users: ${stats.totalUsers}`);
  console.log(`Average staff rating (1–5): ${stats.staffAvg.toFixed(2)}`);
  console.log(`Average service quality (1–10 scale, 9–10 bucket as 9.5): ${stats.serviceAvg.toFixed(2)}`);
  console.log(`Average recommend score (No=1, Maybe=2, Yes=3): ${stats.recommendAvg.toFixed(2)}`);

  const contentOnlyA = computeTalkIdFromTalkData(talkA);
  const contentOnlyB = computeTalkIdFromTalkData(talkB);
  console.log('\n--- Talk identity (content-only) ---');
  console.log(`${companyA}: ${contentOnlyA}`);
  console.log(`${companyB}: ${contentOnlyB}`);

  const scopedA = computeTalkIdFromTalkData(talkA, {
    includeAuthorId: true,
    includeCreatedAt: true,
    includeLocation: true,
  });
  const talkAOtherWindow = {
    ...talkA,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    authorLocation: { latitude: 40.7128, longitude: -74.006 },
  };
  const scopedA2 = computeTalkIdFromTalkData(talkAOtherWindow, {
    includeAuthorId: true,
    includeCreatedAt: true,
    includeLocation: true,
  });

  console.log('\n--- Scoped identity ---');
  console.log(`${companyA} Jan SF: ${scopedA}`);
  console.log(`${companyA} Apr NYC (same Q text): ${scopedA2}`);
}
