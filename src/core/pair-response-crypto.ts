/**
 * Pair-private Talk responses (OPEN-91 P4), moved out of `app.ts`: a response travels encrypted
 * with the secret the two people's keys derive (SEA ECDH), so only the author can read the
 * answers; a legacy plaintext response is still read. SEA and the peer's key lookup are passed in.
 */
import type { SeaSigningPair } from '../shared/p2p-runtime';

export type SeaPort = {
  secret(peerEpub: string, myPair: SeaSigningPair): Promise<string | undefined>;
  encrypt(data: string, secret: string): Promise<string>;
  decrypt(data: string, secret: string): Promise<unknown>;
};

export type PairResponseContent = {
  responderName: string;
  authorName: string;
  answers: any[];
  isChatbotResponse: boolean;
};

export async function pairSecret(sea: SeaPort, myPair: SeaSigningPair | null | undefined, peerId: string, peerEpub: string | null | undefined): Promise<string> {
  if (!myPair) throw new Error('No SEA keypair is available for pair-private talk response');
  if (!peerEpub) throw new Error(`Peer ${peerId} has no public encryption key`);
  const secret = await sea.secret(peerEpub, myPair);
  if (!secret) throw new Error(`No pair secret with ${peerId}`);
  return secret;
}

export async function encryptPairResponse(
  sea: SeaPort,
  myPair: SeaSigningPair | null | undefined,
  peerId: string,
  peerEpub: string | null | undefined,
  content: Record<string, unknown>,
): Promise<string> {
  return sea.encrypt(JSON.stringify(content), await pairSecret(sea, myPair, peerId, peerEpub));
}

/** The first non-empty key among the hints (the Talk's own author or sender key). */
export function firstKeyHint(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * A received response's content. An encrypted one carrying the responder's key inline decrypts
 * with no lookup (`onInlineKey` lets the caller remember it); otherwise the key is looked up.
 */
export async function decodePairResponse(
  sea: SeaPort,
  myPair: SeaSigningPair | null | undefined,
  responseData: any,
  resolvePeerEpub: (peerId: string, hint?: string) => Promise<string | null | undefined>,
  onInlineKey?: (peerId: string, epub: string) => void,
): Promise<PairResponseContent> {
  const answersOf = (value: any): any[] => (Array.isArray(value) ? value : JSON.parse(String(value || '[]')));
  if (responseData?.payloadCiphertext) {
    const peerId = String(responseData.responderId || responseData.authorId || '');
    const inlineEpub = typeof responseData.responderEpub === 'string' ? responseData.responderEpub.trim() : '';
    if (inlineEpub && peerId === String(responseData.responderId || '')) onInlineKey?.(peerId, inlineEpub);
    const epub = await resolvePeerEpub(peerId, inlineEpub || undefined);
    const decrypted = await sea.decrypt(String(responseData.payloadCiphertext), await pairSecret(sea, myPair, peerId, epub));
    if (!decrypted) throw new Error('Pair talk response payload could not be decrypted');
    const payload = (typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted) as Record<string, any>;
    return {
      responderName: String(payload.responderName || responseData.responderId || 'Unknown'),
      authorName: String(payload.authorName || responseData.authorId || 'Unknown'),
      answers: answersOf(payload.answers),
      isChatbotResponse: !!payload.isChatbotResponse,
    };
  }
  return {
    responderName: String(responseData.responderName || responseData.responderId || 'Unknown'),
    authorName: String(responseData.authorName || responseData.authorId || 'Unknown'),
    answers: answersOf(responseData.answers),
    isChatbotResponse: !!responseData.isChatbotResponse,
  };
}
