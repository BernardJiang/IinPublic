import type { ConnectivityBinding, ConnectivityKind } from '../../shared/connectivity-binding';

export type PrivateGunStore = {
  putPrivate: (key: string, data: unknown) => Promise<void>;
  getPrivate: (key: string) => Promise<unknown>;
};

const VERIFIED_BINDINGS_ROOT = 'verifiedConnectivityBindings';

/** Owner-private cache of bindings that already passed signature and control checks. */
export class VerifiedConnectivityBindingStore {
  constructor(private readonly gun: PrivateGunStore) {}

  async put(binding: ConnectivityBinding): Promise<void> {
    await this.gun.putPrivate(this.key(binding.seaPub, binding.connectivityKind), binding);
  }

  async get(seaPub: string, kind: ConnectivityKind, now = new Date()): Promise<ConnectivityBinding | null> {
    const value = await this.gun.getPrivate(this.key(seaPub, kind)) as ConnectivityBinding | null;
    if (!value || value.version !== 1 || value.seaPub !== seaPub || value.connectivityKind !== kind) return null;
    if (Date.parse(value.expiresAt) <= now.getTime()) return null;
    return value;
  }

  private key(seaPub: string, kind: ConnectivityKind): string {
    return `${VERIFIED_BINDINGS_ROOT}/${encodeURIComponent(seaPub)}/${kind}`;
  }
}

/** Blocks follow SEA identity across every transport-ID rotation. */
export function isConnectivityBindingAllowed(
  binding: Pick<ConnectivityBinding, 'seaPub'>,
  blockedSeaPubs: ReadonlySet<string>,
): boolean {
  return !blockedSeaPubs.has(binding.seaPub);
}

/** Transport IDs are diagnostics only and can never become a person label. */
export function connectivityPersonLabel(input: { displayName?: string; seaPub: string }): string {
  const name = String(input.displayName || '').trim();
  return name || `SEA ${input.seaPub.slice(0, 12)}`;
}

