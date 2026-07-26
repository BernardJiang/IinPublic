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

export type UnsignedTechSupportIdentity = Omit<TechSupportIdentity, 'signature'>;

export function techSupportIdentitySigningPayload(identity: UnsignedTechSupportIdentity): string {
  return canonicalSerialize(identity);
}

/**
 * Build-time only (docs/TODO.md K3's `scripts/sign-techsupport-identity.js`) — signs the
 * identity record once with the announcement key and commits the result as
 * `src/shared/techsupport-identity.signed.json`. The server republishes that committed blob on
 * every boot and E2E reset without ever holding the private key at boot time.
 */
export async function signTechSupportIdentity(
  pair: { pub: string; epub: string; priv: string; epriv: string },
): Promise<TechSupportIdentity> {
  const unsigned: UnsignedTechSupportIdentity = {
    userId: TECHSUPPORT_ROOT_USER_ID,
    pub: pair.pub,
    epub: pair.epub,
    role: TECHSUPPORT_NETWORK_ROLE,
  };
  const signature = await SEA.sign(techSupportIdentitySigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport identity');
  return { ...unsigned, signature };
}

/**
 * Verify the identity record carried by the public Gun graph.
 *
 * With `expectedPub`, callers also enforce the compiled trust anchor. Without it,
 * this establishes only that the record is internally consistent and signed by
 * the public key it advertises; that is useful for peer discovery, but must not
 * be treated as an authority upgrade.
 */
export async function readVerifiedTechSupportIdentity(
  value: unknown,
  expectedPub?: string,
): Promise<TechSupportIdentity | null> {
  if (!value || typeof value !== 'object') return null;
  const identity = value as Partial<TechSupportIdentity>;
  if (!identity.pub || !identity.epub || !identity.signature) return null;
  if (identity.userId !== TECHSUPPORT_ROOT_USER_ID || identity.role !== TECHSUPPORT_NETWORK_ROLE) return null;
  if (expectedPub && identity.pub !== expectedPub) return null;
  const payload = canonicalSerialize({
    userId: identity.userId,
    pub: identity.pub,
    epub: identity.epub,
    role: identity.role,
  });
  const verified = await SEA.verify(identity.signature, identity.pub);
  if ((typeof verified === 'string' ? verified : canonicalSerialize(verified)) !== payload) return null;
  return {
    userId: identity.userId,
    pub: identity.pub,
    epub: identity.epub,
    role: identity.role,
    signature: identity.signature,
  };
}

export async function isVerifiedTechSupportIdentity(value: unknown, expectedPub: string): Promise<boolean> {
  return (await readVerifiedTechSupportIdentity(value, expectedPub)) !== null;
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
