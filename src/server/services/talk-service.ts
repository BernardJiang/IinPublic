import { Talk, Survey, Message, Match } from '../../shared/types';
import { TalkValidator } from '../../shared/talk-engine';
import { GunService } from './gun-service';
import { ReputationService } from './reputation-service';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { computeTalkCIDv1 } from '../../shared/cid';

export class TalkService {
  constructor(
    private gunService: GunService,
    private reputationService: ReputationService
  ) {}

  async createTalk(talkData: Partial<Talk>): Promise<Talk> {
    const talk: Talk = {
      id: '',
      title: talkData.title || '',
      authorId: talkData.authorId || '',
      type: talkData.type || 'flow',
      isAdult: talkData.isAdult || false,
      language: talkData.language || 'en',
      tags: talkData.tags || [],
      questions: talkData.questions || [],
      createdAt: new Date(),
      isTemplate: talkData.isTemplate || false,
      usageCount: 0
    };
    talk.id = talkData.id || await computeTalkCIDv1(talk);

    // Validate talk structure
    TalkValidator.validateTalk(talk);

    await this.gunService.put(`talks/${talk.id}`, talk);
    return talk;
  }

  async getSurveyResults(surveyId: string): Promise<Survey> {
    return await this.gunService.get(`surveys/${surveyId}`);
  }

  async processMessage(conversationId: string, senderId: string, messageText: string): Promise<Message> {
    const message: Message = {
      id: uuidv4(),
      senderId,
      text: messageText,
      isFromChatbot: false,
      timestamp: new Date(),
      readBy: []
    };

    await this.gunService.put(`conversations/${conversationId}/messages/${message.id}`, message);
    return message;
  }

  async processAnswer(
    conversationId: string,
    questionId: string,
    answerId: string,
    userId: string
  ): Promise<any> {
    const result: {
      conversationId: string;
      questionId: string;
      answerId: string;
      userId: string;
      isComplete: boolean;
      outcome: 'continue' | 'ignored' | 'match' | 'completed';
      talkId?: string;
      matchId?: string;
    } = {
      conversationId,
      questionId,
      answerId,
      userId,
      isComplete: false,
      outcome: 'continue'
    };

    await this.gunService.put(`conversations/${conversationId}/answers/${questionId}`, {
      answerId,
      userId,
      timestamp: new Date()
    });

    // Update reputation
    await this.reputationService.updateUserReputation(userId, 'question_answered');

    // Try to infer outcome (match / ignore / completed) from the Talk model
    try {
      // Load conversation metadata if it exists
      const rawConversation = await this.gunService
        .get(`conversations/${conversationId}`)
        .catch(() => undefined);

      let talkId: string | undefined;
      let participants: string[] | undefined;

      if (rawConversation) {
        if (rawConversation.data) {
          // Conversation stored as { data: JSON.stringify(conversationData) }
          try {
            const parsed = JSON.parse(rawConversation.data);
            talkId = parsed.talkId;
            participants = parsed.participants;
          } catch {
            // Ignore JSON parse errors and fall back
          }
        } else {
          talkId = rawConversation.talkId;
          participants = rawConversation.participants;
        }
      }

      if (!talkId) {
        // No talk metadata available, return basic result
        return result;
      }

      result.talkId = talkId;

      // Load the Talk; it might be stored directly or wrapped in { data }
      const rawTalk = await this.gunService.get(`talks/${talkId}`).catch(() => undefined);
      if (!rawTalk) {
        return result;
      }

      let talk: Talk | undefined;
      if (rawTalk.data) {
        try {
          talk = JSON.parse(rawTalk.data);
        } catch {
          // If parsing fails, fall back to rawTalk as-is
          talk = rawTalk as Talk;
        }
      } else {
        talk = rawTalk as Talk;
      }

      if (!talk || !Array.isArray(talk.questions)) {
        return result;
      }

      const question = talk.questions.find((q) => q.id === questionId);
      if (!question) {
        return result;
      }

      const answer = question.answers.find((a) => a.id === answerId);
      if (!answer) {
        return result;
      }

      // Derive outcome based on answer flags
      if (answer.isIgnore) {
        result.isComplete = true;
        result.outcome = 'ignored';
      } else if (answer.isMatch) {
        result.isComplete = true;
        result.outcome = 'match';
      } else if (answer.isTerminal) {
        result.isComplete = true;
        result.outcome = 'completed';
      }

      // If we have a match, persist a Match record and update conversation status / reputation
      if (result.outcome === 'match' && participants && participants.length >= 2) {
        const matchId = uuidv4();
        const match: Match = {
          id: matchId,
          userIds: participants,
          talkId,
          conversationId,
          matchedAt: new Date(),
          status: 'pending',
        };

        await this.gunService.put(`matches/${matchId}`, match);
        result.matchId = matchId;

        // Update conversation status if stored with structured data
        if (rawConversation && rawConversation.data) {
          try {
            const parsed = JSON.parse(rawConversation.data);
            parsed.status = 'matched';
            await this.gunService.put(`conversations/${conversationId}`, {
              data: JSON.stringify(parsed),
            });
          } catch {
            // If parsing fails, skip conversation status update
          }
        }

        // Update reputation for all participants
        await Promise.all(
          participants.map((participantId) =>
            this.reputationService.updateUserReputation(participantId, 'match_found'),
          ),
        );
      }
    } catch (error) {
      // Matching / outcome logic should never break core answer processing
      logger.error({ err: error }, 'Failed to process talk answer for matching logic');
    }

    return result;
  }
}