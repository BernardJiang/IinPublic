/**
 * Scenario 2 (§16) client orchestration: obtains and caches this device's
 * `OfficialBuildCredential` — asks the native bridge (Part D) to generate a hardware-attested key
 * against a fresh server-issued challenge (Part C), submits it for verification, and caches the
 * signed result.
 *
 * Deliberately NOT called from the P2P handshake send path itself (`p2p-webrtc-session.ts`) —
 * that's a latency-sensitive real-time connect path, and this involves a native bridge call plus
 * two network round trips. Instead, `ensureCredential()` runs once at app startup (fire-and-
 * forget, never blocks anything else) and the handshake just reads whatever's currently cached
 * via `getCachedCredential()` — possibly nothing yet, or nothing ever on a platform without the
 * bridge, both of which correctly fall through to `unverified-build`, never an error.
 */

import {
  detectNativeAttestationBridge,
  type NativeAttestationBridge,
} from '../../shared/native-attestation-bridge';
import type { OfficialBuildCredential } from '../../shared/official-build-credential';
import { readNativeHostInfo } from '../ui/native-host-info';

const CACHE_STORAGE_KEY = 'iinpublic_attestation_credential_v1';
/** Refresh proactively once less than this much validity remains, rather than waiting for a
 * peer-visible expiry — avoids a credential going stale mid-session for a long-running app. */
const REFRESH_MARGIN_MS = 60 * 60 * 1000; // 1 hour

type CachedEntry = { devicePublicKey: string; credential: OfficialBuildCredential };

function readCache(): CachedEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (!parsed?.credential?.expiresAt || !parsed.devicePublicKey) return null;
    return parsed;
  } catch {
    return null; // localStorage unavailable/corrupt — just refetch, not fatal (see artifact-storage guidance this codebase already follows elsewhere for browser storage)
  }
}

function writeCache(entry: CachedEntry): void {
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* best effort — a failed cache write just means re-fetching next time, harmless */
  }
}

export class WebAttestationService {
  private readonly apiBase: string;
  private readonly bridge: NativeAttestationBridge | null;
  private cached: CachedEntry | null;
  private inFlight: Promise<OfficialBuildCredential | null> | null = null;
  /** verifierKeyId -> publicKeyPem, from GET /api/attestation/verifier-keys. Fetched proactively
   * (ensureVerifierKeys) alongside the credential, for the same reason getCachedCredential is
   * synchronous: p2p-webrtc-session.ts's lookupVerifierKey callback runs inline during handshake
   * processing and can't await a network call. */
  private verifierKeys = new Map<string, string>();
  private verifierKeysInFlight: Promise<void> | null = null;

  constructor(apiBase: string, bridge: NativeAttestationBridge | null = detectNativeAttestationBridge()) {
    this.apiBase = apiBase;
    this.bridge = bridge;
    this.cached = readCache();
  }

  /** Synchronous — what p2p-webrtc-session.ts's `lookupVerifierKey` config callback reads.
   * Returns undefined (never throws) if the keys haven't been fetched yet or the id is unknown —
   * evaluateBuildTrust treats that as 'community-build' (a credential we can't validate), the
   * correct conservative default, not an error. */
  lookupVerifierKey(verifierKeyId: string): string | undefined {
    return this.verifierKeys.get(verifierKeyId);
  }

  /** Fetches and caches the verifier's published public keys. Safe to call repeatedly/
   * concurrently (dedupes in-flight fetches, same pattern as ensureCredential). Never throws. */
  async ensureVerifierKeys(): Promise<void> {
    if (this.verifierKeys.size > 0) return;
    if (this.verifierKeysInFlight) return this.verifierKeysInFlight;
    this.verifierKeysInFlight = this.fetchVerifierKeys().finally(() => {
      this.verifierKeysInFlight = null;
    });
    return this.verifierKeysInFlight;
  }

  private async fetchVerifierKeys(): Promise<void> {
    try {
      const res = await fetch(`${this.apiBase}/api/attestation/verifier-keys`);
      if (!res.ok) return;
      const { keys } = (await res.json()) as { keys?: Array<{ verifierKeyId: string; publicKeyPem: string }> };
      for (const key of keys ?? []) {
        if (key.verifierKeyId && key.publicKeyPem) this.verifierKeys.set(key.verifierKeyId, key.publicKeyPem);
      }
    } catch {
      /* verifier unreachable — peers' credentials just evaluate to community-build until a
       * future call succeeds; not a fatal condition */
    }
  }

  /** Synchronous — what `p2p-webrtc-session.ts` reads when building a handshake. Returns null
   * (never throws, never blocks) on any platform without a usable, non-expired credential. */
  getCachedCredential(devicePublicKey: string): OfficialBuildCredential | null {
    if (!this.cached || this.cached.devicePublicKey !== devicePublicKey) return null;
    if (new Date(this.cached.credential.expiresAt).getTime() <= Date.now()) return null;
    return this.cached.credential;
  }

  /**
   * Ensures a fresh credential is cached for `devicePublicKey`, fetching one if none is cached,
   * it's for a different device key, or it's within `REFRESH_MARGIN_MS` of expiring. Safe to call
   * repeatedly/concurrently — a fetch already in flight is reused rather than duplicated.
   * Resolves to null (never rejects) when the platform has no attestation bridge, or on any
   * failure along the way — callers should treat this as "stay at unverified-build," not as an
   * error to surface to the user; scenario 2 is a best-effort trust signal, not a blocking gate.
   */
  async ensureCredential(devicePublicKey: string): Promise<OfficialBuildCredential | null> {
    const existing = this.getCachedCredential(devicePublicKey);
    if (existing && new Date(existing.expiresAt).getTime() - Date.now() > REFRESH_MARGIN_MS) {
      return existing;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchCredential(devicePublicKey).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchCredential(devicePublicKey: string): Promise<OfficialBuildCredential | null> {
    if (!this.bridge) return null;
    try {
      const description = await this.bridge.describe();
      if (!description.available) return null;

      const challengeRes = await fetch(`${this.apiBase}/api/attestation/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pub: devicePublicKey }),
      });
      if (!challengeRes.ok) return null;
      const { challengeId, challenge } = (await challengeRes.json()) as { challengeId: string; challenge: string };
      if (!challengeId || !challenge) return null;

      const attested = await this.bridge.generateAttestedKey(challenge);

      // appVersion/buildNumber are informational fields on the credential (the verifier doesn't
      // check them against anything — signingIdentityHash from the attestation itself is the
      // real "is this really us" check); readNativeHostInfo() is the one place this codebase
      // already resolves "this device's actual running version" from, see its own doc comment.
      const runningVersion = readNativeHostInfo().version;
      const verifyRes = await fetch(`${this.apiBase}/api/attestation/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          certChainDer: attested.certChainDer,
          devicePublicKey,
          appVersion: runningVersion,
          buildNumber: runningVersion,
        }),
      });
      if (!verifyRes.ok) return null;
      const { credential } = (await verifyRes.json()) as { credential?: OfficialBuildCredential };
      if (!credential) return null;

      this.cached = { devicePublicKey, credential };
      writeCache(this.cached);
      return credential;
    } catch {
      return null; // any failure (native bridge, network, server rejection) — stay unverified, never throw
    }
  }
}
