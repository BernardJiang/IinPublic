import { Talk, Question, Answer } from './types';
import { TalkStructureError, ValidationError } from './errors';

export class TalkValidator {
  /**
   * Validates that a talk structure forms a DAG (no loops)
   */
  static validateDAGStructure(talk: Talk): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    for (const question of talk.questions) {
      if (!visited.has(question.id)) {
        if (this.hasCycleDFS(question, talk.questions, visited, recursionStack)) {
          throw new TalkStructureError(
            `Talk contains a loop starting from question: ${question.id}`,
            talk.id
          );
        }
      }
    }
  }
  
  private static hasCycleDFS(
    current: Question,
    allQuestions: Question[],
    visited: Set<string>,
    recursionStack: Set<string>
  ): boolean {
    visited.add(current.id);
    recursionStack.add(current.id);
    
    const nextQuestionIds = this.getNextQuestionIds(current);
    
    for (const nextId of nextQuestionIds) {
      const nextQuestion = allQuestions.find(q => q.id === nextId);
      if (!nextQuestion) continue;
      
      if (!visited.has(nextId)) {
        if (this.hasCycleDFS(nextQuestion, allQuestions, visited, recursionStack)) {
          return true;
        }
      } else if (recursionStack.has(nextId)) {
        return true; // Back edge found - cycle detected
      }
    }
    
    recursionStack.delete(current.id);
    return false;
  }
  
  private static getNextQuestionIds(question: Question): string[] {
    const nextIds: string[] = [];
    
    // Linear flow
    if (question.nextQuestionId) {
      nextIds.push(question.nextQuestionId);
    }
    
    // Branching logic
    if (question.branchingLogic) {
      for (const branch of question.branchingLogic) {
        nextIds.push(branch.nextQuestionId);
      }
    }
    
    // Answer-specific next questions
    for (const answer of question.answers) {
      if (answer.nextQuestionId) {
        nextIds.push(answer.nextQuestionId);
      }
    }
    
    return nextIds;
  }
  
  /**
   * Validates talk structure and content
   */
  static validateTalk(talk: Talk): void {
    if (!talk.title?.trim()) {
      throw new ValidationError('Talk title is required');
    }
    
    if (talk.questions.length === 0) {
      throw new ValidationError('Talk must have at least one question');
    }
    
    if (talk.questions.length > 20) {
      throw new ValidationError('Talk cannot have more than 20 questions');
    }
    
    // Validate each question
    for (const question of talk.questions) {
      this.validateQuestion(question);
    }
    
    // Validate DAG structure
    this.validateDAGStructure(talk);
    
    // Validate survey-specific rules
    if (talk.type === 'survey') {
      this.validateSurveyTalk(talk);
    }
  }
  
  private static validateQuestion(question: Question): void {
    if (!question.text?.trim()) {
      throw new ValidationError(`Question text is required for question ${question.id}`);
    }
    
    if (!question.text.endsWith('?')) {
      throw new ValidationError(`Question must end with '?' for question ${question.id}`);
    }
    
    if (question.answers.length === 0) {
      throw new ValidationError(`Question must have at least one answer: ${question.id}`);
    }
    
    if (question.answers.length > 10) {
      throw new ValidationError(`Question cannot have more than 10 answers: ${question.id}`);
    }
    
    // Ensure "Ignore" option is always available
    const hasIgnore = question.answers.some(a => a.isIgnore);
    if (!hasIgnore) {
      throw new ValidationError(`Question must have an "Ignore" option: ${question.id}`);
    }
    
    // Validate each answer
    for (const answer of question.answers) {
      this.validateAnswer(answer, question.id);
    }
  }
  
  private static validateAnswer(answer: Answer, questionId: string): void {
    if (!answer.text?.trim()) {
      throw new ValidationError(`Answer text is required for answer ${answer.id} in question ${questionId}`);
    }
    
    if (!answer.text.endsWith('.')) {
      throw new ValidationError(`Answer must end with '.' for answer ${answer.id} in question ${questionId}`);
    }
  }
  
  private static validateSurveyTalk(talk: Talk): void {
    const aggregatableQuestions = talk.questions.filter(q => q.isAggregatable);
    
    if (aggregatableQuestions.length === 0) {
      throw new ValidationError('Survey talk must have at least one aggregatable question');
    }
    
    if (talk.questions.length > 15) {
      throw new ValidationError('Survey talk cannot have more than 15 questions');
    }
  }
}

export class TalkLinearCapture {
  /**
   * Parses a chat line to extract question and answers
   * Format: "Question? Answer1; Answer2; ...; AnswerN."
   */
  static parseChatLine(line: string): { question: string; answers: string[] } | null {
    const trimmed = line.trim();
    
    // Must contain a question mark
    const questionIndex = trimmed.indexOf('?');
    if (questionIndex === -1) return null;
    
    const question = trimmed.substring(0, questionIndex + 1);
    const answersPart = trimmed.substring(questionIndex + 1).trim();
    
    // Split by semicolon and clean up
    const answers = answersPart
      .split(';')
      .map(a => a.trim())
      .filter((a: string) => a.length > 0)
      .map((a: string) => a.endsWith('.') ? a : a + '.');
    
    if (answers.length === 0) return null;
    
    return { question: question.trim(), answers };
  }
  
  /**
   * Converts a chat conversation to a linear talk
   */
  static createLinearTalk(
    userId: string,
    conversationLines: string[],
    tags: string[] = [],
    _location?: string
  ): Talk {
    const questions: Question[] = [];
    let questionIndex = 0;
    
    for (const line of conversationLines) {
      const parsed = this.parseChatLine(line);
      if (!parsed) continue;
      
      const questionId = `q_${questionIndex}`;
      const answers: Answer[] = [];
      
      // Add parsed answers
      for (let i = 0; i < parsed.answers.length; i++) {
        const answer: Answer = {
          id: `a_${questionIndex}_${i}`,
          text: parsed.answers[i],
          isTerminal: questionIndex === conversationLines.length - 1,
          isIgnore: false,
          isMatch: false
        };
        if (questionIndex < conversationLines.length - 1) {
          answer.nextQuestionId = `q_${questionIndex + 1}`;
        }
        answers.push(answer);
      }
      
      // Always add "Ignore" option
      answers.push({
        id: `a_${questionIndex}_ignore`,
        text: 'Ignore.',
        isIgnore: true,
        isTerminal: true
      });
      
      const question: Question = {
        id: questionId,
        text: parsed.question,
        answers
      };
      if (questionIndex < conversationLines.length - 1) {
        question.nextQuestionId = `q_${questionIndex + 1}`;
      }
      questions.push(question);
      
      questionIndex++;
    }
    
    // Add "Let's talk in person" to final question
    if (questions.length > 0) {
      const finalQuestion = questions[questions.length - 1];
      finalQuestion.answers.push({
        id: `a_final_match`,
        text: "Let's talk in person.",
        isMatch: true,
        isTerminal: true
      });
    }
    
    const talk: Talk = {
      id: `talk_${Date.now()}_${userId}`,
      title: 'Auto-captured Talk',
      authorId: userId,
      type: 'matching',
      isAdult: false,
      language: 'en',
      tags: tags.map((t: string) => ({ id: t, name: t, category: 'other' as const, popularity: 0 })),
      questions,
      createdAt: new Date(),
      isTemplate: true,
      usageCount: 0
    };
    
    // Validate the generated talk
    TalkValidator.validateTalk(talk);
    
    return talk;
  }
}