import { TalkValidator } from '../../shared/talk-engine';
import { Talk, Question, Answer } from '../../shared/types';

describe('TalkValidator', () => {
  describe('validateTalkStructure', () => {
    it('should validate a simple linear talk', () => {
      const talk: Talk = {
        id: 'test-talk-1',
        title: 'Simple Talk',
        authorId: 'user-1',
        type: 'matching',
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
                nextQuestionId: 'q2'
              },
              {
                id: 'a2',
                text: 'Sports',
                nextQuestionId: 'q2'
              }
            ]
          },
          {
            id: 'q2',
            text: 'How often do you practice it?',
            answers: [
              {
                id: 'a3',
                text: 'Daily',
                isTerminal: true
              },
              {
                id: 'a4',
                text: 'Weekly',
                isTerminal: true
              }
            ]
          }
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0
      };

      expect(() => TalkValidator.validateTalkStructure(talk)).not.toThrow();
    });

    it('should throw error for talk with loops', () => {
      const talk: Talk = {
        id: 'test-talk-2',
        title: 'Loop Talk',
        authorId: 'user-1',
        type: 'matching',
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
                nextQuestionId: 'q2'
              }
            ]
          },
          {
            id: 'q2',
            text: 'Question 2',
            answers: [
              {
                id: 'a2',
                text: 'Answer 2',
                nextQuestionId: 'q1' // Creates a loop
              }
            ]
          }
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0
      };

      expect(() => TalkValidator.validateTalkStructure(talk)).toThrow('Circular dependency detected');
    });

    it('should throw error for talk with missing question references', () => {
      const talk: Talk = {
        id: 'test-talk-3',
        title: 'Missing Reference Talk',
        authorId: 'user-1',
        type: 'matching',
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
                nextQuestionId: 'q999' // Non-existent question
              }
            ]
          }
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0
      };

      expect(() => TalkValidator.validateTalkStructure(talk)).toThrow('Question q999 not found');
    });

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
                nextQuestionId: 'q2'
              },
              {
                id: 'a2',
                text: '18-25',
                nextQuestionId: 'q3'
              },
              {
                id: 'a3',
                text: 'Over 25',
                nextQuestionId: 'q4'
              }
            ],
            isAgeGate: true
          },
          {
            id: 'q2',
            text: 'What grade are you in?',
            answers: [
              { id: 'a4', text: 'High School', isTerminal: true },
              { id: 'a5', text: 'Middle School', isTerminal: true }
            ]
          },
          {
            id: 'q3',
            text: 'Are you in college?',
            answers: [
              { id: 'a6', text: 'Yes', isTerminal: true },
              { id: 'a7', text: 'No', isTerminal: true }
            ]
          },
          {
            id: 'q4',
            text: 'What is your profession?',
            answers: [
              { id: 'a8', text: 'Engineer', isTerminal: true },
              { id: 'a9', text: 'Teacher', isTerminal: true },
              { id: 'a10', text: 'Other', isTerminal: true }
            ]
          }
        ],
        createdAt: new Date(),
        isTemplate: false,
        usageCount: 0
      };

      expect(() => TalkValidator.validateTalkStructure(talk)).not.toThrow();
    });
  });

  describe('validateAnswer', () => {
    it('should validate a terminal answer', () => {
      const answer: Answer = {
        id: 'a1',
        text: 'Yes, I agree',
        isTerminal: true
      };

      expect(() => TalkValidator.validateAnswer(answer)).not.toThrow();
    });

    it('should validate a non-terminal answer with next question', () => {
      const answer: Answer = {
        id: 'a2',
        text: 'Continue to next question',
        nextQuestionId: 'q2'
      };

      expect(() => TalkValidator.validateAnswer(answer)).not.toThrow();
    });

    it('should throw error for non-terminal answer without next question', () => {
      const answer: Answer = {
        id: 'a3',
        text: 'Invalid answer'
      };

      expect(() => TalkValidator.validateAnswer(answer)).toThrow('Non-terminal answer must have nextQuestionId');
    });
  });

  describe('Talk creation helpers', () => {
    it('should create a linear talk from conversation lines', () => {
      const conversationLines = [
        'Q: What is your name? A1: John A2: Jane A3: Mike',
        'Q: What is your hobby? A1: Reading A2: Gaming A3: Sports'
      ];

      const talk = TalkValidator.createLinearTalk(
        'user-1',
        conversationLines,
        ['casual', 'introduction']
      );

      expect(talk).toBeDefined();
      expect(talk.questions).toHaveLength(2);
      expect(talk.questions[0].answers).toHaveLength(4); // 3 parsed + 1 ignore
      expect(talk.questions[1].answers).toHaveLength(5); // 3 parsed + 1 ignore + 1 match
      expect(talk.tags.map(t => t.name)).toEqual(['casual', 'introduction']);
    });
  });
});