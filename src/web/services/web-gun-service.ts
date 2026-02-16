import Gun from 'gun';
import { EventEmitter } from 'events';

export class WebGunService extends EventEmitter {
  private gun: any;
  private peers: string[];
  private connected: boolean = false;

  constructor() {
    super();
    // Connect to Gun.js server for peer synchronization
    this.peers = ['http://localhost:8080/gun'];
  }

  async initialize(): Promise<void> {
    try {
      // Initialize Gun.js for web
      this.gun = Gun({
        peers: this.peers,
        localStorage: true, // Use localStorage in browser
        radisk: false,
        axe: false, // Disable automatic relay
      });

      this.setupEventHandlers();
      this.connected = true;
      console.log('🔗 Gun.js web service initialized with peers:', this.peers);

      // Log connection status after a delay
      setTimeout(() => {
        console.log('📊 Gun.js mesh status:', Object.keys(this.gun._.opt.peers));
      }, 2000);
    } catch (error) {
      console.error('Failed to initialize Gun.js web service:', error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    this.gun.on('hi', (peer: any) => {
      console.log('🤝 Gun.js peer connected:', peer.id || 'unknown');
    });

    this.gun.on('bye', (peer: any) => {
      console.log('👋 Gun.js peer disconnected:', peer.id || 'unknown');
    });
  }

  getGun(): any {
    return this.gun;
  }

  private serializeDates(obj: any): any {
    // Filter out undefined values - Gun.js doesn't accept them
    if (obj === undefined || obj === null) {
      return null;
    }
    if (obj instanceof Date) {
      return obj.toISOString();
    }
    if (Array.isArray(obj)) {
      // Convert arrays to objects with numeric keys for Gun.js compatibility
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
        if (obj.hasOwnProperty(key)) {
          const value = this.serializeDates(obj[key]);
          // Only include defined values
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
      // Convert Gun.js array objects back to arrays
      const result: any[] = [];
      const length = obj._length || 0;
      for (let i = 0; i < length; i++) {
        if (obj.hasOwnProperty(i.toString())) {
          result[i] = this.deserializeDates(obj[i.toString()]);
        }
      }
      return result;
    }
    if (obj && typeof obj === 'object') {
      const deserialized: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          deserialized[key] = this.deserializeDates(obj[key]);
        }
      }
      return deserialized;
    }
    return obj;
  }

  async put(key: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const serializedData = this.serializeDates(data);
        console.log(
          '🔧 Serialized data for Gun.js:',
          key,
          JSON.stringify(serializedData).substring(0, 500),
        );

        // Use a timeout to detect if Gun.js never responds
        const timeout = setTimeout(() => {
          console.error('⏱️ Gun.js put timeout for key:', key);
          reject(new Error('Gun.js put operation timed out'));
        }, 5000);

        this.gun.get(key).put(serializedData, (ack: any) => {
          clearTimeout(timeout);

          console.log('📥 Gun.js acknowledgment:', ack);

          if (ack.err) {
            console.error('❌ Gun.js put error:', ack.err, 'for key:', key);
            reject(new Error(ack.err));
          } else if (ack.ok === 0) {
            console.warn('⚠️ Gun.js put returned ok=0 (no error but no success)');
            resolve(); // Still resolve since it's not an error
          } else {
            console.log('✅ Gun.js put success:', key);
            resolve();
          }
        });
      } catch (error) {
        console.error('❌ Serialization error:', error);
        reject(error);
      }
    });
  }

  async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;

      const off = this.gun.get(key).once((data: any) => {
        clearTimeout(timeout);
        if (data === undefined) {
          reject(new Error(`No data found for key: ${key}`));
        } else {
          const deserializedData = this.deserializeDates(data);
          resolve(deserializedData);
        }
      });

      // Timeout after 3 seconds
      timeout = setTimeout(() => {
        off.off();
        reject(new Error(`Timeout getting data for key: ${key}`));
      }, 3000);
    });
  }

  subscribe(key: string, callback: (data: any) => void): () => void {
    const off = this.gun.get(key).on((data: any) => {
      callback(data);
      this.emit('newMessage', data);
    });

    return () => off.off();
  }

  isConnected(): boolean {
    return this.connected;
  }
}
