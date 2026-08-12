export type TransportKind = 'gun-websocket' | 'libp2p' | 'webrtc' | 'wifi-aware' | 'wifi-direct' | 'ble' | 'nearby' | 'mailbox';
export type NetworkInterface = 'ethernet' | 'wifi' | 'wifi-direct' | 'cellular' | 'bluetooth' | 'unknown';
export type Directness = 'direct' | 'relay' | 'store-forward';
export type BatteryClass = 'low' | 'medium' | 'high';
export type PathHealth = 'healthy' | 'degraded' | 'unavailable';
export type OperationClass = 'discovery' | 'text' | 'background-sync' | 'urgent-action' | 'ipfs-bulk';
export type MeteredPermission = 'ask' | 'allow-once' | 'always-allow' | 'wait-for-free';

export type PathInfo = {
  pathId: string;
  transport: TransportKind;
  interface: NetworkInterface;
  directness: Directness;
  metered: boolean;
  latencyMs: number;
  bandwidthKbps: number;
  batteryClass: BatteryClass;
  stability: number;
  health: PathHealth;
};

export type RouteSelection = {
  selected: PathInfo | null;
  alternatives: readonly PathInfo[];
  reason: string;
  permissionRequired: boolean;
};

export type ConnectionAdapter = {
  path: PathInfo;
  send: (objectId: string, payload: Uint8Array) => Promise<void>;
};

export type MeteredPermissionPrompt = (
  path: PathInfo,
  operation: OperationClass,
) => Promise<Exclude<MeteredPermission, 'ask'>>;

export class ConnectionManager {
  private readonly adapters = new Map<string, ConnectionAdapter>();
  private activePathId: string | null = null;
  private permission: MeteredPermission;

  constructor(
    permission: MeteredPermission = 'ask',
    private readonly prompt?: MeteredPermissionPrompt,
  ) {
    this.permission = permission;
  }

  register(adapter: ConnectionAdapter): void {
    if (!adapter.path.pathId) throw new Error('pathId is required');
    this.adapters.set(adapter.path.pathId, adapter);
  }

  unregister(pathId: string): void {
    this.adapters.delete(pathId);
    if (this.activePathId === pathId) this.activePathId = null;
  }

  setMeteredPermission(permission: MeteredPermission): void {
    this.permission = permission;
  }

  select(operation: OperationClass): RouteSelection {
    const available = [...this.adapters.values()].map((adapter) => adapter.path)
      .filter((path) => isEligible(path, operation));
    const allowed = available.filter((path) => !path.metered || this.permission === 'always-allow' || this.permission === 'allow-once');
    allowed.sort((a, b) => comparePaths(a, b, operation, this.activePathId));
    const selected = allowed[0] ?? null;
    const meteredOnly = !selected && available.some((path) => path.metered);
    return {
      selected,
      alternatives: selected ? allowed.slice(1) : available,
      reason: selected ? selectionReason(selected, operation, selected.pathId === this.activePathId) : meteredOnly ? 'Only metered routes are available and permission is required.' : 'No eligible route is available.',
      permissionRequired: meteredOnly && this.permission === 'ask',
    };
  }

  async send(operation: OperationClass, objectId: string, payload: Uint8Array): Promise<RouteSelection> {
    let selection = this.select(operation);
    if (!selection.selected && selection.permissionRequired && this.prompt) {
      const metered = selection.alternatives.find((path) => path.metered);
      if (metered) {
        const decision = await this.prompt(metered, operation);
        if (decision === 'always-allow') this.permission = decision;
        if (decision === 'allow-once') this.permission = decision;
        selection = this.select(operation);
      }
    }
    if (!selection.selected) throw new Error(selection.reason);
    const attempted = new Set<string>();
    let current: PathInfo | null = selection.selected;
    let lastError: unknown;
    while (current) {
      attempted.add(current.pathId);
      try {
        await this.adapters.get(current.pathId)?.send(objectId, payload);
        this.activePathId = current.pathId;
        if (this.permission === 'allow-once' && current.metered) this.permission = 'ask';
        return { ...selection, selected: current, reason: selectionReason(current, operation, current.pathId === this.activePathId) };
      } catch (error) {
        lastError = error;
        const next = [selection.selected, ...selection.alternatives]
          .filter((path): path is PathInfo => !!path && !attempted.has(path.pathId))[0];
        current = next ?? null;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('all eligible routes failed');
  }

  getActivePathId(): string | null {
    return this.activePathId;
  }
}

export function comparePaths(a: PathInfo, b: PathInfo, operation: OperationClass, activePathId: string | null): number {
  return pathScore(b, operation, activePathId) - pathScore(a, operation, activePathId) || a.pathId.localeCompare(b.pathId);
}

export function pathScore(path: PathInfo, operation: OperationClass, activePathId: string | null): number {
  const batteryPenalty = { low: 0, medium: 400, high: 900 }[path.batteryClass];
  const directBonus = path.directness === 'direct' ? 2_500 : path.directness === 'relay' ? 500 : 0;
  const operationBandwidth = operation === 'ipfs-bulk' ? Math.min(path.bandwidthKbps, 100_000) / 5 : Math.min(path.bandwidthKbps, 10_000) / 20;
  return (path.pathId === activePathId && path.health === 'healthy' ? 12_000 : 0)
    + (!path.metered ? 10_000 : 0)
    + directBonus
    + Math.max(0, Math.min(100, path.stability)) * 30
    + operationBandwidth
    - Math.min(Math.max(path.latencyMs, 0), 60_000) / 10
    - batteryPenalty
    + (path.health === 'healthy' ? 1_000 : 0);
}

function isEligible(path: PathInfo, operation: OperationClass): boolean {
  if (path.health === 'unavailable') return false;
  if (operation === 'ipfs-bulk' && (path.transport === 'ble' || path.interface === 'bluetooth')) return false;
  return true;
}

function selectionReason(path: PathInfo, operation: OperationClass, reused: boolean): string {
  const parts = [reused ? 'reused healthy route' : path.metered ? 'permitted metered route' : 'free route'];
  parts.push(path.directness === 'direct' ? 'direct connection' : path.directness);
  parts.push(`${path.interface}/${path.transport}`);
  if (operation === 'ipfs-bulk') parts.push('bulk-capable');
  return parts.join('; ');
}

