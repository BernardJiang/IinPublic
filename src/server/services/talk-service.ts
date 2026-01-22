import { Talk, BulkSendJob, TargetScope, Survey, Message } from '../../shared/types';
import { TalkValidator } from '../../shared/talk-engine';
import { GunService } from './gun-service';
import { ReputationService } from './reputation-service';
import { v4 as uuidv4 } from 'uuid';

export class TalkService {
  constructor(
    private gunService: GunService,
    private reputationService: ReputationService
  ) {}

  async createTalk(talkData: Partial<Talk>): Promise<Talk> {
    const talk: Talk = {
      id: talkData.id || uuidv4(),
      title: talkData.title || '',
      authorId: talkData.authorId || '',
      type: talkData.type || 'matching',
      isAdult: talkData.isAdult || false,
      language: talkData.language || 'en',
      tags: talkData.tags || [],
      questions: talkData.questions || [],
      createdAt: new Date(),
      isTemplate: talkData.isTemplate || false,
      usageCount: 0
    };

    // Validate talk structure
    TalkValidator.validateTalk(talk);

    await this.gunService.put(`talks/${talk.id}`, talk);
    return talk;
  }

  async sendBulkTalk(
    talkId: string,
    senderId: string,
    targetScope: TargetScope,
    maxRecipients: number
  ): Promise<BulkSendJob> {
    const job: BulkSendJob = {
      id: uuidv4(),
      talkId,
      senderId,
      targetScope,
      maxRecipients,
      sentCount: 0,
      inProgressCount: 0,
      matchedCount: 0,
      ignoredCount: 0,
      expiredCount: 0,
      status: 'pending',
      createdAt: new Date()
    };

    await this.gunService.put(`bulkJobs/${job.id}`, job);
    
    // Update reputation
    await this.reputationService.updateUserReputation(senderId, 'talk_sent');
    
    return job;
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
    const result = {
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

    return result;
  }
}