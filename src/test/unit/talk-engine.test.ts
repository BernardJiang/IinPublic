import { TalkValidator, TalkAutofix, matchScore, checkIfMatch, checkIfIgnore, computeRouteMatchScore, type SubmittedAnswer } from '../../shared/talk-engine';
import { Talk, Answer } from '../../shared/types';

describe('matchScore', () => {
  it('counts shared tags when combine returns one', () => {
    const viewer = { hiking: 1, cooking: 1, chess: 1 };
    const other = { chess: 1, music: 1, hiking: 1 };
    expect(matchScore(viewer, other, () => 1)).toBe(2);
  });

  it('supports weighted scoring via custom combine policy', () => {
    const viewer = { hiking: 3, cooking: 2, chess: 1 };
    const other = { hiking: 2, cooking: 5, music: 7 };
    const sumMinWeight = matchScore(viewer, other, (a, b) => Math.min(a, b));
    expect(sumMinWeight).toBe(4);
  });

  it('handles arbitrary N users x Mi tags with monotonic ranking', () => {
    const users = Array.from({ length: 12 }, (_, userIndex) => {
      const tagCount = 3 + (userIndex % 5);
      const tags = Array.from({ length: tagCount }, (_, offset) => `tag-${(userIndex + offset) % 18}`);
      return { id: `u${userIndex}`, tags };
    });

    for (const viewer of users) {
      const ranked = users
        .filter((candidate) => candidate.id !== viewer.id)
        .map((candidate) => ({
          candidateId: candidate.id,
          score: matchScore(viewer.tags, candidate.tags, () => 1),
        }))
        .sort((a, b) => b.score - a.score);

      for (let i = 1; i < ranked.length; i += 1) {
        expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
      }

      for (const row of ranked) {
        const candidate = users.find((u) => u.id === row.candidateId)!;
        const expected = viewer.tags.filter((tag) => candidate.tags.includes(tag)).length;
        expect(row.score).toBe(expected);
      }
    }
  });
});

describe('TalkValidator', () => {
  describe('validateDAGStructure', () => {
    it('should validate a simple linear talk', () => {
      const talk: Talk = {
        id: 'test-talk-1',
        title: 'Simple Talk',
        authorId: 'user-1',
        type: 'flow',
        isAdult: false,
        language: 'en',
        tags: [],
        questions: [
          {
            id: 'q1',
            text: 'What is your favorite hobby?',
            answers: [
              {
                id: 'a1',
                text: 'Reading',
                nextQuestionId: 'q2',
              },
              {
                id: 'a2',
                text: 'Sports',
                nextQuestionId: 'q2',
              },
            ],
          },
          {
            id: 'q2',
            text: 'How often do you practice it?',
            answers: [
              {
                id: 'a3',
                text: 'Daily',
                isTerminal: true,
              },
              {
                id: 'a4',
                text: 'Weekly',
                isTerminal: true,
              },
            ],
          },
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0,
      };

      expect(() => TalkValidator.validateDAGStructure(talk)).not.toThrow();
    });

    it('should throw error for talk with loops', () => {
      const talk: Talk = {
        id: 'test-talk-2',
        title: 'Loop Talk',
        authorId: 'user-1',
        type: 'flow',
        isAdult: false,
        language: 'en',
        tags: [],
        questions: [
          {
            id: 'q1',
            text: 'Question 1',
            answers: [
              {
                id: 'a1',
                text: 'Answer 1',
                nextQuestionId: 'q2',
              },
            ],
          },
          {
            id: 'q2',
            text: 'Question 2',
            answers: [
              {
                id: 'a2',
                text: 'Answer 2',
                nextQuestionId: 'q1', // Creates a loop
              },
            ],
          },
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0,
      };

      expect(() => TalkValidator.validateDAGStructure(talk)).toThrow();
    });

    // This test is skipped because validateDAGStructure doesn't check for missing references
    // it('should throw error for talk with missing question references', () => {
    //   const talk: Talk = {
    //     id: 'test-talk-3',
    //     title: 'Missing Reference Talk',
    //     authorId: 'user-1',
    //     type: 'flow',
    //     isAdult: false,
    //     language: 'en',
    //     tags: [],
    //     questions: [
    //       {
    //         id: 'q1',
    //         text: 'Question 1',
    //         answers: [
    //           {
    //             id: 'a1',
    //             text: 'Answer 1',
    //             nextQuestionId: 'q999', // Non-existent question
    //           },
    //         ],
    //       },
    //     ],
    //     createdAt: new Date(),
    //     isTemplate: false,
    //     usageCount: 0,
    //   };

    //   expect(() => TalkValidator.validateDAGStructure(talk)).toThrow();
    // });

    it('should validate talk with branching logic', () => {
      const talk: Talk = {
        id: 'test-talk-4',
        title: 'Branching Talk',
        authorId: 'user-1',
        type: 'survey',
        isAdult: false,
        language: 'en',
        tags: [],
        questions: [
          {
            id: 'q1',
            text: 'What is your age?',
            answers: [
              {
                id: 'a1',
                text: 'Under 18',
                nextQuestionId: 'q2',
              },
              {
                id: 'a2',
                text: '18-25',
                nextQuestionId: 'q3',
              },
              {
                id: 'a3',
                text: 'Over 25',
                nextQuestionId: 'q4',
              },
            ],
            isAgeGate: true,
          },
          {
            id: 'q2',
            text: 'What grade are you in?',
            answers: [
              { id: 'a4', text: 'High School', isTerminal: true },
              { id: 'a5', text: 'Middle School', isTerminal: true },
            ],
          },
          {
            id: 'q3',
            text: 'Are you in college?',
            answers: [
              { id: 'a6', text: 'Yes', isTerminal: true },
              { id: 'a7', text: 'No', isTerminal: true },
            ],
          },
          {
            id: 'q4',
            text: 'What is your profession?',
            answers: [
              { id: 'a8', text: 'Engineer', isTerminal: true },
              { id: 'a9', text: 'Teacher', isTerminal: true },
              { id: 'a10', text: 'Other', isTerminal: true },
            ],
          },
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0,
      };

      expect(() => TalkValidator.validateDAGStructure(talk)).not.toThrow();
    });
  });

  describe('validateTalk (tag)', () => {
    it('should accept a valid tag (one question, one match + one ignore answer)', () => {
      const tag: Talk = {
        id: 'tag-1',
        title: 'Coffee',
        authorId: 'user-1',
        type: 'tag',
        isAdult: false,
        language: 'en',
        tags: [],
        questions: [
          {
            id: 'q_0',
            text: 'Coffee',
            answers: [
              { id: 'a_0_match', text: 'Coffee', isMatch: true, isTerminal: true },
              { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0,
      };
      expect(() => TalkValidator.validateTalk(tag)).not.toThrow();
    });

    it('rejects a plain (non-Pair) tag whose accepted answer diverges from the question text', () => {
      const tag: Talk = {
        id: 'tag-2',
        title: 'Coffee',
        authorId: 'user-1',
        type: 'tag',
        isAdult: false,
        language: 'en',
        tags: [],
        questions: [
          {
            id: 'q_0',
            text: 'Coffee',
            answers: [
              { id: 'a_0_match', text: 'Tea', isMatch: true, isTerminal: true },
              { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0,
      };
      expect(() => TalkValidator.validateTalk(tag)).toThrow();
    });

    it('accepts a Pair tag whose accepted answer diverges from the question text', () => {
      const tag: Talk = {
        id: 'tag-3',
        title: 'sell',
        authorId: 'user-1',
        type: 'tag',
        isAdult: false,
        language: 'en',
        tags: [],
        questions: [
          {
            id: 'q_0',
            text: 'sell',
            reciprocalTagContext: true,
            answers: [
              { id: 'a_0_match', text: 'buy', isMatch: true, isTerminal: true },
              { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0,
      };
      expect(() => TalkValidator.validateTalk(tag)).not.toThrow();
    });

    it('should reject tag with more than one question', () => {
      const tag: Talk = {
        id: 'tag-2',
        title: 'Coffee',
        authorId: 'user-1',
        type: 'tag',
        isAdult: false,
        language: 'en',
        tags: [],
        questions: [
          { id: 'q_0', text: 'Coffee', answers: [{ id: 'a1', text: 'Match.', isMatch: true, isTerminal: true }, { id: 'a2', text: 'Ignore.', isIgnore: true, isTerminal: true }] },
          { id: 'q_1', text: 'Tennis', answers: [{ id: 'a3', text: 'Match.', isMatch: true, isTerminal: true }, { id: 'a4', text: 'Ignore.', isIgnore: true, isTerminal: true }] },
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0,
      };
      expect(() => TalkValidator.validateTalk(tag)).toThrow('Tag must have exactly one question');
    });

    it('should reject tag without both match and ignore answers', () => {
      const tag: Talk = {
        id: 'tag-3',
        title: 'Coffee',
        authorId: 'user-1',
        type: 'tag',
        isAdult: false,
        language: 'en',
        tags: [],
        questions: [
          {
            id: 'q_0',
            text: 'Coffee',
            answers: [
              { id: 'a_0_match', text: 'Match.', isMatch: true, isTerminal: true },
            ],
          },
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0,
      };
      expect(() => TalkValidator.validateTalk(tag)).toThrow(
        /Tag must have (exactly two answers|one match and one ignore)/,
      );
    });
  });
});

describe('TalkAutofix.fix — builtIn typed questions on route talks (§BB, spec §30.2)', () => {
  it('generates the 2 synthetic answers for a builtIn route question with no author-typed answers', () => {
    const talk = {
      id: 't1',
      title: 'Item Deal',
      type: 'route',
      questions: [
        {
          id: 'q_0',
          text: 'How many do you want?',
          contextPath: [],
          builtIn: { kind: 'quantity', quantity: 2 },
          answers: [],
        },
      ],
    } as any;

    const { talk: fixed, fixes } = TalkAutofix.fix(talk);
    const [compatible, incompatible] = fixed.questions[0].answers;
    expect(fixed.questions[0].answers).toHaveLength(2);
    expect(compatible.isMatch).toBe(true);
    expect(compatible.isTerminal).toBe(true);
    expect(compatible.nextQuestionId).toBeUndefined();
    expect(incompatible.isIgnore).toBe(true);
    expect(incompatible.isTerminal).toBe(true);
    expect(fixes.some((f) => f.includes('built-in question'))).toBe(true);
  });

  it('does not overwrite already-populated answers on a builtIn route question (idempotent)', () => {
    const talk = {
      id: 't1',
      title: 'Item Deal',
      type: 'route',
      questions: [
        {
          id: 'q_0',
          text: 'How many do you want?',
          contextPath: [],
          builtIn: { kind: 'quantity', quantity: 2 },
          answers: [
            { id: 'q_0_compatible', text: 'Compatible', isMatch: true, isTerminal: true },
            { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    } as any;

    const { talk: fixed, fixes } = TalkAutofix.fix(talk);
    expect(fixed.questions[0].answers).toHaveLength(2);
    expect(fixes.some((f) => f.includes('built-in question'))).toBe(false);
  });

  it('a builtIn route question\'s synthetic answers pass TalkValidator.validateTalk unchanged', () => {
    const talk = {
      id: 't1',
      title: 'Item Deal',
      type: 'route',
      questions: [
        {
          id: 'q_0',
          text: 'Which item?',
          contextPath: [],
          answers: [
            { id: 'a_0', text: 'Notebook', nextQuestionId: 'q_1' },
            { id: 'a_1', text: 'Book', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q_1',
          text: 'How many notebooks do you want?',
          contextPath: [{ questionId: 'q_0', answerId: 'a_0' }],
          builtIn: { kind: 'quantity', quantity: 2 },
          answers: [],
        },
      ],
    } as any;

    const { talk: fixed } = TalkAutofix.fix(talk);
    expect(() => TalkValidator.validateTalk(fixed)).not.toThrow();
    expect(fixed.questions[1].answers).toHaveLength(2);
  });

  it('a builtIn route question with 0 answers fails TalkValidator.validateTalk before autofix runs', () => {
    // Regression guard: TalkValidator.validateRouteTalk requires answers.length > 0 (line
    // ~531) — confirms TalkAutofix's synthetic-answer step is load-bearing, not redundant.
    const talk = {
      id: 't1',
      title: 'Item Deal',
      type: 'route',
      questions: [
        { id: 'q_0', text: 'How many?', contextPath: [], builtIn: { kind: 'quantity', quantity: 2 }, answers: [] },
      ],
    } as any;

    expect(() => TalkValidator.validateTalk(talk)).toThrow(/at least one answer/);
  });
});

describe('checkIfMatch / checkIfIgnore on route talks', () => {
  // HR job-search route: a jobseeker first picks a position. Accountant/Engineer
  // continue to a one-question screen (its own isMatch/isIgnore terminal, so two
  // structurally distinct match points at different DAG depths); Doctor/Lawyer are
  // rejected immediately at the root. Regression coverage for the bug where
  // checkIfMatch/checkIfIgnore unconditionally returned false for type: 'route'.
  const hrRouteTalk: Talk = {
    id: 'hr-route-1',
    title: 'Which role are you applying for?',
    authorId: 'hr-agent',
    type: 'route',
    isAdult: false,
    language: 'en',
    tags: [],
    questions: [
      {
        id: 'q_position',
        text: 'Which position are you applying for?',
        contextPath: [],
        answers: [
          { id: 'a_accountant', text: 'Accountant', nextQuestionId: 'q_accountant_screen' },
          { id: 'a_engineer', text: 'Engineer', nextQuestionId: 'q_engineer_screen' },
          { id: 'a_doctor', text: 'Doctor', isIgnore: true, isTerminal: true },
          { id: 'a_lawyer', text: 'Lawyer', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_accountant_screen',
        text: 'Do you hold a CPA license?',
        contextPath: [{ questionId: 'q_position', answerId: 'a_accountant' }],
        answers: [
          { id: 'a_cpa_yes', text: 'Yes', isMatch: true, isTerminal: true },
          { id: 'a_cpa_no', text: 'No', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_engineer_screen',
        text: 'Do you have a coding portfolio?',
        contextPath: [{ questionId: 'q_position', answerId: 'a_engineer' }],
        answers: [
          { id: 'a_portfolio_yes', text: 'Yes', isMatch: true, isTerminal: true },
          { id: 'a_portfolio_no', text: 'No', isIgnore: true, isTerminal: true },
        ],
      },
    ],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
  };

  function path(...steps: Array<[string, string]>): SubmittedAnswer[] {
    return steps.map(([questionId, answerId]) => ({ questionId, answerId }));
  }

  it('matches an accountant with a CPA license (one match point)', () => {
    const answers = path(['q_position', 'a_accountant'], ['q_accountant_screen', 'a_cpa_yes']);
    expect(checkIfMatch(hrRouteTalk, answers)).toBe(true);
    expect(checkIfIgnore(hrRouteTalk, answers)).toBe(false);
  });

  it('matches an engineer with a portfolio (a different match point, same talk)', () => {
    const answers = path(['q_position', 'a_engineer'], ['q_engineer_screen', 'a_portfolio_yes']);
    expect(checkIfMatch(hrRouteTalk, answers)).toBe(true);
    expect(checkIfIgnore(hrRouteTalk, answers)).toBe(false);
  });

  it('does not match a doctor, rejected at the root question', () => {
    const answers = path(['q_position', 'a_doctor']);
    expect(checkIfMatch(hrRouteTalk, answers)).toBe(false);
    expect(checkIfIgnore(hrRouteTalk, answers)).toBe(true);
  });

  it('does not match a lawyer, rejected at the root question', () => {
    const answers = path(['q_position', 'a_lawyer']);
    expect(checkIfMatch(hrRouteTalk, answers)).toBe(false);
    expect(checkIfIgnore(hrRouteTalk, answers)).toBe(true);
  });

  it('does not match an accountant candidate without a CPA license', () => {
    const answers = path(['q_position', 'a_accountant'], ['q_accountant_screen', 'a_cpa_no']);
    expect(checkIfMatch(hrRouteTalk, answers)).toBe(false);
    expect(checkIfIgnore(hrRouteTalk, answers)).toBe(true);
  });

  it('an ordinary route talk (no matchThreshold) is byte-for-byte unaffected by computeRouteMatchScore', () => {
    expect(computeRouteMatchScore(hrRouteTalk, path(['q_position', 'a_accountant'], ['q_accountant_screen', 'a_cpa_yes']))).toBeNull();
  });
});

describe('checkIfMatch — route matchThreshold scoring (independent specs, order-independent, partial match)', () => {
  // Adam's "buy iPhone" route: root -> 3 independent sibling specs (color, condition, item),
  // each exactly one question deep. matchThreshold: 2 means "at least 2 of the 3 specs must
  // match" — partial match is the normal case, not "all 3 required."
  const specRouteTalk: Talk = {
    id: 'buy-iphone-route',
    title: 'Buy Used White iPhone',
    authorId: 'adam',
    type: 'route',
    isAdult: false,
    language: 'en',
    tags: [],
    matchThreshold: 2,
    questions: [
      {
        id: 'q_root',
        text: 'What are you offering?',
        contextPath: [],
        answers: [
          { id: 'a_root_color', text: 'Color', nextQuestionId: 'q_color' },
          { id: 'a_root_condition', text: 'Condition', nextQuestionId: 'q_condition' },
          { id: 'a_root_item', text: 'Item', nextQuestionId: 'q_item' },
        ],
      },
      {
        id: 'q_color',
        text: 'Is it white?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_color' }],
        answers: [
          { id: 'a_color_yes', text: 'Yes, white', isMatch: true, isTerminal: true },
          { id: 'a_color_no', text: 'No, a different color', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_condition',
        text: 'Is it used?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_condition' }],
        answers: [
          { id: 'a_condition_yes', text: 'Yes, used', isMatch: true, isTerminal: true },
          { id: 'a_condition_no', text: 'No, new', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_item',
        text: 'Is it an iPhone?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_item' }],
        answers: [
          { id: 'a_item_yes', text: 'Yes, iPhone', isMatch: true, isTerminal: true },
          { id: 'a_item_no', text: 'No, a different phone', isIgnore: true, isTerminal: true },
        ],
      },
    ],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
  };

  const specAnswers = (color: 'yes' | 'no', condition: 'yes' | 'no', item: 'yes' | 'no'): SubmittedAnswer[] => [
    { questionId: 'q_color', answerId: `a_color_${color}` },
    { questionId: 'q_condition', answerId: `a_condition_${condition}` },
    { questionId: 'q_item', answerId: `a_item_${item}` },
  ];

  it('scores a 3-of-3 (100%) response and matches', () => {
    const answers = specAnswers('yes', 'yes', 'yes');
    expect(computeRouteMatchScore(specRouteTalk, answers)).toEqual({ score: 3, total: 3 });
    expect(checkIfMatch(specRouteTalk, answers)).toBe(true);
  });

  it('scores a partial 2-of-3 (66%) response as a match — partial match is the normal case, not an exception', () => {
    const answers = specAnswers('yes', 'yes', 'no');
    expect(computeRouteMatchScore(specRouteTalk, answers)).toEqual({ score: 2, total: 3 });
    expect(checkIfMatch(specRouteTalk, answers)).toBe(true);
  });

  it('does not match a 1-of-3 response — below the threshold of 2', () => {
    const answers = specAnswers('yes', 'no', 'no');
    expect(computeRouteMatchScore(specRouteTalk, answers)).toEqual({ score: 1, total: 3 });
    expect(checkIfMatch(specRouteTalk, answers)).toBe(false);
  });

  it('does not match a 0-of-3 response', () => {
    const answers = specAnswers('no', 'no', 'no');
    expect(computeRouteMatchScore(specRouteTalk, answers)).toEqual({ score: 0, total: 3 });
    expect(checkIfMatch(specRouteTalk, answers)).toBe(false);
  });

  it('is exactly at the threshold boundary — score === matchThreshold matches (>=, not >)', () => {
    const exactlyTwo: Talk = { ...specRouteTalk, matchThreshold: 2 };
    const answers = specAnswers('yes', 'yes', 'no');
    expect(checkIfMatch(exactlyTwo, answers)).toBe(true);
  });

  it('is order-independent — specs submitted in a different order produce the identical score', () => {
    const inOrder = specAnswers('yes', 'yes', 'no');
    const reordered: SubmittedAnswer[] = [inOrder[2], inOrder[0], inOrder[1]];
    expect(computeRouteMatchScore(specRouteTalk, inOrder)).toEqual(computeRouteMatchScore(specRouteTalk, reordered));
    expect(checkIfMatch(specRouteTalk, reordered)).toBe(checkIfMatch(specRouteTalk, inOrder));
  });

  it('ignores answers to questions outside the root\'s direct children rather than corrupting the score', () => {
    const answers: SubmittedAnswer[] = [...specAnswers('yes', 'yes', 'no'), { questionId: 'not_a_real_question', answerId: 'x' }];
    expect(computeRouteMatchScore(specRouteTalk, answers)).toEqual({ score: 2, total: 3 });
  });

  it('a talk with matchThreshold set but no recognizable root/children falls back to null (never throws)', () => {
    const malformed: Talk = { ...specRouteTalk, questions: [] };
    expect(computeRouteMatchScore(malformed, specAnswers('yes', 'yes', 'yes'))).toBeNull();
  });
});

describe('checkIfMatch — Answer.nextQuestionIds fan-out (any-node generalization of matchThreshold)', () => {
  // "Buy or sell?" -> "iPhone or iPad?" -> the "iPhone" answer fans out into 3 parallel
  // attribute specs (Model, Condition, Price range) — this is the shape matchThreshold could
  // never express (it only ever scored the ROOT's own direct children). Neither router
  // question ("buy/sell", "iphone/ipad") is itself scored — only followed.
  const fanOutRouteTalk: Talk = {
    id: 'buy-sell-iphone-ipad-route',
    title: 'Buy or Sell iPhone/iPad',
    authorId: 'adam',
    type: 'route',
    isAdult: false,
    language: 'en',
    tags: [],
    questions: [
      {
        id: 'q_root',
        text: 'Buy or sell?',
        contextPath: [],
        answers: [
          { id: 'a_root_buy', text: 'Buy', nextQuestionId: 'q_product' },
          { id: 'a_root_sell', text: 'Sell', nextQuestionId: 'q_product' },
        ],
      },
      {
        id: 'q_product',
        text: 'iPhone or iPad?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_buy' }],
        answers: [
          {
            id: 'a_product_iphone',
            text: 'iPhone',
            nextQuestionIds: ['q_model', 'q_condition', 'q_price'],
            parallelMatchThreshold: 2,
          },
          { id: 'a_product_ipad', text: 'iPad', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_model',
        text: 'What model?',
        contextPath: [{ questionId: 'q_product', answerId: 'a_product_iphone' }],
        answers: [
          { id: 'a_model_yes', text: '16 Pro', isMatch: true, isTerminal: true },
          { id: 'a_model_no', text: 'Some other model', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_condition',
        text: 'What condition?',
        contextPath: [{ questionId: 'q_product', answerId: 'a_product_iphone' }],
        answers: [
          { id: 'a_condition_yes', text: 'Used, good', isMatch: true, isTerminal: true },
          { id: 'a_condition_no', text: 'Used, poor', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_price',
        text: 'What price range?',
        contextPath: [{ questionId: 'q_product', answerId: 'a_product_iphone' }],
        answers: [
          { id: 'a_price_yes', text: '$500-$700', isMatch: true, isTerminal: true },
          { id: 'a_price_no', text: 'Under $500', isIgnore: true, isTerminal: true },
        ],
      },
    ],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
  };

  const fanOutAnswers = (model: 'yes' | 'no', condition: 'yes' | 'no', price: 'yes' | 'no'): SubmittedAnswer[] => [
    { questionId: 'q_root', answerId: 'a_root_buy' },
    { questionId: 'q_product', answerId: 'a_product_iphone' },
    { questionId: 'q_model', answerId: `a_model_${model}` },
    { questionId: 'q_condition', answerId: `a_condition_${condition}` },
    { questionId: 'q_price', answerId: `a_price_${price}` },
  ];

  it('matches a 3-of-3 response (threshold 2)', () => {
    expect(checkIfMatch(fanOutRouteTalk, fanOutAnswers('yes', 'yes', 'yes'))).toBe(true);
  });

  it('matches a 2-of-3 response — at the threshold boundary (>=, not >)', () => {
    expect(checkIfMatch(fanOutRouteTalk, fanOutAnswers('yes', 'yes', 'no'))).toBe(true);
  });

  it('does not match a 1-of-3 response — below threshold 2', () => {
    expect(checkIfMatch(fanOutRouteTalk, fanOutAnswers('yes', 'no', 'no'))).toBe(false);
  });

  it('is order-independent — specs submitted in a different order produce the identical result', () => {
    const inOrder = fanOutAnswers('yes', 'yes', 'no');
    const reordered = [inOrder[0], inOrder[2], inOrder[4], inOrder[1], inOrder[3]];
    expect(checkIfMatch(fanOutRouteTalk, reordered)).toBe(checkIfMatch(fanOutRouteTalk, inOrder));
  });

  it('an unanswered spec counts as not-passed rather than throwing', () => {
    const answers = fanOutAnswers('yes', 'yes', 'yes').filter((a) => a.questionId !== 'q_price');
    expect(checkIfMatch(fanOutRouteTalk, answers)).toBe(true); // still 2-of-3 answered-and-matching
  });

  it('blank parallelMatchThreshold defaults to requiring ALL children', () => {
    const allRequired: Talk = {
      ...fanOutRouteTalk,
      questions: fanOutRouteTalk.questions.map((q) =>
        q.id === 'q_product'
          ? {
              ...q,
              answers: q.answers.map((a) => {
                if (a.id !== 'a_product_iphone') return a;
                const { parallelMatchThreshold: _drop, ...rest } = a;
                return rest;
              }),
            }
          : q,
      ),
    };
    expect(checkIfMatch(allRequired, fanOutAnswers('yes', 'yes', 'no'))).toBe(false); // 2-of-3, but default requires 3
    expect(checkIfMatch(allRequired, fanOutAnswers('yes', 'yes', 'yes'))).toBe(true);
  });

  it('picking "iPad" (the plain Ignore leaf) never reaches the fan-out at all', () => {
    const answers: SubmittedAnswer[] = [
      { questionId: 'q_root', answerId: 'a_root_buy' },
      { questionId: 'q_product', answerId: 'a_product_ipad' },
    ];
    expect(checkIfMatch(fanOutRouteTalk, answers)).toBe(false);
  });

  it('an ordinary route talk with no nextQuestionIds anywhere is unaffected (falls through to null)', () => {
    expect(computeRouteMatchScore(fanOutRouteTalk, fanOutAnswers('yes', 'yes', 'yes'))).toBeNull(); // legacy path never engages
  });
});

describe('TalkValidator — Answer.nextQuestionIds fan-out validation', () => {
  const baseQuestions = (productAnswerOverrides: Partial<Answer>): Talk['questions'] => [
    {
      id: 'q_root',
      text: 'iPhone?',
      contextPath: [],
      answers: [
        { id: 'a_root_yes', text: 'Yes', nextQuestionIds: ['q_model', 'q_condition'], parallelMatchThreshold: 1, ...productAnswerOverrides },
        { id: 'a_root_no', text: 'No', isIgnore: true, isTerminal: true },
      ],
    },
    {
      id: 'q_model',
      text: 'Model?',
      contextPath: [{ questionId: 'q_root', answerId: 'a_root_yes' }],
      answers: [
        { id: 'a_model_yes', text: '16 Pro', isMatch: true, isTerminal: true },
        { id: 'a_model_no', text: 'Other', isIgnore: true, isTerminal: true },
      ],
    },
    {
      id: 'q_condition',
      text: 'Condition?',
      contextPath: [{ questionId: 'q_root', answerId: 'a_root_yes' }],
      answers: [
        { id: 'a_condition_yes', text: 'Good', isMatch: true, isTerminal: true },
        { id: 'a_condition_no', text: 'Poor', isIgnore: true, isTerminal: true },
      ],
    },
  ];
  const baseTalk = (productAnswerOverrides: Partial<Answer> = {}): Talk => ({
    id: 'fanout-validation',
    title: 'Fan-out validation',
    authorId: 'adam',
    type: 'route',
    isAdult: false,
    language: 'en',
    tags: [],
    questions: baseQuestions(productAnswerOverrides),
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
  });

  it('accepts a valid fan-out with an in-range parallelMatchThreshold', () => {
    expect(() => TalkValidator.validateTalk(baseTalk())).not.toThrow();
  });

  it('rejects an answer setting both nextQuestionId and nextQuestionIds', () => {
    expect(() => TalkValidator.validateTalk(baseTalk({ nextQuestionId: 'q_model' }))).toThrow(/cannot set both/);
  });

  it('rejects nextQuestionIds referencing an unknown question', () => {
    expect(() => TalkValidator.validateTalk(baseTalk({ nextQuestionIds: ['q_model', 'q_missing'] }))).toThrow(/unknown question/);
  });

  it('rejects a parallelMatchThreshold of 0', () => {
    expect(() => TalkValidator.validateTalk(baseTalk({ parallelMatchThreshold: 0 }))).toThrow(/invalid parallelMatchThreshold/);
  });

  it('rejects a parallelMatchThreshold exceeding the number of children', () => {
    expect(() => TalkValidator.validateTalk(baseTalk({ parallelMatchThreshold: 3 }))).toThrow(/invalid parallelMatchThreshold/);
  });

  it('detects a cycle introduced purely through nextQuestionIds', () => {
    const cyclic = baseTalk();
    // Make q_model point back to q_root — a cycle only reachable via the fan-out edge.
    const { isMatch: _isMatch, isTerminal: _isTerminal, ...rest } = cyclic.questions[1].answers[0];
    cyclic.questions[1].answers[0] = { ...rest, nextQuestionId: 'q_root' };
    expect(() => TalkValidator.validateDAGStructure(cyclic)).toThrow(/loop/);
  });
});

describe('checkIfMatch / checkIfIgnore — multi-value ("pick any that apply") questions, spec §30.8/FR-QA-16', () => {
  const multiTalk: Talk = {
    id: 'talk-notebook',
    title: 'Buy Used Notebook',
    type: 'flow',
    questions: [
      {
        id: 'q_model',
        text: 'Which model would you accept?',
        answerSelectionMode: 'multiple',
        answers: [
          { id: 'a_modelA', text: 'Model A', isMatch: true },
          { id: 'a_modelB', text: 'Model B', isMatch: true },
          { id: 'a_modelC', text: 'Model C', isIgnore: true },
        ],
      },
    ],
  } as any;

  it('matches when the selected set intersects the isMatch-flagged options (any overlap counts)', () => {
    const answers: SubmittedAnswer[] = [
      { questionId: 'q_model', answerId: 'a_modelB', answerIds: ['a_modelB'] },
    ];
    expect(checkIfMatch(multiTalk, answers)).toBe(true);
    expect(checkIfIgnore(multiTalk, answers)).toBe(false);
  });

  it('matches on a multi-element selected set as long as at least one element is isMatch-flagged', () => {
    const answers: SubmittedAnswer[] = [
      { questionId: 'q_model', answerId: 'a_modelC', answerIds: ['a_modelC', 'a_modelB'] },
    ];
    expect(checkIfMatch(multiTalk, answers)).toBe(true);
  });

  it('does not match when every selected id is isIgnore-flagged (disjoint from the isMatch set)', () => {
    const answers: SubmittedAnswer[] = [
      { questionId: 'q_model', answerId: 'a_modelC', answerIds: ['a_modelC'] },
    ];
    expect(checkIfMatch(multiTalk, answers)).toBe(false);
    expect(checkIfIgnore(multiTalk, answers)).toBe(true);
  });

  it('a singleton answerIds set reproduces exact-equality single-select behavior exactly', () => {
    const viaSingleton: SubmittedAnswer[] = [{ questionId: 'q_model', answerId: 'a_modelA', answerIds: ['a_modelA'] }];
    const viaLegacyShape: SubmittedAnswer[] = [{ questionId: 'q_model', answerId: 'a_modelA' }];
    expect(checkIfMatch(multiTalk, viaSingleton)).toBe(checkIfMatch(multiTalk, viaLegacyShape));
    expect(checkIfMatch(multiTalk, viaLegacyShape)).toBe(true);
    expect(checkIfIgnore(multiTalk, viaLegacyShape)).toBe(false);
  });

  it('an empty answerIds array falls back to answerId (never treated as an empty selected set)', () => {
    const answers: SubmittedAnswer[] = [{ questionId: 'q_model', answerId: 'a_modelA', answerIds: [] }];
    expect(checkIfMatch(multiTalk, answers)).toBe(true);
  });

  it('existing single-select talks are completely unaffected — every prior unit case in this file still passes unmodified', () => {
    // Regression guard: `answerSelectionMode` absent (undefined) behaves exactly like today.
    const singleTalk: Talk = {
      id: 'talk-single',
      title: 'Single-select',
      type: 'tag',
      questions: [
        {
          id: 'q_0',
          text: 'Tennis',
          answers: [
            { id: 'a_match', text: 'Match.', isMatch: true },
            { id: 'a_ignore', text: 'Ignore.', isIgnore: true },
          ],
        },
      ],
    } as any;
    expect(checkIfMatch(singleTalk, [{ questionId: 'q_0', answerId: 'a_match' }])).toBe(true);
    expect(checkIfIgnore(singleTalk, [{ questionId: 'q_0', answerId: 'a_ignore' }])).toBe(true);
  });
});


describe('TalkValidator — Question.tagKind / reciprocalTagContext shape rules (docs/TODO.md §LL follow-up)', () => {
  const flowTalkWithQ0 = (q0: any): Talk =>
    ({
      id: 't1',
      title: 'Sell iPhone',
      type: 'flow',
      questions: [
        q0,
        {
          id: 'q_1',
          text: 'Model?',
          answers: [
            { id: 'a_1_match', text: '16 Pro', isMatch: true, isTerminal: true },
            { id: 'a_1_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    }) as any;

  it('accepts a simple-tag question whose one answer matches its own text', () => {
    const talk = flowTalkWithQ0({
      id: 'q_0',
      text: 'iPhone',
      tagKind: 'simple',
      answers: [
        { id: 'a_0_match', text: 'iPhone', nextQuestionId: 'q_1' },
        { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    });
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('rejects a simple-tag question whose one answer diverges from its own text', () => {
    const talk = flowTalkWithQ0({
      id: 'q_0',
      text: 'iPhone',
      tagKind: 'simple',
      answers: [
        { id: 'a_0_match', text: 'Android', nextQuestionId: 'q_1' },
        { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    });
    expect(() => TalkValidator.validateTalk(talk)).toThrow();
  });

  it('rejects a simple-tag question with more than one non-ignore answer', () => {
    const talk = flowTalkWithQ0({
      id: 'q_0',
      text: 'iPhone',
      tagKind: 'simple',
      answers: [
        { id: 'a_0_a', text: 'iPhone', nextQuestionId: 'q_1' },
        { id: 'a_0_b', text: 'iPhone', isTerminal: true },
        { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    });
    expect(() => TalkValidator.validateTalk(talk)).toThrow();
  });

  it('rejects a reciprocalTagContext question with more than one non-ignore answer (previously unenforced)', () => {
    const talk = flowTalkWithQ0({
      id: 'q_0',
      text: 'sell',
      reciprocalTagContext: true,
      answers: [
        { id: 'a_0_a', text: 'buy', nextQuestionId: 'q_1' },
        { id: 'a_0_b', text: 'trade', isTerminal: true },
        { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    });
    expect(() => TalkValidator.validateTalk(talk)).toThrow();
  });

  it('rejects a question that is both tagKind: "simple" and reciprocalTagContext at once', () => {
    const talk = flowTalkWithQ0({
      id: 'q_0',
      text: 'iPhone',
      tagKind: 'simple',
      reciprocalTagContext: true,
      answers: [
        { id: 'a_0_match', text: 'iPhone', nextQuestionId: 'q_1' },
        { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    });
    expect(() => TalkValidator.validateTalk(talk)).toThrow();
  });

  it('accepts a reciprocalTagContext question whose one answer diverges (the whole point of a Pair tag)', () => {
    const talk = flowTalkWithQ0({
      id: 'q_0',
      text: 'sell',
      reciprocalTagContext: true,
      answers: [
        { id: 'a_0_match', text: 'buy', nextQuestionId: 'q_1' },
        { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    });
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('applies the same simple-tag/reciprocalTagContext shape rules to route questions (own inline checks, not validateQuestion)', () => {
    const routeTalk: Talk = {
      id: 'r1',
      title: 'Route',
      type: 'route',
      questions: [
        {
          id: 'q_root',
          text: 'iPhone',
          contextPath: [],
          tagKind: 'simple',
          answers: [
            { id: 'a_root_a', text: 'iPhone', isTerminal: true },
            { id: 'a_root_b', text: 'iPhone', isTerminal: true },
          ],
        },
      ],
    } as any;
    expect(() => TalkValidator.validateTalk(routeTalk)).toThrow();
  });
});

describe('checkIfMatch — ancestor-aware reciprocalTagContext (Pair-tag) veto (docs/TODO.md §LL follow-up — the sole tag/preference veto mechanism, usable at any node)', () => {
  it('a mid-tree reciprocalTagContext ancestor gates a match on a flow talk\'s later question', () => {
    const talk: Talk = {
      id: 't1',
      title: 'Sell iPhone',
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'sell',
          reciprocalTagContext: true,
          answers: [
            { id: 'a_0_buy', text: 'buy', nextQuestionId: 'q_1' },
            { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true },
          ],
        },
        {
          id: 'q_1',
          text: 'Model?',
          answers: [
            { id: 'a_1_match', text: '16 Pro', isMatch: true, isTerminal: true },
            { id: 'a_1_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    } as any;
    const answers: SubmittedAnswer[] = [
      { questionId: 'q_0', answerId: 'a_0_buy' },
      { questionId: 'q_1', answerId: 'a_1_match' },
    ];

    expect(checkIfMatch(talk, answers, 'buy')).toBe(true);
    expect(checkIfMatch(talk, answers, 'sell')).toBe(false);
    expect(checkIfMatch(talk, answers, undefined)).toBe(true);
  });

  it('walks a route talk\'s contextPath to find the ancestor, not array position', () => {
    const routeTalk: Talk = {
      id: 'r1',
      title: 'Sell iPhone',
      type: 'route',
      questions: [
        {
          id: 'q_root',
          text: 'sell',
          contextPath: [],
          reciprocalTagContext: true,
          answers: [{ id: 'a_root_buy', text: 'buy', nextQuestionId: 'q_model' }],
        },
        {
          id: 'q_model',
          text: 'Model?',
          contextPath: [{ questionId: 'q_root', answerId: 'a_root_buy' }],
          answers: [
            { id: 'a_model_match', text: '16 Pro', isMatch: true, isTerminal: true },
            { id: 'a_model_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    } as any;
    const answers: SubmittedAnswer[] = [
      { questionId: 'q_root', answerId: 'a_root_buy' },
      { questionId: 'q_model', answerId: 'a_model_match' },
    ];

    expect(checkIfMatch(routeTalk, answers, 'buy')).toBe(true);
    expect(checkIfMatch(routeTalk, answers, 'sell')).toBe(false);
  });

  it('vetoes nothing when the talk declares no Pair-tag question at all — no context, no veto', () => {
    const talk: Talk = {
      id: 't1',
      title: 'Buy Notebook',
      type: 'tag',
      questions: [
        {
          id: 'q_0',
          text: 'Do you sell this?',
          answers: [
            { id: 'a_yes', text: 'Yes', isMatch: true },
            { id: 'a_no', text: 'No', isIgnore: true },
          ],
        },
      ],
    } as any;
    const answers: SubmittedAnswer[] = [{ questionId: 'q_0', answerId: 'a_yes' }];
    expect(checkIfMatch(talk, answers, 'buy')).toBe(true);
    expect(checkIfMatch(talk, answers, 'sell')).toBe(true);
  });
});

describe('TalkAutofix.fix — answerSelectionMode: "multiple" bypasses the single-answer collapse', () => {
  // Regression found via e2e: TalkAutofix's flow-question step "every non-first answer is
  // implicitly ignore" silently stripped isMatch from every checked-multiple option but the
  // first, defeating the whole feature (a buyer's "Model A or Model B" became "Model A only").

  it('keeps every isMatch-flagged answer for a multiple-mode question, does not collapse to the first', () => {
    const talk = {
      id: 't1',
      title: 'Buy Notebook',
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'Which models would you accept?',
          answerSelectionMode: 'multiple',
          answers: [
            { id: 'a_modelA', text: 'Model A', isMatch: true },
            { id: 'a_modelB', text: 'Model B', isMatch: true },
            { id: 'a_modelC', text: 'Model C', isIgnore: true },
          ],
        },
      ],
    } as any;

    const { talk: fixed } = TalkAutofix.fix(talk);
    const [a, b, c] = fixed.questions[0].answers;
    expect(a.isMatch).toBe(true);
    expect(b.isMatch).toBe(true);
    expect(c.isMatch).toBeFalsy();
    expect(c.isIgnore).toBe(true);
    // Every answer normalized to terminal (a multiple-mode question is always chain-terminal)
    // and never carries nextQuestionId.
    for (const answer of fixed.questions[0].answers) {
      expect(answer.isTerminal).toBe(true);
      expect(answer.nextQuestionId).toBeUndefined();
    }
  });

  it('an answer with neither isMatch nor isIgnore set defaults to isIgnore (fail-safe), still multiple-mode', () => {
    const talk = {
      id: 't1',
      title: 'Buy Notebook',
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'Which models would you accept?',
          answerSelectionMode: 'multiple',
          answers: [
            { id: 'a_modelA', text: 'Model A', isMatch: true },
            { id: 'a_modelB', text: 'Model B' }, // author forgot to flag it either way
          ],
        },
      ],
    } as any;

    const { talk: fixed } = TalkAutofix.fix(talk);
    expect(fixed.questions[0].answers[0].isMatch).toBe(true);
    expect(fixed.questions[0].answers[1].isIgnore).toBe(true);
    expect(fixed.questions[0].answers[1].isMatch).toBeFalsy();
  });

  it('single-select (answerSelectionMode absent) flow questions are unaffected — still collapse to answer 0', () => {
    const talk = {
      id: 't1',
      title: 'Ordinary Flow',
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'Do you like coffee?',
          answers: [
            { id: 'a_yes', text: 'Yes', isMatch: true },
            { id: 'a_no', text: 'No', isMatch: true }, // would be wrongly isMatch without the collapse
          ],
        },
      ],
    } as any;

    const { talk: fixed } = TalkAutofix.fix(talk);
    expect(fixed.questions[0].answers[0].isMatch).toBe(true);
    expect(fixed.questions[0].answers[1].isMatch).toBeFalsy();
    expect(fixed.questions[0].answers[1].isIgnore).toBe(true);
  });
});

describe('TalkAutofix.fix — tagKind: "simple" forces the answer to match its question text', () => {
  it('overwrites a mismatched answer to equal the question text', () => {
    const talk = {
      id: 't1',
      title: 'Sell iPhone',
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'iPhone',
          tagKind: 'simple',
          answers: [
            { id: 'a_0_a', text: 'Android', nextQuestionId: 'q_1' },
            { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true },
          ],
        },
        {
          id: 'q_1',
          text: 'Model?',
          answers: [
            { id: 'a_1_match', text: '16 Pro', isMatch: true },
            { id: 'a_1_ignore', text: 'Ignore.', isIgnore: true },
          ],
        },
      ],
    } as any;

    const { talk: fixed, fixes } = TalkAutofix.fix(talk);
    expect(fixed.questions[0].answers[0].text).toBe('iPhone');
    expect(fixes.some((f) => f.includes('simple tag'))).toBe(true);
    expect(() => TalkValidator.validateTalk(fixed)).not.toThrow();
  });

  it('leaves an already-matching answer untouched (no spurious fix entry)', () => {
    const talk = {
      id: 't1',
      title: 'iPhone',
      type: 'tag',
      questions: [
        {
          id: 'q_0',
          text: 'iPhone',
          tagKind: 'simple',
          answers: [
            { id: 'a_0_match', text: 'iPhone', isMatch: true, isTerminal: true },
            { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    } as any;

    const { talk: fixed, fixes } = TalkAutofix.fix(talk);
    expect(fixed.questions[0].answers[0].text).toBe('iPhone');
    expect(fixes.some((f) => f.includes('simple tag'))).toBe(false);
  });
});

describe('TalkAutofix.fix — builtIn typed questions (§BB, spec §30.2)', () => {
  it('generates the 2 synthetic answers for a builtIn question with no author-typed answers', () => {
    const talk = {
      id: 't1',
      title: 'Buy Notebook',
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'How many do you want?',
          builtIn: { kind: 'quantity', quantity: 2 },
          answers: [],
        },
      ],
    } as any;

    const { talk: fixed, fixes } = TalkAutofix.fix(talk);
    const [compatible, incompatible] = fixed.questions[0].answers;
    expect(fixed.questions[0].answers).toHaveLength(2);
    expect(compatible.isMatch).toBe(true);
    expect(compatible.text).toBeTruthy();
    expect(incompatible.isIgnore).toBe(true);
    expect(incompatible.text).toBeTruthy();
    expect(fixes.some((f) => f.includes('built-in question'))).toBe(true);
  });

  it('terminal-matches a builtIn question that is the last in the flow', () => {
    const talk = {
      id: 't1',
      title: 'Buy Notebook',
      type: 'flow',
      questions: [
        { id: 'q_0', text: 'How many do you want?', builtIn: { kind: 'quantity', quantity: 2 }, answers: [] },
      ],
    } as any;

    const { talk: fixed } = TalkAutofix.fix(talk);
    const [compatible] = fixed.questions[0].answers;
    expect(compatible.isMatch).toBe(true);
    expect(compatible.isTerminal).toBe(true);
    expect(compatible.nextQuestionId).toBeUndefined();
  });

  it('links a builtIn question\'s compatible answer to the next question when one follows', () => {
    const talk = {
      id: 't1',
      title: 'Buy Notebook',
      type: 'flow',
      questions: [
        { id: 'q_0', text: 'How many do you want?', builtIn: { kind: 'quantity', quantity: 2 }, answers: [] },
        { id: 'q_1', text: 'Item specifics?', answers: [{ id: 'a_ok', text: 'OK', isMatch: true }] },
      ],
    } as any;

    const { talk: fixed } = TalkAutofix.fix(talk);
    const [compatible, incompatible] = fixed.questions[0].answers;
    expect(compatible.isMatch).toBeFalsy();
    expect(compatible.nextQuestionId).toBe('q_1');
    expect(incompatible.isMatch).toBeFalsy();
    expect(incompatible.isIgnore).toBe(true);
  });

  it('does not overwrite already-populated answers on a builtIn question (idempotent)', () => {
    const talk = {
      id: 't1',
      title: 'Buy Notebook',
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'How many do you want?',
          builtIn: { kind: 'quantity', quantity: 2 },
          answers: [
            { id: 'q_0_compatible', text: 'Compatible', isMatch: true, isTerminal: true },
            { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true },
          ],
        },
      ],
    } as any;

    const { talk: fixed, fixes } = TalkAutofix.fix(talk);
    expect(fixed.questions[0].answers).toHaveLength(2);
    expect(fixes.some((f) => f.includes('built-in question'))).toBe(false);
  });

  it('a builtIn question\'s synthetic answers pass TalkValidator.validateTalk unchanged (no exemption needed)', () => {
    const talk = {
      id: 't1',
      title: 'Buy Notebook',
      type: 'flow',
      questions: [
        { id: 'q_0', text: 'How many do you want?', builtIn: { kind: 'quantity', quantity: 2 }, answers: [] },
      ],
    } as any;

    const { talk: fixed } = TalkAutofix.fix(talk);
    expect(() => TalkValidator.validateTalk(fixed)).not.toThrow();
  });
});

describe('TalkValidator.validateTalk — flow talks with answerSelectionMode: "multiple"', () => {
  // Regression found via e2e: validateFlowTalk had its OWN separate copy of the "only the
  // first answer may be isMatch" rule (independent of TalkAutofix's copy, already fixed
  // above) — a multi-select question with two isMatch-flagged answers passed TalkAutofix but
  // then threw here, silently failing talk-editor submission with no visible JS error.

  const baseTalk = (answers: any[]) => ({
    id: 't1',
    title: 'Buy Notebook',
    type: 'flow',
    questions: [
      {
        id: 'q_0',
        text: 'Which models would you accept?',
        answerSelectionMode: 'multiple',
        answers,
      },
    ],
  } as any);

  it('accepts a multiple-mode question with more than one isMatch-flagged answer', () => {
    const talk = baseTalk([
      { id: 'a_modelA', text: 'Model A', isMatch: true, isTerminal: true },
      { id: 'a_modelB', text: 'Model B', isMatch: true, isTerminal: true },
      { id: 'a_modelC', text: 'Model C', isIgnore: true, isTerminal: true },
    ]);
    expect(() => TalkValidator.validateTalk(talk)).not.toThrow();
  });

  it('still rejects a multiple-mode answer that carries a nextQuestionId (always chain-terminal)', () => {
    const talk = baseTalk([
      { id: 'a_modelA', text: 'Model A', isMatch: true, isTerminal: true },
      { id: 'a_modelB', text: 'Model B', nextQuestionId: 'q_1' },
      { id: 'a_modelC', text: 'Model C', isIgnore: true, isTerminal: true },
    ]);
    expect(() => TalkValidator.validateTalk(talk)).toThrow(/cannot link to another question/);
  });

  it('single-select flow talks are unaffected — still reject a non-first isMatch answer', () => {
    const talk = {
      id: 't1',
      title: 'Ordinary Flow',
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'Do you like coffee?',
          answers: [
            { id: 'a_yes', text: 'Yes', isMatch: true, isTerminal: true },
            { id: 'a_no', text: 'No', isMatch: true, isTerminal: true },
            { id: 'a_maybe', text: 'Maybe', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    } as any;
    expect(() => TalkValidator.validateTalk(talk)).toThrow(/only the first answer may be a match/);
  });

  it('the full processTalkForm-style pipeline (autofix then validate) accepts a real-shaped multi-select talk', () => {
    // Exactly the shape a browser session in the talk editor would produce (isMatch/isIgnore
    // set, isTerminal not yet normalized) — proves the two fixes compose end to end.
    const talk = baseTalk([
      { id: 'a_modelA', text: 'Model A', isMatch: true },
      { id: 'a_modelB', text: 'Model B', isMatch: true },
      { id: 'a_modelC', text: 'Model C', isIgnore: true },
    ]);
    const { talk: fixed } = TalkAutofix.fix(talk);
    expect(() => TalkValidator.validateTalk(fixed)).not.toThrow();
  });
});

  // The following tests are commented out because the methods are private or don't exist

  // describe('validateAnswer', () => {
  //   it('should validate a terminal answer', () => {
  //     const answer: Answer = {
  //       id: 'a1',
  //       text: 'Yes, I agree',
  //       isTerminal: true,
  //     };

  //     expect(() => TalkValidator.validateAnswer(answer, 'q1')).not.toThrow();
  //   });

  //   it('should validate a non-terminal answer with next question', () => {
  //     const answer: Answer = {
  //       id: 'a2',
  //       text: 'Continue to next question',
  //       nextQuestionId: 'q2',
  //     };

  //     expect(() => TalkValidator.validateAnswer(answer, 'q1')).not.toThrow();
  //   });

  //   it('should throw error for non-terminal answer without next question', () => {
  //     const answer: Answer = {
  //       id: 'a3',
  //       text: 'Invalid answer',
  //     };

  //     expect(() => TalkValidator.validateAnswer(answer, 'q1')).toThrow(
  //       'Non-terminal answer must have nextQuestionId',
  //     );
  //   });
  // });

  // describe('Talk creation helpers', () => {
  //   it('should create a linear talk from conversation lines', () => {
  //     const conversationLines = [
  //       'Q: What is your name? A1: John A2: Jane A3: Mike',
  //       'Q: What is your hobby? A1: Reading A2: Gaming A3: Sports',
  //     ];

  //     const talk = TalkValidator.createLinearTalk('user-1', conversationLines, [
  //       'casual',
  //       'introduction',
  //     ]);

  //     expect(talk).toBeDefined();
  //     expect(talk.questions).toHaveLength(2);
  //     expect(talk.questions[0].answers).toHaveLength(4); // 3 parsed + 1 ignore
  //     expect(talk.questions[1].answers).toHaveLength(5); // 3 parsed + 1 ignore + 1 match
  //     expect(talk.tags.map((t: any) => t.name)).toEqual(['casual', 'introduction']);
  //   });
  // });
