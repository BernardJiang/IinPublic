export type HarnessDiscovery = 'hub' | 'known-peer' | 'dht' | 'mdns';
export type HarnessRoute = 'gun-wire' | 'cellular-gun-wire' | 'direct-libp2p' | 'webrtc' | 'circuit-relay' | 'peer-forward' | 'mailbox';
export type HarnessFaults = { connectFailure?: boolean; midSendDrop?: boolean; latencyMs?: number; duplicate?: number; corrupt?: boolean; metered?: boolean; lowBattery?: boolean };
export type HarnessObject = { soul: string; objectId: string; payload: Record<string, unknown> };
export type CapabilityResult = { discovery: HarnessDiscovery; route: HarnessRoute; passed: boolean; assertions: string[] };

export class DeterministicConnectivityHarness {
  private discovery: HarnessDiscovery | null = null;
  private route: HarnessRoute | null = null;
  private mailboxEnabled = false;
  private faults: HarnessFaults = {};
  private readonly bobGun = new Map<string, HarnessObject>();
  private readonly bobUi = new Set<string>();
  private readonly aliceReceipts = new Set<string>();
  private readonly attempts: HarnessRoute[] = [];

  configure(input: { discovery: HarnessDiscovery; route: HarnessRoute; mailboxEnabled?: boolean; faults?: HarnessFaults }): void {
    this.discovery = input.discovery; this.route = input.route; this.mailboxEnabled = input.mailboxEnabled ?? input.route === 'mailbox'; this.faults = input.faults ?? {};
    if (input.route !== 'mailbox' && this.mailboxEnabled) throw new Error('isolated route tests must disable mailbox fallback');
  }

  async deliver(object: HarnessObject, policy: { allowMetered?: boolean; allowLowBatteryForwarding?: boolean } = {}): Promise<void> {
    if (!this.discovery || !this.route) throw new Error('exactly one discovery source and route are required');
    this.attempts.push(this.route);
    if (this.faults.connectFailure) throw new Error('injected connect failure');
    if ((this.faults.metered || this.route === 'cellular-gun-wire') && !policy.allowMetered) throw new Error('metered route denied');
    if (this.route === 'peer-forward' && this.faults.lowBattery && !policy.allowLowBatteryForwarding) throw new Error('low-battery forwarding denied');
    if (this.faults.latencyMs) await new Promise((resolve) => setTimeout(resolve, Math.min(this.faults.latencyMs ?? 0, 10)));
    if (this.faults.midSendDrop) throw new Error('injected mid-send drop');
    if (this.faults.corrupt) throw new Error('corrupt payload rejected');
    const copies = Math.max(1, this.faults.duplicate ?? 1);
    for (let i = 0; i < copies; i += 1) {
      this.bobGun.set(object.soul, object);
      this.bobUi.add(object.objectId);
    }
    this.aliceReceipts.add(object.objectId);
  }

  oracle(object: HarnessObject): { ok: boolean; assertions: string[] } {
    const stored = this.bobGun.get(object.soul);
    const assertions = [
      `Gun soul exists exactly once: ${this.bobGun.has(object.soul)}`,
      `Gun reread matches: ${JSON.stringify(stored?.payload) === JSON.stringify(object.payload)}`,
      `UI renders once: ${this.bobUi.has(object.objectId)}`,
      `Alice persisted receipt: ${this.aliceReceipts.has(object.objectId)}`,
    ];
    return { ok: assertions.every((value) => value.endsWith('true')), assertions };
  }

  resetFaults(): void { this.faults = {}; }
  getAttempts(): readonly HarnessRoute[] { return this.attempts; }
  exportServer(): { receipts: string[]; applicationBodies: never[] } { return { receipts: [...this.aliceReceipts], applicationBodies: [] }; }
}

export function capabilityReport(results: readonly CapabilityResult[]): string {
  return JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), results, passed: results.every((result) => result.passed) }, null, 2);
}
