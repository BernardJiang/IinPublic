import Gun from 'gun';
import { EventEmitter } from 'events';
import { GunBridge, GunPair } from './gun-bridge';
import { getSEA } from '../sea-gun';
import { isDevStageZero } from '../dev-stage-env';
import type { User } from '../../shared/types';
import {
  KEY_RECOVERY_WARNINGS,
  toPublicSeaIdentity,
  type KeyCustodyRecord,
  type SeaPrivateIdentityMaterial,
} from '../../shared/p2p-runtime';
import {
  migrateRecord,
  type SchemaKind,
  type VersionedRecord,
} from '../../shared/p2p-schema-migrations';

const KEYPAIR_STORAGE = 'iinpublic_keypair';
export const KEY_CUSTODY_STORAGE = 'iinpublic_key_custody_v1';

/**
 * Pure form of WebGunService's page-origin → Gun-hub-URL derivation, factored
 * out so it's directly unit-testable (the class method only has `window` to
 * read from, which isn't convenient to fake in every test).
 *
 * Convention (dev + e2e parallel workers):
 *   web 3001 ↔ gun 8080   (single-worker default)
 *   web 3002 ↔ gun 8081   (parallel worker 1)
 *   web 3001+N ↔ gun 8080+N, for N in [0, DEV_E2E_WEB_PORT_RANGE_END-3001).
 *
 * S3 embedded-node (Electron/Android/iOS): the local node serves BOTH the SPA
 * and Gun on the SAME port (e.g. 8088 — see embedded-node-config.ts /
 * platforms/desktop/main.js / NodeForegroundService.kt), so Gun must be
 * derived as same-origin there, NOT via the dev/e2e offset. The range check
 * below (rather than a bare `webPort >= 3001`) is what tells the two apart:
 * dev/e2e web ports only ever live in a band starting at 3001, while
 * embedded-node ports (8080, 8088, or any operator-chosen port) fall outside it.
 *
 * The band's upper bound MUST cover `scripts/run-test-all.sh`'s concurrent-wave port
 * scheme: web = 3001 + E2E_PORT_OFFSET + workerIndex, where E2E_PORT_OFFSET is 0/100/200/300
 * across phases (see tests/e2e/helpers/ports.ts) and workerIndex can itself run past 20 on a
 * many-core machine — so real e2e web ports legitimately reach ~3300+. An earlier, tighter
 * bound (3001-3100) cut that off mid-band: every phase using offset >=100 (mass, stage5,
 * find-similar, mesh-isolated) got routed into the same-origin branch below and silently
 * pointed at a Gun endpoint that doesn't exist on that port (web and Gun are always separate
 * processes/ports in dev/e2e — see playwright.config.ts webServers — never same-origin there),
 * which broke cross-page sync outright rather than just slowing it down. 4001 leaves ~10x
 * headroom over current usage while still excluding realistic embedded-node ports.
 */
export function deriveGunHubUrlFromLocation(protocol: string, hostname: string, port: string): string {
  const webPort = Number(port);
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const DEV_E2E_WEB_PORT_RANGE_END = 3001 + 1000;
  const isDevE2EWebPort = Number.isFinite(webPort) && webPort >= 3001 && webPort < DEV_E2E_WEB_PORT_RANGE_END;
  if (isLocalHost && isDevE2EWebPort) {
    const gunPort = webPort - 3001 + 8080;
    return `${protocol}//${hostname}:${gunPort}/gun`;
  }
  if (isLocalHost && Number.isFinite(webPort) && webPort > 0) {
    // Embedded-node (or any other localhost port outside the dev/e2e band): Gun is
    // mounted on the SAME http server that serves this page — same-origin, no offset.
    return `${protocol}//${hostname}:${webPort}/gun`;
  }
  if (isLocalHost) {
    return `${protocol}//${hostname}:8080/gun`;
  }
  return `${protocol}//${hostname}/gun`;
}
export const KEY_CUSTODY_DEVICE_SECRET_STORAGE = 'iinpublic_key_custody_device_secret_v1';
const KEY_CUSTODY_ITERATIONS = 150_000;

/**
 * WebGunService — dual-mode Gun service.
 *
 * EXISTING API: the direct Gun instance is kept intact so existing services
 * (chatroom, talk, conversation) can continue to call `getGun()` without change.
 *
 * NEW API: a GunBridge worker is created alongside the direct instance, exposing
 * the Web-Worker-based path (IndexedDB persistence, SEA identity, private
 * encrypted space, flexible graph) via dedicated methods.  New features should
 * use `getBridge()` or the typed helpers on this class.
 */
export class WebGunService extends EventEmitter {
  private gun: any;
  private bridge: GunBridge;
  private peers: string[];
  private connected: boolean = false;
  /** In-memory copy of the SEA pair after `ensureKeypairAndAuth()`. */
  private seaPair: GunPair | null = null;

  constructor() {
    super();
    this.peers = [WebGunService.deriveGunHubUrl()];
    this.bridge = new GunBridge('/worker.js');
  }

  private isE2ERelaxedMode(): boolean {
    return process.env.DISABLE_HMR === 'true';
  }

  /**
   * Compute the Gun hub URL from the current page origin.
   *
   * When running outside a browser (SSR / unit test) falls back to the legacy default so
   * existing callers that construct this class in Node don't break.
   */
  private static deriveGunHubUrl(): string {
    if (typeof window === 'undefined' || !window.location) {
      // Node/SSR fallback: honour PORT env var so callers running inside a parallel
      // worker process (web 3001+N ↔ gun 8080+N) still target their own Gun server.
      const envPort = typeof process !== 'undefined' && process.env && process.env.PORT
        ? parseInt(process.env.PORT, 10)
        : 8080;
      return `http://localhost:${Number.isFinite(envPort) ? envPort : 8080}/gun`;
    }
    const { protocol, hostname, port } = window.location;
    return deriveGunHubUrlFromLocation(protocol, hostname, port);
  }

  async initialize(): Promise<void> {
    try {
      // ── Direct Gun instance (backward compat for existing services) ──
      // Gun AXE (axe.js) auto-adds localhost peers and can mesh multiple parallel e2e
      // webpack+Gun servers (3001/3002 ↔ 8080/8081), splitting graphs so headcounts stay at 1.
      // E2E bundles set DISABLE_HMR via webpack DefinePlugin — turn AXE off there only.
      // Do not gate on `typeof process` / `process.env`: webpack 5 browser bundles often have no
      // `process`, so the guard made e2eDisableAxe always false and AXE never disabled.
      const e2eDisableAxe = this.isE2ERelaxedMode();
      const devStageZero = isDevStageZero();
      const disableAxe = e2eDisableAxe || devStageZero;
      this.gun = Gun({
        peers: this.peers,
        localStorage: true,
        radisk: false,
        ...(disableAxe ? { axe: false, multicast: false } : {}),
      });

      await this.waitForHubPeer(disableAxe ? 12_000 : 5000);

      this.gun.on('hi', (peer: any) => {
        console.log('🤝 Gun peer connected:', peer.id || 'unknown');
      });
      this.gun.on('bye', (peer: any) => {
        console.log('👋 Gun peer disconnected:', peer.id || 'unknown');
      });

      // ── Worker bridge (new, IndexedDB-backed, SEA-enabled) ──
      // Non-fatal: if the bridge worker fails (e.g. script load error), the app
      // continues using the direct Gun instance for all existing functionality.
      try {
        await this.bridge.init({ hubUrl: this.peers[0] });
        console.log('🔗 Gun.js worker bridge ready (IndexedDB-backed via worker)');
      } catch (bridgeErr) {
        console.warn('⚠️ Gun worker bridge unavailable — SEA/IndexedDB features disabled:', bridgeErr);
      }

      this.connected = true;
      console.log('🔗 Gun.js initialized — hub:', this.peers[0]);
    } catch (error) {
      console.error('Failed to initialize Gun.js service:', error);
      throw error;
    }
  }

  /** Direct Gun instance — used by existing services (chatroom, talk, etc.). */
  getGun(): any {
    return this.gun;
  }

  /**
   * Worker-backed GunBridge — use for new features:
   * SEA identity, IndexedDB persistence, private encrypted space, graph nodes.
   */
  getBridge(): GunBridge {
    return this.bridge;
  }

  /* ── Serialization helpers ─────────────────────────────────────── */

  private serializeDates(obj: any): any {
    if (obj === undefined || obj === null) return null;
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) {
      const arrayObj: any = { _isArray: true, _length: obj.length, isArray: true, length: obj.length };
      obj.forEach((item, index) => {
        const serialized = this.serializeDates(item);
        if (serialized !== null && serialized !== undefined) {
          arrayObj[index.toString()] = serialized;
        }
      });
      return arrayObj;
    }
    if (obj && typeof obj === 'object') {
      const serialized: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = this.serializeDates(obj[key]);
          if (value !== undefined && value !== null) {
            serialized[key] = value;
          }
        }
      }
      return serialized;
    }
    return obj;
  }

  private deserializeDates(obj: any): any {
    if (typeof obj === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) {
      return new Date(obj);
    }
    if (obj && typeof obj === 'object' && (obj._isArray || obj.isArray)) {
      const result: any[] = [];
      const length = obj._length || obj.length || 0;
      for (let i = 0; i < length; i++) {
        if (Object.prototype.hasOwnProperty.call(obj, i.toString())) {
          result[i] = this.deserializeDates(obj[i.toString()]);
        }
      }
      return result;
    }
    if (obj && typeof obj === 'object') {
      const deserialized: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          deserialized[key] = this.deserializeDates(obj[key]);
        }
      }
      return deserialized;
    }
    return obj;
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  private base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  private getBrowserCrypto(): Crypto | null {
    return typeof globalThis !== 'undefined' && globalThis.crypto?.subtle ? globalThis.crypto : null;
  }

  private getOrCreateDeviceSecret(): string {
    if (typeof localStorage === 'undefined') {
      throw new Error('Browser localStorage is required for device-key custody');
    }
    const existing = localStorage.getItem(KEY_CUSTODY_DEVICE_SECRET_STORAGE);
    if (existing) return existing;
    const crypto = this.getBrowserCrypto();
    const bytes = new Uint8Array(32);
    if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    const secret = this.bytesToBase64(bytes);
    localStorage.setItem(KEY_CUSTODY_DEVICE_SECRET_STORAGE, secret);
    return secret;
  }

  private async deriveCustodyKey(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const crypto = this.getBrowserCrypto();
    if (!crypto) {
      throw new Error('WebCrypto is required for encrypted SEA key custody');
    }
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: this.bytesToArrayBuffer(salt), iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private async wrapKeypairForStorage(pair: GunPair, existing?: KeyCustodyRecord | null): Promise<KeyCustodyRecord> {
    const crypto = this.getBrowserCrypto();
    if (!crypto) {
      throw new Error('WebCrypto is required for encrypted SEA key custody');
    }
    const now = new Date().toISOString();
    const salt = new Uint8Array(16);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(salt);
    crypto.getRandomValues(iv);
    const secret = this.getOrCreateDeviceSecret();
    const key = await this.deriveCustodyKey(secret, salt, KEY_CUSTODY_ITERATIONS);
    const plaintext = new TextEncoder().encode(JSON.stringify(pair));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: this.bytesToArrayBuffer(iv) },
      key,
      this.bytesToArrayBuffer(plaintext),
    );
    return {
      version: 1,
      format: 'webcrypto-device-key-v1',
      publicIdentity: toPublicSeaIdentity(pair as SeaPrivateIdentityMaterial),
      wrapping: {
        kdf: 'PBKDF2-SHA256',
        iterations: KEY_CUSTODY_ITERATIONS,
        salt: this.bytesToBase64(salt),
        iv: this.bytesToBase64(iv),
      },
      ciphertext: this.bytesToBase64(new Uint8Array(encrypted)),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  }

  private async unwrapKeypairFromStorage(record: KeyCustodyRecord): Promise<GunPair | null> {
    try {
      if (record.version !== 1 || record.format !== 'webcrypto-device-key-v1') return null;
      const crypto = this.getBrowserCrypto();
      if (!crypto) return null;
      const secret = this.getOrCreateDeviceSecret();
      const salt = this.base64ToBytes(record.wrapping.salt);
      const iv = this.base64ToBytes(record.wrapping.iv);
      const key = await this.deriveCustodyKey(secret, salt, record.wrapping.iterations);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this.bytesToArrayBuffer(iv) },
        key,
        this.bytesToArrayBuffer(this.base64ToBytes(record.ciphertext)),
      );
      const pair = JSON.parse(new TextDecoder().decode(decrypted)) as GunPair;
      if (!pair?.pub || !pair?.epub || !pair?.priv || !pair?.epriv) return null;
      return pair;
    } catch {
      return null;
    }
  }

  private readCustodyRecord(): KeyCustodyRecord | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY_CUSTODY_STORAGE);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as KeyCustodyRecord;
    } catch {
      return null;
    }
  }

  private async persistCustodyRecord(pair: GunPair, existing?: KeyCustodyRecord | null): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    const record = await this.wrapKeypairForStorage(pair, existing);
    localStorage.setItem(KEY_CUSTODY_STORAGE, JSON.stringify(record));
    localStorage.removeItem(KEYPAIR_STORAGE);
  }

  /* ── Core graph operations (direct Gun — backward compat) ──────── */

  /** Wait until the relay hub accepts connections (avoids puts racing server boot / graph wipe). */
  private waitForHubPeer(maxMs: number): Promise<void> {
    const gun = this.gun;
    if (!gun) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      gun.on('hi', finish);
      setTimeout(finish, maxMs);
    });
  }

  async put(key: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const serializedData = this.serializeDates(data);
        const relaxAck = isDevStageZero() || this.isE2ERelaxedMode();
        let settled = false;
        const done = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve();
        };

        const timeout = setTimeout(() => {
          if (relaxAck) {
            console.warn(`Gun put ack timed out (relaxed mode), continuing optimistically: ${key}`);
            done();
          } else {
            done(new Error('Gun.js put operation timed out'));
          }
        }, relaxAck ? 12_000 : 5000);

        this.gun.get(key).put(serializedData, (ack: any) => {
          if (ack?.err) {
            done(new Error(String(ack.err)));
          } else {
            console.log('✅ Gun put success:', key);
            done();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const off = this.gun.get(key).once((data: any) => {
        clearTimeout(timeout);
        if (data === undefined) {
          reject(new Error(`No data found for key: ${key}`));
        } else {
          resolve(this.deserializeDates(data));
        }
      });

      const timeout = setTimeout(() => {
        off.off();
        reject(new Error(`Timeout getting data for key: ${key}`));
      }, 8000);
    });
  }

  /** Read the public user graph record stored at `users/<id>`. */
  async getPublicUser(userId: string): Promise<Partial<User>> {
    return this.get(`users/${userId}`) as Promise<Partial<User>>;
  }

  subscribe(key: string, callback: (data: any) => void): () => void {
    const off = this.gun.get(key).on((data: any) => {
      callback(data);
      this.emit('newMessage', data);
    });
    return () => off.off();
  }

  /* ── Identity (SEA) — routed through the worker bridge ─────────── */

  createAccount(): Promise<{ pub: string; epub: string }> {
    return this.bridge.createAccount();
  }

  login(pair: GunPair): Promise<{ pub: string; epub: string }> {
    return this.bridge.login(pair);
  }

  logout(): Promise<void> {
    return this.bridge.logout();
  }

  /** Write to the current user's public namespace (readable by all). */
  putPublic(key: string, data: any): Promise<void> {
    return this.bridge.putPublic(key, this.serializeDates(data));
  }

  /** Write to the current user's private namespace (AES-encrypted, owner-only). */
  async putPrivate(key: string, data: any): Promise<void> {
    const pair = this.seaPair;
    if (!pair) {
      throw new Error('SEA keypair not authenticated');
    }
    const SEA = getSEA();
    const encrypted = await SEA.encrypt(JSON.stringify(this.serializeDates(data)), pair);
    const parts = key.split('/').filter(Boolean);
    let ref = this.gun.user().get('private');
    for (const part of parts) {
      ref = ref.get(part);
    }
    await new Promise<void>((resolve, reject) => {
      const relaxAck = isDevStageZero() || this.isE2ERelaxedMode();
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      };
      const timeout = setTimeout(() => {
        if (relaxAck) {
          console.warn(`Gun private put ack timed out (relaxed mode), continuing optimistically: ${key}`);
          done();
        } else {
          done(new Error(`Gun private put operation timed out: ${key}`));
        }
      }, relaxAck ? 12_000 : 5000);
      ref.put(encrypted, (ack: any) => {
        if (ack?.err) {
          done(new Error(String(ack.err)));
        } else {
          done();
        }
      });
    });
  }

  /** Read and decrypt from the current user's private namespace. */
  async getPrivate(key: string): Promise<any> {
    const pair = this.seaPair;
    if (!pair) {
      throw new Error('SEA keypair not authenticated');
    }
    const SEA = getSEA();
    const parts = key.split('/').filter(Boolean);
    let ref = this.gun.user().get('private');
    for (const part of parts) {
      ref = ref.get(part);
    }
    const raw = await new Promise<any>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 4000);
      ref.once((data: any) => {
        clearTimeout(timeout);
        resolve(data ?? null);
      });
    });
    if (!raw) {
      return null;
    }
    const decrypted = await SEA.decrypt(raw as string, pair);
    if (!decrypted) {
      return null;
    }
    const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    return this.deserializeDates(parsed);
  }

  /* ── Flexible Graph schema ─────────────────────────────────────── */

  /** Create a named node in the shared graph. */
  createNode(nodeId: string, nodeData: Record<string, any>): Promise<{ nodeId: string }> {
    return this.bridge.createNode(nodeId, this.serializeDates(nodeData));
  }

  /**
   * Create a directed edge between two nodes.
   * Stored at: edges/<fromId>/<edgeLabel>/<toId>
   */
  linkNodes(fromId: string, toId: string, edgeLabel = 'link'): Promise<void> {
    return this.bridge.linkNodes(fromId, toId, edgeLabel);
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Load or create a SEA keypair, persist as an encrypted custody record, and `gun.user().auth(pair)`.
   * Call after `initialize()`.
   */
  async ensureKeypairAndAuth(): Promise<GunPair> {
    const SEA = getSEA();
    if (!SEA?.pair) {
      throw new Error('Gun SEA not loaded');
    }
    if (!this.gun) {
      throw new Error('Gun not initialized');
    }
    let legacyRaw: string | null = null;
    let existingCustody: KeyCustodyRecord | null = null;
    try {
      if (typeof localStorage !== 'undefined') {
        legacyRaw = localStorage.getItem(KEYPAIR_STORAGE);
        existingCustody = this.readCustodyRecord();
      }
    } catch {
      legacyRaw = null;
      existingCustody = null;
    }
    let pair: GunPair;
    const custodyPair = existingCustody ? await this.unwrapKeypairFromStorage(existingCustody) : null;
    if (custodyPair) {
      pair = custodyPair;
    } else if (legacyRaw) {
      try {
        pair = JSON.parse(legacyRaw) as GunPair;
        if (!pair?.pub || !pair?.priv) {
          pair = await SEA.pair();
        }
      } catch {
        pair = await SEA.pair();
      }
    } else {
      pair = await SEA.pair();
    }
    try {
      await this.persistCustodyRecord(pair, existingCustody);
    } catch (error) {
      console.warn('⚠️ Encrypted SEA key custody unavailable — keeping pair in memory only:', error);
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(KEYPAIR_STORAGE);
      } catch {
        /* ignore */
      }
      /* ignore quota / private mode */
    }

    const gun = this.gun;
    await new Promise<void>((resolve, reject) => {
      gun.user().auth(pair, (ack: any) => {
        if (ack && ack.err) {
          reject(new Error(String(ack.err)));
        } else {
          resolve();
        }
      });
    });

    try {
      await this.bridge.login(pair);
    } catch (error) {
      console.warn('⚠️ Gun worker bridge login unavailable — private SEA helpers disabled:', error);
    }

    this.seaPair = pair;
    return pair;
  }

  /** Active session pair after `ensureKeypairAndAuth()`. */
  getStoredPair(): GunPair | null {
    return this.seaPair;
  }

  getKeyCustodyStatus(): { active: boolean; publicIdentity?: { pub: string; epub: string }; format?: string } {
    const record = this.readCustodyRecord();
    if (!record) return { active: false };
    return { active: true, publicIdentity: record.publicIdentity, format: record.format };
  }

  exportKeyRecoveryPackage(): string {
    const record = this.readCustodyRecord();
    if (!record) {
      throw new Error('No encrypted key custody record is available to export');
    }
    return JSON.stringify({
      version: 1,
      kind: 'iinpublic-sea-key-recovery',
      warnings: KEY_RECOVERY_WARNINGS,
      custody: record,
    });
  }

  async importKeyRecoveryPackage(raw: string): Promise<{ pub: string; epub: string }> {
    const parsed = JSON.parse(raw) as { custody?: KeyCustodyRecord };
    if (!parsed?.custody) {
      throw new Error('Invalid key recovery package');
    }
    const pair = await this.unwrapKeypairFromStorage(parsed.custody);
    if (!pair) {
      throw new Error('Unable to decrypt imported key recovery package on this device');
    }
    await this.persistCustodyRecord(pair, parsed.custody);
    this.seaPair = pair;
    return toPublicSeaIdentity(pair as SeaPrivateIdentityMaterial);
  }

  /**
   * P2P-X: Run the schema migrator on a Gun-loaded record before returning it
   * to callers.  If the record is already at the current schema version this is
   * a cheap identity pass-through.
   *
   * Usage:
   *   const record = this.migrateOnRead('presence', rawRecord);
   */
  migrateOnRead<T extends Record<string, unknown>>(
    kind: SchemaKind,
    record: T,
  ): T & VersionedRecord {
    return migrateRecord(kind, record);
  }
}
