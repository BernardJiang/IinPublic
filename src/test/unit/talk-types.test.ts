/**
 * Tests for the four talk types: tag, talk (matching), survey, tree.
 *
 * The four types are defined in §3.6.1 of the technical specification:
 *
 *   tag      – single keyword/phrase, checked (match) or unchecked (ignore)
 *   matching – sequential chain, each question uses all prior Q/A as context
 *   survey   – independent Q/A, no shared context
 *   tree     – hierarchical DAG mixing context-dependent and independent nodes
 *
 * The tennis/badminton example from the spec is exercised in the tree section.
 */

import { TalkValidator, TreeTalkProcessor } from '../../shared/talk-engine';
import { Talk, AnswerWithContext, ContextStep } from '../../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeBase(): Omit<Talk, 'type' | 'questions'> {
  return {
    id: 'test-id',
    title: 'Test Talk',
    authorId: 'user-1',
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. TAG
// ─────────────────────────────────────────────────────────────────────────────

describe('Talk type: tag', () => {
  it('accepts a valid tag (one question, one match + one ignore answer)', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'tag',
      questions: [
        {
          id: 'q_tennis',
          text: 'Tennis',
          answers: [
            { id: 'a_match', text: 'Interested.', isMatch: true, isTerminal: true },
            { id: 'a_ignore', text: 'Not interested.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('accepts a tag that is a short phrase', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'tag',
      questions: [
        {
          id: 'q_tag',
          text: 'Looking for tennis partner',
          answers: [
            { id: 'a_match', text: 'Match.', isMatch: true, isTerminal: true },
            { id: 'a_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('rejects a tag with more than one question', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'tag',
      questions: [
        {
          id: 'q1',
          text: 'Tennis',
          answers: [
            { id: 'a1', text: 'Match.', isMatch: true, isTerminal: true },
            { id: 'a2', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q2',
          text: 'Badminton',
          answers: [
            { id: 'a3', text: 'Match.', isMatch: true, isTerminal: true },
            { id: 'a4', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow('Tag must have exactly one question');
  });

  it('rejects a tag missing the ignore answer', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'tag',
      questions: [
        {
          id: 'q1',
          text: 'Tennis',
          answers: [
            { id: 'a1', text: 'Match.', isMatch: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(
      /Tag must have (exactly two answers|one match and one ignore)/,
    );
  });

  it('rejects a tag missing the match answer', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'tag',
      questions: [
        {
          id: 'q1',
          text: 'Tennis',
          answers: [
            { id: 'a1', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(
      /Tag must have (exactly two answers|one match and one ignore)/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TALK (matching — sequential, context-dependent)
// ─────────────────────────────────────────────────────────────────────────────

describe('Talk type: matching (sequential / context-dependent)', () => {
  it('accepts a valid two-question sequential talk', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'matching',
      questions: [
        {
          id: 'q1',
          text: 'Do you like tennis?',
          answers: [
            { id: 'a_yes', text: 'Yes.', nextQuestionId: 'q2' },
            { id: 'a_no',  text: 'No.', nextQuestionId: 'q2' },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
          nextQuestionId: 'q2',
        },
        {
          id: 'q2',
          text: 'What is your skill level?',
          answers: [
            { id: 'a_beg', text: 'Beginner.', isTerminal: true },
            { id: 'a_pro', text: 'Professional.', isTerminal: true },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('rejects a matching talk with more than 20 questions', () => {
    const questions = Array.from({ length: 21 }, (_, i) => ({
      id: `q${i}`,
      text: `Question ${i}?`,
      answers: [
        { id: `a${i}_ok`, text: 'OK.', isTerminal: true },
        { id: `a${i}_ig`, text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    }));
    const talk: Talk = { ...makeBase(), type: 'matching', questions };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(
      'Talk cannot have more than 20 questions',
    );
  });

  it('rejects a matching talk with a cycle', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'matching',
      questions: [
        {
          id: 'q1',
          text: 'Do you like tennis?',
          answers: [{ id: 'a1', text: 'Yes.', nextQuestionId: 'q2' }],
          nextQuestionId: 'q2',
        },
        {
          id: 'q2',
          text: 'What is your skill level?',
          answers: [{ id: 'a2', text: 'Beginner.', nextQuestionId: 'q1' }], // cycle
          nextQuestionId: 'q1',
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SURVEY (independent questions, no shared context)
// ─────────────────────────────────────────────────────────────────────────────

describe('Talk type: survey (independent questions)', () => {
  it('accepts a valid two-question survey', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'survey',
      questions: [
        {
          id: 'q1',
          text: 'How satisfied are you with the service?',
          isAggregatable: true,
          answers: [
            { id: 'a1', text: 'Very satisfied.', isTerminal: true },
            { id: 'a2', text: 'Satisfied.', isTerminal: true },
            { id: 'a3', text: 'Not satisfied.', isTerminal: true },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q2',
          text: 'Would you recommend us to a friend?',
          isAggregatable: true,
          answers: [
            { id: 'b1', text: 'Yes.', isTerminal: true },
            { id: 'b2', text: 'No.', isTerminal: true },
            { id: 'b_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('rejects a survey with no aggregatable questions', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'survey',
      questions: [
        {
          id: 'q1',
          text: 'How are you?',
          // isAggregatable: false (omitted)
          answers: [
            { id: 'a1', text: 'Fine.', isTerminal: true },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(
      'Survey talk must have at least one aggregatable question',
    );
  });

  it('rejects a survey with more than 15 questions', () => {
    const questions = Array.from({ length: 16 }, (_, i) => ({
      id: `q${i}`,
      text: `Survey question ${i}?`,
      isAggregatable: true,
      answers: [
        { id: `a${i}_ok`, text: 'OK.', isTerminal: true },
        { id: `a${i}_ig`, text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    }));
    const talk: Talk = { ...makeBase(), type: 'survey', questions };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(
      'Survey talk cannot have more than 15 questions',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. TREE (hierarchical DAG, context-aware)
// ─────────────────────────────────────────────────────────────────────────────

describe('Talk type: tree (hierarchical, context-aware)', () => {
  /**
   * Tennis / Badminton example from the spec (§3.6.1):
   *
   *   Q1a: "Do you like tennis?"   → Yes (root, contextPath=[])
   *   Q1b: "Do you like badminton?" → Yes (root, contextPath=[])
   *   Q2a: "What is your skill level?"  contextPath=[{Q1a, Yes}] → Beginner
   *   Q2b: "What is your skill level?"  contextPath=[{Q1b, Yes}] → Professional
   *
   * The same question text appears twice with different context paths.
   * In the flat answer list they become two distinct records.
   */
  function makeTennisBadmintonTree(): Talk {
    return {
      ...makeBase(),
      title: 'Sports Interest Tree',
      type: 'tree',
      questions: [
        {
          id: 'q_tennis',
          text: 'Do you like tennis?',
          contextPath: [],   // root — no prior context
          answers: [
            { id: 'a_tennis_yes', text: 'Yes.', nextQuestionId: 'q_level_tennis' },
            { id: 'a_tennis_no',  text: 'No.',  isTerminal: true },
            { id: 'a_tennis_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q_badminton',
          text: 'Do you like badminton?',
          contextPath: [],   // root — independent of tennis question
          answers: [
            { id: 'a_badminton_yes', text: 'Yes.', nextQuestionId: 'q_level_badminton' },
            { id: 'a_badminton_no',  text: 'No.',  isTerminal: true },
            { id: 'a_badminton_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q_level_tennis',
          text: 'What is your skill level?',
          // This occurrence is only reached after saying Yes to tennis
          contextPath: [{ questionId: 'q_tennis', answerId: 'a_tennis_yes' }],
          answers: [
            { id: 'a_level_tennis_beg', text: 'Beginner.', isTerminal: true },
            { id: 'a_level_tennis_pro', text: 'Professional.', isTerminal: true },
            { id: 'a_level_tennis_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q_level_badminton',
          text: 'What is your skill level?',
          // This occurrence is only reached after saying Yes to badminton
          contextPath: [{ questionId: 'q_badminton', answerId: 'a_badminton_yes' }],
          answers: [
            { id: 'a_level_badminton_beg', text: 'Beginner.', isTerminal: true },
            { id: 'a_level_badminton_pro', text: 'Professional.', isTerminal: true },
            { id: 'a_level_badminton_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
  }

  describe('validation', () => {
    it('accepts the tennis/badminton tree talk', () => {
      expect(() => TalkValidator.validateTalk(makeTennisBadmintonTree())).not.toThrow();
    });

    it('accepts a simple single-level tree (root questions only)', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'tree',
        questions: [
          {
            id: 'q1',
            text: 'Do you like sports?',
            contextPath: [],
            answers: [
              { id: 'a_yes', text: 'Yes.', isTerminal: true },
              { id: 'a_no',  text: 'No.',  isTerminal: true },
              { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
      };
      expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
    });

    it('rejects a tree question missing contextPath entirely', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'tree',
        questions: [
          {
            id: 'q1',
            text: 'Do you like sports?',
            // contextPath deliberately omitted
            answers: [
              { id: 'a_yes', text: 'Yes.', isTerminal: true },
              { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
      };
      expect(() => TalkValidator.validateTalk(talk)).toThrow(
        /contextPath.*root questions/,
      );
    });

    it('rejects a tree question whose contextPath references a non-existent questionId', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'tree',
        questions: [
          {
            id: 'q_root',
            text: 'Root question?',
            contextPath: [],
            answers: [
              { id: 'a_ok', text: 'OK.', nextQuestionId: 'q_child' },
              { id: 'a_ig', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
          {
            id: 'q_child',
            text: 'Child question?',
            // references a non-existent questionId 'q_unknown'
            contextPath: [{ questionId: 'q_unknown', answerId: 'a_ok' }],
            answers: [
              { id: 'a_c1', text: 'Option A.', isTerminal: true },
              { id: 'a_ci', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
      };
      expect(() => TalkValidator.validateTalk(talk)).toThrow(
        /unknown questionId/,
      );
    });

    it('rejects a tree question whose contextPath references a non-existent answerId', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'tree',
        questions: [
          {
            id: 'q_root',
            text: 'Root question?',
            contextPath: [],
            answers: [
              { id: 'a_ok', text: 'OK.', nextQuestionId: 'q_child' },
              { id: 'a_ig', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
          {
            id: 'q_child',
            text: 'Child question?',
            // references correct questionId but wrong answerId
            contextPath: [{ questionId: 'q_root', answerId: 'a_nonexistent' }],
            answers: [
              { id: 'a_c1', text: 'Option A.', isTerminal: true },
              { id: 'a_ci', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
      };
      expect(() => TalkValidator.validateTalk(talk)).toThrow(
        /unknown answerId/,
      );
    });

    it('rejects a tree talk with more than 50 questions', () => {
      const questions = Array.from({ length: 51 }, (_, i) => ({
        id: `q${i}`,
        text: `Tree question ${i}?`,
        contextPath: [] as ContextStep[],
        answers: [
          { id: `a${i}_ok`, text: 'OK.', isTerminal: true },
          { id: `a${i}_ig`, text: 'Ignore.', isIgnore: true, isTerminal: true },
        ],
      }));
      const talk: Talk = { ...makeBase(), type: 'tree', questions };
      expect(() => TalkValidator.validateTalk(talk)).toThrow(
        'Tree talk cannot have more than 50 questions',
      );
    });

    it('rejects a tree talk with a cycle', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'tree',
        questions: [
          {
            id: 'q1',
            text: 'Question 1?',
            contextPath: [],
            answers: [
              { id: 'a1', text: 'OK.', nextQuestionId: 'q2' },
              { id: 'a1i', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
          {
            id: 'q2',
            text: 'Question 2?',
            contextPath: [{ questionId: 'q1', answerId: 'a1' }],
            answers: [
              { id: 'a2', text: 'OK.', nextQuestionId: 'q1' }, // cycle back to q1
              { id: 'a2i', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
      };
      expect(() => TalkValidator.validateTalk(talk)).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TreeTalkProcessor — context key building
  // ─────────────────────────────────────────────────────────────────────────

  describe('TreeTalkProcessor.buildContextHash', () => {
    it('returns "" (empty string) for an empty context path — no context needed', () => {
      expect(TreeTalkProcessor.buildContextHash([])).toBe('');
    });

    it('returns a deterministic 8-char hex hash for a single-step context', () => {
      const path: ContextStep[] = [{ questionId: 'q_tennis', answerId: 'a_yes' }];
      const hash = TreeTalkProcessor.buildContextHash(path);
      // FNV-1a of "q_tennis:a_yes" = c7d3aab4
      expect(hash).toBe('c7d3aab4');
      expect(hash).toHaveLength(8);
    });

    it('returns a deterministic 8-char hex hash for a multi-step context', () => {
      const path: ContextStep[] = [
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a2' },
      ];
      const hash = TreeTalkProcessor.buildContextHash(path);
      // FNV-1a of "q1:a1|q2:a2" = 1c6c6ab0
      expect(hash).toBe('1c6c6ab0');
      expect(hash).toHaveLength(8);
    });

    it('is deterministic — same path always produces the same hash', () => {
      const path: ContextStep[] = [{ questionId: 'q_tennis', answerId: 'a_yes' }];
      expect(TreeTalkProcessor.buildContextHash(path))
        .toBe(TreeTalkProcessor.buildContextHash(path));
    });

    it('produces different hashes for different paths to the same question', () => {
      const tennisPath: ContextStep[] = [{ questionId: 'q_tennis',   answerId: 'a_tennis_yes' }];
      const badmintonPath: ContextStep[] = [{ questionId: 'q_badminton', answerId: 'a_badminton_yes' }];
      // FNV-1a of "q_tennis:a_tennis_yes"    = aeafadc9
      // FNV-1a of "q_badminton:a_badminton_yes" = 5e968168
      expect(TreeTalkProcessor.buildContextHash(tennisPath)).toBe('aeafadc9');
      expect(TreeTalkProcessor.buildContextHash(badmintonPath)).toBe('5e968168');
      expect(TreeTalkProcessor.buildContextHash(tennisPath))
        .not.toBe(TreeTalkProcessor.buildContextHash(badmintonPath));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TreeTalkProcessor — flattenTreeAnswers (tennis/badminton scenario)
  // ─────────────────────────────────────────────────────────────────────────

  describe('TreeTalkProcessor.flattenTreeAnswers — tennis/badminton scenario', () => {
    it('stores the skill-level answer for tennis with the correct contextHash', () => {
      const tennisSession = [
        {
          questionId: 'q_tennis',
          answerId: 'a_tennis_yes',
          answerText: 'Yes.',
          contextPath: [] as ContextStep[],   // root — no prior context
        },
        {
          questionId: 'q_level_tennis',
          answerId: 'a_level_tennis_beg',
          answerText: 'Beginner.',
          contextPath: [{ questionId: 'q_tennis', answerId: 'a_tennis_yes' }],
        },
      ];

      const records = TreeTalkProcessor.flattenTreeAnswers(tennisSession);
      expect(records).toHaveLength(2);

      const rootRecord = records.find(r => r.questionId === 'q_tennis')!;
      expect(rootRecord.contextHash).toBe('');  // root — no context hash

      const levelRecord = records.find(r => r.questionId === 'q_level_tennis')!;
      expect(levelRecord.answerText).toBe('Beginner.');
      // FNV-1a of "q_tennis:a_tennis_yes" = aeafadc9
      expect(levelRecord.contextHash).toBe('aeafadc9');
      // Full path is NOT stored on the record — only the hash
      expect((levelRecord as any).contextPath).toBeUndefined();
      expect((levelRecord as any).contextKey).toBeUndefined();
    });

    it('stores the skill-level answer for badminton with the correct contextHash', () => {
      const badmintonSession = [
        {
          questionId: 'q_badminton',
          answerId: 'a_badminton_yes',
          answerText: 'Yes.',
          contextPath: [] as ContextStep[],
        },
        {
          questionId: 'q_level_badminton',
          answerId: 'a_level_badminton_pro',
          answerText: 'Professional.',
          contextPath: [{ questionId: 'q_badminton', answerId: 'a_badminton_yes' }],
        },
      ];

      const records = TreeTalkProcessor.flattenTreeAnswers(badmintonSession);
      const levelRecord = records.find(r => r.questionId === 'q_level_badminton')!;
      expect(levelRecord.answerText).toBe('Professional.');
      // FNV-1a of "q_badminton:a_badminton_yes" = 5e968168
      expect(levelRecord.contextHash).toBe('5e968168');
    });

    it('produces two distinct contextHashes for the same question answered under different branches', () => {
      // Two answers to the same question (q_level) reached via different sports branches.
      // The contextHash distinguishes them — no need to store or compare full paths.
      const tennisLevel: AnswerWithContext = {
        questionId: 'q_level',
        answerId: 'a_beg',
        answerText: 'Beginner.',
        contextHash: TreeTalkProcessor.buildContextHash([{ questionId: 'q_tennis', answerId: 'a_yes' }]),
        visibility: 'auto',
        recordedAt: new Date(),
      };
      const badmintonLevel: AnswerWithContext = {
        questionId: 'q_level',
        answerId: 'a_pro',
        answerText: 'Professional.',
        contextHash: TreeTalkProcessor.buildContextHash([{ questionId: 'q_badminton', answerId: 'a_yes' }]),
        visibility: 'auto',
        recordedAt: new Date(),
      };

      // c7d3aab4 vs 05faedd4
      expect(tennisLevel.contextHash).toBe('c7d3aab4');
      expect(badmintonLevel.contextHash).toBe('05faedd4');
      expect(tennisLevel.contextHash).not.toBe(badmintonLevel.contextHash);
      expect(tennisLevel.answerText).toBe('Beginner.');
      expect(badmintonLevel.answerText).toBe('Professional.');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TreeTalkProcessor — resolveContextualAnswer
  // ─────────────────────────────────────────────────────────────────────────

  describe('TreeTalkProcessor.resolveContextualAnswer', () => {
    // Stored answers use contextHash only — no full path stored
    const storedAnswers: AnswerWithContext[] = [
      {
        questionId: 'q_level',
        answerId: 'a_beg',
        answerText: 'Beginner.',
        // FNV-1a of "q_tennis:a_yes" = c7d3aab4
        contextHash: 'c7d3aab4',
        visibility: 'auto',
        recordedAt: new Date(),
      },
      {
        questionId: 'q_level',
        answerId: 'a_pro',
        answerText: 'Professional.',
        // FNV-1a of "q_badminton:a_yes" = 05faedd4
        contextHash: '05faedd4',
        visibility: 'auto',
        recordedAt: new Date(),
      },
      {
        questionId: 'q_root_tag',
        answerId: 'a_ok',
        answerText: 'OK.',
        contextHash: '',   // root / no-context answer
        visibility: 'auto',
        recordedAt: new Date(),
      },
    ];

    it('returns the correct answer when the tennis context matches', () => {
      const result = TreeTalkProcessor.resolveContextualAnswer(
        'q_level',
        [{ questionId: 'q_tennis', answerId: 'a_yes' }],
        storedAnswers,
      );
      expect(result).not.toBeNull();
      expect(result!.answerText).toBe('Beginner.');
    });

    it('returns the correct answer when the badminton context matches', () => {
      const result = TreeTalkProcessor.resolveContextualAnswer(
        'q_level',
        [{ questionId: 'q_badminton', answerId: 'a_yes' }],
        storedAnswers,
      );
      expect(result).not.toBeNull();
      expect(result!.answerText).toBe('Professional.');
    });

    it('returns null when no stored answer matches the current context (FR-TK-12)', () => {
      // User has tennis and badminton answers but chatbot is asked in a
      // squash context for which no answer was recorded.
      const result = TreeTalkProcessor.resolveContextualAnswer(
        'q_level',
        [{ questionId: 'q_squash', answerId: 'a_yes' }],
        storedAnswers,
      );
      expect(result).toBeNull();
    });

    it('returns the root answer for a context-free (survey-style) question', () => {
      const result = TreeTalkProcessor.resolveContextualAnswer(
        'q_root_tag',
        [],   // no context
        storedAnswers,
      );
      expect(result).not.toBeNull();
      expect(result!.answerText).toBe('OK.');
    });

    it('does NOT return a manual-visibility answer (chatbot must not auto-reply)', () => {
      const manualAnswer: AnswerWithContext = {
        questionId: 'q_private',
        answerId: 'a_secret',
        answerText: 'Secret answer.',
        contextHash: '',   // no context — but visibility blocks auto-reply
        visibility: 'manual',
        recordedAt: new Date(),
      };
      const result = TreeTalkProcessor.resolveContextualAnswer(
        'q_private',
        [],
        [manualAnswer],
      );
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TreeTalkProcessor — isSurveyStyleNode
  // ─────────────────────────────────────────────────────────────────────────

  describe('TreeTalkProcessor.isSurveyStyleNode', () => {
    it('returns true for a root node (empty contextPath)', () => {
      const q = {
        id: 'q1', text: 'Root?', contextPath: [],
        answers: [{ id: 'a1', text: 'Yes.', isTerminal: true }],
      };
      expect(TreeTalkProcessor.isSurveyStyleNode(q)).toBe(true);
    });

    it('returns false for a context-dependent node', () => {
      const q = {
        id: 'q2', text: 'Child?',
        contextPath: [{ questionId: 'q1', answerId: 'a1' }],
        answers: [{ id: 'a2', text: 'Yes.', isTerminal: true }],
      };
      expect(TreeTalkProcessor.isSurveyStyleNode(q)).toBe(false);
    });

    it('returns true when contextPath is undefined (no context assigned)', () => {
      const q = {
        id: 'q3', text: 'No path?',
        answers: [{ id: 'a3', text: 'Yes.', isTerminal: true }],
      };
      expect(TreeTalkProcessor.isSurveyStyleNode(q)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TreeTalkProcessor — buildContextPathFromSubmitted
  // ─────────────────────────────────────────────────────────────────────────

  describe('TreeTalkProcessor.buildContextPathFromSubmitted', () => {
    it('produces a ContextStep array from submitted answers', () => {
      const submitted = [
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a2' },
      ];
      const path = TreeTalkProcessor.buildContextPathFromSubmitted(submitted);
      expect(path).toEqual([
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a2' },
      ]);
    });

    it('returns an empty array for no prior answers', () => {
      expect(TreeTalkProcessor.buildContextPathFromSubmitted([])).toEqual([]);
    });
  });
});
