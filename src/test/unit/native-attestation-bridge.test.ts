import {
  detectNativeAttestationBridge,
  parseNativeAttestationDescription,
  parseNativeAttestedKeyResult,
} from '../../shared/native-attestation-bridge';

describe('parseNativeAttestationDescription', () => {
  it('parses a valid description', () => {
    const parsed = parseNativeAttestationDescription(
      '{"version":1,"provider":"android-keystore-attestation","available":true,"strongBoxAvailable":true}',
    );
    expect(parsed).toEqual({
      version: 1,
      provider: 'android-keystore-attestation',
      available: true,
      strongBoxAvailable: true,
    });
  });

  it('defaults strongBoxAvailable to false when missing', () => {
    const parsed = parseNativeAttestationDescription(
      '{"version":1,"provider":"android-keystore-attestation","available":false}',
    );
    expect(parsed.strongBoxAvailable).toBe(false);
  });

  it('rejects malformed/wrong-shape descriptions', () => {
    expect(() => parseNativeAttestationDescription('{}')).toThrow();
    expect(() => parseNativeAttestationDescription('{"version":2}')).toThrow();
    expect(() => parseNativeAttestationDescription(null)).toThrow();
    expect(() => parseNativeAttestationDescription('not json')).toThrow();
  });
});

describe('parseNativeAttestedKeyResult', () => {
  it('parses a successful result', () => {
    const parsed = parseNativeAttestedKeyResult(
      JSON.stringify({ ok: true, certChainDer: ['AAA=', 'BBB='], devicePublicKeyDer: 'CCC=' }),
    );
    expect(parsed).toEqual({ certChainDer: ['AAA=', 'BBB='], devicePublicKeyDer: 'CCC=' });
  });

  it('throws with the native reason when ok is false', () => {
    expect(() => parseNativeAttestedKeyResult(JSON.stringify({ ok: false, reason: 'StrongBoxUnavailableException' }))).toThrow(
      /StrongBoxUnavailableException/,
    );
  });

  it('rejects a missing/empty certificate chain', () => {
    expect(() =>
      parseNativeAttestedKeyResult(JSON.stringify({ ok: true, certChainDer: [], devicePublicKeyDer: 'CCC=' })),
    ).toThrow(/certChainDer/);
    expect(() =>
      parseNativeAttestedKeyResult(JSON.stringify({ ok: true, devicePublicKeyDer: 'CCC=' })),
    ).toThrow(/certChainDer/);
  });

  it('rejects a missing devicePublicKeyDer', () => {
    expect(() =>
      parseNativeAttestedKeyResult(JSON.stringify({ ok: true, certChainDer: ['AAA='] })),
    ).toThrow(/devicePublicKeyDer/);
  });
});

describe('detectNativeAttestationBridge', () => {
  it('returns null in a plain browser (no window.IinPublicAttestation)', () => {
    expect(detectNativeAttestationBridge({})).toBeNull();
  });

  it('detects the Android bridge and wraps its synchronous calls as Promises', async () => {
    const generated = { challengeSeen: '' };
    const bridge = detectNativeAttestationBridge({
      IinPublicAttestation: {
        describe: () =>
          '{"version":1,"provider":"android-keystore-attestation","available":true,"strongBoxAvailable":true}',
        generateAttestedKey: (challengeBase64: string) => {
          generated.challengeSeen = challengeBase64;
          return JSON.stringify({ ok: true, certChainDer: ['leaf==', 'root=='], devicePublicKeyDer: 'pub==' });
        },
      },
    });
    expect(bridge).not.toBeNull();
    const description = await bridge!.describe();
    expect(description.available).toBe(true);
    expect(description.strongBoxAvailable).toBe(true);

    const result = await bridge!.generateAttestedKey('Y2hhbGxlbmdl');
    expect(generated.challengeSeen).toBe('Y2hhbGxlbmdl');
    expect(result.certChainDer).toEqual(['leaf==', 'root==']);
    expect(result.devicePublicKeyDer).toBe('pub==');
  });

  it('propagates a native failure as a rejected promise, not a silent empty result', async () => {
    const bridge = detectNativeAttestationBridge({
      IinPublicAttestation: {
        describe: () => '{"version":1,"provider":"android-keystore-attestation","available":false,"strongBoxAvailable":false}',
        generateAttestedKey: () => JSON.stringify({ ok: false, reason: 'key-attestation-unsupported-below-api-24' }),
      },
    });
    await expect(bridge!.generateAttestedKey('Y2hhbGxlbmdl')).rejects.toThrow(/unsupported-below-api-24/);
  });
});

// F8 (docs/testing/gui-responsiveness-audit.md): key generation must not run as a synchronous
// JavascriptInterface call — it freezes the WebView for as long as the keystore takes.
describe('detectNativeAttestationBridge — off-thread key generation', () => {
  const okResult = JSON.stringify({ ok: true, certChainDer: ['leaf'], devicePublicKeyDer: 'spki' });

  function fakeWindow(android: Record<string, unknown>) {
    const target = new EventTarget();
    return Object.assign(target, { IinPublicAttestation: android }) as unknown as Parameters<typeof detectNativeAttestationBridge>[0];
  }

  it('uses the async shell call and resolves from its result event', async () => {
    const sync = jest.fn(() => okResult);
    const android: Record<string, unknown> = { describe: () => '{}', generateAttestedKey: sync };
    const win = fakeWindow(android);
    android.generateAttestedKeyAsync = jest.fn((id: string) => {
      setTimeout(() => (win as unknown as EventTarget).dispatchEvent(
        new CustomEvent('iinpublic-attestation-result', { detail: { id, payload: okResult } }),
      ), 0);
      return true;
    });
    const bridge = detectNativeAttestationBridge(win)!;
    await expect(bridge.generateAttestedKey('Y2hhbGxlbmdl')).resolves.toEqual({ certChainDer: ['leaf'], devicePublicKeyDer: 'spki' });
    expect(android.generateAttestedKeyAsync).toHaveBeenCalledWith(expect.any(String), 'Y2hhbGxlbmdl');
    expect(sync).not.toHaveBeenCalled();
  });

  it('ignores another request\'s result event', async () => {
    const android: Record<string, unknown> = { describe: () => '{}', generateAttestedKey: () => okResult };
    const win = fakeWindow(android);
    android.generateAttestedKeyAsync = jest.fn((id: string) => {
      const target = win as unknown as EventTarget;
      setTimeout(() => {
        target.dispatchEvent(new CustomEvent('iinpublic-attestation-result', { detail: { id: 'other', payload: '{"ok":false}' } }));
        target.dispatchEvent(new CustomEvent('iinpublic-attestation-result', { detail: { id, payload: okResult } }));
      }, 0);
      return true;
    });
    await expect(detectNativeAttestationBridge(win)!.generateAttestedKey('c')).resolves.toMatchObject({ devicePublicKeyDer: 'spki' });
  });

  it('falls back to the synchronous call on an older shell', async () => {
    const android = { describe: () => '{}', generateAttestedKey: jest.fn(() => okResult) };
    await expect(detectNativeAttestationBridge(fakeWindow(android))!.generateAttestedKey('c')).resolves.toMatchObject({ devicePublicKeyDer: 'spki' });
    expect(android.generateAttestedKey).toHaveBeenCalledWith('c');
  });
});
