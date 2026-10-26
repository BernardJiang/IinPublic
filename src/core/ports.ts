/**
 * What the device core needs from its host (OPEN-91 P4): small interfaces the web worker, the
 * native Node process and unit tests each provide. Today the GUI's `WebGunService` provides them.
 */
import type { SeaSigningPair } from '../shared/p2p-runtime';

/** The device's private, encrypted store (never leaves the device). */
export type PrivateStore = {
  putPrivate(key: string, data: unknown): Promise<void>;
  getPrivate(key: string): Promise<unknown>;
};

export type SubscribablePrivateStore = PrivateStore & {
  /** Calls back with each new value of a private key; returns the unsubscribe. */
  subscribePrivate(key: string, callback: (data: any) => void): () => void;
};

/** This device's signing identity, and other people's public records. */
export type MeshIdentity = {
  getStoredPair(): (Partial<SeaSigningPair> & { pub?: string; priv?: string; epub?: string; epriv?: string }) | null;
  getPublicUser(userId: string): Promise<{ pub?: unknown } | null | undefined>;
};
