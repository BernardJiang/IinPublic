import Gun from 'gun';
import { EventEmitter } from 'events';

export class WebGunService extends EventEmitter {
  private gun: any;
  private peers: string[];
  private connected: boolean = false;

  constructor() {
    super();
    this.peers = []; // Start without WebSocket peers
  }

  async initialize(): Promise<void> {
    try {
      // Initialize Gun.js for web (localStorage-only mode for development)
      this.gun = Gun({
        peers: this.peers,
        localStorage: true, // Use localStorage in browser
        radisk: false
      });

      this.setupEventHandlers();
      this.connected = true;
      console.log('🔗 Gun.js web service initialized');
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
    if (obj instanceof Date) {
      return obj.toISOString();
    }
    if (Array.isArray(obj)) {
      // Convert arrays to objects with numeric keys for Gun.js compatibility
      const arrayObj: any = { _isArray: true };
      obj.forEach((item, index) => {
        arrayObj[index.toString()] = this.serializeDates(item);
      });
      return arrayObj;
    }
    if (obj && typeof obj === 'object') {
      const serialized: any = {};
      for (const key in obj) {
        serialized[key] = this.serializeDates(obj[key]);
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
      Object.keys(obj).forEach(key => {
        if (key !== '_isArray') {
          const index = parseInt(key);
          if (!isNaN(index)) {
            result[index] = this.deserializeDates(obj[key]);
          }
        }
      });
      return result;
    }
    if (obj && typeof obj === 'object') {
      const deserialized: any = {};
      for (const key in obj) {
        deserialized[key] = this.deserializeDates(obj[key]);
      }
      return deserialized;
    }
    return obj;
  }

  async put(key: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const serializedData = this.serializeDates(data);
      this.gun.get(key).put(serializedData, (ack: any) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve();
        }
      });
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