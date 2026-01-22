import { EventEmitter } from 'events';
export declare class WebGunService extends EventEmitter {
    private gun;
    private peers;
    private connected;
    constructor();
    initialize(): Promise<void>;
    private setupEventHandlers;
    getGun(): any;
    put(key: string, data: any): Promise<void>;
    get(key: string): Promise<any>;
    subscribe(key: string, callback: (data: any) => void): () => void;
    isConnected(): boolean;
}
//# sourceMappingURL=web-gun-service.d.ts.map