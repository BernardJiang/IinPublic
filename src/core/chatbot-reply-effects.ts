/** Portable chatbot orchestration; hosts provide graph reads, response transport and rendering. */
import { buildTalkIdentityKey } from '../shared/cid';
import { talkRevisionPairKey } from './talk-rules';
import type { ChatbotReplyDecision } from './chatbot-reply';

export type ChatbotDecisionWithAnswers = ChatbotReplyDecision & { answers?: any[] | null };

export type ChatbotReplyParams = {
  talkId: string;
  talkData: any;
  authorId: string;
  authorName: string;
};

export type ChatbotReplyEvent =
  | { type: 'skipped'; reason: string; talkId: string; authorId: string; retries?: number }
  | { type: 'passed'; talkId: string; authorId: string }
  | { type: 'triggered'; talkId: string; contentId: string; authorId: string; authorName: string };

export interface ChatbotReplyEffectsPorts {
  currentUserId(): string | undefined;
  decide(params: ChatbotReplyParams): Promise<ChatbotDecisionWithAnswers>;
  recordPass(params: ChatbotReplyParams): void;
  resolveAnswers(params: ChatbotReplyParams, graphAnswers: any[] | null): Promise<any[] | null>;
  submitAnswer(params: ChatbotReplyParams, answers: any[]): void;
  classifyOutcome(params: ChatbotReplyParams, answers: any[]): Promise<'match' | 'mismatch'>;
  recordAnswer(params: ChatbotReplyParams, answers: any[], outcome: 'match' | 'mismatch'): void;
  incomingRows(): Promise<Array<Record<string, any>>>;
  talkBody(talkId: string): Promise<Record<string, any> | null>;
  schedule(task: () => void, delayMs: number): void;
  onEvent?(event: ChatbotReplyEvent): void;
  onFailure?(error: unknown): void;
}

export type ChatbotReplyEffectsOptions = {
  fastRetries?: number;
  slowRetries?: number;
  fastDelayMs?: number;
  slowDelayMs?: number;
};

export class ChatbotReplyEffects {
  private readonly handledPairs = new Set<string>();
  private readonly retryCounts = new Map<string, number>();
  private readonly retryScheduled = new Set<string>();
  private readonly fastRetries: number;
  private readonly slowRetries: number;
  private readonly fastDelayMs: number;
  private readonly slowDelayMs: number;

  constructor(
    private readonly ports: ChatbotReplyEffectsPorts,
    options: ChatbotReplyEffectsOptions = {},
  ) {
    this.fastRetries = options.fastRetries ?? 20;
    this.slowRetries = options.slowRetries ?? 30;
    this.fastDelayMs = options.fastDelayMs ?? 500;
    this.slowDelayMs = options.slowDelayMs ?? 5_000;
  }

  private pairKey(talkId: string, authorId: string, talkData: any): string {
    return talkRevisionPairKey(talkId, authorId, talkData);
  }

  isHandled(talkId: string, authorId: string, talkData: any): boolean {
    return this.handledPairs.has(this.pairKey(talkId, authorId, talkData));
  }

  markHandled(talkId: string, authorId: string, talkData: any): void {
    const pairKey = this.pairKey(talkId, authorId, talkData);
    this.handledPairs.add(pairKey);
    this.retryCounts.delete(pairKey);
  }

  async reply(
    params: ChatbotReplyParams,
    known?: ChatbotDecisionWithAnswers,
  ): Promise<'answered' | 'passed' | 'waiting' | 'skipped' | 'failed'> {
    const pairKey = this.pairKey(params.talkId, params.authorId, params.talkData);
    const decision = known ?? await this.ports.decide(params);
    if (decision.act === 'skip') {
      if (decision.reason !== 'self') {
        this.ports.onEvent?.({
          type: 'skipped',
          reason: decision.reason,
          talkId: params.talkId,
          authorId: params.authorId,
        });
      }
      return 'skipped';
    }

    if (decision.act === 'pass') {
      this.markHandled(params.talkId, params.authorId, params.talkData);
      this.ports.recordPass(params);
      this.ports.onEvent?.({ type: 'passed', talkId: params.talkId, authorId: params.authorId });
      return 'passed';
    }

    if (decision.act === 'wait') {
      const retries = this.retryCounts.get(pairKey) ?? 0;
      const retryLimit = this.fastRetries + this.slowRetries;
      if (retries >= retryLimit) {
        this.retryCounts.delete(pairKey);
        this.ports.onEvent?.({
          type: 'skipped',
          reason: 'no reusable template',
          talkId: params.talkId,
          authorId: params.authorId,
          retries,
        });
        return 'skipped';
      }
      if (!this.retryScheduled.has(pairKey)) {
        this.retryCounts.set(pairKey, retries + 1);
        this.retryScheduled.add(pairKey);
        this.ports.schedule(() => {
          this.retryScheduled.delete(pairKey);
          void this.reply(params).catch((error) => this.ports.onFailure?.(error));
        }, retries < this.fastRetries ? this.fastDelayMs : this.slowDelayMs);
      }
      return 'waiting';
    }

    this.retryCounts.delete(pairKey);
    this.handledPairs.add(pairKey);
    this.ports.onEvent?.({
      type: 'triggered',
      talkId: params.talkId,
      contentId: decision.contentId,
      authorId: params.authorId,
      authorName: params.authorName,
    });
    const answered = await this.tryReply(params, decision.answers ?? null).catch((error) => {
      this.ports.onFailure?.(error);
      return false;
    });
    if (!answered) this.handledPairs.delete(pairKey);
    return answered ? 'answered' : 'failed';
  }

  async tryReply(params: ChatbotReplyParams, graphAnswers: any[] | null = null): Promise<boolean> {
    const answers = await this.ports.resolveAnswers(params, graphAnswers);
    if (!answers?.length || !this.ports.currentUserId()) return false;
    this.ports.submitAnswer(params, answers);
    const outcome = await this.ports.classifyOutcome(params, answers);
    this.ports.recordAnswer(params, answers, outcome);
    return true;
  }

  async answerSendersOfStarterTag(starterTalk: any): Promise<number> {
    const currentUserId = this.ports.currentUserId();
    if (!currentUserId) return 0;
    let identity: string;
    try {
      identity = buildTalkIdentityKey(starterTalk);
    } catch {
      return 0;
    }

    let answered = 0;
    const rows = await this.ports.incomingRows();
    for (const row of rows) {
      if (String(row?.identityKey || '') !== identity) continue;
      for (const sender of Object.values<any>(row?.senders ?? {})) {
        const authorId = String(sender?.senderId || '');
        const talkId = String(sender?.lastTalkId || '');
        if (!authorId || !talkId || authorId === currentUserId) continue;
        const body = await this.ports.talkBody(talkId);
        if (!body) continue;
        const outcome = await this.reply({
          talkId,
          talkData: { ...body, authorId },
          authorId,
          authorName: String(sender?.senderName || 'Unknown'),
        });
        if (outcome === 'answered' || outcome === 'passed') answered += 1;
      }
    }
    return answered;
  }
}
