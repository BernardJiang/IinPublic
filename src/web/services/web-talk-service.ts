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
      usageCount: 0,
    };

    console.log('🔍 About to store Talk in Gun.js:', JSON.stringify(talk, null, 2));

    try {
      // Store Talk as JSON string to avoid Gun.js nested object issues
      const talkJson = JSON.stringify(talk);

      await this.gunService.put(`talks/${talk.id}`, {
        id: talk.id,
        data: talkJson,
        createdAt: talk.createdAt.toISOString(),
      });

      console.log('✅ Talk stored successfully in Gun.js as JSON string');
      return talk;
    } catch (error) {
      console.error('❌ Failed to store Talk in Gun.js:', error);
      throw new Error('Invalid data: ' + (error as Error).message);
    }
  }

  async getTalk(talkId: string): Promise<Talk | null> {
    try {
      const raw = await this.gunService.get(`talks/${talkId}`);
      if (!raw || !raw.data) return null;
      const talk = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data;
      return talk as Talk;
    } catch {
      return null;
    }
  }

  async updateTalk(talkId: string, talkData: Partial<Talk>): Promise<Talk> {
    const existing = await this.getTalk(talkId);
    if (!existing) {
      throw new Error(`Talk not found: ${talkId}`);
    }
    const updated: Talk = {
      ...existing,
      ...talkData,
      id: talkId,
      title: talkData.title ?? existing.title,
      authorId: existing.authorId,
      type: talkData.type ?? existing.type,
      isAdult: talkData.isAdult ?? existing.isAdult,
      language: talkData.language ?? existing.language,
      tags: talkData.tags ?? existing.tags,
      questions: talkData.questions ?? existing.questions,
      createdAt: existing.createdAt,
      isTemplate: talkData.isTemplate ?? existing.isTemplate,
      usageCount: existing.usageCount,
    };
    const talkJson = JSON.stringify(updated);
    await this.gunService.put(`talks/${talkId}`, {
      id: updated.id,
      data: talkJson,
      createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : (existing as any).createdAt,
    });
    return updated;
  }

  async sendBulkTalk(
    talkId: string,
    senderId: string,
    targetScope: TargetScope,
    maxRecipients: number,
  ): Promise<BulkSendJob> {
    const job: BulkSendJob = {
      id: uuidv4(),
      talkId: talkId,
      senderId: senderId,
      targetScope: targetScope,
      maxRecipients: maxRecipients,
      sentCount: 0,
      inProgressCount: 0,
      matchedCount: 0,
      ignoredCount: 0,
      expiredCount: 0,
      status: 'pending',
      createdAt: new Date(),
    };

    await this.gunService.put(`bulkJobs/${job.id}`, job);
    return job;
  }

  async processAnswer(
    conversationId: string,
    questionId: string,
    answerId: string,
    userId: string,
  ): Promise<any> {
    // Simplified implementation
    const result = {
      conversationId: conversationId,
      questionId: questionId,
      answerId: answerId,
      userId: userId,
      isComplete: false,
      outcome: 'continue',
    };

    await this.gunService.put(`conversations/${conversationId}/answers/${questionId}`, {
      answerId: answerId,
      userId: userId,
      timestamp: new Date(),
    });

    return result;
  }

  async sendMessage(conversationId: string, senderId: string, message: string): Promise<void> {
    await this.gunService.put(`conversations/${conversationId}/messages/${Date.now()}`, {
      senderId: senderId,
      message: message,
      timestamp: new Date(),
      isFromChatbot: false,
    });
  }

  checkForLinearCapture(message: string): any | null {
    const parsed = TalkLinearCapture.parseChatLine(message);
    if (parsed) {
      return { question: parsed.question, answers: parsed.answers };
    }
    return null;
  }
}
