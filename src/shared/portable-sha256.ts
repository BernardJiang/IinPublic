import { sha256 } from '@noble/hashes/sha256';

/** SHA-256 for browsers and embedded Node builds that do not expose global WebCrypto. */
export function portableSha256Hex(value: string): string {
  const digest = sha256(new TextEncoder().encode(value));
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
