import type { P2PMeshFrame } from './p2p-mesh-protocol';

export type ForwardingSettings = {
  enabled: boolean;
  wifiForwarding: boolean;
  cellularForwarding: boolean;
  lowBatteryPause: boolean;
  routeByteBudget: number;
  cellularByteBudget: number;
  maxFramesPerRoutePerMinute: number;
};

export const DEFAULT_FORWARDING_SETTINGS: Readonly<ForwardingSettings> = {
  enabled: true,
  wifiForwarding: true,
  cellularForwarding: false,
  lowBatteryPause: true,
  routeByteBudget: 50 * 1024 * 1024,
  cellularByteBudget: 0,
  maxFramesPerRoutePerMinute: 600,
};

export type ForwardingFrameClass = 'locally-originated' | 'locally-addressed' | 'discovery-gossip' | 'third-party';
export type ForwardingContext = {
  routeId: string;
  interface: 'wifi' | 'cellular' | 'other';
  lowBattery: boolean;
};

export type ForwardingDecision = { allowed: boolean; frameClass: ForwardingFrameClass; reason: string };

export class MeshForwardingPolicy {
  private settings: ForwardingSettings;
  private readonly bytesByRoute = new Map<string, number>();
  private forwardedFrames = 0;
  private droppedFrames = 0;
  private abuseDrops = 0;
  private readonly recentForwardsByRoute = new Map<string, number[]>();

  constructor(settings: Partial<ForwardingSettings> = {}) {
    this.settings = { ...DEFAULT_FORWARDING_SETTINGS, ...settings };
  }

  update(settings: Partial<ForwardingSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  evaluate(frame: P2PMeshFrame, localUserId: string, context: ForwardingContext, bytes: number): ForwardingDecision {
    const frameClass = classifyForwardingFrame(frame, localUserId);
    if (frameClass !== 'third-party' && frameClass !== 'discovery-gossip') {
      return { allowed: true, frameClass, reason: 'user-owned traffic is never disabled by forwarding policy' };
    }
    if (!this.settings.enabled) return this.drop(frameClass, 'peer forwarding disabled');
    if (context.lowBattery && this.settings.lowBatteryPause) return this.drop(frameClass, 'peer forwarding paused for low battery');
    if (context.interface === 'wifi' && !this.settings.wifiForwarding) return this.drop(frameClass, 'Wi-Fi forwarding disabled');
    if (context.interface === 'cellular' && !this.settings.cellularForwarding) return this.drop(frameClass, 'cellular forwarding disabled');
    const used = this.bytesByRoute.get(context.routeId) ?? 0;
    const budget = context.interface === 'cellular'
      ? Math.min(this.settings.routeByteBudget, this.settings.cellularByteBudget)
      : this.settings.routeByteBudget;
    if (bytes < 0 || used + bytes > budget) return this.drop(frameClass, 'forwarding byte budget exceeded');
    const cutoff = Date.now() - 60_000;
    const recent = (this.recentForwardsByRoute.get(context.routeId) ?? []).filter((at) => at > cutoff);
    this.recentForwardsByRoute.set(context.routeId, recent);
    if (recent.length >= this.settings.maxFramesPerRoutePerMinute) {
      this.abuseDrops += 1;
      return this.drop(frameClass, 'forwarding rate limit exceeded');
    }
    return { allowed: true, frameClass, reason: 'peer forwarding permitted' };
  }

  recordForwarded(routeId: string, bytes: number): void {
    this.bytesByRoute.set(routeId, (this.bytesByRoute.get(routeId) ?? 0) + Math.max(0, bytes));
    this.forwardedFrames += 1;
    const recent = this.recentForwardsByRoute.get(routeId) ?? [];
    recent.push(Date.now());
    this.recentForwardsByRoute.set(routeId, recent);
  }

  diagnostics(): { bytesByRoute: Record<string, number>; forwardedFrames: number; droppedFrames: number; abuseDrops: number } {
    return { bytesByRoute: Object.fromEntries(this.bytesByRoute), forwardedFrames: this.forwardedFrames, droppedFrames: this.droppedFrames, abuseDrops: this.abuseDrops };
  }

  private drop(frameClass: ForwardingFrameClass, reason: string): ForwardingDecision {
    this.droppedFrames += 1;
    return { allowed: false, frameClass, reason };
  }
}

export function classifyForwardingFrame(frame: P2PMeshFrame, localUserId: string): ForwardingFrameClass {
  if (frame.originUserId === localUserId) return 'locally-originated';
  if (frame.recipientUserId === localUserId) return 'locally-addressed';
  if (!frame.recipientUserId && (frame.kind === 'talk-announce' || frame.kind === 'talk-retracted')) return 'discovery-gossip';
  return 'third-party';
}
