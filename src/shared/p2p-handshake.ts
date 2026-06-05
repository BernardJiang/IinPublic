/**
 * P2P-Q — Signed Handshake + Protocol/Feature Negotiation
 *
 * Peers exchange a signed handshake immediately on DataChannel open (and on
 * first Gun/direct exchange) so they can negotiate capabilities before trusting
 * any P2P payload.
 *
 * REQ-P2P-14 / REQ-P2P-15
 */

export const APP_NAME = 'iinpublic';
export const APP_VERSION = '1.0.0';

/** Wire protocols ordered newest-first; the highest mutually-supported version wins. */
export const SUPPORTED_PROTOCOLS = ['iinpublic-p2p-v1'] as const;
export type SupportedProtocol = (typeof SUPPORTED_PROTOCOLS)[number];

/** Optional capability flags advertised during handshake. */
export type HandshakeFeature =
  | 'signed-discovery'
  | 'encrypted-signaling'
  | 'webrtc-datachannel'
  | 'relay-fallback'
  | 'pair-private-responses'
  | 'ledger-sync'
  | 'schema-migrations';

/** Handshake payload sent over the DataChannel immediately after open. */
export type P2PHandshakePayload = {
  appName: string;
  appVersion: string;
  supportedProtocols: SupportedProtocol[];
  features: HandshakeFeature[];
  /** SHA-256(pub) derived peer id. */
  peerId: string;
  /** SEA public key (no private material). */
  publicKey: string;
  timestamp: string;
};

/** Wire frame type for the handshake exchange. */
export type HandshakeFrame = {
  type: 'handshake';
  payload: P2PHandshakePayload;
};

export type ProtocolNegotiationResult =
  | { ok: true; selectedProtocol: SupportedProtocol; unsupportedFeatures: HandshakeFeature[] }
  | { ok: false; reason: string };

export type HandshakeDiagnostics = {
  localAppVersion: string;
  remoteAppVersion: string | null;
  selectedProtocol: SupportedProtocol | null;
  unsupportedFeatures: HandshakeFeature[];
  handshakeState: 'pending' | 'ok' | 'failed';
  failureReason: string | null;
};

/**
 * Build the handshake payload to send to the remote peer.
 */
export function buildHandshakePayload(params: {
  peerId: string;
  publicKey: string;
  appVersion?: string;
  features?: HandshakeFeature[];
  now?: Date;
}): P2PHandshakePayload {
  if (!params.peerId) throw new Error('handshake requires peerId');
  if (!params.publicKey) throw new Error('handshake requires publicKey');
  return {
    appName: APP_NAME,
    appVersion: params.appVersion ?? APP_VERSION,
    supportedProtocols: [...SUPPORTED_PROTOCOLS],
    features: params.features ?? [
      'signed-discovery',
      'encrypted-signaling',
      'webrtc-datachannel',
      'relay-fallback',
      'pair-private-responses',
      'ledger-sync',
      'schema-migrations',
    ],
    peerId: params.peerId,
    publicKey: params.publicKey,
    timestamp: (params.now ?? new Date()).toISOString(),
  };
}

/**
 * Negotiate the highest common protocol from two peers' handshakes.
 * If either peer's list is empty or there is no overlap, returns { ok: false }.
 * Unknown features in the remote list are silently ignored.
 */
export function negotiateProtocol(
  local: P2PHandshakePayload,
  remote: P2PHandshakePayload,
): ProtocolNegotiationResult {
  if (!local.supportedProtocols?.length || !remote.supportedProtocols?.length) {
    return { ok: false, reason: 'empty protocol list' };
  }
  // Prefer protocols advertised by local (ordered newest-first) that also appear in remote.
  const remoteSet = new Set<string>(remote.supportedProtocols);
  const selected = local.supportedProtocols.find((p) => remoteSet.has(p));
  if (!selected) {
    return {
      ok: false,
      reason: `no common protocol: local=${local.supportedProtocols.join(',')}, remote=${remote.supportedProtocols.join(',')}`,
    };
  }
  const remoteFeatures = new Set<string>(remote.features ?? []);
  const unsupportedFeatures = (local.features ?? []).filter((f) => !remoteFeatures.has(f));
  return { ok: true, selectedProtocol: selected, unsupportedFeatures };
}

/**
 * Validate that a received handshake payload has the required fields and a
 * timestamp within the allowed skew window.  Does NOT verify the SEA signature
 * (that is done separately via `verifySignedP2PEnvelopeProof`).
 */
export function validateHandshakePayload(
  payload: unknown,
  opts: { now?: Date; maxSkewMs?: number } = {},
): { ok: true; payload: P2PHandshakePayload } | { ok: false; reason: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'handshake payload is not an object' };
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.appName !== 'string' || !p.appName) {
    return { ok: false, reason: 'missing appName' };
  }
  if (typeof p.appVersion !== 'string' || !p.appVersion) {
    return { ok: false, reason: 'missing appVersion' };
  }
  if (!Array.isArray(p.supportedProtocols) || p.supportedProtocols.length === 0) {
    return { ok: false, reason: 'missing or empty supportedProtocols' };
  }
  if (!Array.isArray(p.features)) {
    return { ok: false, reason: 'missing features list' };
  }
  if (typeof p.peerId !== 'string' || !p.peerId) {
    return { ok: false, reason: 'missing peerId' };
  }
  if (typeof p.publicKey !== 'string' || !p.publicKey) {
    return { ok: false, reason: 'missing publicKey' };
  }
  if (typeof p.timestamp !== 'string' || !p.timestamp) {
    return { ok: false, reason: 'missing timestamp' };
  }
  const created = new Date(p.timestamp as string).getTime();
  if (!Number.isFinite(created)) {
    return { ok: false, reason: 'invalid timestamp' };
  }
  const now = (opts.now ?? new Date()).getTime();
  const maxSkewMs = opts.maxSkewMs ?? 120_000;
  if (Math.abs(now - created) > maxSkewMs) {
    return { ok: false, reason: 'stale handshake timestamp' };
  }
  return { ok: true, payload: p as unknown as P2PHandshakePayload };
}

/**
 * Build a diagnostics snapshot from local and remote handshake payloads.
 */
export function buildHandshakeDiagnostics(
  local: P2PHandshakePayload,
  remote: P2PHandshakePayload | null,
  negotiationResult: ProtocolNegotiationResult | null,
): HandshakeDiagnostics {
  const state: HandshakeDiagnostics['handshakeState'] = !remote
    ? 'pending'
    : !negotiationResult
      ? 'pending'
      : negotiationResult.ok
        ? 'ok'
        : 'failed';
  return {
    localAppVersion: local.appVersion,
    remoteAppVersion: remote?.appVersion ?? null,
    selectedProtocol:
      negotiationResult?.ok ? negotiationResult.selectedProtocol : null,
    unsupportedFeatures:
      negotiationResult?.ok ? negotiationResult.unsupportedFeatures : [],
    handshakeState: state,
    failureReason:
      negotiationResult && !negotiationResult.ok ? negotiationResult.reason : null,
  };
}
