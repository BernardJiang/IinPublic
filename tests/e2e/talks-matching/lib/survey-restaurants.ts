/**
 * Shared logic: restaurant survey demo (used by CLI + e2e).
 */

import { TalkValidator } from '../../../../src/shared/talk-engine';
import { computeTalkIdFromTalkData } from '../../../../src/shared/talk-content-id';
import type { Question, Talk } from '../../../../src/shared/types';

const IGNORE = { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true };

export function makeRestaurantSurvey(): Talk {
  const questions: Question[] = [
    {
      id: 'q_burger',
      text: 'Which restaurant has the best burger?',
      isAggregatable: true,
      contextHashId: '',
      answers: [
        { id: 'bg_mc', text: 'McDonald', isTerminal: true, counter: 0 },
        { id: 'bg_kfc', text: 'KFC', isTerminal: true, counter: 0 },
        { id: 'bg_wen', text: "Wenddy's", isTerminal: true, counter: 0 },
        { id: 'bg_ot', text: 'others', isTerminal: true, counter: 0 },
        { ...IGNORE, id: 'bg_ig' },
      ],
    },
    {
      id: 'q_fries',
      text: 'Which restaurant has the best fries?',
      isAggregatable: true,
      contextHashId: '',
      answers: [
        { id: 'fr_md', text: 'MaDonald', isTerminal: true, counter: 0 },
        { id: 'fr_kfc', text: 'KFC', isTerminal: true, counter: 0 },
        { id: 'fr_ino', text: 'In and Out', isTerminal: true, counter: 0 },
        { id: 'fr_ot', text: 'others', isTerminal: true, counter: 0 },
        { ...IGNORE, id: 'fr_ig' },
      ],
    },
    {
      id: 'q_pizza',
      text: 'Which restaurant has the best pizza?',
      isAggregatable: true,
      contextHashId: '',
      answers: [
        { id: 'pz_ph', text: 'Pizza Hut', isTerminal: true, counter: 0 },
        { id: 'pz_gh', text: 'Gravity Height', isTerminal: true, counter: 0 },
        { id: 'pz_dom', text: "Domino's Pizza", isTerminal: true, counter: 0 },
        { id: 'pz_ot', text: 'others', isTerminal: true, counter: 0 },
        { ...IGNORE, id: 'pz_ig' },
      ],
    },
  ];

  return {
    id: 'demo-survey-food',
    title: 'Restaurant survey',
    authorId: 'demo-author',
    type: 'survey',
    isAdult: false,
    language: 'en',
    tags: [],
    questions,
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
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

export function simulateRestaurantUsers(talk: Talk, seed: number) {
  const rng = mulberry32(seed);
  const rows: { user: number; burger: string; fries: string; pizza: string }[] = [];

  for (let u = 1; u <= 10; u += 1) {
    const row: { user: number; burger: string; fries: string; pizza: string } = {
      user: u,
      burger: '',
      fries: '',
      pizza: '',
    };
    for (const q of talk.questions) {
      const opts = q.answers.filter((a) => !a.isIgnore);
      const choice = pick(rng, opts);
      choice.counter = (choice.counter ?? 0) + 1;
      if (q.id === 'q_burger') row.burger = choice.text;
      if (q.id === 'q_fries') row.fries = choice.text;
      if (q.id === 'q_pizza') row.pizza = choice.text;
    }
    rows.push(row);
  }
  return rows;
}

export function mergeSurveyCountersInto(base: Talk, incoming: Talk) {
  for (let i = 0; i < base.questions.length; i += 1) {
    const bq = base.questions[i]!;
    const iq = incoming.questions[i]!;
    for (let j = 0; j < bq.answers.length; j += 1) {
      const ba = bq.answers[j]!;
      const ia = iq.answers[j]!;
      ba.counter = (ba.counter ?? 0) + (ia.counter ?? 0);
    }
  }
}

export function runRestaurantSurveyDemo(): void {
  const wave1 = makeRestaurantSurvey();
  const wave2 = makeRestaurantSurvey();

  TalkValidator.validateTalk(wave1);
  TalkValidator.validateTalk(wave2);

  const id1 = computeTalkIdFromTalkData(wave1);
  const id2 = computeTalkIdFromTalkData(wave2);
  console.log('=== Restaurant survey ===\n');
  console.log(`Content identity wave1: ${id1}`);
  console.log(`Content identity wave2: ${id2}`);

  simulateRestaurantUsers(wave1, 7);
  simulateRestaurantUsers(wave2, 91);

  const combined = makeRestaurantSurvey();
  mergeSurveyCountersInto(combined, wave1);
  mergeSurveyCountersInto(combined, wave2);
  TalkValidator.validateTalk(combined);
  console.log('Combined waves validated.');
}
