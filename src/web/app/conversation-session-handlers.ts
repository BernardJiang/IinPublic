import { formatAttachmentShareMessageText, type AttachmentShareMessagePayload } from '../../core/attachment-share';
import type { IpfsAttachment, User } from '../../shared/types';
import type { WebConversationService } from '../services/web-conversation-service';
import type { UIManager } from '../ui/ui-manager';

export interface ConversationSessionHandlerPorts {
  ui: UIManager;
  conversations: WebConversationService;
  currentUser(): User | undefined;
  onConversationAdded(conversationId: string): void;
  confirmDeal(conversationId: string): Promise<void>;
  isBlocked(peerId: string): Promise<boolean>;
  publishMedia(file: File, conversationId: string): Promise<IpfsAttachment>;
  findOrCreate(peerId: string, peerName: string): Promise<string>;
  ingestSnapshot(records: any[]): Promise<void>;
  now?(): number;
  random?(): number;
}

export function registerConversationSessionHandlers(ports: ConversationSessionHandlerPorts): void {
  const { ui, conversations } = ports;
  ui.on('conversationAdded', ({ conversationId }: { conversationId: string }) => ports.onConversationAdded(conversationId));
  ui.on('confirmDeal', ({ conversationId }: { conversationId: string }) => ports.confirmDeal(conversationId));

  ui.on('shareConversationMedia', async (data: { conversationId: string; file: File }) => {
    try {
      const user = ports.currentUser();
      if (!user) throw new Error('Not logged in');
      const conversation = ui.getMyConversations()[data.conversationId];
      const peerId = conversation?.otherUserId ? String(conversation.otherUserId) : undefined;
      if (peerId && await ports.isBlocked(peerId)) {
        ui.showNotification(ui.formatMediaShareBlockedRecipient(), 'error');
        return;
      }
      ui.showNotification(ui.formatMediaShareUploading(data.file.name), 'info');
      const attachment = await ports.publishMedia(data.file, data.conversationId);
      const payload: AttachmentShareMessagePayload = {
        kind: 'ipfs-auto-share-v1',
        conversationId: data.conversationId,
        talkId: `dm-media:${data.conversationId}`,
        authorId: user.id,
        cid: attachment.cid,
        link: `ipfs://${attachment.cid}`,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        enc: attachment.enc,
        keyCiphertext: 'public',
        sharedAt: new Date(ports.now?.() ?? Date.now()).toISOString(),
      };
      const suffix = (ports.random?.() ?? Math.random()).toString(36).slice(2, 9);
      await conversations.sendMessage(data.conversationId, user.id, formatAttachmentShareMessageText(payload), {
        messageId: `msg_${ports.now?.() ?? Date.now()}_${suffix}`,
        ...(peerId ? { otherUserId: peerId } : {}),
      });
    } catch (error) {
      console.error('Failed to share media link:', error);
      ui.showNotification(ui.formatMessageSendFailed((error as Error).message), 'error');
    }
  });

  ui.on('sendDirectMessage', async (data: {
    peerId: string; peerName: string; text: string; resolve(): void; reject(error: unknown): void;
  }) => {
    try {
      const user = ports.currentUser();
      if (!user) throw new Error('Not logged in');
      const conversationId = await ports.findOrCreate(data.peerId, data.peerName);
      await conversations.sendMessage(conversationId, user.id, data.text, { otherUserId: data.peerId });
      data.resolve();
    } catch (error) {
      ui.showNotification(ui.formatMessageSendFailed((error as Error).message), 'error');
      data.reject(error);
    }
  });
  ui.on('openDirectConversation', async (data: {
    peerId: string; peerName: string; resolve(id: string): void; reject(error: unknown): void;
  }) => {
    try {
      if (!ports.currentUser()) throw new Error('Not logged in');
      data.resolve(await ports.findOrCreate(data.peerId, data.peerName));
    }
    catch (error) { data.reject(error); }
  });
  ui.on('needConversationSync', async () => {
    const user = ports.currentUser();
    if (!user) return;
    try { await ports.ingestSnapshot(await conversations.getUserConversationsSnapshot(user.id)); }
    catch (error) { console.warn('Conversation sync snapshot failed:', error); }
  });
}
