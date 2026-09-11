/** @jest-environment jsdom */

import { completeTalk, saveMyTalk, type TalkCompletionDeps } from '../../web/ui/talk-completion';
import { getMyTalks } from '../../web/ui/my-talks-storage';
import { getAnsweredTalkByContent } from '../../web/ui/answer-preferences-storage';
import { getFlatAnswerHistory } from '../../web/ui/answer-history-storage';

function deps(overrides: Partial<TalkCompletionDeps> = {}): TalkCompletionDeps {
  return {
    t: (key) => key,
    emit: jest.fn(),
    showNotification: jest.fn(),
    displayTalksList: jest.fn(),
    ...overrides,
  };
}

function talk(overrides: Record<string, any> = {}): any {
  return {
    id: 't1',
    title: 'My Talk',
    type: 'flow',
    authorId: 'author-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    questions: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('saveMyTalk', () => {
  it('writes a new entry to myTalks with a fresh lastInteraction', () => {
    const d = deps();
    saveMyTalk(
      { talkId: 't1', title: 'T', type: 'flow', timestamp: 'x', role: 'answered' } as any,
      d,
    );
    const entry = getMyTalks().t1;
    expect(entry.title).toBe('T');
    expect(entry.role).toBe('answered');
    expect(typeof entry.lastInteraction).toBe('string');
  });

  it('preserves an existing role when a later patch omits it, but overwrites title/timestamp', () => {
    const d = deps();
    saveMyTalk({ talkId: 't1', title: 'T', type: 'flow', timestamp: 'x', role: 'created' } as any, d);
    saveMyTalk({ talkId: 't1', title: 'T2', type: 'flow', timestamp: 'y' } as any, d);
    const entry = getMyTalks().t1;
    expect(entry.title).toBe('T2');
    expect(entry.role).toBe('created');
  });

  it('refreshes the talks list only when the Talks tab view is currently active', () => {
    const d = deps();
    saveMyTalk({ talkId: 't1', title: 'T', type: 'flow', timestamp: 'x', role: 'answered' } as any, d);
    expect(d.displayTalksList).not.toHaveBeenCalled();

    document.body.innerHTML = '<div id="talks-view" class="active"></div>';
    saveMyTalk({ talkId: 't1', title: 'T', type: 'flow', timestamp: 'x', role: 'answered' } as any, d);
    expect(d.displayTalksList).toHaveBeenCalledTimes(1);
  });
});

describe('completeTalk', () => {
  it('saves a new entry keyed by talk.id and records the answered-by-content mapping', () => {
    const d = deps();
    completeTalk(talk(), [{ questionId: 'q1', answerId: 'yes' }], 'match', undefined, d);

    const myTalks = getMyTalks();
    expect(myTalks.t1).toBeDefined();
    expect(myTalks.t1.outcome).toBe('match');
    expect(myTalks.t1.senders).toEqual(['author-1']);

    const byContent = getAnsweredTalkByContent();
    expect(Object.values(byContent)).toContain('t1');
  });

  it('reuses the existing talkId and unions senders when the same content was already answered', () => {
    const d = deps();
    const t = talk();
    completeTalk(t, [{ questionId: 'q1', answerId: 'yes' }], 'match', undefined, d);
    completeTalk(talk({ id: 't1', authorId: 'author-2' }), [{ questionId: 'q1', answerId: 'yes' }], 'match', undefined, d);

    const myTalks = getMyTalks();
    expect(Object.keys(myTalks)).toHaveLength(1);
    expect(myTalks.t1.senders).toEqual(expect.arrayContaining(['author-1', 'author-2']));
  });

  it('marks role "answered" when an ignore answer is present, even with copy-autosave on', () => {
    const d = deps();
    completeTalk(talk(), [{ questionId: 'q1', answerId: 'ignore' }], 'mismatch', undefined, d);
    expect(getMyTalks().t1.role).toBe('answered');
  });

  it('marks role "copied" when copy-autosave is on and no answer was an ignore', () => {
    localStorage.setItem('copyTalkAutoSave', 'true');
    const d = deps();
    completeTalk(talk(), [{ questionId: 'q1', answerId: 'yes' }], 'match', undefined, d);
    expect(getMyTalks().t1.role).toBe('copied');
  });

  it('preserves an existing "created" role rather than downgrading it', () => {
    const d = deps();
    saveMyTalk({ talkId: 't1', title: 'T', type: 'flow', timestamp: 'x', role: 'created' } as any, d);
    completeTalk(talk(), [{ questionId: 'q1', answerId: 'yes' }], 'match', undefined, d);
    expect(getMyTalks().t1.role).toBe('created');
  });

  it('records a flat answer history entry', () => {
    const d = deps();
    completeTalk(
      talk({ questions: [{ id: 'q1', answers: [{ id: 'yes', text: 'Yes' }] }] }),
      [{ questionId: 'q1', answerId: 'yes' }],
      'match',
      undefined,
      d,
    );
    expect(Object.keys(getFlatAnswerHistory()).length).toBeGreaterThan(0);
  });

  it('emits talkCompleted with the withholdFromSender flag only when set', () => {
    const d = deps();
    completeTalk(talk(), [{ questionId: 'q1', answerId: 'yes' }], 'match', { withholdFromSender: true }, d);
    expect(d.emit).toHaveBeenCalledWith('talkCompleted', expect.objectContaining({
      talkId: 't1',
      withholdFromSender: true,
    }));
  });

  it('does not include withholdFromSender when meta is absent', () => {
    const d = deps();
    completeTalk(talk(), [{ questionId: 'q1', answerId: 'yes' }], 'match', undefined, d);
    const call = (d.emit as jest.Mock).mock.calls[0][1];
    expect(call).not.toHaveProperty('withholdFromSender');
  });

  it.each([
    ['flow', 'responseSubmittedFlow'],
    ['tag', 'responseSubmittedTag'],
    ['survey', 'responseSubmittedSurvey'],
  ])('shows the %s-specific success notification', (type, expectedKey) => {
    const d = deps();
    completeTalk(talk({ type }), [{ questionId: 'q1', answerId: 'yes' }], 'match', undefined, d);
    expect(d.showNotification).toHaveBeenCalledWith(expectedKey, 'success');
  });
});
