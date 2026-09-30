/**
 * Native hardware Key Attestation bridge — scenario 2 (§16.3). Mirrors
 * `native-custody-bridge.ts`'s detection/wrapping pattern exactly (see that file's doc comment
 * for the rationale). Android-only for now — Apple App Attest (§16.4) and any Electron
 * equivalent are documented follow-ups requiring accounts/setup this session didn't have; no
 * `webkit.messageHandlers`/`iinpublicNative` branch is stubbed here, since claiming one would be
 * a false capability, not just an unImplemented one. `detectNativeAttestationBridge` returning
 * null on those platforms is correct today, not a gap to silently paper over.
 */

export type NativeAttestationDescription = {
  version: 1;
  provider: 'android-keystore-attestation';
  available: boolean;
  /** Hint only — generateAttestedKey() itself falls back automatically if StrongBox generation
   * fails, so callers don't need to branch on this before calling it. */
  strongBoxAvailable: boolean;
};

export type NativeAttestedKeyResult = {
  /** Base64-encoded DER certificates, leaf-first (matches KeyStore.getCertificateChain's own
   * order, and android-key-attestation.ts's verifyChainToRoots's chain-walking assumption). */
  certChainDer: string[];
  /** Base64-encoded DER SubjectPublicKeyInfo of the generated key's public half. */
  devicePublicKeyDer: string;
};

export interface NativeAttestationBridge {
  describe(): Promise<NativeAttestationDescription>;
  /** `challenge` is raw bytes; callers pass base64. Regenerates the key every call — see
   * NativeAttestationBridge.kt's doc comment for why that's correct, not wasteful. */
  generateAttestedKey(challengeBase64: string): Promise<NativeAttestedKeyResult>;
}

export function parseNativeAttestationDescription(raw: unknown): NativeAttestationDescription {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { version?: unknown }).version !== 1 ||
    (value as { provider?: unknown }).provider !== 'android-keystore-attestation' ||
    typeof (value as { available?: unknown }).available !== 'boolean'
  ) {
    throw new Error('Invalid native attestation description');
  }
  const strongBox = (value as { strongBoxAvailable?: unknown }).strongBoxAvailable;
  return {
    version: 1,
    provider: 'android-keystore-attestation',
    available: (value as NativeAttestationDescription).available,
    strongBoxAvailable: typeof strongBox === 'boolean' ? strongBox : false,
  };
}

export function parseNativeAttestedKeyResult(raw: unknown): NativeAttestedKeyResult {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) {
    const reason = (value as { reason?: unknown } | null)?.reason;
    throw new Error(`Native attestation key generation failed${typeof reason === 'string' ? `: ${reason}` : ''}`);
  }
  const certChainDer = (value as { certChainDer?: unknown }).certChainDer;
  const devicePublicKeyDer = (value as { devicePublicKeyDer?: unknown }).devicePublicKeyDer;
  if (!Array.isArray(certChainDer) || certChainDer.length === 0 || !certChainDer.every((c) => typeof c === 'string')) {
    throw new Error('Invalid native attestation result: certChainDer');
  }
  if (typeof devicePublicKeyDer !== 'string' || !devicePublicKeyDer) {
    throw new Error('Invalid native attestation result: devicePublicKeyDer');
  }
  return { certChainDer: certChainDer as string[], devicePublicKeyDer };
}

type AndroidAttestationGlobal = {
  describe(): string;
  generateAttestedKey(challengeBase64: string): string;
};

type NativeWindow = {
  IinPublicAttestation?: AndroidAttestationGlobal;
};

/** Returns the platform's hardware attestation bridge, or null when unavailable (plain browser,
 * a platform without an attestation bridge built yet, or — for Android specifically — an OS
 * version below the API 24 floor, which `describe().available` also reports for a caller that
 * wants the reason rather than just a null). */
export function detectNativeAttestationBridge(
  win: NativeWindow | undefined = globalThis as NativeWindow,
): NativeAttestationBridge | null {
  if (!win) return null;
  const android = win.IinPublicAttestation;
  if (android) {
    return {
      describe: async () => parseNativeAttestationDescription(android.describe()),
      generateAttestedKey: async (challengeBase64) =>
        parseNativeAttestedKeyResult(android.generateAttestedKey(challengeBase64)),
    };
  }
  return null;
}
