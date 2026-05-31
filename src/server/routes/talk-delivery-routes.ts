import type express from 'express';
import { checkIfIgnore, checkIfMatch } from '../../shared/talk-engine';
import { buildTalkIdentityKey, canonicalIdentityKeyFromStoredCluster } from '../../shared/cid';
import { computeCIDv1 } from '../../shared/cid';
import { TALK_CONTENT_HASH_ID } from '../../shared/incoming-talk-ids';
import {
  getDefaultTalkIntakeFilters,
  intakeFilterRejectReasons,
  subjectTextMatchesBlockedTerms,
} from '../../shared/talk-intake-filters';
import type { TalkType } from '../../shared/talk-stats';
import type { GPSCoordinate, TalkIntakeFilters } from '../../shared/types';
import { appendBulkBroadcastDeliveryRejections } from '../../shared/bulk-broadcast-audience';
import { logger } from '../logger';
import { GunService } from '../services/gun-service';
import type { SymmetricTalkEdgeRateLimiter } from '../services/symmetric-talk-edge-rate-limit';
import type { DailyWeeklyTalkEdgeQuotaRateLimiter } from '../services/daily-weekly-talk-edge-quota-rate-limit';
import {
  findAutoAnswer,
  type ExactChatbotMemoryState,
} from '../../shared/exact-chatbot-memory';
import {
  readExactChatbotMemoryForUser,
  writeExactChatbotMemoryForUser,
} from '../exact-chatbot-memory-store';
import { resolveP2PRuntimeFlags, usesDirectTalkDelivery } from '../../shared/p2p-runtime';

type TalkDeliveryRouteDeps = {
  gunService: GunService;
  incomingTalksMap: Map<string, Map<string, any>>;
  loadTalkDataFromGraphOrBody: (talkId: string, bodyTalkData?: unknown) => Promise<any | null>;
  getUserStageName: (userId: string, fallback: string) => Promise<string>;
  upsertIncomingTalkForUser: (params: {
    receiverId: string;
    talkId: string;
    talkData: any;
    senderId: string;
    senderName: string;
  }) => Promise<{ identityKey: string }>;
  mapTemplateEntriesToTalk: (entries: any[], talkData: any) => any[];
  fanoutResponseToSenders: (params: {
    talkData: any;
    sourceTalkId: string;
    responderId: string;
    responderName: string;
    answers: any[];
    senders: Array<{ senderId: string; senderName: string; talkId: string }>;
    isChatbotResponse: boolean;
    storeOnSourceTalk: boolean;
  }) => Promise<any[]>;
  normalizeSubmittedAnswersForTalk: (talkData: any, answers: any[]) => any[];
  getClusterSenders: (params: {
    responderId: string;
    identityKey: string;
    fallbackTalkId: string;
    fallbackSenderId?: string;
  }) => Promise<any[]>;
  deriveIsAutoAnswerSet: (
    answers: Array<{ mode?: string }>,
    explicitIsAuto?: boolean,
    isChatbotResponse?: boolean,
  ) => boolean;
  buildAnswerTemplateEntries: (talkData: any, answers: any[]) => any[];
  saveUserAnswerTemplateByContent: (params: {
    responderId: string;
    responderName: string;
    identityKey: string;
    language: string;
    answers: any[];
    templateEntries: any[];
    isAuto: boolean;
  }) => Promise<void>;
  getUserRegion: (userId: string) => Promise<string>;
  getUserDeliveryContext: (userId: string) => Promise<{
    talkFilters: TalkIntakeFilters;
    ageVerified: boolean;
    location?: GPSCoordinate;
    interestTokens: string[];
  }>;
  getBlockStatus: (viewerId: string, targetId: string) => Promise<{
    blocked: boolean;
    blockedBy: boolean;
    eitherBlocked: boolean;
  }>;
  getSenderBulkSendCapacity: (senderId: string) => Promise<number>;
  recordTalkStatsResponse: (params: {
    talkId: string;
    talkType: TalkType;
    responderId: string;
    region: string;
    answers: Array<{ questionId: string; answerId: string; answerText: string }>;
    outcome?: 'match' | 'ignore' | 'other';
    isAuto?: boolean;
  }) => Promise<void>;
  /** When set, incremented once per valid register-receivers call that includes targeting tags */
  recordBroadcastTargetTagUses?: (tagStrings: string[]) => void;
  /** Server-wide substring blocklist (`IINPUBLIC_SERVER_BLOCKED_TERMS`). */
  getServerBlockedTerms?: () => string[];
  symmetricTalkEdgeLimiter?: SymmetricTalkEdgeRateLimiter;
  dailyWeeklyTalkEdgeQuotaRateLimiter?: DailyWeeklyTalkEdgeQuotaRateLimiter;
};

export function registerTalkDeliveryRoutes(app: express.Application, deps: TalkDeliveryRouteDeps): void {
  const {
    gunService,
    incomingTalksMap,
    loadTalkDataFromGraphOrBody,
    getUserStageName,
    upsertIncomingTalkForUser,
    mapTemplateEntriesToTalk,
    fanoutResponseToSenders,
    normalizeSubmittedAnswersForTalk,
    getClusterSenders,
    deriveIsAutoAnswerSet,
    buildAnswerTemplateEntries,
    saveUserAnswerTemplateByContent,
    getUserRegion,
    getUserDeliveryContext,
    getBlockStatus,
    getSenderBulkSendCapacity,
    recordTalkStatsResponse,
    recordBroadcastTargetTagUses,
    getServerBlockedTerms,
    symmetricTalkEdgeLimiter,
    dailyWeeklyTalkEdgeQuotaRateLimiter,
  } = deps;

  function mapExactMemoryToTalk(
    exactMemory: ExactChatbotMemoryState,
    receiverId: string,
    talkData: any,
  ): Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }> | null {
    const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
    if (questions.length === 0) return null;

    const byId = new Map<string, any>();
    questions.forEach((question: any) => {
      if (question?.id) byId.set(String(question.id), question);
    });

    const answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }> = [];
    const languageContext = { language: String(talkData?.language || 'en').toLowerCase() };
    let question = questions[0];
    const seen = new Set<string>();

    while (question && !seen.has(String(question.id))) {
      seen.add(String(question.id));
      const optionTexts = (Array.isArray(question.answers) ? question.answers : []).map((answer: any) =>
        String(answer?.text || ''),
      );
      const result = findAutoAnswer(
        exactMemory,
        receiverId,
        String(question.text || ''),
        optionTexts,
        undefined,
        languageContext,
      );
      if (result.action === 'SKIP') {
        return [];
      }
      if (result.action !== 'ANSWER' || !result.answerText) {
        return null;
      }

      const selected = (Array.isArray(question.answers) ? question.answers : []).find(
        (answer: any) => String(answer?.text || '').trim() === result.answerText,
      );
      if (!selected?.id || selected.isIgnore) {
        return [];
      }

      answers.push({
        questionId: question.id,
        answerId: selected.id,
        answerText: selected.text,
        isChecked: selected.isMatch === true,
        mode: 'auto',
      });

      if (selected.isMatch || selected.isTerminal) {
        break;
      }
      if (selected.nextQuestionId) {
        question = byId.get(String(selected.nextQuestionId));
        continue;
      }
      if (talkData?.type === 'survey') {
        const idx = questions.findIndex((candidate: any) => candidate?.id === question.id);
        question = idx >= 0 ? questions[idx + 1] : undefined;
        continue;
      }
      break;
    }

    return answers.length > 0 ? answers : null;
  }

  function filterReasonsForTalk(
    talkData: any,
    context: {
      talkFilters: TalkIntakeFilters;
      ageVerified: boolean;
      location?: GPSCoordinate;
      interestTokens: string[];
    },
  ): string[] {
    const expiresAtValue = talkData?.expiresAt;
    const expiresAt = typeof expiresAtValue === 'number'
      ? expiresAtValue
      : typeof expiresAtValue === 'string'
        ? new Date(expiresAtValue).getTime()
        : Number.NaN;
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      return ['talk_expired'];
    }

    const reasons: string[] = [];
    const subject = {
      title: talkData?.title,
      type: talkData?.type,
      language: talkData?.language,
      createdAt: talkData?.createdAt,
      updatedAt: talkData?.updatedAt ?? talkData?.createdAt,
      authorLocation: talkData?.authorLocation,
      questions: Array.isArray(talkData?.questions) ? talkData.questions : [],
      questionsJson: typeof talkData?.questionsJson === 'string' ? talkData.questionsJson : undefined,
      isAdult: !!talkData?.isAdult,
    };
    reasons.push(...intakeFilterRejectReasons(subject, context.talkFilters, context.location));
    const serverTerms = getServerBlockedTerms?.() ?? [];
    if (serverTerms.length > 0 && subjectTextMatchesBlockedTerms(subject, serverTerms)) {
      reasons.push('moderation_server_terms');
    }
    if (talkData?.isAdult && !context.ageVerified) {
      reasons.push('age_gate');
    }
    return reasons;
  }

  async function resolveBulkSenderPivot(senderId: string, talkData: any): Promise<
    | {
        latitude: number;
        longitude: number;
      }
    | undefined
  > {
    const snd = await getUserDeliveryContext(senderId);
    if (snd.location) {
      return { latitude: snd.location.latitude, longitude: snd.location.longitude };
    }
    const a = talkData?.authorLocation;
    if (
      a &&
      typeof a.latitude === 'number' &&
      typeof a.longitude === 'number' &&
      Number.isFinite(a.latitude) &&
      Number.isFinite(a.longitude)
    ) {
      return { latitude: a.latitude, longitude: a.longitude };
    }
    return undefined;
  }

  function parseBulkBroadcastTargetTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x: unknown) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x: string) => x.length > 0);
  }

  function parseBulkBroadcastMaxDistanceMiles(raw: unknown): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
    return Math.min(Math.floor(raw), 12_451);
  }

  function addRejectionCounts(target: Record<string, number>, reasons: readonly string[]): void {
    for (const reason of reasons) {
      target[reason] = (target[reason] || 0) + 1;
    }
  }

  app.get('/api/test/exact-chatbot-memory/:userId', async (req, res) => {
    try {
      const userId = String(req.params.userId || '');
      if (!userId) {
        res.status(400).json({ error: 'userId required' });
        return;
      }
      const memory = await readExactChatbotMemoryForUser(gunService, userId);
      res.json({ userId, memory: memory || null });
    } catch (error) {
      logger.error({ err: error }, 'Error reading exact chatbot memory');
      res.status(500).json({ error: (error as Error).message });
    }
  });

  async function computeBulkRejectionsForReceiver(
    receiverId: string,
    senderId: string,
    talkData: any,
    broadcastTargetTags: string[],
    broadcastMaxDistanceMiles: number | undefined,
    senderPivot: { latitude: number; longitude: number } | undefined,
  ): Promise<string[]> {
    let receiverContext: Awaited<ReturnType<typeof getUserDeliveryContext>>;
    try {
      receiverContext = await getUserDeliveryContext(receiverId);
    } catch (error) {
      logger.warn(
        { err: error, receiverId, senderId },
        '[register-receivers] receiver delivery context unavailable; using permissive fallback',
      );
      receiverContext = {
        talkFilters: getDefaultTalkIntakeFilters([String(talkData?.language || 'en')]),
        ageVerified: false,
        interestTokens: [],
      };
    }
    const rejectedBy = filterReasonsForTalk(talkData, receiverContext);
    const talkTagsArr = Array.isArray((talkData as { tags?: unknown })?.tags)
      ? (talkData as { tags: any[] }).tags
      : [];
    appendBulkBroadcastDeliveryRejections(rejectedBy, {
      broadcastTargetTags,
      receiverInterestTokens: receiverContext.interestTokens,
      ...(talkTagsArr.length > 0 ? { talkTags: talkTagsArr } : {}),
      ...(typeof broadcastMaxDistanceMiles === 'number' && broadcastMaxDistanceMiles > 0
        ? { broadcastMaxDistanceMiles }
        : {}),
      ...(senderPivot ? { senderPivot } : {}),
      ...(receiverContext.location ? { receiverLocation: receiverContext.location } : {}),
    });
    let blockStatus: Awaited<ReturnType<typeof getBlockStatus>>;
    try {
      blockStatus = await getBlockStatus(receiverId, senderId);
    } catch (error) {
      logger.warn(
        { err: error, receiverId, senderId },
        '[register-receivers] block status unavailable; assuming unblocked',
      );
      blockStatus = { blocked: false, blockedBy: false, eitherBlocked: false };
    }
    if (blockStatus.eitherBlocked) {
      rejectedBy.push('blocked_user');
    }
    return rejectedBy;
  }

  app.post('/api/talks/broadcast-receiver-preview', async (req, res) => {
    try {
      const { senderId, receiverIds, talkId, talkData: bodyTalkData, broadcastTargetTags: rawBt, broadcastMaxDistanceMiles: rawMaxDm } =
        req.body as {
          senderId: string;
          receiverIds: string[];
          talkId?: string;
          talkData?: unknown;
          broadcastTargetTags?: unknown;
          broadcastMaxDistanceMiles?: unknown;
        };
      const broadcastTargetTags = parseBulkBroadcastTargetTags(rawBt);
      const broadcastMaxDistanceMiles = parseBulkBroadcastMaxDistanceMiles(rawMaxDm);
      if (!senderId || !Array.isArray(receiverIds)) {
        res.status(400).json({ error: 'senderId and receiverIds[] required' });
        return;
      }
      let talkData: any | null = null;
      const tidRaw = typeof talkId === 'string' ? talkId.trim() : '';
      if (tidRaw) {
        talkData = await loadTalkDataFromGraphOrBody(tidRaw, bodyTalkData);
      } else if (bodyTalkData && typeof bodyTalkData === 'object') {
        talkData = bodyTalkData as any;
      }
      if (!talkData) {
        res.status(404).json({ error: 'talkId or embedded talk payload required for preview' });
        return;
      }
      if (String(talkData?.authorId) !== String(senderId)) {
        res.status(403).json({ error: 'senderId must match talk author' });
        return;
      }
      const senderCapacityRaw = await getSenderBulkSendCapacity(senderId);
      const senderCapacity = Math.max(0, Number.isFinite(senderCapacityRaw) ? Math.floor(senderCapacityRaw) : 0);
      const uniqueReceiverIds = Array.from(new Set(receiverIds.filter((id) => !!id && id !== senderId)));
      if (senderCapacity === 0) {
        res.json({
          totalCandidates: uniqueReceiverIds.length,
          cappedPoolSize: 0,
          eligibleReceivers: 0,
          eligibleReceiverIds: [],
          senderCapacity,
          capacityDropped: uniqueReceiverIds.length,
          rejectedByCounts: uniqueReceiverIds.length > 0 ? { sender_capacity: uniqueReceiverIds.length } : {},
          rejectedReceivers: uniqueReceiverIds.map((receiverId) => ({
            receiverId,
            rejectedBy: ['sender_capacity'],
          })),
        });
        return;
      }
      const receiverIdsCapped = uniqueReceiverIds.slice(0, senderCapacity);
      const capacityDropped = Math.max(0, uniqueReceiverIds.length - receiverIdsCapped.length);
      const senderPivot = await resolveBulkSenderPivot(senderId, talkData);
      const nowPrev = Date.now();
      const senderColdForPreview =
        !symmetricTalkEdgeLimiter ||
        symmetricTalkEdgeLimiter.cooldownMs <= 0 ||
        symmetricTalkEdgeLimiter.isCold(senderId, nowPrev);
      let eligibleReceivers = 0;
      const eligibleReceiverIds: string[] = [];
      const rejectedReceivers: Array<{ receiverId: string; rejectedBy: string[] }> = uniqueReceiverIds
        .slice(senderCapacity)
        .map((receiverId) => ({ receiverId, rejectedBy: ['sender_capacity'] }));
      const rejectedByCounts: Record<string, number> = {};
      if (capacityDropped > 0) rejectedByCounts.sender_capacity = capacityDropped;
      for (const receiverId of receiverIdsCapped) {
        const rejectedBy = await computeBulkRejectionsForReceiver(
          receiverId,
          senderId,
          talkData,
          broadcastTargetTags,
          broadcastMaxDistanceMiles,
          senderPivot,
        );
        if (rejectedBy.length > 0) {
          addRejectionCounts(rejectedByCounts, rejectedBy);
          rejectedReceivers.push({ receiverId, rejectedBy });
          continue;
        }
        if (!senderColdForPreview) {
          addRejectionCounts(rejectedByCounts, ['symmetric_rate_limit']);
          rejectedReceivers.push({ receiverId, rejectedBy: ['symmetric_rate_limit'] });
          continue;
        }
        if (
          symmetricTalkEdgeLimiter &&
          symmetricTalkEdgeLimiter.cooldownMs > 0 &&
          !symmetricTalkEdgeLimiter.isCold(receiverId, nowPrev)
        ) {
          addRejectionCounts(rejectedByCounts, ['symmetric_rate_limit']);
          rejectedReceivers.push({ receiverId, rejectedBy: ['symmetric_rate_limit'] });
          continue;
        }
        if (dailyWeeklyTalkEdgeQuotaRateLimiter) {
          const quota = dailyWeeklyTalkEdgeQuotaRateLimiter.checkEdgeQuotas(senderId, receiverId, nowPrev);
          if (!quota.ok) {
            addRejectionCounts(rejectedByCounts, quota.rejectedBy);
            rejectedReceivers.push({ receiverId, rejectedBy: quota.rejectedBy });
            continue;
          }
        }
        eligibleReceivers += 1;
        eligibleReceiverIds.push(receiverId);
      }
      res.json({
        totalCandidates: uniqueReceiverIds.length,
        cappedPoolSize: receiverIdsCapped.length,
        eligibleReceivers,
        eligibleReceiverIds,
        senderCapacity,
        capacityDropped,
        rejectedByCounts,
        rejectedReceivers,
      });
    } catch (error) {
      logger.error({ err: error }, 'broadcast-receiver-preview error');
      res.status(500).json({ error: (error as Error).message });
    }
  });
  app.post('/api/talks/:id/received', async (req, res) => {
    try {
      const talkId = req.params.id;
      if (usesDirectTalkDelivery(resolveP2PRuntimeFlags(process.env))) {
        const { receiverId, senderId, talkData: bodyTalkData } = req.body as {
          receiverId?: string;
          senderId?: string;
          talkData?: unknown;
        };
        if (!receiverId || !senderId) {
          res.status(400).json({ error: 'receiverId and senderId required' });
          return;
        }
        const talkData = bodyTalkData && typeof bodyTalkData === 'object' ? bodyTalkData : null;
        const identityKey = talkData ? buildTalkIdentityKey(talkData) : talkId;
        res.json({
          registered: true,
          directDelivery: true,
          identityKey,
          autoResponded: false,
          reason: 'p0_direct_talk_delivery',
        });
        return;
      }
      const { receiverId, receiverName, senderId, senderName, talkData: bodyTalkData, chatbotEnabled } = req.body as {
        receiverId: string;
        receiverName?: string;
        senderId: string;
        senderName?: string;
        talkData?: unknown;
        chatbotEnabled?: boolean;
      };
      if (!receiverId || !senderId) {
        res.status(400).json({ error: 'receiverId and senderId required' });
        return;
      }

      const talkData = await loadTalkDataFromGraphOrBody(talkId, bodyTalkData);
      if (!talkData) {
        res.status(404).json({ error: 'Talk not found' });
        return;
      }

      const receiverContext = await getUserDeliveryContext(receiverId);
      const blockStatus = await getBlockStatus(receiverId, senderId);
      const rejectedBy = filterReasonsForTalk(talkData, receiverContext);
      if (blockStatus.eitherBlocked) {
        rejectedBy.push('blocked_user');
      }
      if (rejectedBy.length > 0) {
        res.json({ registered: false, filteredOut: true, rejectedBy });
        return;
      }

      const now = Date.now();
      if (
        symmetricTalkEdgeLimiter &&
        symmetricTalkEdgeLimiter.cooldownMs > 0 &&
        (!symmetricTalkEdgeLimiter.isCold(senderId, now) || !symmetricTalkEdgeLimiter.isCold(receiverId, now))
      ) {
        res.json({ registered: false, filteredOut: true, rejectedBy: ['symmetric_rate_limit'] });
        return;
      }
      if (dailyWeeklyTalkEdgeQuotaRateLimiter) {
        const quota = dailyWeeklyTalkEdgeQuotaRateLimiter.checkEdgeQuotas(senderId, receiverId, now);
        if (!quota.ok) {
          res.json({ registered: false, filteredOut: true, rejectedBy: quota.rejectedBy });
          return;
        }
      }

      const resolvedSenderName = senderName || (await getUserStageName(senderId, 'Someone'));
      const resolvedReceiverName = receiverName || (await getUserStageName(receiverId, 'Someone'));

      const { identityKey } = await upsertIncomingTalkForUser({
        receiverId,
        talkId,
        talkData,
        senderId,
        senderName: resolvedSenderName,
      });

      dailyWeeklyTalkEdgeQuotaRateLimiter?.consumeEdgeQuotas(senderId, receiverId, now);

      if (symmetricTalkEdgeLimiter && symmetricTalkEdgeLimiter.cooldownMs > 0) {
        symmetricTalkEdgeLimiter.touchPair(senderId, receiverId, Date.now());
      }

      if (chatbotEnabled === false) {
        res.json({ registered: true, identityKey, autoResponded: false, reason: 'chatbot_disabled' });
        return;
      }

      const exactMemory = await readExactChatbotMemoryForUser(gunService, receiverId);
      if (exactMemory && typeof exactMemory === 'object') {
        const exactAutoAnswers = mapExactMemoryToTalk(exactMemory, receiverId, talkData);
        if (Array.isArray(exactAutoAnswers) && exactAutoAnswers.length === 0) {
          await writeExactChatbotMemoryForUser(gunService, receiverId, exactMemory);
          res.json({
            registered: true,
            identityKey,
            autoResponded: false,
            reason: 'exact_chatbot_memory_skip',
          });
          return;
        }
        if (exactAutoAnswers && exactAutoAnswers.length > 0) {
          const matches = await fanoutResponseToSenders({
            talkData,
            sourceTalkId: talkId,
            responderId: receiverId,
            responderName: resolvedReceiverName,
            answers: exactAutoAnswers,
            senders: [{ senderId, senderName: resolvedSenderName, talkId }],
            isChatbotResponse: true,
            storeOnSourceTalk: true,
          });

          await writeExactChatbotMemoryForUser(gunService, receiverId, exactMemory);

          res.json({
            registered: true,
            identityKey,
            autoResponded: true,
            isMatch: matches.length > 0,
            matches,
            reason: 'exact_chatbot_memory',
          });
          return;
        }
      }

      const savedTemplate = await gunService.getPath([
        'talkAnswerTemplateByUser',
        receiverId,
        identityKey,
      ]);

      if (!savedTemplate?.isAuto) {
        res.json({ registered: true, identityKey, autoResponded: false });
        return;
      }

      const templateEntriesRaw =
        typeof savedTemplate.templateEntries === 'string'
          ? JSON.parse(savedTemplate.templateEntries)
          : savedTemplate.templateEntries;

      const autoAnswers = mapTemplateEntriesToTalk(templateEntriesRaw || [], talkData);
      if (!Array.isArray(autoAnswers) || autoAnswers.length === 0) {
        res.json({ registered: true, identityKey, autoResponded: false, reason: 'No mappable auto answers' });
        return;
      }

      const matches = await fanoutResponseToSenders({
        talkData,
        sourceTalkId: talkId,
        responderId: receiverId,
        responderName: resolvedReceiverName,
        answers: autoAnswers,
        senders: [{ senderId, senderName: resolvedSenderName, talkId }],
        isChatbotResponse: true,
        storeOnSourceTalk: true,
      });

      res.json({
        registered: true,
        identityKey,
        autoResponded: true,
        isMatch: matches.length > 0,
        matches,
        conversationId: matches[0]?.conversationId ?? null,
        otherUserId: matches[0]?.senderId ?? senderId,
        otherUserName: matches[0]?.senderName ?? resolvedSenderName,
      });
    } catch (error) {
      logger.error({ err: error }, 'Talk received registration error');
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * Sender-driven: after Gun announces a talk to a chatroom, register every listed receiver on the server
   * graph so GET /incoming-talks and IN UI work even when a peer never receives the Gun node in time.
   */
  app.post('/api/talks/:id/register-receivers-for-broadcast', async (req, res) => {
    const hardTimeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn({ talkId: req.params.id }, '[register-receivers] hard timeout');
        res.status(504).json({ error: 'timeout', registered: 0 });
      }
    }, 300_000);
    try {
      if (usesDirectTalkDelivery(resolveP2PRuntimeFlags(process.env))) {
        clearTimeout(hardTimeout);
        const receiverIds = (req.body as { receiverIds?: string[] })?.receiverIds;
        const count = Array.isArray(receiverIds) ? receiverIds.length : 0;
        res.json({
          ok: true,
          registered: 0,
          directDelivery: true,
          skipped: true,
          receiverCount: count,
        });
        return;
      }
      const talkId = req.params.id;
      const { senderId, senderName, receiverIds, talkData: bodyTalkData, broadcastTargetTags: rawBt, broadcastMaxDistanceMiles: rawMaxDm } =
        req.body as {
          senderId: string;
          senderName?: string;
          receiverIds: string[];
          talkData?: unknown;
          broadcastTargetTags?: unknown;
          broadcastMaxDistanceMiles?: unknown;
        };
      const broadcastTargetTags = parseBulkBroadcastTargetTags(rawBt);
      const broadcastMaxDistanceMiles = parseBulkBroadcastMaxDistanceMiles(rawMaxDm);
      logger.info({ talkId, senderId, receiverCount: receiverIds.length }, '[register-receivers] registering receivers');
      if (!senderId || !Array.isArray(receiverIds)) {
        clearTimeout(hardTimeout);
        res.status(400).json({ error: 'senderId and receiverIds[] required' });
        return;
      }
      const talkData = await loadTalkDataFromGraphOrBody(talkId, bodyTalkData);
      logger.info({ talkId, title: (talkData as any)?.title ?? null, authorId: (talkData as any)?.authorId }, '[register-receivers] talkData loaded');
      if (!talkData) {
        clearTimeout(hardTimeout);
        res.status(404).json({ error: 'Talk not found' });
        return;
      }
      if (String((talkData as { authorId?: string }).authorId) !== String(senderId)) {
        logger.warn({ authorId: (talkData as any).authorId, senderId }, '[register-receivers] 403: authorId mismatch');
        clearTimeout(hardTimeout);
        res.status(403).json({ error: 'senderId must match talk author' });
        return;
      }
      if (broadcastTargetTags.length > 0) {
        recordBroadcastTargetTagUses?.(broadcastTargetTags);
      }
      const senderPivot = await resolveBulkSenderPivot(senderId, talkData);
      const senderCapacityRaw = await getSenderBulkSendCapacity(senderId);
      const senderCapacity = Math.max(0, Number.isFinite(senderCapacityRaw) ? Math.floor(senderCapacityRaw) : 0);
      const uniqueReceiverIds = Array.from(new Set(receiverIds.filter((id) => !!id && id !== senderId)));
      if (senderCapacity === 0) {
        clearTimeout(hardTimeout);
        if (!res.headersSent) {
          res.json({
            ok: true,
            registered: 0,
            filteredOut: uniqueReceiverIds.length,
            senderCapacity,
            capacityDropped: uniqueReceiverIds.length,
          });
        }
        return;
      }
      const receiverIdsCapped = uniqueReceiverIds.slice(0, senderCapacity);
      const capacityDropped = Math.max(0, uniqueReceiverIds.length - receiverIdsCapped.length);
      const resolvedSenderName = senderName || (await getUserStageName(senderId, 'Someone'));
      let registered = 0;
      let filteredOut = capacityDropped;
      const nowBulk = Date.now();
      if (
        symmetricTalkEdgeLimiter &&
        symmetricTalkEdgeLimiter.cooldownMs > 0 &&
        !symmetricTalkEdgeLimiter.isCold(senderId, nowBulk)
      ) {
        clearTimeout(hardTimeout);
        if (!res.headersSent) {
          res.json({
            ok: true,
            registered: 0,
            filteredOut: receiverIdsCapped.length + capacityDropped,
            senderCapacity,
            capacityDropped,
            symmetricRateLimited: true,
          });
        }
        return;
      }
      for (const receiverId of receiverIdsCapped) {
        const rejectedBy = await computeBulkRejectionsForReceiver(
          receiverId,
          senderId,
          talkData,
          broadcastTargetTags,
          broadcastMaxDistanceMiles,
          senderPivot,
        );
        if (rejectedBy.length > 0) {
          filteredOut += 1;
          continue;
        }
        if (
          symmetricTalkEdgeLimiter &&
          symmetricTalkEdgeLimiter.cooldownMs > 0 &&
          !symmetricTalkEdgeLimiter.isCold(receiverId, nowBulk)
        ) {
          filteredOut += 1;
          continue;
        }
        if (dailyWeeklyTalkEdgeQuotaRateLimiter) {
          const quota = dailyWeeklyTalkEdgeQuotaRateLimiter.checkEdgeQuotas(senderId, receiverId, nowBulk);
          if (!quota.ok) {
            filteredOut += 1;
            continue;
          }
        }
        await upsertIncomingTalkForUser({
          receiverId,
          talkId,
          talkData,
          senderId,
          senderName: resolvedSenderName,
        });

        dailyWeeklyTalkEdgeQuotaRateLimiter?.consumeEdgeQuotas(senderId, receiverId, nowBulk);

        if (symmetricTalkEdgeLimiter && symmetricTalkEdgeLimiter.cooldownMs > 0) {
          symmetricTalkEdgeLimiter.touch(receiverId, nowBulk);
        }
        registered += 1;
      }
      if (registered > 0 && symmetricTalkEdgeLimiter && symmetricTalkEdgeLimiter.cooldownMs > 0) {
        symmetricTalkEdgeLimiter.touch(senderId, nowBulk);
      }
      clearTimeout(hardTimeout);
      if (!res.headersSent) res.json({ ok: true, registered, filteredOut, senderCapacity, capacityDropped });
    } catch (error) {
      clearTimeout(hardTimeout);
      logger.error({ err: error }, 'register-receivers-for-broadcast error');
      if (!res.headersSent) res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/users/:id/incoming-talks', async (req, res) => {
    try {
      const userId = req.params.id;
      if (usesDirectTalkDelivery(resolveP2PRuntimeFlags(process.env))) {
        res.setHeader('X-P0-Direct-Talk-Delivery', '1');
        res.json([]);
        return;
      }
      const userMap = incomingTalksMap.get(userId);
      if (!userMap || userMap.size === 0) {
        res.json([]);
        return;
      }

      const values = await Promise.all(
        Array.from(userMap.entries()).map(async ([rawKey, cluster]) => {
          const logical =
            typeof cluster?.identityKey === 'string' && cluster.identityKey
              ? cluster.identityKey
              : TALK_CONTENT_HASH_ID.test(rawKey)
                ? rawKey
                : canonicalIdentityKeyFromStoredCluster(cluster);
          // Phase G: isAnswered/isAutoAnswered are now written directly onto the
          // in-memory cluster by saveUserAnswerTemplateByContent (no Gun read needed).
          const isAnswered = !!(cluster?.isAnswered);
          return {
            ...cluster,
            identityKey: logical,
            isAnswered,
            isAutoAnswered: !!cluster?.isAutoAnswered,
          };
        }),
      );

      values.sort(
        (a: any, b: any) =>
          new Date(b?.updatedAt || 0).getTime() - new Date(a?.updatedAt || 0).getTime(),
      );
      res.json(values);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/talks/:id/response', async (req, res) => {
    try {
      const talkId = req.params.id;
      const { responderId, responderName, answers, talkData: bodyTalkData, isAuto, isChatbotResponse } = req.body as {
        responderId: string;
        responderName?: string;
        answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }>;
        talkData?: unknown;
        isAuto?: boolean;
        isChatbotResponse?: boolean;
      };
      if (!responderId || !Array.isArray(answers)) {
        res.status(400).json({ error: 'responderId and answers required' });
        return;
      }
      const talkData = await loadTalkDataFromGraphOrBody(talkId, bodyTalkData);
      if (!talkData) {
        res.status(404).json({ error: 'Talk not found' });
        return;
      }

      const normalizedAnswers = normalizeSubmittedAnswersForTalk(talkData, answers);
      const identityKey = buildTalkIdentityKey(talkData);
      const resolvedResponderName = responderName || (await getUserStageName(responderId, 'Someone'));

      const fallbackSenderId = talkData.authorId as string | undefined;
      if (fallbackSenderId && fallbackSenderId !== responderId) {
        const fallbackSenderName = await getUserStageName(fallbackSenderId, 'Someone');
        await upsertIncomingTalkForUser({
          receiverId: responderId,
          talkId,
          talkData,
          senderId: fallbackSenderId,
          senderName: fallbackSenderName,
        });
      }

      const sendersParams = {
        responderId,
        identityKey,
        fallbackTalkId: talkId,
      } as { responderId: string; identityKey: string; fallbackTalkId: string; fallbackSenderId?: string };
      if (fallbackSenderId) {
        sendersParams.fallbackSenderId = fallbackSenderId;
      }
      const senders = await getClusterSenders(sendersParams);

      const effectiveIsAuto = deriveIsAutoAnswerSet(normalizedAnswers, isAuto, isChatbotResponse);
      const templateEntries = buildAnswerTemplateEntries(talkData, normalizedAnswers);
      await saveUserAnswerTemplateByContent({
        responderId,
        responderName: resolvedResponderName,
        identityKey,
        language: String(talkData?.language || 'en').toLowerCase(),
        answers: normalizedAnswers,
        templateEntries,
        isAuto: effectiveIsAuto,
      });

      // Phase E: per-question chatbot answer cache (REQ-CHATBOT-05).
      // Write byQuestion/<questionCidId> alongside the legacy identityKey path.
      // Falls back to q.id when cidId is not yet present (backward compat).
      try {
        const questions: any[] = Array.isArray(talkData?.questions) ? talkData.questions : [];
        const questionByCid = new Map<string, string>();
        for (const q of questions) {
          const cacheKey = String(q.cidId || q.id || '');
          if (cacheKey) questionByCid.set(String(q.id), cacheKey);
        }
        for (const answer of normalizedAnswers) {
          const qId = String(answer.questionId || '');
          const cacheKey = questionByCid.get(qId) || qId;
          if (!cacheKey) continue;
          // Recompute cidId from stable question content if not present
          const question = questions.find((q: any) => String(q.id) === qId);
          const cidKey = question?.cidId || (question
            ? await computeCIDv1({ text: question.text, answers: (question.answers || []).map((a: any) => ({ id: a.id, text: a.text })) })
            : cacheKey);
          await gunService.putPath(
            ['talkAnswerTemplateByUser', responderId, 'byQuestion', cidKey],
            {
              answerId: String(answer.answerId || ''),
              answerText: String(answer.answerText || ''),
              updatedAt: new Date().toISOString(),
              isAuto: effectiveIsAuto,
            },
          );
        }
      } catch (perQuestionErr) {
        logger.warn({ err: perQuestionErr }, 'Per-question cache write failed (non-fatal)');
      }

      const matches = await fanoutResponseToSenders({
        talkData,
        sourceTalkId: talkId,
        responderId,
        responderName: resolvedResponderName,
        answers: normalizedAnswers,
        senders,
        isChatbotResponse: !!isChatbotResponse,
        storeOnSourceTalk: false,
      });

      const isMatch = checkIfMatch(talkData, normalizedAnswers);
      const isIgnore = checkIfIgnore(talkData, normalizedAnswers);

      try {
        const region = await getUserRegion(responderId);
        await recordTalkStatsResponse({
          talkId,
          talkType: (talkData?.type || 'flow') as TalkType,
          responderId,
          region,
          answers: normalizedAnswers.map((a: any) => ({
            questionId: String(a.questionId),
            answerId: String(a.answerId),
            answerText: String(a.answerText ?? ''),
          })),
          outcome: isMatch ? 'match' : isIgnore ? 'ignore' : 'other',
          isAuto: effectiveIsAuto,
        });
      } catch (err) {
        logger.warn({ err }, 'stats: failed to record response');
      }

      res.json({
        isMatch,
        identityKey,
        matchedCount: matches.length,
        matches,
        conversationId: matches[0]?.conversationId ?? null,
        otherUserId: matches[0]?.senderId ?? null,
        otherUserName: matches[0]?.senderName ?? null,
      });
    } catch (error) {
      logger.error({ err: error }, 'Talk response error');
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
