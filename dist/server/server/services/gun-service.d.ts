export declare class GunService {
    private gun;
    private peers;
    constructor();
    private setupEventHandlers;
    /**
     * Get Gun instance for direct access
     */
    getGun(): any;
    /**
     * Store data with automatic conflict resolution
     */
    put(key: string, data: any): Promise<void>;
    /**
     * Retrieve data by key
     */
    get(key: string): Promise<any>;
    /**
     * Subscribe to real-time updates
     */
    subscribe(key: string, callback: (data: any) => void): () => void;
    /**
     * Add to a set/array
     */
    addToSet(setKey: string, itemKey: string, item: any): Promise<void>;
    /**
     * Get all items from a set
     */
    getSet(setKey: string): Promise<any[]>;
    /**
     * Remove from set
     */
    removeFromSet(setKey: string, itemKey: string): Promise<void>;
    /**
     * Create a secure private key for user encryption (Gun SEA)
     */
    createUserSEA(): Promise<any>;
    /**
     * Get network statistics
     */
    getNetworkStats(): any;
    /**
     * Clean up and close connections
     */
    shutdown(): void;
}
//# sourceMappingURL=gun-service.d.ts.map