/** OPEN-91 P4: the author's decision on an incoming Talk response, as the core makes it. */
import { decideResponseIngest, type ResponseIngestInput } from '../../core/response-ingest';
import { emptyTalkLedgerDoc, outcomeKey, retractedKey, type TalkLedgerDoc } from '../../shared/talk-ledger';

const tag = {
  id: 'talk-1', type: 'tag', title: 'Tennis',
  questions: [{ id: 'q1', text: 'Tennis?', answers: [{ id: 'yes', text: 'Yes', isMatch: true }, { id: 'no', text: 'No', isIgnore: true }] }],
};
const yes = [{ questionId: 'q1', answerId: 'yes', answerText: 'Yes' }];
const no = [{ questionId: 'q1', answerId: 'no', answerText: 'No' }];

function input(overrides: Partial<ResponseIngestInput> = {}): ResponseIngestInput {
  return {
    talkData: tag, answers: yes, ledger: emptyTalkLedgerDoc(), identityKey: 'id-tennis',
    responderId: 'bob', authorId: 'ann', talkId: 'talk-1', responseId: 'r1', version: 1,
    respondedAt: '2026-10-26T10:00:00.000Z', submittedAt: '2026-10-26T10:00:00.000Z', now: '2026-10-26T10:00:01.000Z',
    ...overrides,
  };
}

function ledgerWith(outcome: 'matched' | 'ignored', version: number, responseId = 'r1'): TalkLedgerDoc {
  const ledger = emptyTalkLedgerDoc();
  ledger.outcomes[outcomeKey('bob', 'talk-1', 'ann')] = {
    responderId: 'bob', talkId: 'talk-1', authorId: 'ann', identityKey: 'id-tennis', outcome, version, responseId,
    respondedAt: '2026-10-26T09:00:00.000Z', updatedAt: '2026-10-26T09:00:00.000Z',
  } as never;
  return ledger;
}

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
    const ledger = emptyTalkLedgerDoc();
    ledger.retracted[retractedKey('talk-1', 'ann')] = { retractedAt: Date.parse('2026-10-26T10:30:00.000Z') } as never;
    expect(decideResponseIngest(input({ ledger }))).toEqual({ kind: 'reject', reason: 'retracted' });
    expect(decideResponseIngest(input({ ledger, respondedAt: '2026-10-26T11:00:00.000Z' })).kind).toBe('first');
  });

  it('a change of mind flips the outcome either way; the same outcome is a version bump', () => {
    expect(decideResponseIngest(input({ ledger: ledgerWith('ignored', 1), version: 2, responseId: 'r2' }))).toMatchObject({ kind: 'now-match', priorVersion: 1 });
    expect(decideResponseIngest(input({ ledger: ledgerWith('matched', 1), answers: no, version: 2, responseId: 'r2' }))).toMatchObject({ kind: 'no-longer-match' });
    expect(decideResponseIngest(input({ ledger: ledgerWith('matched', 1), version: 2, responseId: 'r2' }))).toMatchObject({ kind: 'unchanged', isMatch: true });
  });

  it('a replay or an older version is discarded, and the caller’s ledger is never changed', () => {
    const ledger = ledgerWith('matched', 2, 'r2');
    const before = JSON.stringify(ledger);
    expect(decideResponseIngest(input({ ledger, version: 1, responseId: 'r2' }))).toEqual({ kind: 'reject', reason: 'stale' });
    expect(decideResponseIngest(input({ ledger, version: 2, responseId: 'r2' }))).toEqual({ kind: 'reject', reason: 'stale' });
    decideResponseIngest(input({ ledger, version: 3, responseId: 'r3' }));
    expect(JSON.stringify(ledger)).toBe(before);
  });
});
