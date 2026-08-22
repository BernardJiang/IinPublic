/**
 * Tests for the four talk types: tag, talk types: tag, flow, survey, route.
 *
 * The four types are defined in §3.6.1 of the technical specification:
 *
 *   tag      – single keyword/phrase, checked (match) or unchecked (ignore)
 *   flow   – sequential chain (path graph), each question uses all prior Q/A as context
 *   survey   – independent Q/A, no shared context
 *   route  – hierarchical DAG (logical map) mixing context-dependent and independent nodes
 *
 * The tennis/badminton example from the spec is exercised in the route section.
 */

import { TalkValidator, RouteProcessor, TalkAutofix } from '../../shared/talk-engine';
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
            { id: 'a_match', text: 'Tennis', isMatch: true, isTerminal: true },
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
            { id: 'a_match', text: 'Looking for tennis partner', isMatch: true, isTerminal: true },
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
// 2. FLOW (linear thread — sequential, context-dependent)
// ─────────────────────────────────────────────────────────────────────────────

describe('Talk type: flow (sequential / context-dependent)', () => {
  it('accepts a valid two-question sequential talk (first answer links; rest ignore)', () => {
    // Flow rules (§3.6.1 + create-talk GUI spec): the first answer on every
    // question is a match-or-next; any additional answers are implicitly ignore.
    const talk: Talk = {
      ...makeBase(),
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'Do you like tennis?',
          answers: [
            { id: 'a_yes', text: 'Yes.', nextQuestionId: 'q2' },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
          nextQuestionId: 'q2',
        },
        {
          id: 'q2',
          text: 'What is your skill level?',
          answers: [
            { id: 'a_beg', text: "Let's talk.", isMatch: true, isTerminal: true },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('rejects a flow whose later answer is not ignore (only first answer may match/link)', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'Do you like tennis?',
          answers: [
            { id: 'a_yes', text: 'Yes.', nextQuestionId: 'q2' },
            { id: 'a_no',  text: 'No.', nextQuestionId: 'q2' },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q2',
          text: 'What is your skill level?',
          answers: [
            { id: 'a_beg', text: "Let's talk.", isMatch: true, isTerminal: true },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(/only the first answer/);
  });

  it('rejects a flow with duplicate question text', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'Do you like tennis?',
          answers: [
            { id: 'a1', text: 'Yes.', nextQuestionId: 'q2' },
            { id: 'a1_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q2',
          text: 'Do you like tennis?', // duplicate
          answers: [
            { id: 'a2', text: "Let's talk.", isMatch: true, isTerminal: true },
            { id: 'a2_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(/duplicate question/);
  });

  it('rejects a flow with more than 20 questions', () => {
    const questions = Array.from({ length: 21 }, (_, i) => ({
      id: `q${i}`,
      text: `Question ${i}?`,
      answers: [
        { id: `a${i}_ok`, text: 'OK.', isTerminal: true },
        { id: `a${i}_ig`, text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    }));
    const talk: Talk = { ...makeBase(), type: 'flow', questions };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(
      'Talk cannot have more than 20 questions',
    );
  });

  it('rejects a flow with a cycle', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'flow',
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
// 4. ROUTE (logical map — hierarchical DAG, context-aware)
// ─────────────────────────────────────────────────────────────────────────────

describe('Talk type: route (hierarchical DAG, context-aware)', () => {
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
  function makeTennisBadmintonRoute(): Talk {
    return {
      ...makeBase(),
      title: 'Sports Interest Route',
      type: 'route',
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
    it('accepts the tennis/badminton route', () => {
      expect(() => TalkValidator.validateTalk(makeTennisBadmintonRoute())).not.toThrow();
    });

    it('accepts a single-level route (root questions only)', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'route',
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

    it('rejects a route question missing contextPath entirely', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'route',
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

    it('rejects a route question whose contextPath references a non-existent questionId', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'route',
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

    it('rejects a route question whose contextPath references a non-existent answerId', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'route',
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

    it('rejects a route with more than 50 questions', () => {
      const questions = Array.from({ length: 51 }, (_, i) => ({
        id: `q${i}`,
        text: `Tree question ${i}?`,
        contextPath: [] as ContextStep[],
        answers: [
          { id: `a${i}_ok`, text: 'OK.', isTerminal: true },
          { id: `a${i}_ig`, text: 'Ignore.', isIgnore: true, isTerminal: true },
        ],
      }));
      const talk: Talk = { ...makeBase(), type: 'route', questions };
      expect(() => TalkValidator.validateTalk(talk)).toThrow(
        'Route cannot have more than 50 questions',
      );
    });

    it('rejects a route with a cycle', () => {
      const talk: Talk = {
        ...makeBase(),
        type: 'route',
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
  // RouteProcessor — context key building
  // ─────────────────────────────────────────────────────────────────────────

  describe('RouteProcessor.buildContextHash', () => {
    it('returns "" (empty string) for an empty context path — no context needed', () => {
      expect(RouteProcessor.buildContextHash([])).toBe('');
    });

    it('returns a deterministic 8-char hex hash for a single-step context', () => {
      const path: ContextStep[] = [{ questionId: 'q_tennis', answerId: 'a_yes' }];
      const hash = RouteProcessor.buildContextHash(path);
      // FNV-1a of "q_tennis:a_yes" = c7d3aab4
      expect(hash).toBe('c7d3aab4');
      expect(hash).toHaveLength(8);
    });

    it('returns a deterministic 8-char hex hash for a multi-step context', () => {
      const path: ContextStep[] = [
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a2' },
      ];
      const hash = RouteProcessor.buildContextHash(path);
      // FNV-1a of "q1:a1|q2:a2" = 1c6c6ab0
      expect(hash).toBe('1c6c6ab0');
      expect(hash).toHaveLength(8);
    });

    it('is deterministic — same path always produces the same hash', () => {
      const path: ContextStep[] = [{ questionId: 'q_tennis', answerId: 'a_yes' }];
      expect(RouteProcessor.buildContextHash(path))
        .toBe(RouteProcessor.buildContextHash(path));
    });

    it('produces different hashes for different paths to the same question', () => {
      const tennisPath: ContextStep[] = [{ questionId: 'q_tennis',   answerId: 'a_tennis_yes' }];
      const badmintonPath: ContextStep[] = [{ questionId: 'q_badminton', answerId: 'a_badminton_yes' }];
      // FNV-1a of "q_tennis:a_tennis_yes"    = aeafadc9
      // FNV-1a of "q_badminton:a_badminton_yes" = 5e968168
      expect(RouteProcessor.buildContextHash(tennisPath)).toBe('aeafadc9');
      expect(RouteProcessor.buildContextHash(badmintonPath)).toBe('5e968168');
      expect(RouteProcessor.buildContextHash(tennisPath))
        .not.toBe(RouteProcessor.buildContextHash(badmintonPath));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RouteProcessor — flattenTreeAnswers (tennis/badminton scenario)
  // ─────────────────────────────────────────────────────────────────────────

  describe('RouteProcessor.flattenTreeAnswers — tennis/badminton scenario', () => {
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

      const records = RouteProcessor.flattenTreeAnswers(tennisSession);
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

      const records = RouteProcessor.flattenTreeAnswers(badmintonSession);
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
        contextHash: RouteProcessor.buildContextHash([{ questionId: 'q_tennis', answerId: 'a_yes' }]),
        visibility: 'auto',
        recordedAt: new Date(),
      };
      const badmintonLevel: AnswerWithContext = {
        questionId: 'q_level',
        answerId: 'a_pro',
        answerText: 'Professional.',
        contextHash: RouteProcessor.buildContextHash([{ questionId: 'q_badminton', answerId: 'a_yes' }]),
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
  // RouteProcessor — resolveContextualAnswer
  // ─────────────────────────────────────────────────────────────────────────

  describe('RouteProcessor.resolveContextualAnswer', () => {
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
      const result = RouteProcessor.resolveContextualAnswer(
        'q_level',
        [{ questionId: 'q_tennis', answerId: 'a_yes' }],
        storedAnswers,
      );
      expect(result).not.toBeNull();
      expect(result!.answerText).toBe('Beginner.');
    });

    it('returns the correct answer when the badminton context matches', () => {
      const result = RouteProcessor.resolveContextualAnswer(
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
      const result = RouteProcessor.resolveContextualAnswer(
        'q_level',
        [{ questionId: 'q_squash', answerId: 'a_yes' }],
        storedAnswers,
      );
      expect(result).toBeNull();
    });

    it('returns the root answer for a context-free (survey-style) question', () => {
      const result = RouteProcessor.resolveContextualAnswer(
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
      const result = RouteProcessor.resolveContextualAnswer(
        'q_private',
        [],
        [manualAnswer],
      );
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RouteProcessor — isSurveyStyleNode
  // ─────────────────────────────────────────────────────────────────────────

  describe('RouteProcessor.isSurveyStyleNode', () => {
    it('returns true for a root node (empty contextPath)', () => {
      const q = {
        id: 'q1', text: 'Root?', contextPath: [],
        answers: [{ id: 'a1', text: 'Yes.', isTerminal: true }],
      };
      expect(RouteProcessor.isSurveyStyleNode(q)).toBe(true);
    });

    it('returns false for a context-dependent node', () => {
      const q = {
        id: 'q2', text: 'Child?',
        contextPath: [{ questionId: 'q1', answerId: 'a1' }],
        answers: [{ id: 'a2', text: 'Yes.', isTerminal: true }],
      };
      expect(RouteProcessor.isSurveyStyleNode(q)).toBe(false);
    });

    it('returns true when contextPath is undefined (no context assigned)', () => {
      const q = {
        id: 'q3', text: 'No path?',
        answers: [{ id: 'a3', text: 'Yes.', isTerminal: true }],
      };
      expect(RouteProcessor.isSurveyStyleNode(q)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RouteProcessor — buildContextPathFromSubmitted
  // ─────────────────────────────────────────────────────────────────────────

  describe('RouteProcessor.buildContextPathFromSubmitted', () => {
    it('produces a ContextStep array from submitted answers', () => {
      const submitted = [
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a2' },
      ];
      const path = RouteProcessor.buildContextPathFromSubmitted(submitted);
      expect(path).toEqual([
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a2' },
      ]);
    });

    it('returns an empty array for no prior answers', () => {
      expect(RouteProcessor.buildContextPathFromSubmitted([])).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. NEW CREATE-TALK RULES: flow chained contextHashId, survey counters,
//    route per-path uniqueness, TalkAutofix behaviour.
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow chained contextHashId', () => {
  it('accepts a flow where each question carries its chained contextHashId', () => {
    // Q1's context is empty (''); Q2's context is hash([{q1,a_yes}]).
    const q1a_yes = { questionId: 'q1', answerId: 'a_yes' };
    const q1HashId = ''; // no prior context
    const q2HashId = RouteProcessor.buildContextHash([q1a_yes]);
    const talk: Talk = {
      ...makeBase(),
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'Do you like coffee?',
          contextHashId: q1HashId,
          answers: [
            { id: 'a_yes', text: 'Yes.', nextQuestionId: 'q2' },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q2',
          text: 'Espresso or drip?',
          contextHashId: q2HashId,
          answers: [
            { id: 'a_esp', text: "Let's talk.", isMatch: true, isTerminal: true },
            { id: 'a_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('rejects a flow whose contextHashId does not match the prior chain', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'flow',
      questions: [
        {
          id: 'q1',
          text: 'A?',
          contextHashId: '',
          answers: [
            { id: 'a1', text: 'Yes.', nextQuestionId: 'q2' },
            { id: 'a1_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q2',
          text: 'B?',
          contextHashId: 'deadbeef', // wrong
          answers: [
            { id: 'a2', text: "Let's talk.", isMatch: true, isTerminal: true },
            { id: 'a2_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(/contextHashId/);
  });
});

describe('Survey counters and independence', () => {
  it('accepts a survey whose answers carry numeric counters', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'survey',
      questions: [
        {
          id: 'q1',
          text: 'Favourite colour?',
          isAggregatable: true,
          contextHashId: '',
          answers: [
            { id: 'a_r', text: 'Red.', counter: 0, isIgnore: true, isTerminal: true },
            { id: 'a_b', text: 'Blue.', counter: 0, isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('rejects a survey question with a nextQuestionId', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'survey',
      questions: [
        {
          id: 'q1',
          text: 'A?',
          isAggregatable: true,
          nextQuestionId: 'q2',
          answers: [
            { id: 'a1', text: 'Yes.', isIgnore: true, isTerminal: true },
            { id: 'a1_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q2',
          text: 'B?',
          isAggregatable: true,
          answers: [
            { id: 'a2', text: 'Yes.', isIgnore: true, isTerminal: true },
            { id: 'a2_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(/independent/);
  });
});

describe('Route per-path uniqueness', () => {
  it('rejects the same question text appearing twice on a single root→leaf path', () => {
    const talk: Talk = {
      ...makeBase(),
      type: 'route',
      questions: [
        {
          id: 'q_root',
          text: 'Do you play a sport?',
          contextPath: [],
          answers: [{ id: 'a_yes', text: 'Yes.', isTerminal: false }],
        },
        {
          id: 'q_dup',
          // Same text as q_root — on the path [q_root/a_yes] this is illegal.
          text: 'Do you play a sport?',
          contextPath: [{ questionId: 'q_root', answerId: 'a_yes' }],
          answers: [{ id: 'a_y', text: 'Yes.', isMatch: true, isTerminal: true }],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).toThrow(/repeating question on path/);
  });

  it('accepts the same question text in two different branches', () => {
    // Two children of q_root: q_tennis and q_badminton. Each has its own
    // "skill level" follow-up — same text, different branch, different hash.
    const talk: Talk = {
      ...makeBase(),
      type: 'route',
      questions: [
        {
          id: 'q_root',
          text: 'Pick a sport.',
          contextPath: [],
          answers: [
            { id: 'a_t', text: 'Tennis.', isTerminal: false },
            { id: 'a_b', text: 'Badminton.', isTerminal: false },
          ],
        },
        {
          id: 'q_skill_tennis',
          text: 'What is your skill level?',
          contextPath: [{ questionId: 'q_root', answerId: 'a_t' }],
          answers: [{ id: 'a_beg_t', text: 'Beginner.', isMatch: true, isTerminal: true }],
        },
        {
          id: 'q_skill_bad',
          text: 'What is your skill level?',
          contextPath: [{ questionId: 'q_root', answerId: 'a_b' }],
          answers: [{ id: 'a_beg_b', text: 'Beginner.', isMatch: true, isTerminal: true }],
        },
      ],
    };
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });
});

describe('TalkAutofix', () => {
  it('auto-renames duplicate flow question texts and fixes answer constraints', () => {
    const broken = {
      ...makeBase(),
      type: 'flow' as const,
      questions: [
        {
          id: 'q1',
          text: 'Do you like coffee?',
          answers: [
            // First answer is wrongly an ignore (autofix should promote it to a link/match)
            { id: 'a1_first', text: 'Yes.', isIgnore: true, isTerminal: true },
            // Second answer wrongly carries a match flag (autofix should convert to ignore)
            { id: 'a1_extra', text: 'Maybe.', isMatch: true, isTerminal: true },
            { id: 'a1_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q2',
          text: 'Do you like coffee?', // duplicate text
          answers: [
            { id: 'a2_first', text: "Let's talk.", isMatch: true, isTerminal: true },
            { id: 'a2_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    const report = TalkAutofix.fix(broken as any);
    expect(report.fixes.length).toBeGreaterThan(0);
    expect(() => TalkValidator.validateTalk(report.talk as any)).not.toThrow();
    // Q2's text should have been disambiguated.
    expect(report.talk.questions[1].text).not.toBe(report.talk.questions[0].text);
    // First answer on q1 is now a match or next.
    const a0 = report.talk.questions[0].answers[0];
    expect(Boolean(a0.isMatch) || Boolean(a0.nextQuestionId)).toBe(true);
    // The middle answer (previously match) is now ignore.
    expect(report.talk.questions[0].answers[1].isMatch).toBeFalsy();
    expect(report.talk.questions[0].answers[1].isIgnore).toBe(true);
  });

  it('converts isMatch on a non-last question first answer to nextQuestionId', () => {
    // User sets Q1 first answer to "noticed" (isMatch) while Q2 exists.
    // Autofix must redirect Q1 → Q2 instead of firing match immediately.
    const talk = {
      ...makeBase(),
      type: 'flow' as const,
      questions: [
        {
          id: 'q_0',
          text: 'Do you play tennis?',
          answers: [
            { id: 'a_0_0', text: 'Yes.', isMatch: true, isTerminal: true },
            { id: 'a_0_1', text: 'No.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q_1',
          text: 'When are you free?',
          answers: [
            { id: 'a_1_0', text: 'This weekend.', isMatch: true, isTerminal: true },
            { id: 'a_1_1', text: 'Not sure.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    };
    const { talk: fixed, fixes } = TalkAutofix.fix(talk as any);
    // Q0 first answer must now link to Q1, not fire match
    const q0first = fixed.questions[0].answers[0];
    expect(q0first.nextQuestionId).toBe('q_1');
    expect(q0first.isMatch).toBeFalsy();
    expect(q0first.isTerminal).toBeFalsy();
    // Q1 first answer stays as match (it IS the last question)
    expect(fixed.questions[1].answers[0].isMatch).toBe(true);
    // At least one fix was reported
    expect(fixes.some((f) => f.includes('q_0'))).toBe(true);
    expect(() => TalkValidator.validateTalk(fixed as any)).not.toThrow();
  });

  it('fills in contextHashId for route questions from contextPath', () => {
    const talk = {
      ...makeBase(),
      type: 'route' as const,
      questions: [
        { id: 'q0', text: 'Root?', contextPath: [], answers: [{ id: 'a0', text: 'Yes.', isMatch: true, isTerminal: true }] },
      ],
    };
    const { talk: fixed } = TalkAutofix.fix(talk as any);
    expect(fixed.questions[0].contextHashId).toBe('');
  });
});
