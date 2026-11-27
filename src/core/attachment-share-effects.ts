/**
 * Portable orchestration for matched-Talk attachment shares.
 *
 * The host owns key custody, transport, persistence, IPFS and UI refreshes. This coordinator owns
 * the policy that must be identical in every host: author/block gates, stable-message idempotency,
 * send ordering, per-attachment failure isolation and receive-before-fetch ordering.
 */
import type { IpfsAttachment } from '../shared/types';
import {
  attachmentShareMessageId,
  formatAttachmentShareMessageText,
  parseAttachmentShareMessageText,
  type AttachmentShareMessagePayload,
} from './attachment-share';

export type MailboxAttachmentSharePayload = {
  kind: 'ipfs-conversation-share-v1';
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  text: string;
  timestamp: string;
};

export type AttachmentShareFailureContext = 'auto-share' | 'mailbox-fetch';

export interface AttachmentShareEffectsPorts {
  currentUser(): { id: string; stageName: string } | undefined;
  isBlockedEitherWay(peerId: string): Promise<boolean>;
  hasProcessed(messageId: string): boolean;
  markProcessed(messageId: string): void;
  persistProcessed(): void;
  buildPayload(params: {
    conversationId: string;
    talkId: string;
    authorId: string;
    recipientId: string;
    attachment: IpfsAttachment;
    sharedAt: string;
  }): Promise<AttachmentShareMessagePayload>;
  sendConversationMessage(params: {
    conversationId: string;
    senderId: string;
    recipientId: string;
    messageId: string;
    text: string;
  }): Promise<void>;
  postMailbox(payload: MailboxAttachmentSharePayload): Promise<void>;
  ingestConversationMessage(payload: MailboxAttachmentSharePayload): Promise<void>;
  fetchSharedAttachment(payload: AttachmentShareMessagePayload, senderId: string): Promise<void> | void;
  now?(): Date;
  onFailure?(context: AttachmentShareFailureContext, error: unknown): void;
}

export type AutoShareMatchedTalkAttachmentsParams = {
  conversationId: string;
  talkId: string;
  authorId: string;
  responderId: string;
  responderName: string;
  attachments: IpfsAttachment[];
};

export class AttachmentShareEffects {
  private readonly inFlight = new Set<string>();

  constructor(private readonly ports: AttachmentShareEffectsPorts) {}

  async autoShareMatchedTalkAttachments(
    params: AutoShareMatchedTalkAttachmentsParams,
  ): Promise<number> {
    const currentUser = this.ports.currentUser();
    if (!currentUser?.id || currentUser.id !== params.authorId) return 0;
    if (params.attachments.length === 0) return 0;
    if (await this.ports.isBlockedEitherWay(params.responderId)) return 0;

    let sent = 0;
    for (const attachment of params.attachments) {
      try {
        const messageId = await attachmentShareMessageId(
          params.conversationId,
          params.talkId,
          params.authorId,
          attachment.cid,
        );
        if (this.ports.hasProcessed(messageId) || this.inFlight.has(messageId)) continue;

        this.inFlight.add(messageId);
        try {
          const timestamp = (this.ports.now?.() ?? new Date()).toISOString();
          const sharePayload = await this.ports.buildPayload({
            conversationId: params.conversationId,
            talkId: params.talkId,
            authorId: params.authorId,
            recipientId: params.responderId,
            attachment,
            sharedAt: timestamp,
          });
          const text = formatAttachmentShareMessageText(sharePayload);
          await this.ports.sendConversationMessage({
            conversationId: params.conversationId,
            senderId: params.authorId,
            recipientId: params.responderId,
            messageId,
            text,
          });
          await this.ports.postMailbox({
            kind: 'ipfs-conversation-share-v1',
            conversationId: params.conversationId,
            messageId,
            senderId: params.authorId,
            senderName: currentUser.stageName,
            recipientId: params.responderId,
            recipientName: params.responderName,
            text,
            timestamp,
          });
          this.ports.markProcessed(messageId);
          sent += 1;
        } finally {
          this.inFlight.delete(messageId);
        }
      } catch (error) {
        this.ports.onFailure?.('auto-share', error);
      }
    }

    this.ports.persistProcessed();
    return sent;
  }

  async ingestAttachmentShareFromMailbox(payload: MailboxAttachmentSharePayload): Promise<boolean> {
    if (!this.ports.currentUser()?.id) return false;
    if (payload.kind !== 'ipfs-conversation-share-v1') return false;
    const messageId = String(payload.messageId || '').trim();
    if (!messageId || this.ports.hasProcessed(messageId) || this.inFlight.has(messageId)) return false;
    if (await this.ports.isBlockedEitherWay(payload.senderId)) return false;
    // The block lookup is asynchronous; another drain may have claimed this id while it ran.
    if (this.ports.hasProcessed(messageId) || this.inFlight.has(messageId)) return false;

    this.inFlight.add(messageId);
    try {
      await this.ports.ingestConversationMessage({ ...payload, messageId });
      const sharePayload = parseAttachmentShareMessageText(payload.text);
      if (sharePayload) {
        try {
          void Promise.resolve(this.ports.fetchSharedAttachment(sharePayload, payload.senderId))
            .catch((error) => this.ports.onFailure?.('mailbox-fetch', error));
        } catch (error) {
          this.ports.onFailure?.('mailbox-fetch', error);
        }
      }
      this.ports.markProcessed(messageId);
      this.ports.persistProcessed();
      return true;
    } finally {
      this.inFlight.delete(messageId);
    }
  }
}
