import Gun from 'gun';
import { EventEmitter } from 'events';
import { GunBridge, GunPair } from './gun-bridge';
import { getSEA } from '../sea-gun';

const KEYPAIR_STORAGE = 'iinpublic_keypair';

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

  /**
   * Compute the Gun hub URL from the current page origin.
   *
   * Convention (dev + e2e parallel workers):
   *   web 3001 ↔ gun 8080   (single-worker default)
   *   web 3002 ↔ gun 8081   (parallel worker 1)
   *   web 3001+N ↔ gun 8080+N
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
    const webPort = Number(port);
    // Only apply the +8080-3001 offset for localhost dev/e2e; in prod the hub is on the same
    // origin without an explicit port and we preserve that behaviour.
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && Number.isFinite(webPort) && webPort >= 3001) {
      const gunPort = webPort - 3001 + 8080;
      return `${protocol}//${hostname}:${gunPort}/gun`;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}:8080/gun`;
    }
    return `${protocol}//${hostname}/gun`;
  }

  async initialize(): Promise<void> {
    try {
      // ── Direct Gun instance (backward compat for existing services) ──
      this.gun = Gun({
        peers: this.peers,
        localStorage: true,
        radisk: false,
      });

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
        console.log('🔗 Gun.js worker bridge ready');
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
      const arrayObj: any = { _isArray: true, _length: obj.length };
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
    if (obj && typeof obj === 'object' && obj._isArray) {
      const result: any[] = [];
      const length = obj._length || 0;
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

  /* ── Core graph operations (direct Gun — backward compat) ──────── */

  async put(key: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const serializedData = this.serializeDates(data);

        const timeout = setTimeout(() => {
          reject(new Error('Gun.js put operation timed out'));
        }, 5000);

        this.gun.get(key).put(serializedData, (ack: any) => {
          clearTimeout(timeout);
          if (ack.err) {
            reject(new Error(ack.err));
          } else {
            console.log('✅ Gun put success:', key);
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;

      const off = this.gun.get(key).once((data: any) => {
        clearTimeout(timeout);
        if (data === undefined) {
          reject(new Error(`No data found for key: ${key}`));
        } else {
          resolve(this.deserializeDates(data));
        }
      });

      timeout = setTimeout(() => {
        off.off();
        reject(new Error(`Timeout getting data for key: ${key}`));
      }, 8000);
    });
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
  putPrivate(key: string, data: any): Promise<void> {
    return this.bridge.putPrivate(key, this.serializeDates(data));
  }

  /** Read and decrypt from the current user's private namespace. */
  async getPrivate(key: string): Promise<any> {
    const raw = await this.bridge.getPrivate(key);
    return this.deserializeDates(raw);
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
   * Load or create a SEA keypair, persist under `iinpublic_keypair`, and `gun.user().auth(pair)`.
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
    let raw: string | null = null;
    try {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEYPAIR_STORAGE) : null;
    } catch {
      raw = null;
    }
    let pair: GunPair;
    if (raw) {
      try {
        pair = JSON.parse(raw) as GunPair;
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
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KEYPAIR_STORAGE, JSON.stringify(pair));
      }
    } catch {
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
    this.seaPair = pair;
    return pair;
  }

  /** Active session pair after `ensureKeypairAndAuth()`. */
  getStoredPair(): GunPair | null {
    return this.seaPair;
  }
}
