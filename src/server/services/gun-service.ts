import Gun from 'gun';

export class GunService {
  private gun: any;
  private peers: string[];

  constructor(existingGunInstance?: any) {
    if (existingGunInstance) {
      // Use the provided Gun instance (from HTTP server)
      this.gun = existingGunInstance;
      this.peers = [];
      console.log('✅ GunService using existing Gun instance from HTTP server');
    } else {
      // Create new Gun instance (for standalone use)
      this.peers = process.env.GUN_PEERS
        ? process.env.GUN_PEERS.split(',')
        : ['http://localhost:8080/gun'];

      this.gun = Gun({
        peers: this.peers,
        localStorage: false, // Server-side, no localStorage
        radisk: true, // Enable persistent storage
        file: process.env.GUN_DATA_FILE || 'data.json',
      });
      console.log('✅ GunService created new Gun instance');
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.gun.on('hi', (peer: any) => {
      console.log(`🤝 Gun.js peer connected: ${peer.id}`);
    });

    this.gun.on('bye', (peer: any) => {
      console.log(`👋 Gun.js peer disconnected: ${peer.id}`);
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
    return new Promise((resolve, reject) => {
      this.gun.get(key).put(data, (ack: any) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Retrieve data by key
   */
  public async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.gun.get(key).once(
        (data: any) => {
          if (data === undefined) {
            reject(new Error(`No data found for key: ${key}`));
          } else {
            resolve(data);
          }
        },
        { wait: 1000 },
      ); // Wait up to 1 second for data
    });
  }

  /**
   * Get data at a nested path (e.g. ['talks', talkId] or ['users', userId, 'conversations', convId])
   * so server can read the same graph shape the client uses.
   */
  public async getPath(path: string[]): Promise<any> {
    if (path.length === 0) return undefined;
    return new Promise((resolve) => {
      let ref: any = this.gun;
      for (const seg of path) {
        ref = ref.get(seg);
      }
      ref.once(
        (data: any) => {
          resolve(data);
        },
        { wait: 2000 },
      );
    });
  }

  /**
   * Put data at a nested path (same graph shape as client).
   */
  public async putPath(path: string[], data: any): Promise<void> {
    if (path.length === 0) return;
    return new Promise((resolve, reject) => {
      let ref: any = this.gun;
      for (const seg of path) {
        ref = ref.get(seg);
      }
      ref.put(data, (ack: any) => {
        if (ack?.err) {
          reject(new Error(ack.err));
        } else {
          resolve();
        }
      });
    });
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
   * Create a secure private key for user encryption (Gun SEA)
   */
  public async createUserSEA(): Promise<any> {
    // This would use Gun's SEA (Security, Encryption, Authorization)
    // For now, return a mock implementation
    return {
      pub: 'mock_public_key_' + Date.now(),
      priv: 'mock_private_key_' + Date.now(),
    };
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
      console.log('🔌 Shutting down Gun.js service');
    }
  }
}
