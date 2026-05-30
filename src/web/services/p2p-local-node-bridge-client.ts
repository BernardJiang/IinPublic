import { DirectP2PConversationTransport } from './direct-p2p-conversation-transport';

export type LocalNodeBridgeStatus = {
  enabled: boolean;
  bridgeUrl: string;
  reachable: boolean;
  lastCheckedAt: string | null;
  reason: string;
};

/**
 * P2P-O: probe the permissioned localhost Gun bridge (companion node).
 * Stack-only — does not start the node process.
 */
export class P2PLocalNodeBridgeClient {
  private status: LocalNodeBridgeStatus = {
    enabled: false,
    bridgeUrl: 'ws://127.0.0.1:8765/iinpublic-local-node',
    reachable: false,
    lastCheckedAt: null,
    reason: 'Local node bridge not probed',
  };

  constructor(
    private readonly enabled: boolean,
    bridgeUrl = 'ws://127.0.0.1:8765/iinpublic-local-node',
  ) {
    this.status = { ...this.status, enabled, bridgeUrl };
  }

  getStatus(): LocalNodeBridgeStatus {
    return { ...this.status };
  }

  async probe(apiBase?: string): Promise<LocalNodeBridgeStatus> {
    if (!this.enabled) {
      this.status = {
        ...this.status,
        reachable: false,
        lastCheckedAt: new Date().toISOString(),
        reason: 'P2P_NODE_ENABLED is off',
      };
      return this.getStatus();
    }

    const base = apiBase || DirectP2PConversationTransport.resolveApiBase();
    try {
      const res = await fetch(`${base}/api/p2p/local-node`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`local-node status ${res.status}`);
      const snapshot = (await res.json()) as {
        status?: string;
        sessionPairing?: { bridgeUrl?: string };
        health?: { ok?: boolean; reason?: string };
      };
      const bridgeUrl = snapshot.sessionPairing?.bridgeUrl || this.status.bridgeUrl;
      const running = snapshot.status === 'running';
      this.status = {
        enabled: true,
        bridgeUrl,
        reachable: running && !!snapshot.health?.ok,
        lastCheckedAt: new Date().toISOString(),
        reason:
          snapshot.health?.reason ||
          (running ? 'Local node supervisor reports running' : 'Local node is not running'),
      };
    } catch (err) {
      this.status = {
        enabled: true,
        bridgeUrl: this.status.bridgeUrl,
        reachable: false,
        lastCheckedAt: new Date().toISOString(),
        reason: (err as Error).message,
      };
    }
    return this.getStatus();
  }
}
