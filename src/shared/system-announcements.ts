import { canonicalSerialize, computeCIDv1 } from './cid';
import SEA from 'gun/sea';
import { TECHSUPPORT_NETWORK_ROLE, TECHSUPPORT_ROOT_USER_ID } from './techsupport';

export type SystemAnnouncement = {
  id: string;
  authorPub: string;
  text: string;
  createdAt: string;
  expiresAt: string;
  signature: string;
};

export type UnsignedSystemAnnouncement = Omit<SystemAnnouncement, 'signature'>;

export type TechSupportIdentity = {
  userId: string;
  pub: string;
  epub: string;
  role: string;
  signature: string;
};

export async function isVerifiedTechSupportIdentity(value: unknown, expectedPub: string): Promise<boolean> {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<TechSupportIdentity>;
  if (!identity.pub || !identity.epub || !identity.signature) return false;
  if (identity.userId !== TECHSUPPORT_ROOT_USER_ID || identity.role !== TECHSUPPORT_NETWORK_ROLE || identity.pub !== expectedPub) return false;
  const payload = canonicalSerialize({
    userId: identity.userId,
    pub: identity.pub,
    epub: identity.epub,
    role: identity.role,
  });
  const verified = await SEA.verify(identity.signature, identity.pub);
  return (typeof verified === 'string' ? verified : canonicalSerialize(verified)) === payload;
}

export function announcementSigningPayload(announcement: UnsignedSystemAnnouncement): string {
  return canonicalSerialize(announcement);
}

export function announcementAdminAuthorizationPayload(input: {
  text: string;
  expiresAt: string;
  requestedAt: string;
}): string {
  return canonicalSerialize({
    method: 'POST',
    path: '/api/admin/announcements',
    text: input.text,
    expiresAt: input.expiresAt,
    requestedAt: input.requestedAt,
  });
}

export async function createSystemAnnouncement(
  input: Omit<UnsignedSystemAnnouncement, 'id' | 'authorPub'>,
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<SystemAnnouncement> {
  const unsigned: UnsignedSystemAnnouncement = {
    id: await computeCIDv1(canonicalSerialize({ ...input, authorPub: pair.pub })),
    authorPub: pair.pub,
    ...input,
  };
  const signature = await SEA.sign(announcementSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign system announcement');
  return { ...unsigned, signature };
}

export async function isRenderableSystemAnnouncement(
  value: unknown,
  expectedAuthorPub: string,
  now = new Date(),
): Promise<boolean> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SystemAnnouncement>;
  if (!candidate.id || !candidate.authorPub || !candidate.text || !candidate.createdAt || !candidate.expiresAt || !candidate.signature) {
    return false;
  }
  if (candidate.authorPub !== expectedAuthorPub || new Date(candidate.expiresAt).getTime() <= now.getTime()) return false;
  const unsigned: UnsignedSystemAnnouncement = {
    id: candidate.id,
    authorPub: candidate.authorPub,
    text: candidate.text,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
  };
  const verified = await SEA.verify(candidate.signature, candidate.authorPub);
  return (typeof verified === 'string' ? verified : canonicalSerialize(verified)) === announcementSigningPayload(unsigned);
}
