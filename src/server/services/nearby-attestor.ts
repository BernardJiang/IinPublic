import { createHash, createHmac, generateKeyPairSync, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  nearbyAttestorKeyId,
  nearbyUtcDay,
  signNearbyAgeProof,
  signNearbyBeacon,
  type NearbyAgeProof,
  type NearbyAttestorKey,
  type NearbyBeacon,
} from '../../shared/nearby-v3-attestation';

/**
 * The hub's attestor for Nearby v3 ranking (nearby-v3-attestation.ts): it signs each UTC day's
 * beacon and, per key, the day it first saw that key's card.
 *
 * - The beacon is HMAC(seed, day): unpredictable without the seed, the same after a restart.
 * - First-seen days are an append-only log of `<day> <sha256(pub)>` lines, so the hub keeps no
 *   public keys and a key's age survives restarts. Memory-only (E2E, tests) keeps both in memory.
 *
 * The key and seed live in `<dir>/key.json` (`NEARBY_ATTESTOR_DIR`, default
 * `nearby-attestor-<port>` in the working directory), created on first start. Losing the file
 * changes the hub's key: phones that pinned nothing learn the new one; every key's age restarts.
 */
type StoredKey = { publicKey: string; priv: string; seed: string };

export type NearbyAttestorOptions = { dir?: string | null };

function defaultDir(): string {
  const port = process.env.PORT || '8080';
  return process.env.NEARBY_ATTESTOR_DIR || path.join(process.cwd(), `nearby-attestor-${port}`);
}

function base64Url(value: string): string {
  return value.replace(/=+$/, '');
}

/** A new P-256 pair in Gun SEA format: `pub` = `x.y`, `priv` = `d` (base64url). */
function generateSeaPair(): { publicKey: string; priv: string } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string; y: string; d: string };
  return { publicKey: `${base64Url(jwk.x)}.${base64Url(jwk.y)}`, priv: base64Url(jwk.d) };
}

function hashPub(pub: string): string {
  return createHash('sha256').update(`iinpublic:nearby-first-seen:v1:${pub}`).digest('base64url').slice(0, 22);
}

export class NearbyAttestor {
  readonly key: NearbyAttestorKey;
  private readonly priv: string;
  private readonly seed: Buffer;
  private readonly logPath: string | null;
  private readonly firstSeen = new Map<string, string>();
  private readonly beacons = new Map<string, Promise<NearbyBeacon>>();

  constructor(options: NearbyAttestorOptions = {}) {
    const dir = options.dir === undefined
      ? (process.env.E2E_GUN_MEMORY_ONLY === '1' || process.env.JEST_WORKER_ID ? null : defaultDir())
      : options.dir;
    let stored: StoredKey | null = null;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      const keyPath = path.join(dir, 'key.json');
      try {
        stored = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as StoredKey;
      } catch {
        stored = null;
      }
      if (!stored?.publicKey || !stored.priv || !stored.seed) {
        stored = { ...generateSeaPair(), seed: randomBytes(32).toString('hex') };
        fs.writeFileSync(keyPath, JSON.stringify(stored), { mode: 0o600 });
      }
      this.logPath = path.join(dir, 'first-seen.log');
      try {
        for (const line of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
          const [day, hashed] = line.split(' ');
          if (day && hashed && !this.firstSeen.has(hashed)) this.firstSeen.set(hashed, day);
        }
      } catch {
        // No log yet.
      }
    } else {
      stored = { ...generateSeaPair(), seed: randomBytes(32).toString('hex') };
      this.logPath = null;
    }
    this.key = { keyId: nearbyAttestorKeyId(stored.publicKey), publicKey: stored.publicKey };
    this.priv = stored.priv;
    this.seed = Buffer.from(stored.seed, 'hex');
  }

  /** Today's signed beacon (UTC). */
  beacon(nowMs = Date.now()): Promise<NearbyBeacon> {
    const day = nearbyUtcDay(nowMs);
    let beacon = this.beacons.get(day);
    if (!beacon) {
      const value = createHmac('sha256', this.seed).update(`iinpublic:nearby-beacon:v1:${day}`).digest('hex');
      beacon = signNearbyBeacon({ day, value, key: this.key, priv: this.priv });
      this.beacons.clear();
      this.beacons.set(day, beacon);
    }
    return beacon;
  }

  /** The signed day this key was first seen; the first call for a key records today. */
  async ageProof(pub: string, nowMs = Date.now()): Promise<NearbyAgeProof> {
    const hashed = hashPub(pub);
    let since = this.firstSeen.get(hashed);
    if (!since) {
      since = nearbyUtcDay(nowMs);
      this.firstSeen.set(hashed, since);
      if (this.logPath) {
        try {
          fs.appendFileSync(this.logPath, `${since} ${hashed}\n`);
        } catch {
          // Disk trouble: the key is still remembered until the next restart.
        }
      }
    }
    return signNearbyAgeProof({ pub, since, key: this.key, priv: this.priv });
  }

  /** E2E database clear: forget first-seen days (the key and seed stay). */
  clear(): void {
    this.firstSeen.clear();
    if (this.logPath) {
      try {
        fs.rmSync(this.logPath, { force: true });
      } catch {
        // Nothing to remove.
      }
    }
  }
}
