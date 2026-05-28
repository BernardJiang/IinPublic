import { Talk, BulkSendJob, TargetScope, type Question } from '../../shared/types';
import { FlowCapture } from '../../shared/talk-engine';
import { WebGunService } from './web-gun-service';
import { v4 as uuidv4 } from 'uuid';
import { computeTalkIdFromTalkData } from '../../shared/talk-content-id';
import { computeCIDv1 } from '../../shared/cid';

export class WebTalkService {
  constructor(
    private gunService: WebGunService,
    /** When set, incomplete Gun reads fall back to GET this host + /api/talks/:id (server graph). */
    private apiBase?: string,
  ) {}

  /**
   * Compute a stable CIDv1 content hash for each question in the talk.
   * Only stable content (text + answer ids/texts) is hashed; routing fields
   * (next, isMatch, isIgnore, isTerminal, branchingLogic) are excluded so that
   * routing-only edits don't break the per-question chatbot answer cache.
   *
   * Updates each question in-place and returns the array.
   */
  private async stampQuestionCids(questions: Question[]): Promise<Question[]> {
    return Promise.all(
      questions.map(async (q) => {
        const stable = {
          text: q.text,
          answers: (q.answers || []).map((a) => ({ id: a.id, text: a.text })),
        };
        const cidId = await computeCIDv1(stable);
        return { ...q, cidId };
      }),
    );
  }

  /** Gun sometimes exposes arrays as wrapped objects after graph merge. */
  private normalizeAnswersArray(answers: any): any[] {
    if (Array.isArray(answers)) return answers;
    if (answers && typeof answers === 'object' && (answers._isArray || answers.isArray)) {
      const alen = Number(answers._length ?? answers.length) || 0;
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
    if (q && typeof q === 'object' && (q._isArray || q.isArray)) {
      const len = Number(q._length ?? q.length) || 0;
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

    // Stamp each question with a CIDv1 content hash (excludes routing fields)
    talk.questions = await this.stampQuestionCids(talk.questions);

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

  /** Server is authoritative for complete talk data; Gun is used as a low-latency cache. */
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
        // 202 means the server is still replicating — not a permanent failure
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

    // 1. Quick Gun cache check — no wait.
    const cached = await this.getTalk(talkId);
    if (looksComplete(cached)) return cached as Talk;

    // 2. Server is authoritative; try it before entering the retry loop.
    const fromServer = await tryServer();
    if (fromServer) return fromServer;

    // 3. Both sources are incomplete (server returned 202 or Gun is still replicating).
    //    Retry, preferring Gun (lower latency) then server (completeness), until one delivers.
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, gapMs));
      const t = await this.getTalk(talkId);
      if (looksComplete(t)) return t as Talk;
      const s = await tryServer();
      if (s) return s;
    }

    return null;
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
    // Re-stamp CIDs on edit so routing-only changes don't affect cidId
    updated.questions = await this.stampQuestionCids(updated.questions);
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

  async submitTalkResponse(params: {
    talkId: string;
    responderId: string;
    responderName: string;
    answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }>;
    talkData?: unknown;
    isAuto?: boolean;
    isChatbotResponse?: boolean;
  }): Promise<{
    isMatch: boolean;
    identityKey: string;
    matchedCount: number;
    matches: Array<{ senderId: string; senderName: string; conversationId: string; talkId: string }>;
    conversationId: string | null;
    otherUserId: string | null;
    otherUserName: string | null;
  }> {
    const base = this.apiBase?.replace(/\/$/, '');
    if (!base) {
      throw new Error('submitTalkResponse requires apiBase');
    }
    const res = await fetch(`${base}/api/talks/${encodeURIComponent(params.talkId)}/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      throw new Error(`submitTalkResponse failed: ${res.status}`);
    }
    return res.json();
  }

  async sendMessage(conversationId: string, senderId: string, message: string): Promise<void> {
    await this.gunService.put(`conversations/${conversationId}/messages/${Date.now()}`, {
      senderId: senderId,
      message: message,
      timestamp: new Date(),
      isFromChatbot: false,
    });
  }

  /**
   * STAT-01 — generic stats inquiry across all four talk types.
   * Forwards to the server aggregation endpoint that matches {@link dimension}.
   */
  async queryStats(
    talkId: string,
    dimension: 'summary' | 'by-day' | 'by-region' | 'by-answer',
    params?: { questionId?: string; from?: number; to?: number; bucket?: 'day' | 'week' | 'month' },
  ): Promise<any> {
    const base = this.apiBase?.replace(/\/$/, '');
    if (!base) throw new Error('queryStats requires apiBase');
    const q = new URLSearchParams();
    if (params?.questionId) q.set('questionId', params.questionId);
    if (params?.from != null) q.set('from', String(params.from));
    if (params?.to != null) q.set('to', String(params.to));
    if (params?.bucket) q.set('bucket', params.bucket);
    const qs = q.toString();
    const url = `${base}/api/stats/talks/${encodeURIComponent(talkId)}/${dimension}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`queryStats ${dimension} failed: ${res.status}`);
    return res.json();
  }

  checkForLinearCapture(message: string): any | null {
    const parsed = FlowCapture.parseChatLine(message);
    if (parsed) {
      return { question: parsed.question, answers: parsed.answers };
    }
    return null;
  }
}
