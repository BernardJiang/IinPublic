/** Author-side orchestration for an incoming answer to one of the current user's Talks. */
import type { P2PMeshTalkResponsePayload } from '../shared/p2p-mesh-protocol';
import type { OutcomeRecord } from './device-graph/exchanged';
import { decideResponseIngest } from './response-ingest';
import { isDealEligibleTalk, matchScoreParamsFor } from './talk-rules';

export type DecryptedTalkResponse = {
  answers: any[];
  responderName: string;
  isChatbotResponse: boolean;
};

export type ResponseIngestContext = {
  collectionSessionId?: string;
  answers?: any[];
  responderName?: string;
  isChatbotResponse?: boolean;
};

export type ResponseExchangeMeta = {
  responseId: string;
  version: number;
  respondedAt: string;
  answers: any[];
  collectionSessionId?: string;
};

export type ResponseIngestEvent =
  | { type: 'received'; payload: P2PMeshTalkResponsePayload }
  | { type: 'missing-talk'; payload: P2PMeshTalkResponsePayload }
  | { type: 'rejected'; payload: P2PMeshTalkResponsePayload; reason: string }
  | { type: 'unchanged'; payload: P2PMeshTalkResponsePayload; priorVersion: number; version: number };

export type MatchConversationInput = {
  currentUserId: string;
  currentUserName: string;
  responderId: string;
  responderName: string;
  talkId: string;
  respondedByBot: boolean;
  dealEligible: boolean;
  matchScore?: number;
  matchTotal?: number;
};

export type MatchConversationView = {
  conversationId: string;
  otherUserId: string;
  otherUserName: string;
  talkId: string;
  respondedByBot: boolean;
  transportMode: unknown;
  dealEligible: boolean;
  matchScore?: number;
  matchTotal?: number;
  changeOfMindAt?: string;
};

export interface ResponseIngestEffectsPorts {
  currentUser(): { id: string; stageName: string } | undefined;
  acceptsResponder(responderId: string): boolean;
  hasProcessed(key: string): boolean;
  markProcessed(key: string): void;
  resolveTalk(talkId: string): Promise<any | null>;
  decrypt(payload: P2PMeshTalkResponsePayload): Promise<DecryptedTalkResponse>;
  responseState(talkId: string, responderId: string): Promise<{
    prior: OutcomeRecord | null;
    retractedAt: number | null;
  }>;
  recordExchange(params: {
    peerId: string;
    peerName: string;
    talkId: string;
    talkData: any;
    outcome: 'match' | 'mismatch';
    meta: ResponseExchangeMeta;
  }): void;
  createConversation(input: MatchConversationInput): Promise<string>;
  recordDealTalk(conversationId: string, talkId: string, talkData: any): void;
  recordNeed(conversationId: string, talkData: any): void;
  showSafetyToast(): void;
  upsertConversation(view: MatchConversationView): void;
  transportMode(): unknown;
  showFirstMatch(params: { conversationId: string; responderName: string; talkTitle: string }): void;
  showNowMatch(params: { responderName: string; changedAt: string }): void;
  showNoLongerMatch(params: { responderName: string; changedAt: string }): void;
  markConversationEnded(responderId: string, talkId: string, changedAt: string): void;
  shareAttachments(params: {
    conversationId: string;
    talkId: string;
    authorId: string;
    responderId: string;
    responderName: string;
    talkData: any;
  }): Promise<void>;
  setMemberMatched(responderId: string): void;
  onEvent?(event: ResponseIngestEvent): void;
}

export class ResponseIngestEffects {
  constructor(private readonly ports: ResponseIngestEffectsPorts) {}

  private key(payload: P2PMeshTalkResponsePayload): string {
    return `mesh-response::${payload.talkId}::${payload.responseId}::v${payload.version ?? 1}`;
  }

  private async createMatch(
    payload: P2PMeshTalkResponsePayload,
    talkData: any,
    decrypted: DecryptedTalkResponse,
    changeOfMindAt?: string,
  ): Promise<string> {
    const currentUser = this.ports.currentUser();
    if (!currentUser) throw new Error('Current user is unavailable');
    const dealEligible = isDealEligibleTalk(talkData);
    const score = matchScoreParamsFor(talkData, decrypted.answers);
    const conversationId = await this.ports.createConversation({
      currentUserId: currentUser.id,
      currentUserName: currentUser.stageName,
      responderId: payload.responderId,
      responderName: decrypted.responderName,
      talkId: payload.talkId,
      respondedByBot: decrypted.isChatbotResponse,
      dealEligible,
      ...score,
    });
    this.ports.recordDealTalk(conversationId, payload.talkId, talkData);
    this.ports.recordNeed(conversationId, talkData);
    this.ports.showSafetyToast();
    this.ports.upsertConversation({
      conversationId,
      otherUserId: payload.responderId,
      otherUserName: decrypted.responderName,
      talkId: payload.talkId,
      respondedByBot: decrypted.isChatbotResponse,
      transportMode: this.ports.transportMode(),
      dealEligible,
      ...score,
      ...(changeOfMindAt ? { changeOfMindAt } : {}),
    });
    await this.ports.shareAttachments({
      conversationId,
      talkId: payload.talkId,
      authorId: currentUser.id,
      responderId: payload.responderId,
      responderName: decrypted.responderName,
      talkData,
    });
    this.ports.setMemberMatched(payload.responderId);
    return conversationId;
  }

  async ingest(
    payload: P2PMeshTalkResponsePayload,
    context: ResponseIngestContext = {},
  ): Promise<'ignored' | 'rejected' | 'mismatch' | 'match' | 'ended' | 'unchanged'> {
    const currentUser = this.ports.currentUser();
    if (!currentUser?.id || payload.authorId !== currentUser.id) return 'ignored';
    if (!this.ports.acceptsResponder(payload.responderId)) return 'ignored';

    this.ports.onEvent?.({ type: 'received', payload });
    const key = this.key(payload);
    if (this.ports.hasProcessed(key)) return 'ignored';
    const talkData = await this.ports.resolveTalk(payload.talkId);
    if (!talkData) {
      this.ports.onEvent?.({ type: 'missing-talk', payload });
      return 'ignored';
    }
    const decrypted = Array.isArray(context.answers)
      ? {
          answers: context.answers,
          responderName: context.responderName || payload.responderId,
          isChatbotResponse: context.isChatbotResponse === true,
        }
      : await this.ports.decrypt(payload);
    const state = await this.ports.responseState(payload.talkId, payload.responderId);
    const decision = decideResponseIngest({
      talkData,
      answers: decrypted.answers,
      ...(state.prior ? { prior: state.prior } : {}),
      ...(state.retractedAt !== null ? { retractedAt: state.retractedAt } : {}),
      responderId: payload.responderId,
      authorId: currentUser.id,
      talkId: payload.talkId,
      responseId: payload.responseId,
      ...(payload.version !== undefined ? { version: payload.version } : {}),
      ...(payload.respondedAt ? { respondedAt: payload.respondedAt } : {}),
      submittedAt: payload.submittedAt,
    });
    if (decision.kind === 'reject') {
      this.ports.onEvent?.({ type: 'rejected', payload, reason: decision.reason });
      return 'rejected';
    }

    this.ports.markProcessed(key);
    this.ports.recordExchange({
      peerId: payload.responderId,
      peerName: decrypted.responderName,
      talkId: payload.talkId,
      talkData,
      outcome: decision.isMatch ? 'match' : 'mismatch',
      meta: {
        responseId: payload.responseId,
        version: decision.version,
        respondedAt: decision.respondedAt,
        answers: decrypted.answers,
        ...(context.collectionSessionId ? { collectionSessionId: context.collectionSessionId } : {}),
      },
    });

    if (decision.kind === 'first') {
      if (!decision.isMatch) return 'mismatch';
      const conversationId = await this.createMatch(payload, talkData, decrypted);
      this.ports.showFirstMatch({
        conversationId,
        responderName: decrypted.responderName,
        talkTitle: String(talkData.title || 'Talk'),
      });
      return 'match';
    }
    if (decision.kind === 'now-match') {
      this.ports.showNowMatch({
        responderName: decrypted.responderName,
        changedAt: decision.respondedAt,
      });
      await this.createMatch(payload, talkData, decrypted, decision.respondedAt);
      return 'match';
    }
    if (decision.kind === 'no-longer-match') {
      this.ports.showNoLongerMatch({
        responderName: decrypted.responderName,
        changedAt: decision.respondedAt,
      });
      this.ports.markConversationEnded(
        payload.responderId,
        payload.talkId,
        decision.respondedAt,
      );
      return 'ended';
    }
    this.ports.onEvent?.({
      type: 'unchanged',
      payload,
      priorVersion: decision.priorVersion,
      version: decision.version,
    });
    return 'unchanged';
  }
}
