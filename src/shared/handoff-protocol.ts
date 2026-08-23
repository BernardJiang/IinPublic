/**
 * Encrypted device-handoff transfer protocol (spec §11.2, docs/TODO.md §J).
 *
 * Two ALREADY-linked (§10) SEA identities exchange a one-time encrypted archive when a
 * public-PC installation is being erased. This is explicitly a *separate* authorization
 * from the mere existence of a link (identity-v1-semantics.md decision #5: "Data
 * migration/sync will require separate mutual, category-scoped authorization") — nothing
 * here runs unless the user on the erasing device explicitly presses "Save … first", and
 * nothing lands as usable data on the receiver until *that* user explicitly presses Import.
 *
 * Three record types, each a self-authenticating signed record in the shared public
 * graph (mirrors identity-linking.ts's own attestation/revocation shape and pipe-delimited
 * signing-input convention — a plain non-JSON-looking string, so `SEA.verify`'s
 * auto-JSON-parse-on-verify quirk never applies here; see web-ledger-service.ts's own
 * doc comment for the bug that convention avoids):
 *
 *  - `EpubAnnouncement` — publishes "this pub's encryption key is this epub", signed by
 *    the pub itself. Needed because linked devices are known only by their signing `pub`
 *    (§10's v1 design deliberately never resolves a peer's app-level userId), while
 *    SEA-encrypting *to* someone requires their `epub` — a different key. Without this
 *    signature, a third party could publish a false epub for a pub they don't control and
 *    intercept a handoff; the sender only trusts an epub whose announcement verifies
 *    against the exact pub the link was made with.
 *  - `HandoffEnvelope` — the encrypted archive itself: `ciphertext` is
 *    `SEA.encrypt(JSON.stringify(archive), SEA.secret(receiverEpub, senderPair))`, signed
 *    by the sender so the receiver knows it really came from the linked identity (not
 *    just "something decryptable" — decryptability alone doesn't prove origin, since the
 *    ECDH secret is symmetric and derivable by either side once epubs are known).
 *  - `HandoffAck` — the receiver's signed proof that the archive was imported. This is
 *    what the sender's Erase dialog waits for (spec §11.3: "erase stays disabled until
 *    the archive is acknowledged by the receiving device") — never inferred from mere
 *    local completion of the encrypt+write step.
 *
 * Pure (no Gun/DOM) so build/verify are unit-testable; a real SEA-backed `HandoffCrypto`
 * is injected by the web layer (web-device-handoff-service.ts), a deterministic mock by
 * tests.
 */

import type { HandoffArchive } from './device-handoff';

/** Injected crypto surface — real impl is SEA sign/verify/secret/encrypt/decrypt. */
export interface HandoffCrypto {
  sign(data: string): Promise<string>;
  verify(data: string, sig: string, pub: string): Promise<boolean>;
  /** ECDH shared secret between the caller's own keypair and `peerEpub`. */
  secret(peerEpub: string): Promise<string>;
  encrypt(plaintext: string, secret: string): Promise<string>;
  /** Returns undefined on decrypt failure (wrong secret, corrupted ciphertext) rather than throwing. */
  decrypt(ciphertext: string, secret: string): Promise<string | undefined>;
}

export interface EpubAnnouncement {
  pub: string;
  epub: string;
  issuedAt: number;
  sig: string;
}

export interface HandoffEnvelope {
  fromPub: string;
  toPub: string;
  ciphertext: string;
  sentAt: number;
  sig: string;
}

export interface HandoffAck {
  /** The receiver's own pub — the identity that signs the ack, proving it imported. */
  fromPub: string;
  /** The original archive sender's pub — who is waiting on this ack. */
  toPub: string;
  ackedAt: number;
  sig: string;
}

function epubSigningInput(a: Pick<EpubAnnouncement, 'pub' | 'epub' | 'issuedAt'>): string {
  return `handoff-epub|${a.pub}|${a.epub}|${a.issuedAt}`;
}

function envelopeSigningInput(e: Pick<HandoffEnvelope, 'fromPub' | 'toPub' | 'ciphertext' | 'sentAt'>): string {
  return `handoff-envelope|${e.fromPub}|${e.toPub}|${e.ciphertext}|${e.sentAt}`;
}

function ackSigningInput(a: Pick<HandoffAck, 'fromPub' | 'toPub' | 'ackedAt'>): string {
  return `handoff-ack|${a.fromPub}|${a.toPub}|${a.ackedAt}`;
}

export async function buildEpubAnnouncement(
  pub: string,
  epub: string,
  crypto: HandoffCrypto,
  now: number = Date.now(),
): Promise<EpubAnnouncement> {
  const issuedAt = now;
  const sig = await crypto.sign(epubSigningInput({ pub, epub, issuedAt }));
  return { pub, epub, issuedAt, sig };
}

export async function verifyEpubAnnouncement(a: EpubAnnouncement, crypto: HandoffCrypto): Promise<boolean> {
  if (!a || !a.pub || !a.epub || !a.sig) return false;
  return crypto.verify(epubSigningInput(a), a.sig, a.pub);
}

export async function buildHandoffEnvelope(args: {
  fromPub: string;
  toPub: string;
  ciphertext: string;
  crypto: HandoffCrypto;
  now?: number;
}): Promise<HandoffEnvelope> {
  const { fromPub, toPub, ciphertext, crypto } = args;
  const sentAt = args.now ?? Date.now();
  const sig = await crypto.sign(envelopeSigningInput({ fromPub, toPub, ciphertext, sentAt }));
  return { fromPub, toPub, ciphertext, sentAt, sig };
}

export async function verifyHandoffEnvelope(e: HandoffEnvelope, crypto: HandoffCrypto): Promise<boolean> {
  if (!e || !e.fromPub || !e.toPub || e.fromPub === e.toPub || !e.ciphertext || !e.sig) return false;
  return crypto.verify(envelopeSigningInput(e), e.sig, e.fromPub);
}

export async function buildHandoffAck(args: {
  fromPub: string;
  toPub: string;
  crypto: HandoffCrypto;
  now?: number;
}): Promise<HandoffAck> {
  const { fromPub, toPub, crypto } = args;
  const ackedAt = args.now ?? Date.now();
  const sig = await crypto.sign(ackSigningInput({ fromPub, toPub, ackedAt }));
  return { fromPub, toPub, ackedAt, sig };
}

export async function verifyHandoffAck(a: HandoffAck, crypto: HandoffCrypto): Promise<boolean> {
  if (!a || !a.fromPub || !a.toPub || a.fromPub === a.toPub || !a.sig) return false;
  return crypto.verify(ackSigningInput(a), a.sig, a.fromPub);
}

/**
 * Encrypt an archive for `toPub` using the sender's own keypair and the receiver's
 * verified epub, then wrap it in a signed envelope. Returns null if the archive can't be
 * JSON-serialized (shouldn't happen for a real `HandoffArchive`).
 */
export async function encryptHandoffArchive(args: {
  archive: HandoffArchive;
  fromPub: string;
  toPub: string;
  toEpub: string;
  crypto: HandoffCrypto;
  now?: number;
}): Promise<HandoffEnvelope> {
  const { archive, fromPub, toPub, toEpub, crypto } = args;
  const secret = await crypto.secret(toEpub);
  const ciphertext = await crypto.encrypt(JSON.stringify(archive), secret);
  return buildHandoffEnvelope({ fromPub, toPub, ciphertext, crypto, ...(args.now !== undefined ? { now: args.now } : {}) });
}

/**
 * Verify and decrypt an envelope back into a `HandoffArchive`. Returns null on any
 * failure (bad signature, wrong secret, malformed JSON) — callers must treat null as "not
 * a usable handoff," never partially trust a record that fails any one of these checks.
 */
export async function decryptHandoffArchive(
  envelope: HandoffEnvelope,
  fromEpub: string,
  crypto: HandoffCrypto,
): Promise<HandoffArchive | null> {
  if (!(await verifyHandoffEnvelope(envelope, crypto))) return null;
  const secret = await crypto.secret(fromEpub);
  const plaintext = await crypto.decrypt(envelope.ciphertext, secret);
  if (!plaintext) return null;
  try {
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== 'object' || parsed.fromPub !== envelope.fromPub) return null;
    return parsed as HandoffArchive;
  } catch {
    return null;
  }
}
