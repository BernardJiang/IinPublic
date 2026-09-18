import {
  getFlatAnswerHistory,
  getTalkContentKey,
  saveFlatAnswerHistoryRecord,
  setFlatAnswerHistory,
} from '../../web/ui/answer-history-storage';

beforeEach(() => {
  setFlatAnswerHistory({});
});

describe('getTalkContentKey', () => {
  it('is stable for the same question/answer content regardless of unrelated fields', () => {
    const a = { type: 'flow', questions: [{ text: 'Q1', answers: [{ text: 'A1' }] }] };
    const b = { type: 'flow', questions: [{ text: 'Q1', answers: [{ text: 'A1' }] }], id: 'other-id' };
    expect(getTalkContentKey(a)).toBe(getTalkContentKey(b));
  });

  it('differs when locationRadiusMiles differs', () => {
    const base = { type: 'flow', questions: [] };
    expect(getTalkContentKey({ ...base, locationRadiusMiles: 5 })).not.toBe(
      getTalkContentKey({ ...base, locationRadiusMiles: 10 }),
    );
  });

  it('folds title into the key only for type "tag"', () => {
    const tag = { type: 'tag', title: 'Buy a bike', questions: [] };
    const otherTag = { type: 'tag', title: 'Sell a bike', questions: [] };
    const flow = { type: 'flow', title: 'Buy a bike', questions: [] };
    const otherFlow = { type: 'flow', title: 'Sell a bike', questions: [] };
    expect(getTalkContentKey(tag)).not.toBe(getTalkContentKey(otherTag));
    expect(getTalkContentKey(flow)).toBe(getTalkContentKey(otherFlow));
  });
});

describe('saveFlatAnswerHistoryRecord', () => {
  it('persists under an id combining the content key and talkId', () => {
    const talk = { id: 'talk-1', type: 'flow', title: 'My Flow', questions: [] };
    saveFlatAnswerHistoryRecord('talk-1', talk, [], 'match', ['sender-1']);

    const history = getFlatAnswerHistory();
    const key = `${getTalkContentKey(talk)}:talk-1`;
    expect(history[key]).toBeDefined();
    expect(history[key].talkId).toBe('talk-1');
    expect(history[key].outcome).toBe('match');
    expect(history[key].senderIds).toEqual(['sender-1']);
  });

  it('dedupes sender ids and drops falsy entries', () => {
    const talk = { id: 't', type: 'survey', questions: [] };
    saveFlatAnswerHistoryRecord('t', talk, [], 'mismatch', ['a', 'a', '', 'b']);
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.senderIds).toEqual(['a', 'b']);
  });

  it('a self-match tag (booleanTag) renders Checked/Unchecked, not the raw answer text', () => {
    const talk = {
      id: 't',
      type: 'tag',
      title: 'Buy a bike',
      questions: [
        { id: 'q1', text: 'Buy a bike', tagKind: 'simple', answers: [{ id: 'a1', text: 'Yes', isMatch: true }] },
      ],
    };
    saveFlatAnswerHistoryRecord('t', talk, [{ questionId: 'q1', answerId: 'a1' }], 'match', []);
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0].kind).toBe('tag');
    expect(record.items[0].booleanTag).toBe(true);
    expect(record.items[0].choice).toBe('Checked');
  });

  it('a Pair tag (reciprocalTagContext) renders its real accepted-answer text, not a boolean', () => {
    const talk = {
      id: 't',
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'What are you doing?',
          reciprocalTagContext: 'buy-sell',
          answers: [{ id: 'a1', text: 'sell', isMatch: true }],
        },
      ],
    };
    saveFlatAnswerHistoryRecord('t', talk, [{ questionId: 'q1', answerId: 'a1' }], 'match', []);
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0].kind).toBe('tag');
    expect(record.items[0].booleanTag).toBe(false);
    expect(record.items[0].choice).toBe('sell');
  });

  it('an ordinary flow question falls back to "Ignored" when no answer text is present', () => {
    const talk = {
      id: 't',
      type: 'flow',
      questions: [{ id: 'q1', text: 'Pick one', answers: [] }],
    };
    saveFlatAnswerHistoryRecord('t', talk, [{ questionId: 'q1', answerId: 'missing' }], 'mismatch', []);
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0].choice).toBe('Ignored');
  });

  it('an explicit "ignore" answerText also falls back to the answer object\'s own text or Ignored', () => {
    const talk = {
      id: 't',
      type: 'flow',
      questions: [{ id: 'q1', text: 'Pick one', answers: [{ id: 'a1', text: 'Some answer' }] }],
    };
    saveFlatAnswerHistoryRecord(
      't',
      talk,
      [{ questionId: 'q1', answerId: 'a1', answerText: 'ignore' }],
      'mismatch',
      [],
    );
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0].choice).toBe('Some answer');
  });

  it('a flow talk builds contextLabel from prior question→answer pairs, joined by " · "', () => {
    const talk = {
      id: 't',
      type: 'flow',
      questions: [
        { id: 'q1', text: 'Q1', answers: [{ id: 'a1', text: 'A1' }] },
        { id: 'q2', text: 'Q2', answers: [{ id: 'a2', text: 'A2' }] },
      ],
    };
    saveFlatAnswerHistoryRecord(
      't',
      talk,
      [
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a2' },
      ],
      'match',
      [],
    );
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0].contextLabel).toBe(''); // first question has no prior context
    expect(record.items[1].contextLabel).toBe('Q1→A1');
  });

  it('a route talk builds contextLabel/contextPath from the question\'s own contextPath field', () => {
    const talk = {
      id: 't',
      type: 'route',
      questions: [
        { id: 'q1', text: 'Root', answers: [{ id: 'a1', text: 'Go' }] },
        {
          id: 'q2',
          text: 'Leaf',
          answers: [{ id: 'a2', text: 'Done' }],
          contextPath: [{ questionId: 'q1', answerId: 'a1' }],
        },
      ],
    };
    saveFlatAnswerHistoryRecord(
      't',
      talk,
      [
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a2' },
      ],
      'match',
      [],
    );
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[1].contextPath).toEqual(['Root→Go']);
    expect(record.items[1].contextLabel).toBe('Root→Go');
  });

  it('a survey talk always renders an empty contextLabel/contextHash, even with a contextPath', () => {
    const talk = {
      id: 't',
      type: 'survey',
      questions: [{ id: 'q1', text: 'Q1', answers: [{ id: 'a1', text: 'A1' }], contextHashId: 'hash1' }],
    };
    saveFlatAnswerHistoryRecord('t', talk, [{ questionId: 'q1', answerId: 'a1' }], 'mismatch', []);
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0].contextLabel).toBe('');
    expect(record.items[0].contextHash).toBeUndefined();
  });

  it('includes contextHash and questionContentId only when the question carries them', () => {
    const talk = {
      id: 't',
      type: 'flow',
      questions: [
        { id: 'q1', text: 'Q1', answers: [{ id: 'a1', text: 'A1' }], contextHashId: 'hash1', cidId: 'cid1' },
      ],
    };
    saveFlatAnswerHistoryRecord('t', talk, [{ questionId: 'q1', answerId: 'a1' }], 'match', []);
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0].contextHash).toBe('hash1');
    expect(record.items[0].questionContentId).toBe('cid1');
  });

  it('carries the mode field through only when present on the completed answer', () => {
    const talk = { id: 't', type: 'flow', questions: [{ id: 'q1', text: 'Q1', answers: [] }] };
    saveFlatAnswerHistoryRecord(
      't',
      talk,
      [{ questionId: 'q1', answerId: 'a1', mode: 'typed' }],
      'match',
      [],
    );
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0].mode).toBe('typed');
  });

  it('persists a typed declaration as a structured AnswerRecord value, not only display text', () => {
    const talk = {
      id: 't',
      type: 'flow',
      title: 'Notebook',
      questions: [{ id: 'q1', text: 'Budget?', answers: [] }],
    };
    saveFlatAnswerHistoryRecord(
      't',
      talk,
      [{
        questionId: 'q1',
        answerId: 'typed:priceRange',
        answerText: '300 – 500',
        mode: 'typed',
        typedValue: { kind: 'priceRange', priceRange: { min: 300, max: 500 } },
      }],
      'mismatch',
      [],
    );
    const [record] = Object.values(getFlatAnswerHistory());
    expect(record.items[0]).toMatchObject({
      answerId: 'typed:priceRange',
      choice: '300 – 500',
      mode: 'typed',
      typedValue: { kind: 'priceRange', priceRange: { min: 300, max: 500 } },
    });
  });

  it('includes locationRadiusMiles on the record only when the talk has one', () => {
    const withRadius = { id: 't1', type: 'flow', questions: [], locationRadiusMiles: 25 };
    const withoutRadius = { id: 't2', type: 'flow', questions: [] };
    saveFlatAnswerHistoryRecord('t1', withRadius, [], 'match', []);
    saveFlatAnswerHistoryRecord('t2', withoutRadius, [], 'match', []);
    const history = getFlatAnswerHistory();
    expect(history[`${getTalkContentKey(withRadius)}:t1`].locationRadiusMiles).toBe(25);
    expect(history[`${getTalkContentKey(withoutRadius)}:t2`].locationRadiusMiles).toBeUndefined();
  });
});
