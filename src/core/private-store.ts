/**
 * The owner's private records in the device core (OPEN-91 P5.2): what the WebView's worker Gun kept
 * under `users/<pub>/private/<key>` (SEA-encrypted by the owner's keypair) and its device-local
 * mirrors (the user id, the cached user record). The core stores what it is given — ciphertext for
 * private records, encrypted by the GUI, which holds the keypair; the node never sees plaintext.
 * Everything is under `local/`, which never leaves the device.
 */
import type { GraphStore } from './graph-store';

const PRIVATE_PATH = 'local/private';
const DEVICE_PATH = 'local/device';

/**
 * One node per key, plus the set of keys stored, loaded once and kept current: reading a key never
 * written then answers at once instead of waiting out storage's not-found grace period.
 */
class KeyedNodes {
  private known: Promise<Set<string>> | null = null;

  constructor(private readonly store: GraphStore, private readonly root: string) {}

  private keys(): Promise<Set<string>> {
    this.known ??= this.store.childKeys(this.root).then((keys) => new Set(keys)).catch((error) => {
      this.known = null; // storage busy: ask again next time
      throw error;
    });
    return this.known;
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    const encoded = encodeURIComponent(key);
    if (!(await this.keys()).has(encoded)) return null;
    return this.store.get(`${this.root}/${encoded}`);
  }

  async put(key: string, value: Record<string, unknown> | null): Promise<void> {
    const encoded = encodeURIComponent(key);
    await this.store.put(`${this.root}/${encoded}`, value);
    const known = await this.keys().catch(() => null);
    if (!known) return;
    if (value === null) known.delete(encoded);
    else known.add(encoded);
  }

  async list(): Promise<string[]> {
    return [...(await this.keys())].map((encoded) => decodeURIComponent(encoded));
  }
}

export class PrivateStore {
  private readonly privates: KeyedNodes;
  private readonly device: KeyedNodes;

  constructor(store: GraphStore) {
    this.privates = new KeyedNodes(store, PRIVATE_PATH);
    this.device = new KeyedNodes(store, DEVICE_PATH);
  }

  /** A private record's ciphertext (SEA), or null. */
  async getPrivate(key: string): Promise<string | null> {
    const node = await this.privates.get(key);
    return node && typeof node.v === 'string' ? node.v : null;
  }

  async putPrivate(key: string, ciphertext: string | null): Promise<void> {
    await this.privates.put(key, ciphertext === null ? null : { v: ciphertext });
  }

  privateKeys(): Promise<string[]> {
    return this.privates.list();
  }

  /** A device-local value (plain JSON: ids and caches only, never secrets). */
  async getDevice(path: string): Promise<unknown> {
    const node = await this.device.get(path);
    if (!node || typeof node.json !== 'string') return null;
    try {
      return JSON.parse(node.json);
    } catch {
      return null;
    }
  }

  async putDevice(path: string, value: unknown): Promise<void> {
    await this.device.put(path, value === null || value === undefined ? null : { json: JSON.stringify(value) });
  }
}
