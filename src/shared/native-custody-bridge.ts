import type { SeaPrivateIdentityMaterial } from './p2p-runtime';

export type NativeCustodyProvider = 'android-keystore' | 'apple-keychain' | 'electron-safe-storage';

export type NativeCustodyDescription = {
  version: 1;
  provider: NativeCustodyProvider;
  /** true/false when the OS reports it; null when the platform cannot tell. Never assumed. */
  hardwareBacked: boolean | null;
  available: boolean;
};

/**
 * Narrow OS-keystore boundary. The native side owns the non-exportable wrapping key and the
 * ciphertext; the WebView only ever exchanges the SEA pair at unlock/write time.
 */
export interface NativeCustodyBridge {
  describe(): Promise<NativeCustodyDescription>;
  read(): Promise<SeaPrivateIdentityMaterial | null>;
  /** Native must encrypt, persist, read back, and compare before resolving. */
  write(pair: SeaPrivateIdentityMaterial): Promise<void>;
  /** Removes only when the stored public identity equals `pub`/`epub`. */
  remove(expected: { pub: string; epub: string }): Promise<void>;
}

const PROVIDERS: readonly NativeCustodyProvider[] = ['android-keystore', 'apple-keychain', 'electron-safe-storage'];

export function parseNativeCustodyDescription(raw: unknown): NativeCustodyDescription {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    !value || typeof value !== 'object' ||
    (value as { version?: unknown }).version !== 1 ||
    !PROVIDERS.includes((value as { provider?: NativeCustodyProvider }).provider as NativeCustodyProvider) ||
    typeof (value as { available?: unknown }).available !== 'boolean'
  ) {
    throw new Error('Invalid native custody description');
  }
  const hw = (value as { hardwareBacked?: unknown }).hardwareBacked;
  return {
    version: 1,
    provider: (value as NativeCustodyDescription).provider,
    hardwareBacked: typeof hw === 'boolean' ? hw : null,
    available: (value as NativeCustodyDescription).available,
  };
}

export function parseNativeCustodyPair(raw: unknown): SeaPrivateIdentityMaterial | null {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || 'error' in value || !('pair' in value)) {
    throw new Error('Native custody read failed');
  }
  const pair = (value as { pair: unknown }).pair;
  if (pair === null) return null;
  const p = pair as Record<string, unknown>;
  for (const key of ['pub', 'epub', 'priv', 'epriv']) {
    if (typeof p[key] !== 'string' || !(p[key] as string)) throw new Error('Invalid native custody pair');
  }
  return { pub: p.pub as string, epub: p.epub as string, priv: p.priv as string, epriv: p.epriv as string };
}

type AndroidCustodyGlobal = {
  describe(): string;
  read(): string;
  write(pairJson: string): string;
  remove(pub: string, epub: string): string;
};

type NativeWindow = {
  IinPublicCustody?: AndroidCustodyGlobal;
  webkit?: { messageHandlers?: { iinpublicCustody?: { postMessage(message: unknown): Promise<unknown> } } };
  iinpublicNative?: {
    custody?: {
      describe(): Promise<unknown>;
      read(): Promise<unknown>;
      write(pair: SeaPrivateIdentityMaterial): Promise<unknown>;
      remove(expected: { pub: string; epub: string }): Promise<unknown>;
    };
  };
};

function assertOk(raw: unknown): void {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || (value as { ok?: unknown }).ok !== true) throw new Error('Native custody operation failed');
}

/** Returns the platform's OS-keystore bridge, or null on plain browsers. */
export function detectNativeCustodyBridge(win: NativeWindow | undefined = globalThis as NativeWindow): NativeCustodyBridge | null {
  if (!win) return null;
  const android = win.IinPublicCustody;
  if (android) {
    return {
      describe: async () => parseNativeCustodyDescription(android.describe()),
      read: async () => parseNativeCustodyPair(android.read()),
      write: async (pair) => assertOk(android.write(JSON.stringify(pair))),
      remove: async ({ pub, epub }) => assertOk(android.remove(pub, epub)),
    };
  }
  const apple = win.webkit?.messageHandlers?.iinpublicCustody;
  if (apple) {
    return {
      describe: async () => parseNativeCustodyDescription(await apple.postMessage({ op: 'describe' })),
      read: async () => parseNativeCustodyPair(await apple.postMessage({ op: 'read' })),
      write: async (pair) => assertOk(await apple.postMessage({ op: 'write', pair })),
      remove: async (expected) => assertOk(await apple.postMessage({ op: 'remove', ...expected })),
    };
  }
  const electron = win.iinpublicNative?.custody;
  if (electron) {
    return {
      describe: async () => parseNativeCustodyDescription(await electron.describe()),
      read: async () => parseNativeCustodyPair(await electron.read()),
      write: async (pair) => assertOk(await electron.write(pair)),
      remove: async (expected) => assertOk(await electron.remove(expected)),
    };
  }
  return null;
}
