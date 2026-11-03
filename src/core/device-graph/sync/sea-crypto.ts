/**
 * The graph's crypto port over Gun's SEA (passed in: the core imports no page or Node globals) and
 * the portable ECDSA signatures that work on the phone's embedded Node too.
 */
import { portableEcdsaSign, portableEcdsaVerify } from '../../../shared/portable-ecdsa';
import type { GraphCrypto } from './graph-sync';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function seaGraphCrypto(SEA: any, randomBytes: (length: number) => Uint8Array): GraphCrypto {
  return {
    secret: async (epub, pair) => (await SEA.secret(epub, pair)) || undefined,
    encrypt: async (data, key) => {
      const cipher = await SEA.encrypt(data, key);
      if (typeof cipher !== 'string' || !cipher.startsWith('SEA{')) throw new Error('SEA did not encrypt');
      return cipher;
    },
    decrypt: (data, key) => SEA.decrypt(data, key),
    sign: portableEcdsaSign,
    verify: portableEcdsaVerify,
    randomHex: (bytes) => Array.from(randomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
