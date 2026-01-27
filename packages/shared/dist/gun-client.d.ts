export declare const RELAY_URL = "http://localhost:8765/gun";
/**
 * Creates a configured Gun instance.
 * @param peers List of relay peers to connect to.
 */
export declare const createGunInstance: (peers?: string[]) => import("gun").IGunInstance<any>;
