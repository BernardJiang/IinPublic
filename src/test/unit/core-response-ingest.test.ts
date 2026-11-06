/** OPEN-91 P4: the author's decision on an incoming Talk response, as the core makes it. */
import { compareResponse, decideResponseIngest, type ResponseIngestInput } from '../../core/response-ingest';
import type { OutcomeRecord } from '../../core/device-graph/exchanged';

const tag = {
  id: 'talk-1', type: 'tag', title: 'Tennis',
  questions: [{ id: 'q1', text: 'Tennis?', answers: [{ id: 'yes', text: 'Yes', isMatch: true }, { id: 'no', text: 'No', isIgnore: true }] }],
};
const yes = [{ questionId: 'q1', answerId: 'yes', answerText: 'Yes' }];
const no = [{ questionId: 'q1', answerId: 'no', answerText: 'No' }];

function input(overrides: Partial<ResponseIngestInput> = {}): ResponseIngestInput {
  return {
    talkData: tag, answers: yes,
    responderId: 'bob', authorId: 'ann', talkId: 'talk-1', responseId: 'r1', version: 1,
    respondedAt: '2026-10-26T10:00:00.000Z', submittedAt: '2026-10-26T10:00:00.000Z',
    ...overrides,
  };
}

const prior = (outcome: 'matched' | 'ignored', version: number, responseId = 'r1'): OutcomeRecord =>
  ({ outcome, version, responseId, respondedAt: '2026-10-26T09:00:00.000Z' });

describe('decideResponseIngest', () => {
  it('a first answer is taken, a match or not', () => {
    expect(decideResponseIngest(input())).toMatchObject({ kind: 'first', isMatch: true, version: 1 });
    expect(decideResponseIngest(input({ answers: no }))).toMatchObject({ kind: 'first', isMatch: false });
  });

  it('a survey answered only in part is discarded', () => {
    const survey = { ...tag, type: 'survey', questions: [...tag.questions, { id: 'q2', text: 'More?', answers: [] }] };
    expect(decideResponseIngest(input({ talkData: survey }))).toEqual({ kind: 'reject', reason: 'incomplete-survey' });
  });

  it('an answer given before the Talk was retracted is discarded; one given after is taken', () => {
    const retractedAt = Date.parse('2026-10-26T10:30:00.000Z');
    expect(decideResponseIngest(input({ retractedAt }))).toEqual({ kind: 'reject', reason: 'retracted' });
    expect(decideResponseIngest(input({ retractedAt, respondedAt: '2026-10-26T11:00:00.000Z' })).kind).toBe('first');
  });

  it('a change of mind flips the outcome either way; the same outcome is a version bump', () => {
    expect(decideResponseIngest(input({ prior: prior('ignored', 1), version: 2, responseId: 'r2' }))).toMatchObject({ kind: 'now-match', priorVersion: 1 });
    expect(decideResponseIngest(input({ prior: prior('matched', 1), answers: no, version: 2, responseId: 'r2' }))).toMatchObject({ kind: 'no-longer-match' });
    expect(decideResponseIngest(input({ prior: prior('matched', 1), version: 2, responseId: 'r2' }))).toMatchObject({ kind: 'unchanged', isMatch: true });
  });

  it('a replay or an older version is discarded', () => {
    expect(decideResponseIngest(input({ prior: prior('matched', 2, 'r2'), version: 1, responseId: 'r2' }))).toEqual({ kind: 'reject', reason: 'stale' });
    expect(decideResponseIngest(input({ prior: prior('matched', 2, 'r2'), version: 2, responseId: 'r2' }))).toEqual({ kind: 'reject', reason: 'stale' });
  });

  it('at one version, the later answer wins', () => {
    const existing = { version: 1, responseId: 'a', respondedAt: '2026-10-26T09:00:00.000Z' };
    expect(compareResponse(existing, { version: 1, responseId: 'b', respondedAt: '2026-10-26T09:01:00.000Z' })).toBeGreaterThan(0);
    expect(compareResponse(existing, { version: 1, responseId: 'b', respondedAt: '2026-10-26T08:59:00.000Z' })).toBeLessThan(0);
    expect(compareResponse(existing, { version: 2, responseId: 'a', respondedAt: '2026-10-26T08:00:00.000Z' })).toBeGreaterThan(0);
  });
});
