/**
 * Talks matching — survey customer satisfaction (demo, no browser).
 * Logic: ./lib/survey-customer-satisfaction.ts (also used by scripts/talk-tests).
 */
import { test, expect } from '../helpers/fixtures';
import { TalkValidator } from '../../../src/shared/talk-engine';
import { computeTalkIdFromTalkData } from '../../../src/shared/talk-content-id';
import {
  averages,
  makeSurveyTalk,
  simulateUsers,
} from './lib/survey-customer-satisfaction';

test.describe('Talks matching — survey customer satisfaction (demo)', () => {
  test('validates talk, simulates 10 users, and separates identity keys', () => {
    const companyA = 'Acme Coffee';
    const companyB = 'Beta Bistro';
    const talkA = makeSurveyTalk(companyA);
    const talkB = makeSurveyTalk(companyB);

    expect(() => TalkValidator.validateTalk(talkA)).not.toThrow();
    expect(() => TalkValidator.validateTalk(talkB)).not.toThrow();

    const seed = 42;
    const rows = simulateUsers(talkA, seed);
    expect(rows).toHaveLength(10);

    for (const q of talkA.questions) {
      const nonIgn = q.answers.filter((a) => !a.isIgnore);
      const sum = nonIgn.reduce((s, a) => s + (a.counter ?? 0), 0);
      expect(sum).toBe(10);
    }

    const stats = averages(talkA);
    expect(stats.totalUsers).toBe(10);
    expect(stats.staffAvg.toFixed(2)).toBe('2.80');
    expect(stats.serviceAvg.toFixed(2)).toBe('4.30');
    expect(stats.recommendAvg.toFixed(2)).toBe('2.00');

    const contentA = computeTalkIdFromTalkData(talkA);
    const contentB = computeTalkIdFromTalkData(talkB);
    expect(contentA).toMatch(/^qa_[0-9a-f]{8}$/);
    expect(contentB).toMatch(/^qa_[0-9a-f]{8}$/);
    expect(contentA).not.toBe(contentB);

    const scopedA = computeTalkIdFromTalkData(talkA, {
      includeAuthorId: true,
      includeCreatedAt: true,
      includeLocation: true,
    });
    const otherWindow = {
      ...talkA,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      authorLocation: { latitude: 40.7128, longitude: -74.006 },
    };
    const scopedB = computeTalkIdFromTalkData(otherWindow, {
      includeAuthorId: true,
      includeCreatedAt: true,
      includeLocation: true,
    });
    expect(scopedA).not.toBe(scopedB);
  });
});
