import {
  computeTalkIdFromTalkData,
  buildTalkIdentityKey,
  DEFAULT_TALK_CONTENT_ID_OPTIONS,
} from '../../shared/cid';

describe('talk-content-id', () => {
  it('produces stable qa_ id for same Q/A content', () => {
    const a = {
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'Coffee?',
          answers: [
            { id: 'a1', text: 'Yes' },
            { id: 'a2', text: 'No' },
          ],
        },
      ],
    };
    const b = {
      type: 'flow',
      questions: [
        {
          id: 'q9',
          text: 'Coffee?',
          answers: [
            { id: 'z', text: 'No' },
            { id: 'y', text: 'Yes' },
          ],
        },
      ],
    };
    const ida = computeTalkIdFromTalkData(a);
    const idb = computeTalkIdFromTalkData(b);
    expect(ida).toMatch(/^qa_[0-9a-f]{8}$/);
    expect(ida).toBe(idb);
    expect(computeTalkIdFromTalkData(a, DEFAULT_TALK_CONTENT_ID_OPTIONS)).toBe(ida);
    expect(buildTalkIdentityKey(a)).toBe(ida);
  });

  it('differs when answer text changes', () => {
    const t1 = {
      type: 'flow',
      questions: [{ id: 'q1', text: 'Hi', answers: [{ id: 'a1', text: 'A' }] }],
    };
    const t2 = {
      type: 'flow',
      questions: [{ id: 'q1', text: 'Hi', answers: [{ id: 'a1', text: 'B' }] }],
    };
    expect(computeTalkIdFromTalkData(t1)).not.toBe(computeTalkIdFromTalkData(t2));
  });

  it('ignores the human-readable title for Flow, Survey, and Route content identity', () => {
    for (const type of ['flow', 'survey', 'route']) {
      const content = {
        type,
        language: 'en',
        questions: [{ id: 'q1', text: 'Same question', answers: [{ id: 'a1', text: 'Same answer' }] }],
      };
      expect(computeTalkIdFromTalkData({ ...content, title: 'Title for Alice' }))
        .toBe(computeTalkIdFromTalkData({ ...content, title: 'A different title for Bob' }));
    }
  });

  it('hashes a simple tag from the normalized tag atom, not generated checkbox wording', () => {
    const tennisA = {
      type: 'tag', title: 'Display title is not identity', language: 'en',
      questions: [{
        id: 'q1', text: '  Tennis  ', tagKind: 'simple',
        answers: [
          { id: 'yes', text: 'Tennis', isMatch: true },
          { id: 'no', text: 'Ignore.', isIgnore: true },
        ],
      }],
    };
    const tennisB = {
      type: 'tag', title: 'TENNIS', language: 'zh',
      questions: [{
        id: 'different', text: 'tennis', tagKind: 'simple',
        answers: [
          { id: 'accept', text: 'Interested.', isMatch: true },
          { id: 'reject', text: 'Not interested.', isIgnore: true },
        ],
      }],
    };
    expect(computeTalkIdFromTalkData(tennisA)).toBe(computeTalkIdFromTalkData(tennisB));
  });

  it('hashes an ordered Pair-tag from both tag atoms', () => {
    const pair = (accepted: string) => ({
      type: 'tag', title: 'buy',
      questions: [{
        id: 'q1', text: 'buy', reciprocalTagContext: true,
        answers: [
          { id: 'match', text: accepted, isMatch: true },
          { id: 'ignore', text: 'Ignore.', isIgnore: true },
        ],
      }],
    });
    expect(computeTalkIdFromTalkData(pair('sell'))).toBe(computeTalkIdFromTalkData(pair(' SELL ')));
    expect(computeTalkIdFromTalkData(pair('sell'))).not.toBe(computeTalkIdFromTalkData(pair('rent')));
  });

  it('differs when the language changes for otherwise identical content', () => {
    const base = {
      type: 'flow',
      questions: [{ id: 'q1', text: 'Coffee?', answers: [{ id: 'a1', text: 'Yes' }] }],
    };
    expect(computeTalkIdFromTalkData({ ...base, language: 'en' }))
      .not.toBe(computeTalkIdFromTalkData({ ...base, language: 'zh' }));
  });

  it('optional authorId changes id when enabled', () => {
    const base = {
      type: 'flow',
      questions: [{ id: 'q1', text: 'Hi', answers: [{ id: 'a1', text: 'A' }] }],
      authorId: 'user-1',
    };
    const without = computeTalkIdFromTalkData(base);
    const withAuthor = computeTalkIdFromTalkData(base, { includeAuthorId: true });
    expect(without).not.toBe(withAuthor);
  });
});
