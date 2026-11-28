import type { IpfsAttachment, Talk, User } from '../../shared/types';
import { InteractionKind } from '../../shared/types';
import { FlowCapture, TalkAutofix, buildRevisedTalkDraft } from '../../shared/talk-engine';
import { coalesced } from '../services/coalesced-refresh';
import type { WebTalkService } from '../services/web-talk-service';
import { getMyConversations } from '../ui/my-conversations-storage';
import { getMyTalks } from '../ui/my-talks-storage';
import type { UIManager } from '../ui/ui-manager';

type CreateTalkInput = Partial<Talk> & {
  selfAnswers?: Array<{ questionId: string; answerId: string }>;
  mediaFile?: File;
  reviseSourceTalk?: Talk;
  isPublic?: boolean;
  sendToChatroom?: boolean;
};

export interface TalkEventHandlerDeps {
  ui: UIManager;
  talks: WebTalkService;
  currentUser(): User | undefined;
  authorLocation(): { latitude: number; longitude: number } | undefined;
  publishMediaFile(file: File, talkId: string): Promise<IpfsAttachment>;
  pinAttachments(talkId: string, attachments: IpfsAttachment[]): Promise<void>;
  broadcastCreated(talk: Talk): boolean;
  emitLedger(kind: InteractionKind, content: Record<string, unknown>): void;
  exchangeCurrentList(): void;
  schedulePublishedExchange(): void;
  retractTalk(talkId: string, retractedAt: number): Promise<void>;
  resolveFullTalk(talkId: string): Promise<Talk | null>;
  loadFullTalkByIdentity(identityKey: string): Promise<Talk | null>;
  refreshIncoming(): Promise<unknown>;
  applyStats(talkIds: string[]): Promise<void>;
  completeTalk(data: { talkId: string; localTalkId?: string; answers: any[]; talkData?: any; isChatbotResponse?: boolean }): Promise<void>;
  syncBackgroundAgent(): void;
}

/** Registers Talk authoring/query/answer UI commands without exposing application coordinator state. */
export function registerTalkEventHandlers(deps: TalkEventHandlerDeps): void {
  const { ui, talks } = deps;

  ui.on('sendTalkToUser', async (data: { userId: string }) => {
    const existing = Object.entries(getMyConversations()).find(([, conversation]: [string, any]) =>
      conversation?.otherUserId === data.userId);
    if (existing) ui.showConversationDetail(existing[0]);
    else ui.showNotification(ui.formatMatchToStartConversation(), 'info');
  });

  ui.on('createTalk', async (talkData: CreateTalkInput) => {
    try {
      const user = deps.currentUser();
      if (!user) throw new Error('Current user is unavailable');
      const { mediaFile, reviseSourceTalk, ...talkFields } = talkData;
      let ipfsAttachments = talkFields.ipfsAttachments;
      if (mediaFile) {
        ui.showNotification(ui.formatMediaShareUploading(mediaFile.name), 'info');
        const attachment = await deps.publishMediaFile(mediaFile, `talk-media:${user.id}:${Date.now()}`);
        ipfsAttachments = [...(ipfsAttachments ?? []), attachment];
      }
      const authorLocation = deps.authorLocation();
      const created = reviseSourceTalk
        ? await talks.createTalk({
          ...buildRevisedTalkDraft(reviseSourceTalk, talkFields.questions ?? [], user.id, {
            ...(talkFields.title !== undefined ? { title: talkFields.title } : {}),
            ...(talkFields.type !== undefined ? { type: talkFields.type } : {}),
            ...(talkFields.language !== undefined ? { language: talkFields.language } : {}),
            ...(talkFields.tags !== undefined ? { tags: talkFields.tags } : {}),
            ...(talkFields.isAdult !== undefined ? { isAdult: talkFields.isAdult } : {}),
            ...(talkFields.expiresAt !== undefined ? { expiresAt: talkFields.expiresAt } : {}),
            ...(talkFields.locationRadiusMiles !== undefined ? { locationRadiusMiles: talkFields.locationRadiusMiles } : {}),
            ...(talkFields.matchThreshold !== undefined ? { matchThreshold: talkFields.matchThreshold } : {}),
            ...(talkFields.collectionImportance !== undefined ? { collectionImportance: talkFields.collectionImportance } : {}),
          }),
          ...(ipfsAttachments ? { ipfsAttachments } : {}),
          ...(authorLocation ? { authorLocation } : {}),
        })
        : await talks.createTalk({
          ...talkFields,
          ...(ipfsAttachments ? { ipfsAttachments } : {}),
          authorId: user.id,
          ...(authorLocation ? { authorLocation } : {}),
        });
      if (reviseSourceTalk) ui.applyTalkRevisionPolicy(reviseSourceTalk.id);
      if (created.ipfsAttachments?.length) await deps.pinAttachments(created.id, created.ipfsAttachments);
      deps.emitLedger(InteractionKind.TALK_CREATED, {
        talkId: created.id,
        title: created.title,
        type: created.type,
        language: created.language,
      });
      const isPublic = talkData.isPublic !== false;
      ui.saveCreatedTalk(created, { selfAnswers: talkData.selfAnswers ?? [], isPublic });
      const sendToRoom = isPublic && talkData.sendToChatroom !== false;
      if (isPublic) ui.maybeShowPreSendSafetyToast();
      const sentToRoom = sendToRoom ? deps.broadcastCreated(created) : false;
      ui.showNotification(
        ui.formatTalkCreated(!sendToRoom ? 'saved-only' : sentToRoom ? 'sent' : 'needs-room'),
        'success',
      );
    } catch (error) {
      console.error('Failed to create talk:', error);
      ui.showNotification(ui.formatTalkCreateFailed((error as Error).message), 'error');
    }
  });

  ui.on('finalizeCaptureSession', async (data: { conversationId: string; scopeTalkId?: string; lines: string[] }) => {
    try {
      const user = deps.currentUser();
      if (!user) return;
      const location = deps.authorLocation();
      if (data.scopeTalkId) {
        const oldTalk = await talks.getTalk(data.scopeTalkId);
        if (!oldTalk) return;
        const appended = FlowCapture.buildCapturedQuestions(data.lines, oldTalk.questions.length);
        if (appended.length === 0) return;
        const questions = TalkAutofix.fix({ ...oldTalk, questions: [...oldTalk.questions, ...appended] }).talk.questions;
        const created = await talks.createTalk({
          ...buildRevisedTalkDraft(oldTalk, questions, user.id),
          ...(location ? { authorLocation: location } : {}),
        });
        ui.saveCreatedTalk(created, { selfAnswers: [], isPublic: false });
        ui.applyTalkRevisionPolicy(data.scopeTalkId);
        ui.showNotification(ui.formatCaptureTalkAppended(), 'success');
      } else {
        const assembled = FlowCapture.assembleCapturedTalk(data.lines);
        if (!assembled) return;
        const created = await talks.createTalk({
          ...assembled,
          authorId: user.id,
          ...(location ? { authorLocation: location } : {}),
        });
        ui.saveCreatedTalk(created, { selfAnswers: [], isPublic: false });
        ui.showNotification(ui.formatCaptureTalkCreated(), 'success');
      }
    } catch (error) {
      console.error('Failed to finalize captured Talk:', error);
      ui.showNotification(ui.formatTalkCreateFailed((error as Error).message), 'error');
    }
  });

  ui.on('updateTalk', async (data: Partial<Talk> & {
    id: string; title: string; type: string; questions: any[];
    selfAnswers?: Array<{ questionId: string; answerId: string }>;
  }) => {
    try {
      const updated = await talks.updateTalk(data.id, {
        title: data.title,
        type: data.type as Talk['type'],
        questions: data.questions,
        language: data.language || 'en',
        tags: data.tags || [],
        ...(data.isAdult !== undefined ? { isAdult: data.isAdult } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
        ...(data.locationRadiusMiles !== undefined ? { locationRadiusMiles: data.locationRadiusMiles } : {}),
        ...(data.matchThreshold !== undefined ? { matchThreshold: data.matchThreshold } : {}),
      });
      if (updated.ipfsAttachments?.length) await deps.pinAttachments(updated.id, updated.ipfsAttachments);
      ui.saveCreatedTalk(updated, { selfAnswers: data.selfAnswers ?? [] });
      ui.showNotification(ui.formatTalkUpdated(), 'success');
      ui.displayTalksList();
      deps.emitLedger(InteractionKind.TALK_SUPERSEDED, { oldTalkId: data.id, newTalkId: data.id });
      deps.exchangeCurrentList();
    } catch (error) {
      console.error('Failed to update Talk:', error);
      ui.showNotification(ui.formatTalkUpdateFailed((error as Error).message), 'error');
    }
  });

  ui.on('withdrawTalk', ({ talkId }: { talkId: string }) => {
    const configured = typeof process !== 'undefined' ? Number(process.env?.['TALK_WITHDRAWN_GRACE_MS']) : 0;
    deps.emitLedger(InteractionKind.TALK_WITHDRAWN, {
      talkId,
      gracePeriodMs: configured > 0 ? configured : 24 * 60 * 60 * 1000,
    });
  });
  ui.on('publishTalk', () => deps.schedulePublishedExchange());
  ui.on('retractTalk', ({ talkId, retractedAt }: { talkId: string; retractedAt: number }) => {
    void deps.retractTalk(talkId, retractedAt);
  });

  ui.on('demandFullTalk', async (data: { talkId: string; identityKeyFallback?: string; callback(fullTalk: any): void }) => {
    try {
      const id = data.talkId.trim();
      let value = id ? await deps.resolveFullTalk(id) : null;
      if (!value && data.identityKeyFallback) value = await deps.loadFullTalkByIdentity(data.identityKeyFallback);
      data.callback(value);
    } catch (error) {
      console.error('Failed to get full Talk:', error);
      data.callback(null);
    }
  });
  ui.on('demandFullTalkByIdentity', async (data: { identityKey: string; callback(fullTalk: any): void }) => {
    if (!deps.currentUser()) return data.callback(null);
    try { data.callback(await deps.loadFullTalkByIdentity(data.identityKey)); }
    catch (error) { console.error('demandFullTalkByIdentity failed:', error); data.callback(null); }
  });
  ui.on('loadTalkForEdit', async ({ talkId }: { talkId: string }) => {
    try {
      const own = getMyTalks()[talkId]?.fullTalk;
      const value = own?.questions ? { ...own, id: talkId } : await talks.getTalk(talkId);
      if (value) ui.showTalkEditorDialog(value);
      else ui.showNotification(ui.formatTalkNotFound(), 'error');
    } catch (error) {
      ui.showNotification(ui.formatTalkLoadFailed((error as Error).message), 'error');
    }
  });
  ui.on('needIncomingTalkClusters', () => { void deps.refreshIncoming(); });

  const statIds = new Set<string>();
  const readStats = coalesced(async () => {
    const ids = [...statIds];
    statIds.clear();
    await deps.applyStats(ids);
  }, 1_500);
  ui.on('needTalkStats', ({ talkIds }: { talkIds: string[] }) => {
    if (talkIds.length === 0) {
      statIds.clear();
      ui.setTalkStats({});
      ui.displayTalksList();
      return;
    }
    talkIds.forEach((id) => statIds.add(id));
    void readStats();
  });

  ui.on('talkCompleted', async (data: { talkId: string; localTalkId?: string; answers: any[]; talkData?: any; isChatbotResponse?: boolean }) => {
    try {
      await deps.completeTalk(data);
      deps.syncBackgroundAgent();
    } catch (error) {
      console.error('Failed to handle Talk completion:', error);
    }
  });
  ui.on('answerQuestion', async (data: { conversationId: string; questionId: string; answerId: string }) => {
    try {
      const user = deps.currentUser();
      if (!user) return;
      const result = await talks.processAnswer(data.conversationId, data.questionId, data.answerId, user.id);
      ui.updateConversation(data.conversationId, result);
      if (result.isComplete) ui.showTalkCompletion(data.conversationId, result.outcome);
    } catch (error) {
      ui.showNotification(ui.formatAnswerProcessFailed((error as Error).message), 'error');
    }
  });
}
