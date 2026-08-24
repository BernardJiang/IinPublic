import {
  buildAnswerPreferenceLookupKey,
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
    expect(pairs).toEqual([{ questionText: 'Tennis?', answerText: 'Yes' }]);
  });
});
