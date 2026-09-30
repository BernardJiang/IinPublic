import { sha256 } from '@noble/hashes/sha256';

function portableUtf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const symbol of value) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** SHA-256 for browsers and embedded Node builds that do not expose global WebCrypto. */
export function portableSha256Hex(value: string): string {
  const digest = sha256(portableUtf8Bytes(value));
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
