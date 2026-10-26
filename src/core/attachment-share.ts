/**
 * Sharing a matched Talk's attachments in the conversation (OPEN-91 P4), moved out of `app.ts`:
 * the share message (an IPFS link plus a key envelope encrypted for the other person — file bytes
 * never travel through Gun or the mailbox), its stable id, and reading one back from message text.
 */
import { computeCIDv1 } from '../shared/cid';
import type { IpfsAttachment } from '../shared/types';

export type AttachmentShareMessagePayload = {
  kind: 'ipfs-auto-share-v1';
  conversationId: string;
  talkId: string;
  authorId: string;
  cid: string;
  link: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  enc: 'sea-pair' | 'none';
  keyCiphertext: string;
  sharedAt: string;
};

const MESSAGE_PREFIX = 'IPFS_SHARE:';

/** The same share always gets the same id, so a resend is not a second message. */
export function attachmentShareMessageId(conversationId: string, talkId: string, authorId: string, cid: string): Promise<string> {
  return computeCIDv1({ kind: 'ipfs-auto-share-v1', conversationId, talkRef: `${talkId}::${authorId}`, cid });
}

/** The key envelope (L5): transport material only, encrypted for the recipient by the caller. */
export function attachmentShareKeyPayload(talkId: string, authorId: string, attachment: IpfsAttachment): Record<string, unknown> {
  return {
    kind: 'ipfs-share-key-v1',
    talkRef: `${talkId}::${authorId}`,
    cid: attachment.cid,
    enc: attachment.enc,
    keyMaterial: `ipfs-share:${talkId}:${authorId}:${attachment.cid}`,
  };
}

export function attachmentSharePayload(
  params: { conversationId: string; talkId: string; authorId: string; attachment: IpfsAttachment },
  keyCiphertext: string,
  sharedAt: string,
): AttachmentShareMessagePayload {
  return {
    kind: 'ipfs-auto-share-v1',
    conversationId: params.conversationId,
    talkId: params.talkId,
    authorId: params.authorId,
    cid: params.attachment.cid,
    link: `ipfs://${params.attachment.cid}`,
    name: params.attachment.name,
    mimeType: params.attachment.mimeType,
    sizeBytes: params.attachment.sizeBytes,
    enc: params.attachment.enc as AttachmentShareMessagePayload['enc'],
    keyCiphertext,
    sharedAt,
  };
}

/** A share carried as message text (`IPFS_SHARE:{…}`); null for anything else or a malformed one. */
export function parseAttachmentShareMessageText(text: string): AttachmentShareMessagePayload | null {
  const raw = String(text || '');
  if (!raw.startsWith(MESSAGE_PREFIX)) return null;
  try {
    const payload = JSON.parse(raw.slice(MESSAGE_PREFIX.length));
    if (!payload || payload.kind !== 'ipfs-auto-share-v1') return null;
    if (!String(payload.cid || '').trim() || !String(payload.keyCiphertext || '').trim()) return null;
    return payload as AttachmentShareMessagePayload;
  } catch {
    return null;
  }
}
