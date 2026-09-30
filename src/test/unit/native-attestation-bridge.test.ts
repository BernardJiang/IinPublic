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
