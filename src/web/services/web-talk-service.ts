import { Talk, BulkSendJob, TargetScope } from '../../shared/types';
import { TalkLinearCapture } from '../../shared/talk-engine';
import { WebGunService } from './web-gun-service';
import { v4 as uuidv4 } from 'uuid';

export class WebTalkService {
  constructor(private gunService: WebGunService) {}

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
    return job;
  }

  async processAnswer(
    conversationId: string,
    questionId: string,
    answerId: string,
    userId: string
  ): Promise<any> {
    // Simplified implementation
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

    return result;
  }

  async sendMessage(conversationId: string, senderId: string, message: string): Promise<void> {
    await this.gunService.put(`conversations/${conversationId}/messages/${Date.now()}`, {
      senderId,
      message,
      timestamp: new Date(),
      isFromChatbot: false
    });
  }

  checkForLinearCapture(message: string): any | null {
    const parsed = TalkLinearCapture.parseChatLine(message);
    return parsed ? { question: parsed.question, answers: parsed.answers } : null;
  }
}