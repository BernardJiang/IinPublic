import Gun from 'gun';
import SEA from 'gun/sea';
import { logger } from '../logger';
import { resolveP2PRuntimeFlags, shouldSkipServerGunPersist } from '../../shared/p2p-runtime';

export class GunService {
  private gun: any;
  private peers: string[];

  constructor(existingGunInstance?: any) {
    if (existingGunInstance) {
      // Use the provided Gun instance (from HTTP server)
      this.gun = existingGunInstance;
      this.peers = [];
      logger.info('GunService using existing Gun instance from HTTP server');
    } else {
      // Create new Gun instance (for standalone use).
      // Default hub follows PORT env var so a standalone GunService running alongside a
      // parallel Playwright worker (web 3001+N ↔ gun 8080+N) targets the right Gun server
      // rather than always defaulting to 8080.
      const defaultPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
      this.peers = process.env.GUN_PEERS
        ? process.env.GUN_PEERS.split(',')
        : [`http://localhost:${Number.isFinite(defaultPort) ? defaultPort : 8080}/gun`];

      this.gun = Gun({
        peers: this.peers,
        localStorage: false, // Server-side, no localStorage
        radisk: true, // Enable persistent storage
        file: process.env.GUN_DATA_FILE || 'data.json',
      });
      logger.info('GunService created new Gun instance');
    }

    this.setupEventHandlers();
  }

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

  private setupEventHandlers(): void {
    this.gun.on('hi', (peer: any) => {
      logger.info({ peerId: peer.id }, 'Gun.js peer connected');
    });

    this.gun.on('bye', (peer: any) => {
      logger.info({ peerId: peer.id }, 'Gun.js peer disconnected');
    });
  }

  /**
   * Get Gun instance for direct access
   */
  public getGun(): any {
    return this.gun;
  }

  /**
   * Store data with automatic conflict resolution
   */
  public async put(key: string, data: any): Promise<void> {
    const path = key.split('/').filter((seg) => seg.length > 0);
    if (shouldSkipServerGunPersist(path, resolveP2PRuntimeFlags(process.env))) {
      return;
    }
    return new Promise((resolve, reject) => {
      this.gun.get(key).put(this.serializeDates(data), (ack: any) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve();
        }
      });
    });
  }

  public putFast(key: string, data: any): void {
    const path = key.split('/').filter((seg) => seg.length > 0);
    if (shouldSkipServerGunPersist(path, resolveP2PRuntimeFlags(process.env))) {
      return;
    }
    this.gun.get(key).put(this.serializeDates(data));
  }

  /**
   * Retrieve data by key
   */
  public async get(key: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Timeout reading key: ${key}`));
      }, 8000);
      timeoutId.unref?.();

      this.gun.get(key).once(
        (data: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (data === undefined) {
            reject(new Error(`No data found for key: ${key}`));
          } else {
            resolve(this.deserializeDates(data));
          }
        },
        { wait: 2000 },
      );
    });
  }

  public async getOptional(key: string, waitMs = 500): Promise<any | null> {
    return new Promise<any | null>((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, waitMs + 100);
      timeoutId.unref?.();

      this.gun.get(key).once(
        (data: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (data === undefined || data === null) {
            resolve(null);
          } else {
            resolve(this.deserializeDates(data));
          }
        },
        { wait: waitMs },
      );
    });
  }

  /**
   * Get data at a nested path (e.g. ['talks', talkId] or ['users', userId, 'conversations', convId])
   * so server can read the same graph shape the client uses.
   */
  public async getPath(path: string[], waitMs = 2000, timeoutMs = 3000): Promise<any> {
    if (path.length === 0) return undefined;
    return new Promise<any>((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(undefined);
      }, timeoutMs);
      timeoutId.unref?.();

      let ref: any = this.gun;
      for (const seg of path) {
        ref = ref.get(seg);
      }
      ref.once(
        (data: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(this.deserializeDates(data));
        },
        { wait: waitMs },
      );
    });
  }

  /**
   * Put data at a nested path (same graph shape as client).
   */
  public putPath(
    path: string[],
    data: any,
    options?: { supportChannel?: boolean; relayP0TalkDelivery?: boolean },
  ): Promise<void> {
    if (path.length === 0) return Promise.resolve();
    const flags = resolveP2PRuntimeFlags(process.env);
    if (shouldSkipServerGunPersist(path, flags, options)) {
      return Promise.resolve();
    }
    let ref: any = this.gun;
    for (const seg of path) {
      ref = ref.get(seg);
    }
    ref.put(this.serializeDates(data)); // fire-and-forget: ack callback can hang in-memory; data is written synchronously
    return Promise.resolve();
  }

  /**
   * Subscribe to real-time updates
   */
  public subscribe(key: string, callback: (data: any) => void): () => void {
    const off = this.gun.get(key).on((data: any, _key: string) => {
      callback(data);
    });

    return () => off.off();
  }

  /**
   * Add to a set/array
   */
  public async addToSet(setKey: string, itemKey: string, item: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.gun.get(setKey).set(this.gun.get(itemKey).put(item), (ack: any) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get all items from a set
   */
  public async getSet(setKey: string): Promise<any[]> {
    return new Promise((resolve) => {
      const items: any[] = [];

      this.gun
        .get(setKey)
        .map()
        .once((data: any, _key: string) => {
          if (data) {
            items.push({ ...data, _key });
          }
        });

      // Wait a bit for all items to be collected
      setTimeout(() => resolve(items), 500);
    });
  }

  /**
   * Remove from set
   */
  public async removeFromSet(setKey: string, itemKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.gun
        .get(setKey)
        .get(itemKey)
        .put(null, (ack: any) => {
          if (ack.err) {
            reject(new Error(ack.err));
          } else {
            resolve();
          }
        });
    });
  }

  /**
   * Create a secure keypair for user encryption (Gun SEA).
   */
  public async createUserSEA(): Promise<{
    pub: string;
    priv: string;
    epub: string;
    epriv: string;
  }> {
    return SEA.pair();
  }

  /**
   * Get network statistics
   */
  public getNetworkStats(): any {
    return {
      peers: this.gun._.opt.peers,
      connected: Object.keys(this.gun._.opt.mesh.hi || {}).length,
    };
  }

  /**
   * Clean up and close connections
   */
  public shutdown(): void {
    if (this.gun && this.gun._) {
      // Gun doesn't have a formal shutdown method, but we can clean up
      logger.info('Shutting down Gun.js service');
    }
  }
}
