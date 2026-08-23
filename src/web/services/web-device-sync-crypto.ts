import {
  type DeviceSyncBundle,
  type DeviceSyncCrypto,
  type DeviceSyncEndpoint,
  webCryptoDeviceSyncHash,
} from '../../shared/device-sync-contract';
import { canonicalSerialize } from '../../shared/p2p-runtime';
import SEA from 'gun/sea';
import { getSEA, type GunPair } from '../sea-gun';

export const DEVICE_SYNC_ENVELOPE_VERSION = 1 as const;

export interface EncryptedDeviceSyncEnvelope {
  version: typeof DEVICE_SYNC_ENVELOPE_VERSION;
  kind: 'iinpublic-device-sync-envelope';
  source: DeviceSyncEndpoint;
  targetDevicePub: string;
  authorizationId: string;
  ciphertext: string;
}

function sea(): any {
  return getSEA() ?? SEA;
}

/** SEA-backed manifest signing adapter for the current per-installation identity keys. */
export function createSeaDeviceSyncCrypto(pair: GunPair): DeviceSyncCrypto {
  const signerPub = String(pair.pub || '');
  if (!signerPub) throw new Error('device sync signing pair requires pub');
  return {
    hash: webCryptoDeviceSyncHash,
    sign: async (value: string) => {
      const signature = await sea().sign(value, pair);
      if (typeof signature !== 'string' || !signature) throw new Error('SEA failed to sign device sync payload');
      return signature;
    },
    verify: async (value: string, signature: string, pub: string) => {
      try {
        const verified = await sea().verify(signature, pub);
        const verifiedValue = typeof verified === 'string' ? verified : canonicalSerialize(verified);
        return verifiedValue === value;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Encrypt an already signed sync bundle to exactly the manifest's receiving epub.
 * The envelope exposes only endpoint routing keys; records, categories, counts,
 * hashes, and provenance remain inside SEA ECDH encryption.
 */
export async function encryptDeviceSyncBundle(
  bundle: DeviceSyncBundle,
  senderPair: GunPair,
): Promise<EncryptedDeviceSyncEnvelope> {
  const senderPub = String(senderPair.pub || '');
  const senderEpub = String(senderPair.epub || '');
  if (senderPub !== bundle.manifest.source.devicePub || senderEpub !== bundle.manifest.source.deviceEpub) {
    throw new Error('sync envelope sender does not match manifest source');
  }
  const targetEpub = bundle.manifest.target.deviceEpub;
  if (!targetEpub) throw new Error('sync manifest target requires epub');
  const sharedSecret = await sea().secret(targetEpub, senderPair);
  if (!sharedSecret) throw new Error('SEA failed to derive device sync secret');
  const scopedSecret = await deriveAuthorizationScopedSecret(
    String(sharedSecret),
    bundle.manifest.authorizationId,
    bundle.manifest.source.devicePub,
    bundle.manifest.target.devicePub,
  );
  const ciphertext = await sea().encrypt(JSON.stringify(bundle), scopedSecret);
  if (typeof ciphertext !== 'string' || !ciphertext) throw new Error('SEA failed to encrypt device sync bundle');
  return {
    version: DEVICE_SYNC_ENVELOPE_VERSION,
    kind: 'iinpublic-device-sync-envelope',
    source: bundle.manifest.source,
    targetDevicePub: bundle.manifest.target.devicePub,
    authorizationId: bundle.manifest.authorizationId,
    ciphertext,
  };
}

/** Decrypt only envelopes addressed to this installation and bind the plaintext back to its wrapper. */
export async function decryptDeviceSyncEnvelope(
  envelope: EncryptedDeviceSyncEnvelope,
  recipientPair: GunPair,
): Promise<DeviceSyncBundle> {
  if (!envelope || envelope.version !== DEVICE_SYNC_ENVELOPE_VERSION || envelope.kind !== 'iinpublic-device-sync-envelope') {
    throw new Error('unsupported or malformed device sync envelope');
  }
  const recipientPub = String(recipientPair.pub || '');
  if (!recipientPub || recipientPub !== envelope.targetDevicePub) throw new Error('device sync envelope is addressed to another device');
  if (!envelope.source?.deviceEpub || !envelope.authorizationId || !envelope.ciphertext) throw new Error('device sync envelope is incomplete');
  const sharedSecret = await sea().secret(envelope.source.deviceEpub, recipientPair);
  if (!sharedSecret) throw new Error('SEA failed to derive device sync secret');
  const scopedSecret = await deriveAuthorizationScopedSecret(
    String(sharedSecret),
    envelope.authorizationId,
    envelope.source.devicePub,
    recipientPub,
  );
  const decrypted = await sea().decrypt(envelope.ciphertext, scopedSecret);
  if (!decrypted) throw new Error('device sync envelope decryption failed');
  let bundle: DeviceSyncBundle;
  try {
    bundle = (typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted) as DeviceSyncBundle;
  } catch {
    throw new Error('device sync envelope plaintext is malformed');
  }
  if (
    bundle?.manifest?.source?.devicePub !== envelope.source.devicePub
    || bundle?.manifest?.source?.deviceEpub !== envelope.source.deviceEpub
    || bundle?.manifest?.target?.devicePub !== envelope.targetDevicePub
    || bundle?.manifest?.target?.devicePub !== recipientPub
    || bundle?.manifest?.authorizationId !== envelope.authorizationId
  ) throw new Error('device sync envelope endpoint binding mismatch');
  return bundle;
}

async function deriveAuthorizationScopedSecret(
  sharedSecret: string,
  authorizationId: string,
  sourceDevicePub: string,
  targetDevicePub: string,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto HKDF is unavailable for device sync');
  const encoder = new TextEncoder();
  const key = await subtle.importKey('raw', encoder.encode(sharedSecret), 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: encoder.encode(`iinpublic-sync-auth-v1|${authorizationId}`),
    info: encoder.encode(`${sourceDevicePub}|${targetDevicePub}`),
  }, key, 256);
  return Array.from(new Uint8Array(bits)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
