import {
  computeTalkIdFromTalkData,
  buildTalkIdentityKey,
  DEFAULT_TALK_CONTENT_ID_OPTIONS,
} from '../../shared/talk-content-id';

describe('talk-content-id', () => {
  it('produces stable qa_ id for same Q/A content', () => {
    const a = {
      type: 'matching',
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
      type: 'matching',
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
      type: 'matching',
      questions: [{ id: 'q1', text: 'Hi', answers: [{ id: 'a1', text: 'A' }] }],
    };
    const t2 = {
      type: 'matching',
      questions: [{ id: 'q1', text: 'Hi', answers: [{ id: 'a1', text: 'B' }] }],
    };
    expect(computeTalkIdFromTalkData(t1)).not.toBe(computeTalkIdFromTalkData(t2));
  });

  it('optional authorId changes id when enabled', () => {
    const base = {
      type: 'matching',
      questions: [{ id: 'q1', text: 'Hi', answers: [{ id: 'a1', text: 'A' }] }],
      authorId: 'user-1',
    };
    const without = computeTalkIdFromTalkData(base);
    const withAuthor = computeTalkIdFromTalkData(base, { includeAuthorId: true });
    expect(without).not.toBe(withAuthor);
  });
});
