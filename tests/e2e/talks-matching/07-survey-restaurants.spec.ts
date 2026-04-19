/**
 * Talks matching — restaurant survey (demo, no browser).
 */
import { test, expect } from '../helpers/fixtures';
import { TalkValidator } from '../../../src/shared/talk-engine';
import { computeTalkIdFromTalkData } from '../../../src/shared/talk-content-id';
import {
  makeRestaurantSurvey,
  mergeSurveyCountersInto,
  simulateRestaurantUsers,
} from './lib/survey-restaurants';

test.describe('Talks matching — restaurant survey (demo)', () => {
  test('same wording shares content id; merged waves sum to 20 picks per question', () => {
    const wave1 = makeRestaurantSurvey();
    const wave2 = makeRestaurantSurvey();
    expect(() => TalkValidator.validateTalk(wave1)).not.toThrow();
    expect(() => TalkValidator.validateTalk(wave2)).not.toThrow();

    const id1 = computeTalkIdFromTalkData(wave1);
    const id2 = computeTalkIdFromTalkData(wave2);
    expect(id1).toBe(id2);

    simulateRestaurantUsers(wave1, 7);
    simulateRestaurantUsers(wave2, 91);

    const combined = makeRestaurantSurvey();
    mergeSurveyCountersInto(combined, wave1);
    mergeSurveyCountersInto(combined, wave2);
    expect(() => TalkValidator.validateTalk(combined)).not.toThrow();

    for (const q of combined.questions) {
      const nonIgn = q.answers.filter((a) => !a.isIgnore);
      const sum = nonIgn.reduce((s, a) => s + (a.counter ?? 0), 0);
      expect(sum).toBe(20);
    }
  });
});
