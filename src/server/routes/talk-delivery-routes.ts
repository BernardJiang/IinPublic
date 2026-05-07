import type express from 'express';
import { checkIfIgnore, checkIfMatch } from '../../shared/talk-engine';
import { buildTalkIdentityKey, canonicalIdentityKeyFromStoredCluster } from '../../shared/talk-content-id';
import { TALK_CONTENT_HASH_ID } from '../../shared/incoming-talk-ids';
import { intakeFilterRejectReasons } from '../../shared/talk-intake-filters';
import type { TalkType } from '../../shared/talk-stats';
import type { GPSCoordinate, TalkIntakeFilters } from '../../shared/types';
import { receiverPassesBroadcastTagTargeting } from '../../shared/broadcast-tag-targeting';
import { logger } from '../logger';
import { GunService } from '../services/gun-service';

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
  }) => Promise<void>;
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
  } = deps;

  function filterReasonsForTalk(
    talkData: any,
    context: {
      talkFilters: TalkIntakeFilters;
      ageVerified: boolean;
      location?: GPSCoordinate;
      interestTokens: string[];
    },
  ): string[] {
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
    if (talkData?.isAdult && !context.ageVerified) {
      reasons.push('age_gate');
    }
    return reasons;
  }

  app.post('/api/talks/:id/received', async (req, res) => {
    try {
      const talkId = req.params.id;
      const { receiverId, receiverName, senderId, senderName, talkData: bodyTalkData } = req.body as {
        receiverId: string;
        receiverName?: string;
        senderId: string;
        senderName?: string;
        talkData?: unknown;
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

      const resolvedSenderName = senderName || (await getUserStageName(senderId, 'Someone'));
      const resolvedReceiverName = receiverName || (await getUserStageName(receiverId, 'Someone'));

      const { identityKey } = await upsertIncomingTalkForUser({
        receiverId,
        talkId,
        talkData,
        senderId,
        senderName: resolvedSenderName,
      });

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
    }, 20000);
    try {
      const talkId = req.params.id;
      const { senderId, senderName, receiverIds, talkData: bodyTalkData, broadcastTargetTags: rawBt } =
        req.body as {
          senderId: string;
          senderName?: string;
          receiverIds: string[];
          talkData?: unknown;
          broadcastTargetTags?: unknown;
        };
      const broadcastTargetTags = Array.isArray(rawBt)
        ? rawBt
            .map((x: unknown) => (typeof x === 'string' ? x.trim() : ''))
            .filter((x: string) => x.length > 0)
        : [];
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
      for (const receiverId of receiverIdsCapped) {
        const receiverContext = await getUserDeliveryContext(receiverId);
        const blockStatus = await getBlockStatus(receiverId, senderId);
        const rejectedBy = filterReasonsForTalk(talkData, receiverContext);
        if (
          broadcastTargetTags.length > 0 &&
          !receiverPassesBroadcastTagTargeting({
            broadcastTargetTags,
            talkTags: Array.isArray((talkData as { tags?: unknown })?.tags) ? (talkData as { tags: any[] }).tags : [],
            receiverInterestTokens: receiverContext.interestTokens,
          })
        ) {
          rejectedBy.push('tag_targeting');
        }
        if (blockStatus.eitherBlocked) {
          rejectedBy.push('blocked_user');
        }
        if (rejectedBy.length > 0) {
          filteredOut += 1;
          continue;
        }
        await upsertIncomingTalkForUser({
          receiverId,
          talkId,
          talkData,
          senderId,
          senderName: resolvedSenderName,
        });
        registered += 1;
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
          const template = await gunService.getPath([
            'talkAnswerTemplateByUser',
            userId,
            logical,
          ]);
          const isAnswered = !!(template && template.answers);
          return {
            ...cluster,
            identityKey: logical,
            isAnswered,
            isAutoAnswered: !!template?.isAuto,
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
        answers: normalizedAnswers,
        templateEntries,
        isAuto: effectiveIsAuto,
      });

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
