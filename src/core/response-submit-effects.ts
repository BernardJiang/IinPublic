/** Responder-side orchestration for committing, fanning out and projecting a Talk answer. */
import { canonicalSerialize, computeResponseId } from '../shared/cid';
import type { P2PMeshTalkResponsePayload } from '../shared/p2p-mesh-protocol';
import { checkIfMatch } from '../shared/talk-engine';
import { firstKeyHint } from './pair-response-crypto';
import { isIgnoreAnswerSet, isResponseComplete } from './response-rules';
import { isDealEligibleTalk, matchScoreParamsFor } from './talk-rules';

export type ResponseSubmitParams = {
  talkId: string;
  localTalkId?: string;
  talkData: any;
  answers: any[];
  isChatbotResponse: boolean;
  authorId: string;
  authorName: string;
  isAutoResponse: boolean;
  releaseLine?: () => void;
};

export type AdditionalResponseTarget = {
  senderId: string;
  senderName: string;
  talkId: string;
};

export type ResponseSubmitEvent =
  | { type: 'incomplete'; talkId: string; answered: number }
  | { type: 'encryption-failed'; authorId: string; error: unknown }
  | { type: 'delivery-failed'; authorId: string; error: unknown }
  | { type: 'not-sent'; authorId: string; reason: string }
  | { type: 'sent'; talkId: string; authorId: string; version: number; sent: boolean }
  | { type: 'retracted'; talkId: string; authorId: string }
  | { type: 'fanout'; authorId: string };

export type ResponseCommitPortInput = {
  talkId: string;
  talkData: any;
  answers: any[];
  authorId: string;
  authorName: string;
  authorEpub?: string;
  responderId: string;
  responderEpub?: string;
  payloadCiphertext: string;
  submittedAt: string;
  selfTag?: string;
};

export interface ResponseSubmitEffectsPorts {
  currentUser(): { id: string; stageName: string; epub?: string } | undefined;
  acceptsAuthor(authorId: string): boolean;
  resolveSelfTag(talkData: any, answers: any[]): Promise<string | undefined>;
  shouldSkipDelivery(params: ResponseSubmitParams, isMatch: boolean): boolean;
  encrypt(authorId: string, content: {
    responderName: string;
    authorName: string;
    answers: any[];
    isChatbotResponse: boolean;
    transportMode: 'mesh-p2p';
  }, authorEpub?: string): Promise<string>;
  commit(input: ResponseCommitPortInput): Promise<{
    payload: P2PMeshTalkResponsePayload;
    isContentChange: boolean;
  }>;
  ensureGraphLinks(): Promise<void>;
  sendGraphAnswer(params: {
    talkId: string;
    authorId: string;
    answers: Array<{ questionId: string; answerId: string }>;
    mode: 'chatbot' | 'manual';
    context: {
      responderName: string;
      isChatbotResponse: boolean;
      responseId: string;
      version: number;
      submittedAt: string;
      respondedAt?: string;
    };
  }): Promise<{ sent: boolean; reason?: string }>;
  showExchangeActivity(authorId: string): void;
  recordDelivery(responseId: string, authorId: string): Promise<void>;
  isRetracted(talkId: string): Promise<boolean>;
  otherSenders(talkId: string, authorId: string): AdditionalResponseTarget[];
  refreshExchangeState(): Promise<unknown> | void;
  recordAnsweredLedger(params: {
    talkId: string;
    responseId: string;
    outcome: 'match' | 'ignore' | 'mismatch';
  }): void;
  answeredRow(talkData: any): string | undefined;
  recordExchange(params: {
    peerId: string;
    peerName: string;
    talkId: string;
    talkData: any;
    outcome: 'match' | 'mismatch';
    meta: {
      responseId: string;
      version: number;
      respondedAt: string;
      answers: any[];
      direction: 'received';
    };
  }): void;
  createConversation(params: {
    currentUserId: string;
    currentUserName: string;
    authorId: string;
    authorName: string;
    talkId: string;
    respondedByBot: boolean;
    dealEligible: boolean;
    matchScore?: number;
    matchTotal?: number;
  }): Promise<string>;
  recordNeed(conversationId: string, talkData: any): void;
  resolveResponderSourceTalkId(talkData: any, answers: any[]): Promise<string | undefined>;
  recordDealTalk(conversationId: string, talkId: string, talkData: any): void;
  showSafetyToast(): void;
  upsertConversation(view: {
    conversationId: string;
    otherUserId: string;
    otherUserName: string;
    talkId: string;
    respondedByBot: false;
    transportMode: unknown;
    dealEligible: boolean;
    matchScore?: number;
    matchTotal?: number;
  }): void;
  transportMode(): unknown;
  setMemberMatched(authorId: string): void;
  recordMatchLedger(params: { talkId: string; conversationId: string; otherUserId: string }): void;
  now?(): Date;
  onEvent?(event: ResponseSubmitEvent): void;
}

export class ResponseSubmitEffects {
  constructor(private readonly ports: ResponseSubmitEffectsPorts) {}

  async submit(params: ResponseSubmitParams): Promise<'ignored' | 'incomplete' | 'mismatch' | 'match'> {
    const currentUser = this.ports.currentUser();
    if (!currentUser?.id || !this.ports.acceptsAuthor(params.authorId)) return 'ignored';
    if (!isResponseComplete(params.talkData, params.answers)) {
      this.ports.onEvent?.({ type: 'incomplete', talkId: params.talkId, answered: params.answers.length });
      return 'incomplete';
    }

    const selfTag = await this.ports.resolveSelfTag(params.talkData, params.answers);
    const isMatch = checkIfMatch(params.talkData, params.answers, selfTag);
    const isIgnore = isIgnoreAnswerSet(params.answers);
    let responseId = await computeResponseId({
      talkId: params.talkId,
      responderId: currentUser.id,
      responseContentJson: canonicalSerialize(params.answers),
    });
    const submittedAt = (this.ports.now?.() ?? new Date()).toISOString();
    let isContentChange = false;
    let version = 1;
    const deliveries: Promise<void>[] = [];

    const sendToAuthor = async (
      authorId: string,
      authorName: string,
      authorEpub?: string,
      talkId = params.talkId,
    ): Promise<void> => {
      if (!this.ports.acceptsAuthor(authorId)) return;
      let payloadCiphertext: string;
      try {
        payloadCiphertext = await this.ports.encrypt(authorId, {
          responderName: currentUser.stageName,
          authorName,
          answers: params.answers,
          isChatbotResponse: params.isChatbotResponse,
          transportMode: 'mesh-p2p',
        }, authorEpub);
      } catch (error) {
        this.ports.onEvent?.({ type: 'encryption-failed', authorId, error });
        return;
      }
      const committed = await this.ports.commit({
        talkId,
        talkData: params.talkData,
        answers: params.answers,
        authorId,
        authorName,
        ...(authorEpub ? { authorEpub } : {}),
        responderId: currentUser.id,
        ...(currentUser.epub ? { responderEpub: currentUser.epub } : {}),
        payloadCiphertext,
        submittedAt,
        ...(selfTag ? { selfTag } : {}),
      });
      const targetResponseId = committed.payload.responseId;
      const targetVersion = committed.payload.version ?? 1;
      if (authorId === params.authorId) {
        responseId = targetResponseId;
        version = targetVersion;
        isContentChange = committed.isContentChange;
      }

      deliveries.push((async () => {
        await this.ports.ensureGraphLinks();
        const result = await this.ports.sendGraphAnswer({
          talkId,
          authorId,
          answers: params.answers.map((answer: any) => ({
            questionId: String(answer.questionId),
            answerId: String(answer.answerId),
          })),
          mode: params.isChatbotResponse ? 'chatbot' : 'manual',
          context: {
            responderName: currentUser.stageName,
            isChatbotResponse: params.isChatbotResponse,
            responseId: targetResponseId,
            version: targetVersion,
            submittedAt: committed.payload.submittedAt,
            ...(committed.payload.respondedAt
              ? { respondedAt: committed.payload.respondedAt }
              : {}),
          },
        }).catch((error) => {
          this.ports.onEvent?.({ type: 'delivery-failed', authorId, error });
          return { sent: false, reason: 'error' };
        });
        if (!result.sent) {
          this.ports.onEvent?.({ type: 'not-sent', authorId, reason: result.reason ?? 'unknown' });
        } else {
          this.ports.showExchangeActivity(authorId);
          await this.ports.recordDelivery(targetResponseId, authorId);
        }
        this.ports.onEvent?.({ type: 'sent', talkId, authorId, version: targetVersion, sent: result.sent });
      })().catch((error) => {
        this.ports.onEvent?.({ type: 'delivery-failed', authorId, error });
      }));
    };

    if (!this.ports.shouldSkipDelivery(params, isMatch)) {
      if (await this.ports.isRetracted(params.talkId)) {
        this.ports.onEvent?.({ type: 'retracted', talkId: params.talkId, authorId: params.authorId });
      } else {
        await sendToAuthor(
          params.authorId,
          params.authorName,
          firstKeyHint(params.talkData?.authorEpub, params.talkData?.senderEpub),
        );
      }
      if (isContentChange) {
        for (const target of this.ports.otherSenders(params.talkId, params.authorId)) {
          if (await this.ports.isRetracted(target.talkId)) {
            this.ports.onEvent?.({
              type: 'retracted',
              talkId: target.talkId,
              authorId: target.senderId,
            });
            continue;
          }
          this.ports.onEvent?.({ type: 'fanout', authorId: target.senderId });
          try {
            await sendToAuthor(
              target.senderId,
              target.senderName || 'Unknown',
              undefined,
              target.talkId,
            );
          } catch (error) {
            this.ports.onEvent?.({ type: 'delivery-failed', authorId: target.senderId, error });
          }
        }
      }
    }
    void this.ports.refreshExchangeState();
    this.ports.recordAnsweredLedger({
      talkId: params.talkId,
      responseId,
      outcome: isMatch ? 'match' : isIgnore ? 'ignore' : 'mismatch',
    });
    this.ports.recordExchange({
      peerId: params.authorId,
      peerName: params.authorName,
      talkId: params.localTalkId ?? this.ports.answeredRow(params.talkData) ?? params.talkId,
      talkData: params.talkData,
      outcome: isMatch ? 'match' : 'mismatch',
      meta: {
        responseId,
        version,
        respondedAt: submittedAt,
        answers: params.answers,
        direction: 'received',
      },
    });
    params.releaseLine?.();
    await Promise.all(deliveries);
    void this.ports.refreshExchangeState();
    if (!isMatch) return 'mismatch';

    const dealEligible = isDealEligibleTalk(params.talkData);
    const score = matchScoreParamsFor(params.talkData, params.answers);
    const conversationId = await this.ports.createConversation({
      currentUserId: currentUser.id,
      currentUserName: currentUser.stageName,
      authorId: params.authorId,
      authorName: params.authorName,
      talkId: params.talkId,
      respondedByBot: params.isChatbotResponse,
      dealEligible,
      ...score,
    });
    this.ports.recordNeed(conversationId, params.talkData);
    if (dealEligible) {
      const sourceTalkId = await this.ports.resolveResponderSourceTalkId(
        params.talkData,
        params.answers,
      );
      if (sourceTalkId) this.ports.recordDealTalk(conversationId, sourceTalkId, params.talkData);
    }
    this.ports.showSafetyToast();
    this.ports.upsertConversation({
      conversationId,
      otherUserId: params.authorId,
      otherUserName: params.authorName,
      talkId: params.talkId,
      respondedByBot: false,
      transportMode: this.ports.transportMode(),
      dealEligible,
      ...score,
    });
    this.ports.setMemberMatched(params.authorId);
    this.ports.recordMatchLedger({
      talkId: params.talkId,
      conversationId,
      otherUserId: params.authorId,
    });
    return 'match';
  }
}
