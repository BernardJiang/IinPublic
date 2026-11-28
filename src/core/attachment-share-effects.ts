/**
 * Portable orchestration for matched-Talk attachment shares.
 *
 * The host owns key custody, transport, persistence, IPFS and UI refreshes. This coordinator owns
 * the policy that must be identical in every host: author/block gates, stable-message idempotency,
 * send ordering, per-attachment failure isolation and receive-before-fetch ordering.
 */
import type { IpfsAttachment } from '../shared/types';
import {
  attachmentShareRetractionPayload,
  attachmentShareMessageId,
  formatAttachmentShareRetractionText,
  formatAttachmentShareMessageText,
  parseAttachmentShareMessageText,
  type AttachmentShareMessagePayload,
} from './attachment-share';
import { computeCIDv1 } from '../shared/cid';

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

export type AttachmentShareFailureContext = 'auto-share' | 'mailbox-fetch' | 'retraction';

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
  hasFetched(cid: string): boolean;
  canDecryptAttachments(): boolean;
  resolveSenderEpub(senderId: string): Promise<string>;
  verifyKeyCiphertext(
    payload: AttachmentShareMessagePayload,
    senderId: string,
    senderEpub: string,
  ): Promise<boolean>;
  requestAttachment(params: {
    conversationId: string;
    recipientId: string;
    senderId: string;
    cid: string;
  }): Promise<void>;
  fetchAttachmentBytes(payload: AttachmentShareMessagePayload, senderEpub: string): Promise<Uint8Array | null>;
  storeFetched(cid: string, bytes: Uint8Array): void;
  attachmentFetched(): void;
  sleep(delayMs: number): Promise<void>;
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

export type RetractSharedAttachmentsParams = {
  talkId: string;
  authorId: string;
  conversationPeerId: string;
  conversationId: string;
  attachments: IpfsAttachment[];
  retractedAt: number;
};

export type AttachmentFetchResult = 'fetched' | 'already-fetched' | 'blocked' | 'no-key' | 'exhausted';

export class AttachmentShareEffects {
  private readonly inFlight = new Set<string>();
  private readonly fetchesInFlight = new Set<string>();

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
          void this.fetchSharedAttachmentBytes(sharePayload, payload.senderId)
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

  async fetchSharedAttachmentBytes(
    payload: AttachmentShareMessagePayload,
    senderId: string,
    attempts = 6,
  ): Promise<AttachmentFetchResult> {
    const cid = String(payload.cid || '').trim();
    if (!cid || this.ports.hasFetched(cid)) return 'already-fetched';
    if (this.fetchesInFlight.has(cid)) return 'already-fetched';

    this.fetchesInFlight.add(cid);
    try {
      if (await this.ports.isBlockedEitherWay(senderId)) return 'blocked';
      if (!this.ports.canDecryptAttachments()) return 'no-key';

      const senderEpub = await this.ports.resolveSenderEpub(senderId);
      if (payload.enc === 'sea-pair'
        && !await this.ports.verifyKeyCiphertext(payload, senderId, senderEpub)) {
        throw new Error('Attachment share key decrypt failed');
      }

      const recipientId = this.ports.currentUser()?.id;
      for (let attempt = 0; attempt < attempts && !this.ports.hasFetched(cid); attempt += 1) {
        if (recipientId && senderId && payload.conversationId) {
          await this.ports.requestAttachment({
            conversationId: payload.conversationId,
            recipientId,
            senderId,
            cid,
          }).catch(() => { /* session not ready yet; the next pass retries */ });
        }
        if (this.ports.hasFetched(cid)) return 'fetched';

        let bytes: Uint8Array | null = null;
        try {
          bytes = await this.ports.fetchAttachmentBytes(payload, senderEpub);
        } catch {
          /* content is not reachable yet; retry below */
        }
        if (bytes) {
          this.ports.storeFetched(cid, bytes);
          this.ports.attachmentFetched();
          return 'fetched';
        }
        if (attempt < attempts - 1) await this.ports.sleep(1_500 * (attempt + 1));
      }
      return this.ports.hasFetched(cid) ? 'fetched' : 'exhausted';
    } finally {
      this.fetchesInFlight.delete(cid);
    }
  }

  async markSharedAttachmentLinksDead(params: RetractSharedAttachmentsParams): Promise<number> {
    const currentUser = this.ports.currentUser();
    if (!currentUser?.id || params.attachments.length === 0) return 0;

    let sent = 0;
    for (const attachment of params.attachments) {
      try {
        const messageId = await computeCIDv1({
          kind: 'ipfs-auto-share-retracted-v1',
          conversationId: params.conversationId,
          talkRef: `${params.talkId}::${params.authorId}`,
          cid: attachment.cid,
        });
        if (this.ports.hasProcessed(messageId) || this.inFlight.has(messageId)) continue;

        this.inFlight.add(messageId);
        try {
          const text = formatAttachmentShareRetractionText(attachmentShareRetractionPayload(
            params.talkId,
            params.authorId,
            attachment.cid,
            params.retractedAt,
          ));
          await this.ports.sendConversationMessage({
            conversationId: params.conversationId,
            senderId: currentUser.id,
            recipientId: params.conversationPeerId,
            messageId,
            text,
          });
          this.ports.markProcessed(messageId);
          sent += 1;
        } finally {
          this.inFlight.delete(messageId);
        }
      } catch (error) {
        this.ports.onFailure?.('retraction', error);
      }
    }
    this.ports.persistProcessed();
    return sent;
  }
}
