import {
  APP_NAME,
  APP_VERSION,
  SUPPORTED_PROTOCOLS,
  buildHandshakePayload,
  buildHandshakeDiagnostics,
  negotiateProtocol,
  validateHandshakePayload,
  type P2PHandshakePayload,
} from '../../shared/p2p-handshake';

const base = (): P2PHandshakePayload => ({
  appName: APP_NAME,
  appVersion: APP_VERSION,
  supportedProtocols: [...SUPPORTED_PROTOCOLS],
  features: ['signed-discovery', 'webrtc-datachannel', 'ledger-sync'],
  peerId: 'peer_abc',
  publicKey: 'pubkey_abc',
  timestamp: new Date().toISOString(),
});

describe('buildHandshakePayload', () => {
  it('builds a valid handshake payload', () => {
    const p = buildHandshakePayload({ peerId: 'peer_1', publicKey: 'pub_1' });
    expect(p.appName).toBe(APP_NAME);
    expect(p.appVersion).toBe(APP_VERSION);
    expect(p.supportedProtocols).toEqual([...SUPPORTED_PROTOCOLS]);
    expect(p.peerId).toBe('peer_1');
    expect(p.publicKey).toBe('pub_1');
    expect(typeof p.timestamp).toBe('string');
  });

  it('throws when peerId is missing', () => {
    expect(() => buildHandshakePayload({ peerId: '', publicKey: 'pub_1' })).toThrow(/peerId/);
  });

  it('throws when publicKey is missing', () => {
    expect(() => buildHandshakePayload({ peerId: 'peer_1', publicKey: '' })).toThrow(/publicKey/);
  });
});

describe('negotiateProtocol', () => {
  it('selects the highest common protocol', () => {
    const local = base();
    const remote = base();
    const result = negotiateProtocol(local, remote);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selectedProtocol).toBe('iinpublic-p2p-v1');
      expect(result.unsupportedFeatures).toEqual([]);
    }
  });

  it('reports unsupported features the remote lacks', () => {
    const local = base();
    const remote = { ...base(), features: ['signed-discovery'] as P2PHandshakePayload['features'] };
    const result = negotiateProtocol(local, remote);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unsupportedFeatures).toContain('webrtc-datachannel');
      expect(result.unsupportedFeatures).toContain('ledger-sync');
    }
  });

  it('fails cleanly when there is no common protocol', () => {
    const local = { ...base(), supportedProtocols: ['iinpublic-p2p-v1'] as P2PHandshakePayload['supportedProtocols'] };
    const remote = { ...base(), supportedProtocols: [] as unknown as P2PHandshakePayload['supportedProtocols'] };
    const result = negotiateProtocol(local, remote);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/empty protocol list/);
  });

  it('fails when protocols do not overlap', () => {
    const local = { ...base(), supportedProtocols: ['iinpublic-p2p-v1'] as P2PHandshakePayload['supportedProtocols'] };
    const remote = { ...base(), supportedProtocols: ['iinpublic-p2p-v99'] as unknown as P2PHandshakePayload['supportedProtocols'] };
    const result = negotiateProtocol(local, remote);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no common protocol/);
  });

  it('ignores unknown features in remote without crashing', () => {
    const local = base();
    const remote = {
      ...base(),
      features: [...base().features, 'future-unknown-feature'] as unknown as P2PHandshakePayload['features'],
    };
    expect(() => negotiateProtocol(local, remote)).not.toThrow();
    const result = negotiateProtocol(local, remote);
    expect(result.ok).toBe(true);
  });
});

describe('validateHandshakePayload', () => {
  it('accepts a valid payload', () => {
    const result = validateHandshakePayload(base());
    expect(result.ok).toBe(true);
  });

  it('rejects non-object payloads', () => {
    expect(validateHandshakePayload(null).ok).toBe(false);
    expect(validateHandshakePayload(42).ok).toBe(false);
    expect(validateHandshakePayload('string').ok).toBe(false);
  });

  it('rejects missing appName', () => {
    const result = validateHandshakePayload({ ...base(), appName: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/appName/);
  });

  it('rejects missing supportedProtocols', () => {
    const result = validateHandshakePayload({ ...base(), supportedProtocols: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/supportedProtocols/);
  });

  it('rejects missing peerId', () => {
    const result = validateHandshakePayload({ ...base(), peerId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/peerId/);
  });

  it('rejects stale timestamps', () => {
    const staleTs = new Date(Date.now() - 300_000).toISOString();
    const result = validateHandshakePayload({ ...base(), timestamp: staleTs }, { maxSkewMs: 120_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale/);
  });

  it('accepts custom maxSkewMs', () => {
    const recentTs = new Date(Date.now() - 50_000).toISOString();
    const result = validateHandshakePayload({ ...base(), timestamp: recentTs }, { maxSkewMs: 120_000 });
    expect(result.ok).toBe(true);
  });

  it('rejects malformed timestamps', () => {
    const result = validateHandshakePayload({ ...base(), timestamp: 'not-a-date' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/timestamp/);
  });
});

describe('buildHandshakeDiagnostics', () => {
  it('returns pending state when remote is null', () => {
    const d = buildHandshakeDiagnostics(base(), null, null);
    expect(d.handshakeState).toBe('pending');
    expect(d.remoteAppVersion).toBeNull();
    expect(d.selectedProtocol).toBeNull();
  });

  it('returns ok state after successful negotiation', () => {
    const local = base();
    const remote = base();
    const result = negotiateProtocol(local, remote);
    const d = buildHandshakeDiagnostics(local, remote, result);
    expect(d.handshakeState).toBe('ok');
    expect(d.selectedProtocol).toBe('iinpublic-p2p-v1');
    expect(d.unsupportedFeatures).toEqual([]);
    expect(d.failureReason).toBeNull();
  });

  it('returns failed state when negotiation fails', () => {
    const local = base();
    const remote = { ...base(), supportedProtocols: [] as unknown as P2PHandshakePayload['supportedProtocols'] };
    const result = negotiateProtocol(local, remote);
    const d = buildHandshakeDiagnostics(local, remote, result);
    expect(d.handshakeState).toBe('failed');
    expect(d.selectedProtocol).toBeNull();
    expect(d.failureReason).toBeTruthy();
  });
});
