import Gun from 'gun';
import { EventEmitter } from 'events';

export class WebGunService extends EventEmitter {
  private gun: any;
  private peers: string[];
  private connected: boolean = false;

  constructor() {
    super();
    this.peers = ['ws://localhost:8080/gun'];
  }

  async initialize(): Promise<void> {
    try {
      // Initialize Gun.js for web
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

  async put(key: string, data: any): Promise<void> {
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

  async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      
      const off = this.gun.get(key).once((data: any) => {
        clearTimeout(timeout);
        if (data === undefined) {
          reject(new Error(`No data found for key: ${key}`));
        } else {
          resolve(data);
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