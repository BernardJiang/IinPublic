import {
  buildQuestionContextHash,
  buildAnswerPreferenceLookupKey,
  immediateParentQAPairs,
  sessionAnswersToQAPairs,
} from '../../shared/flattened-answer-keys';
import { computeTalkIdFromTalkData } from '../../shared/cid';

describe('flattened-answer-keys', () => {
  const multiTalkA = {
    type: 'flow',
    questions: [
      { id: 'q0', text: 'Tennis?', answers: [{ id: 'y', text: 'Yes' }] },
      { id: 'q1', text: 'Balboa?', answers: [{ id: 'y', text: 'Yes' }] },
    ],
  };

  const multiTalkB = {
    type: 'flow',
    questions: [
      { id: 'x0', text: 'Tennis?', answers: [{ id: 'a', text: 'Yes' }] },
      { id: 'x1', text: 'Saturday?', answers: [{ id: 'b', text: 'Yes' }] },
    ],
  };

  it('uses same flat key for first question of multi-talk across different content hashes', () => {
    const hA = computeTalkIdFromTalkData(multiTalkA);
    const hB = computeTalkIdFromTalkData(multiTalkB);
    expect(hA).not.toBe(hB);

    const kA = buildAnswerPreferenceLookupKey(multiTalkA, hA, 0, [], 'Tennis?');
    const kB = buildAnswerPreferenceLookupKey(multiTalkB, hB, 0, [], 'Tennis?');
    expect(kA).toBe(kB);
  });

  it('uses path-based key for second question so same wording differs after different prior answers', () => {
    const h = computeTalkIdFromTalkData(multiTalkA);
    const path1: { questionText: string; answerText: string }[] = [
      { questionText: 'Tennis?', answerText: 'Yes' },
    ];
    const path2: { questionText: string; answerText: string }[] = [
      { questionText: 'Tennis?', answerText: 'No' },
    ];
    const k1 = buildAnswerPreferenceLookupKey(multiTalkA, h, 1, path1, 'Balboa?');
    const k2 = buildAnswerPreferenceLookupKey(multiTalkA, h, 1, path2, 'Balboa?');
    expect(k1).not.toBe(k2);
  });

  it('does not reuse first-question preferences across languages', () => {
    const english = { ...multiTalkA, language: 'en' };
    const chinese = { ...multiTalkA, language: 'zh' };
    const englishKey = buildAnswerPreferenceLookupKey(english, computeTalkIdFromTalkData(english), 0, [], 'Tennis?');
    const chineseKey = buildAnswerPreferenceLookupKey(chinese, computeTalkIdFromTalkData(chinese), 0, [], 'Tennis?');
    expect(englishKey).not.toBe(chineseKey);
  });

  it('scopes tag / single-question by content hash', () => {
    const tag1 = {
      type: 'tag',
      questions: [{ id: 'q0', text: 'Interested?', answers: [{ id: 'm', text: 'Match' }] }],
    };
    const tag2 = {
      type: 'tag',
      questions: [{ id: 'q0', text: 'Interested?', answers: [{ id: 'm', text: 'Maybe' }] }],
    };
    const h1 = computeTalkIdFromTalkData(tag1);
    const h2 = computeTalkIdFromTalkData(tag2);
    expect(h1).not.toBe(h2);
    const k1 = buildAnswerPreferenceLookupKey(tag1, h1, 0, [], 'Interested?');
    const k2 = buildAnswerPreferenceLookupKey(tag2, h2, 0, [], 'Interested?');
    expect(k1).not.toBe(k2);
  });

  it('docs/TODO.md §KK: different tagContext produces a different key for the same path', () => {
    const h = computeTalkIdFromTalkData(multiTalkA);
    const path: { questionText: string; answerText: string }[] = [
      { questionText: 'Tennis?', answerText: 'Yes' },
    ];
    const buyLookingForSeller = buildAnswerPreferenceLookupKey(multiTalkA, h, 1, path, 'Model?', {
      mySelfTag: 'buy',
      counterpartTag: 'sell',
    });
    const buyLookingForBuddies = buildAnswerPreferenceLookupKey(multiTalkA, h, 1, path, 'Model?', {
      mySelfTag: 'buy',
      counterpartTag: 'buy',
    });
    expect(buyLookingForSeller).not.toBe(buyLookingForBuddies);
  });

  it('§KK: same tagContext across independently-authored talks produces the same key (cross-talk match)', () => {
    // Adam's buy-iPhone talk and Eve's sell-iPhone talk are different objects with different
    // content hashes, but once each side's tagContext resolves symmetrically (Adam: mySelfTag
    // 'buy' answering his own talk; Eve: mySelfTag 'buy' derived as the opposite of her own
    // 'sell' when SHE looks up an incoming 'buy' talk) the bucket must line up. Each side's own
    // buy/sell tag now lives in a Pair-tag question's text (`reciprocalTagContext`), not on the
    // talk object itself — irrelevant at this layer, since `tagContext` is passed in explicitly.
    const adamTalk = { ...multiTalkA };
    const eveTalk = { ...multiTalkB };
    const path: { questionText: string; answerText: string }[] = [
      { questionText: 'Item?', answerText: 'iPhone' },
    ];
    const adamSavesUnderHisOwnTalk = buildAnswerPreferenceLookupKey(
      adamTalk,
      computeTalkIdFromTalkData(adamTalk),
      1,
      path,
      'Model?',
      { mySelfTag: 'buy', counterpartTag: 'sell' },
    );
    const eveLooksUpFromHerIncomingTalk = buildAnswerPreferenceLookupKey(
      eveTalk,
      computeTalkIdFromTalkData(eveTalk),
      1,
      path,
      'Model?',
      { mySelfTag: 'sell', counterpartTag: 'buy' },
    );
    // These deliberately do NOT match each other — each party's own bucket is scoped to their
    // own mySelfTag/counterpartTag pair; a real cross-talk lookup mirrors mySelfTag via the
    // nearest Pair-tag ancestor (myEffectiveTagContext, ui-manager.ts), not tested at this layer.
    expect(adamSavesUnderHisOwnTalk).not.toBe(eveLooksUpFromHerIncomingTalk);
    // Confirm the actual symmetric case: when Adam looks up Eve's incoming 'sell' talk, his own
    // resolved tagContext is {mySelfTag: 'buy', counterpartTag: 'sell'} — the same shape Adam's
    // own save-side used above — so the two buckets must line up.
    const adamLooksUpEvesIncomingSellTalk = buildAnswerPreferenceLookupKey(
      eveTalk,
      computeTalkIdFromTalkData(eveTalk),
      1,
      path,
      'Model?',
      { mySelfTag: 'buy', counterpartTag: 'sell' },
    );
    expect(adamLooksUpEvesIncomingSellTalk).toBe(adamSavesUnderHisOwnTalk);
  });

  it('§KK: omitting tagContext keeps the pre-existing untagged key shape (backward compatible)', () => {
    const h = computeTalkIdFromTalkData(multiTalkA);
    const path: { questionText: string; answerText: string }[] = [
      { questionText: 'Tennis?', answerText: 'Yes' },
    ];
    const withoutContext = buildAnswerPreferenceLookupKey(multiTalkA, h, 1, path, 'Balboa?');
    const withUndefinedContext = buildAnswerPreferenceLookupKey(multiTalkA, h, 1, path, 'Balboa?', {
      mySelfTag: undefined,
      counterpartTag: undefined,
    });
    expect(withoutContext).toBe(withUndefinedContext);
  });

  it('sessionAnswersToQAPairs maps ids to question text', () => {
    const pairs = sessionAnswersToQAPairs(multiTalkA, [
      { questionId: 'q0', answerText: 'Yes' },
    ]);
    expect(pairs).toEqual([{ questionId: 'q0', questionText: 'Tennis?', answerText: 'Yes' }]);
  });

  it('includes the first question choice set and ignores choice display order', () => {
    const first = { text: 'Favourite fruit?', answers: [{ text: 'Apple' }, { text: 'Banana' }, { text: 'Strawberries' }] };
    const reordered = { text: 'Favourite fruit?', answers: [{ text: 'Strawberries' }, { text: 'Apple' }, { text: 'Banana' }] };
    const expanded = { text: 'Favourite fruit?', answers: [...first.answers, { text: 'Orange' }] };

    expect(buildQuestionContextHash(multiTalkA, first, undefined)).toBe(
      buildQuestionContextHash(multiTalkA, reordered, undefined),
    );
    expect(buildQuestionContextHash(multiTalkA, first, undefined)).not.toBe(
      buildQuestionContextHash(multiTalkA, expanded, undefined),
    );
  });

  it('rolls a flow context from only the previous hash, previous answer, and current frame', () => {
    const q1 = { text: 'Buying fruit?', answers: [{ text: 'Yes' }, { text: 'No' }] };
    const q2 = { text: 'Which season?', answers: [{ text: 'Summer' }, { text: 'Winter' }] };
    const q3 = { text: 'Favourite fruit?', answers: [{ text: 'Apple' }, { text: 'Banana' }] };
    const c1 = buildQuestionContextHash(multiTalkA, q1, undefined);
    const c2 = buildQuestionContextHash(multiTalkA, q2, { contextHash: c1, answerText: 'Yes' });
    const c3 = buildQuestionContextHash(multiTalkA, q3, { contextHash: c2, answerText: 'Summer' });

    expect(c3).toHaveLength(64);
    expect(c3).toBe(buildQuestionContextHash(multiTalkA, q3, { contextHash: c2, answerText: 'Summer' }));
    expect(c3).not.toBe(buildQuestionContextHash(multiTalkA, q3, { contextHash: c2, answerText: 'Winter' }));
  });

  it('treats every survey question as independent of the previous cursor', () => {
    const survey = { type: 'survey', language: 'en' };
    const question = { text: 'Favourite fruit?', answers: [{ text: 'Apple' }, { text: 'Banana' }] };
    expect(buildQuestionContextHash(survey, question, undefined)).toBe(
      buildQuestionContextHash(survey, question, { contextHash: 'prior', answerText: 'Something' }),
    );
  });

  it('uses only the immediate route parent and ignores already-answered fan-out siblings', () => {
    const route = {
      type: 'route',
      questions: [
        {
          id: 'root', text: 'Product?', contextPath: [],
          answers: [{ id: 'phone', text: 'Phone', nextQuestionIds: ['model', 'condition'] }],
        },
        {
          id: 'model', text: 'Model?', contextPath: [{ questionId: 'root', answerId: 'phone' }],
          answers: [{ id: 'a', text: 'A' }],
        },
        {
          id: 'condition', text: 'Condition?', contextPath: [{ questionId: 'root', answerId: 'phone' }],
          answers: [{ id: 'new', text: 'New' }],
        },
      ],
    };
    const answers = [
      { questionId: 'root', answerId: 'phone', answerText: 'Phone', contextHash: 'root-hash' },
      { questionId: 'model', answerId: 'a', answerText: 'A', contextHash: 'model-hash' },
    ];

    expect(immediateParentQAPairs(route, route.questions[2], answers)).toEqual([{
      questionId: 'root',
      questionText: 'Product?',
      answerText: 'Phone',
      contextHash: 'root-hash',
    }]);
  });

  it('uses the preceding flow answer as the single rolling parent', () => {
    const answers = [
      { questionId: 'q0', answerId: 'y', answerText: 'Yes', contextHash: 'first' },
      { questionId: 'q1', answerId: 'y', answerText: 'Yes', contextHash: 'second' },
    ];
    expect(immediateParentQAPairs(multiTalkA, multiTalkA.questions[1], answers)).toEqual([{
      questionId: 'q0',
      questionText: 'Tennis?',
      answerText: 'Yes',
      contextHash: 'first',
    }]);
  });

  it('reconstructs a pre-v2 route draft from its ordered active ancestry only', () => {
    const route = {
      type: 'route',
      questions: [
        { id: 'root', text: 'Product?', contextPath: [], answers: [{ id: 'phone', text: 'Phone' }] },
        { id: 'sibling', text: 'Color?', contextPath: [{ questionId: 'root', answerId: 'phone' }], answers: [{ id: 'blue', text: 'Blue' }] },
        {
          id: 'model', text: 'Model?',
          contextPath: [{ questionId: 'root', answerId: 'phone' }],
          answers: [{ id: 'a', text: 'A' }],
        },
      ],
    };
    expect(immediateParentQAPairs(route, route.questions[2], [
      { questionId: 'root', answerId: 'phone', answerText: 'Phone' },
      { questionId: 'sibling', answerId: 'blue', answerText: 'Blue' },
    ])).toEqual([{ questionId: 'root', questionText: 'Product?', answerText: 'Phone' }]);
  });
});
