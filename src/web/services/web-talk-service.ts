import { Talk, BulkSendJob, TargetScope } from '../../shared/types';
import { FlowCapture } from '../../shared/talk-engine';
import { WebGunService } from './web-gun-service';
import { v4 as uuidv4 } from 'uuid';
import { computeTalkIdFromTalkData } from '../../shared/talk-content-id';

export class WebTalkService {
  constructor(
    private gunService: WebGunService,
    /** When set, incomplete Gun reads fall back to GET this host + /api/talks/:id (server graph). */
    private apiBase?: string,
  ) {}

  /** Gun sometimes exposes arrays as { _isArray, _length, 0, 1, ... } after graph merge. */
  private normalizeAnswersArray(answers: any): any[] {
    if (Array.isArray(answers)) return answers;
    if (answers && typeof answers === 'object' && answers._isArray) {
      const alen = Number(answers._length) || 0;
      const ans: any[] = [];
      for (let j = 0; j < alen; j++) {
        if (Object.prototype.hasOwnProperty.call(answers, String(j))) ans.push(answers[String(j)]);
      }
      return ans;
    }
    if (answers && typeof answers === 'object') {
      const keys = Object.keys(answers).filter((k) => /^\d+$/.test(k));
      if (keys.length > 0) {
        return keys
          .map((k) => Number(k))
          .sort((a, b) => a - b)
          .map((i) => answers[String(i)]);
      }
    }
    return [];
  }

  private normalizeQuestion(qu: any): any {
    if (!qu || typeof qu !== 'object') return qu;
    return { ...qu, answers: this.normalizeAnswersArray(qu.answers) };
  }

  private normalizeTalkFromStorage(talk: any): Talk {
    if (!talk || typeof talk !== 'object') return talk as Talk;
    const q = talk.questions;
    if (Array.isArray(q)) {
      return { ...talk, questions: q.map((qu) => this.normalizeQuestion(qu)) } as Talk;
    }
    if (q && typeof q === 'object' && q._isArray) {
      const len = Number(q._length) || 0;
      const arr: any[] = [];
      for (let i = 0; i < len; i++) {
        if (!Object.prototype.hasOwnProperty.call(q, String(i))) continue;
        arr.push(this.normalizeQuestion(q[String(i)]));
      }
      return { ...talk, questions: arr } as Talk;
    }
    return talk as Talk;
  }

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
      usageCount: 0,
    };
    if (talkData.expiresAt != null) talk.expiresAt = talkData.expiresAt;
    if (talkData.locationRadiusMiles != null) talk.locationRadiusMiles = talkData.locationRadiusMiles;
    if (talkData.authorLocation != null) talk.authorLocation = talkData.authorLocation;

    talk.id = talkData.id || computeTalkIdFromTalkData(talk);

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
      const parsed = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data;
      return this.normalizeTalkFromStorage(parsed);
    } catch {
      return null;
    }
  }

  /** Prefer server graph (authoritative), then retry local Gun until full talk is available. */
  async getTalkWithRetry(
    talkId: string,
    opts?: { attempts?: number; gapMs?: number },
  ): Promise<Talk | null> {
    const attempts = opts?.attempts ?? 20;
    const gapMs = opts?.gapMs ?? 250;
    const looksComplete = (t: Talk | null): boolean => {
      if (!t) return false;
      // Tag talks have no questions; treat them as complete if they have a title and authorId
      if ((t as any).type === 'tag') return !!(t.title && t.authorId);
      if (!Array.isArray(t.questions) || t.questions.length === 0) return false;
      const q0 = t.questions[0];
      return !!(q0 && Array.isArray(q0.answers) && q0.answers.length > 0);
    };

    const tryServer = async (): Promise<Talk | null> => {
      const base = this.apiBase?.replace(/\/$/, '');
      if (!base) return null;
      try {
        const res = await fetch(`${base}/api/talks/${encodeURIComponent(talkId)}`);
        if (res.status === 202) return null;
        if (!res.ok) return null;
        const raw = await res.json();
        if (raw && typeof raw === 'object' && (raw as { pending?: boolean }).pending === true) {
          return null;
        }
        const normalized = this.normalizeTalkFromStorage(raw);
        return looksComplete(normalized) ? (normalized as Talk) : null;
      } catch {
        return null;
      }
    };

    // Prefer local Gun first; one HTTP fallback at the end (server returns 202 while replicating, not 404).
    for (let i = 0; i < attempts; i++) {
      const t = await this.getTalk(talkId);
      if (looksComplete(t)) return t as Talk;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, gapMs));
    }

    const last = await this.getTalk(talkId);
    if (looksComplete(last)) return last as Talk;
    const again = await tryServer();
    if (again) return again;
    return looksComplete(last) ? last : null;
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
    if (talkData.expiresAt !== undefined) updated.expiresAt = talkData.expiresAt;
    else if (existing.expiresAt != null) updated.expiresAt = existing.expiresAt;
    if (talkData.locationRadiusMiles !== undefined) updated.locationRadiusMiles = talkData.locationRadiusMiles;
    else if (existing.locationRadiusMiles != null) updated.locationRadiusMiles = existing.locationRadiusMiles;
    if (talkData.authorLocation !== undefined) updated.authorLocation = talkData.authorLocation;
    else if (existing.authorLocation != null) updated.authorLocation = existing.authorLocation;
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
    const parsed = FlowCapture.parseChatLine(message);
    if (parsed) {
      return { question: parsed.question, answers: parsed.answers };
    }
    return null;
  }
}
