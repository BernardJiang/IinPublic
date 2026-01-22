"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GunService = void 0;
const gun_1 = __importDefault(require("gun"));
class GunService {
    gun;
    peers;
    constructor() {
        this.peers = process.env.GUN_PEERS
            ? process.env.GUN_PEERS.split(',')
            : ['http://localhost:8080/gun'];
        this.gun = (0, gun_1.default)({
            peers: this.peers,
            localStorage: false, // Server-side, no localStorage
            radisk: true, // Enable persistent storage
            file: process.env.GUN_DATA_FILE || 'data.json'
        });
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.gun.on('hi', (peer) => {
            console.log(`🤝 Gun.js peer connected: ${peer.id}`);
        });
        this.gun.on('bye', (peer) => {
            console.log(`👋 Gun.js peer disconnected: ${peer.id}`);
        });
    }
    /**
     * Get Gun instance for direct access
     */
    getGun() {
        return this.gun;
    }
    /**
     * Store data with automatic conflict resolution
     */
    async put(key, data) {
        return new Promise((resolve, reject) => {
            this.gun.get(key).put(data, (ack) => {
                if (ack.err) {
                    reject(new Error(ack.err));
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Retrieve data by key
     */
    async get(key) {
        return new Promise((resolve, reject) => {
            this.gun.get(key).once((data) => {
                if (data === undefined) {
                    reject(new Error(`No data found for key: ${key}`));
                }
                else {
                    resolve(data);
                }
            }, { wait: 1000 }); // Wait up to 1 second for data
        });
    }
    /**
     * Subscribe to real-time updates
     */
    subscribe(key, callback) {
        const off = this.gun.get(key).on((data, _key) => {
            callback(data);
        });
        return () => off.off();
    }
    /**
     * Add to a set/array
     */
    async addToSet(setKey, itemKey, item) {
        return new Promise((resolve, reject) => {
            this.gun.get(setKey).set(this.gun.get(itemKey).put(item), (ack) => {
                if (ack.err) {
                    reject(new Error(ack.err));
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Get all items from a set
     */
    async getSet(setKey) {
        return new Promise((resolve) => {
            const items = [];
            this.gun.get(setKey).map().once((data, _key) => {
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
    async removeFromSet(setKey, itemKey) {
        return new Promise((resolve, reject) => {
            this.gun.get(setKey).get(itemKey).put(null, (ack) => {
                if (ack.err) {
                    reject(new Error(ack.err));
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Create a secure private key for user encryption (Gun SEA)
     */
    async createUserSEA() {
        // This would use Gun's SEA (Security, Encryption, Authorization)
        // For now, return a mock implementation
        return {
            pub: 'mock_public_key_' + Date.now(),
            priv: 'mock_private_key_' + Date.now()
        };
    }
    /**
     * Get network statistics
     */
    getNetworkStats() {
        return {
            peers: this.gun._.opt.peers,
            connected: Object.keys(this.gun._.opt.mesh.hi || {}).length
        };
    }
    /**
     * Clean up and close connections
     */
    shutdown() {
        if (this.gun && this.gun._) {
            // Gun doesn't have a formal shutdown method, but we can clean up
            console.log('🔌 Shutting down Gun.js service');
        }
    }
}
exports.GunService = GunService;
//# sourceMappingURL=gun-service.js.map