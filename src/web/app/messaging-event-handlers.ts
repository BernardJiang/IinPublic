/** Place-chat and direct-conversation UI event composition. */
import { parseAttachmentShareMessageText } from '../../core/attachment-share';
import type { GraphConversationMessage } from '../../core/device-graph/sync/graph-host';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { mergeMessagesWithGraph } from '../services/web-device-sync-message-cache';
import type { PlaceChatClient } from '../services/place-chat-client';
import type { WebChatroomService } from '../services/web-chatroom-service';
import type { WebConversationService } from '../services/web-conversation-service';
import type { UIManager } from '../ui/ui-manager';

export interface MessagingEventHandlerDeps {
  ui: UIManager;
  chatrooms: WebChatroomService;
  placeChat: PlaceChatClient;
  conversations: WebConversationService;
  currentUser(): { id: string; stageName: string } | undefined;
  graphMessages(conversationId: string): Promise<GraphConversationMessage[]>;
  recordSupportMessages(conversationId: string, otherUserId: string, messages: readonly any[]): void;
  fetchSharedAttachment(
    payload: NonNullable<ReturnType<typeof parseAttachmentShareMessageText>>,
    senderId: string,
  ): Promise<unknown>;
  handleSupportQuestion(conversationId: string, messageId: string, message: string): Promise<unknown>;
  recordConversationLedger(conversationId: string, messageId: string): void;
  now?(): number;
  random?(): number;
}

const messageId = (deps: MessagingEventHandlerDeps): string =>
  `msg_${deps.now?.() ?? Date.now()}_${(deps.random?.() ?? Math.random()).toString(36).slice(2, 11)}`;

export function registerMessagingEventHandlers(deps: MessagingEventHandlerDeps): void {
  const { ui } = deps;

  ui.on('sendMessage', async (data: {
    conversationId: string;
    message: string;
    onPersisted?: () => void;
    onError?: () => void;
  }) => {
    try {
      console.log('📤 Sending chatroom message');
      const chatroomId = deps.chatrooms.getCurrentChatroomId();
      const currentUser = deps.currentUser();
      if (!chatroomId || !currentUser) {
        ui.showNotification(ui.formatNotInChatroom(), 'error');
        data.onError?.();
        return;
      }
      const message = {
        id: messageId(deps),
        text: data.message,
        senderId: currentUser.id,
        senderName: currentUser.stageName,
        timestamp: new Date(deps.now?.() ?? Date.now()).toISOString(),
      };
      const stored = await deps.placeChat.send(chatroomId, message);
      data.onPersisted?.();
      ui.displayChatroomMessage({ ...stored, isOwnMessage: true });
      console.log('✅ Chatroom message sent');
      ui.showNotification(ui.formatMessageSent(), 'success');
    } catch (error) {
      data.onError?.();
      console.error('Failed to send message:', error);
      ui.showNotification(ui.formatMessageSendFailed((error as Error).message), 'error');
    }
  });

  ui.on('loadConversation', async (data: { conversationId: string }) => {
    try {
      console.log('📖 Loading conversation:', data.conversationId);
      const conversation = ui.getMyConversations()[data.conversationId] as any;
      const otherUserId = conversation?.otherUserId ? String(conversation.otherUserId) : undefined;
      let graphMessages: GraphConversationMessage[] = [];
      let latestLiveMessages: any[] = [];
      const displayMergedMessages = () => {
        const messages = mergeMessagesWithGraph(
          data.conversationId,
          latestLiveMessages,
          graphMessages,
          deps.currentUser()?.id || '',
        );
        void ui.displayConversationMessages(data.conversationId, messages);
        return messages;
      };
      void deps.graphMessages(data.conversationId).then((rows) => {
        graphMessages = rows;
        displayMergedMessages();
      }).catch((error) => console.warn('[graph] conversation history read failed:', error));

      deps.conversations.subscribeToMessages(data.conversationId, (liveMessages) => {
        console.log('📨 Received conversation messages:', liveMessages);
        latestLiveMessages = liveMessages;
        if (otherUserId && data.conversationId.startsWith('conv_support_')) {
          deps.recordSupportMessages(data.conversationId, otherUserId, liveMessages);
        }
        const messages = displayMergedMessages();
        for (const message of messages) {
          const sharePayload = parseAttachmentShareMessageText(String(message.text || ''));
          if (!sharePayload || !message.senderId || message.senderId === deps.currentUser()?.id) continue;
          void deps.fetchSharedAttachment(sharePayload, String(message.senderId)).catch((error) => {
            console.warn('[L5] conversation attachment fetch failed:', error);
          });
        }
        const currentUserId = deps.currentUser()?.id;
        if (currentUserId) {
          ui.syncConversationMessageSummary(data.conversationId, messages, currentUserId);
        }
      }, deps.currentUser()?.id, otherUserId);
    } catch (error) {
      console.error('Failed to load conversation:', error);
      ui.showNotification(ui.formatConversationLoadFailed((error as Error).message), 'error');
    }
  });

  ui.on('sendConversationMessage', async (data: {
    conversationId: string;
    message: string;
    talkId?: string;
    onPersisted?: () => void;
    onError?: () => void;
  }) => {
    let conversation: ReturnType<UIManager['getMyConversations']>[string] | undefined;
    let otherUserId: string | undefined;
    const id = messageId(deps);
    try {
      console.log('📤 Sending conversation message');
      const currentUser = deps.currentUser();
      if (!currentUser) throw new Error('Current user is unavailable');
      conversation = ui.getMyConversations()[data.conversationId];
      otherUserId = conversation?.otherUserId ? String(conversation.otherUserId) : undefined;
      await deps.conversations.sendMessage(data.conversationId, currentUser.id, data.message, {
        messageId: id,
        ...(otherUserId ? { otherUserId } : {}),
        ...(data.talkId ? { talkId: data.talkId } : {}),
      });
    } catch (error) {
      data.onError?.();
      console.error('Failed to send conversation message:', error);
      ui.showNotification(ui.formatMessageSendFailed((error as Error).message), 'error');
      return;
    }

    data.onPersisted?.();
    console.log('✅ Conversation message sent');
    if (conversation?.supportChannel === true || otherUserId === TECHSUPPORT_ROOT_USER_ID) {
      void deps.handleSupportQuestion(data.conversationId, id, data.message)
        .catch((error) => console.warn('Support follow-up failed after message send:', error));
    }
    deps.recordConversationLedger(data.conversationId, id);
  });
}
