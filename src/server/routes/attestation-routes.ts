import * as crypto from 'crypto';
import type express from 'express';
import { logger } from '../logger';
import { P2PAbuseDefenseContext, type AbuseDefenseConfig } from '../../shared/p2p-abuse-defense';
import { verifyChainToRoots, parseKeyAttestationExtension } from '../security/android-key-attestation';
import { GOOGLE_HARDWARE_ATTESTATION_ROOTS_PEM } from '../security/google-hardware-attestation-roots';
import type { EmbeddedHubRelayClientLike } from '../../node-app/embedded-hub-relay-client';
import {
  canonicalCredentialSigningInput,
  OFFICIAL_APPLICATION_ID,
  OFFICIAL_SIGNING_IDENTITY_HASH,
  type OfficialBuildCredential,
} from '../../shared/official-build-credential';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const keyCustody = require('../security/attestation-verifier-key-custody');

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete the attest-and-verify round trip
const DEFAULT_CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000; // §16.8: credentials refresh roughly daily

function normalizeHexDigest(value: string): string {
  return value.replace(/:/g, '').toLowerCase();
}

function splitPemCertificates(combined: string): string[] {
  return combined.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}

type ChallengeRecord = {
  challenge: Buffer;
  requesterKey: string;
  issuedAt: number;
  expiresAt: number;
  consumed: boolean;
};

export type RegisterAttestationRoutesDeps = {
  /** Loaded once at route-registration time; routes 503 (not a crash) when this fails, e.g. the
   * key isn't configured on this deployment yet — §16.5: "If the verifier is unavailable,
   * continue normal open-protocol operation with the correct lower-confidence label." */
  verifierKeyFile?: string;
  trustedRootsPem?: string[];
  officialApplicationId?: string;
  officialSigningIdentityHash?: string; // lowercase, no colons
  challengeTtlMs?: number;
  credentialTtlMs?: number;
  abuseDefenseConfig?: AbuseDefenseConfig;
  /**
   * Present only on an embedded/on-device server (see src/server/index.ts's construction), which
   * never has a verifier key of its own — see EmbeddedHubRelayClientLike's doc comment on its
   * three attestation-forwarding methods for why. When set and no local verifierKeyFile is
   * configured, all three routes below forward to the real hub instead of 503ing, exactly like
   * registerTurnRoutes does for TURN_SHARED_SECRET.
   */
  hubRelayClient?: EmbeddedHubRelayClientLike;
};

/**
 * The software-attestation verifier (§16.5) — issues challenges, verifies Android hardware Key
 * Attestation chains against them, and signs short-lived OfficialBuildCredentials for genuinely
 * official builds. Deliberately holds no per-user state: the one long-lived thing it stores is
 * its own signing keypair (Part B); challenge state is in-memory and short-lived (default 5 min,
 * lazily swept on access — this is not a database, by design, see §16.8).
 */
export function registerAttestationRoutes(app: express.Application, deps: RegisterAttestationRoutesDeps = {}): void {
  const challengeTtlMs = deps.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
  const credentialTtlMs = deps.credentialTtlMs ?? DEFAULT_CREDENTIAL_TTL_MS;
  const officialApplicationId = deps.officialApplicationId ?? OFFICIAL_APPLICATION_ID;
  const officialSigningIdentityHash = normalizeHexDigest(
    deps.officialSigningIdentityHash ?? OFFICIAL_SIGNING_IDENTITY_HASH,
  );
  const trustedRootsPem =
    deps.trustedRootsPem ?? splitPemCertificates(GOOGLE_HARDWARE_ATTESTATION_ROOTS_PEM);

  let verifierPair: { publicKeyPem: string; privateKeyPem: string } | null = null;
  let verifierKeyId: string | null = null;
  let verifierLoadError: string | null = null;
  try {
    const keyFile = deps.verifierKeyFile ?? process.env.ATTESTATION_VERIFIER_KEY_FILE;
    if (keyFile) {
      verifierPair = keyCustody.loadVerifierPairSync({ keyFile });
      verifierKeyId = keyCustody.fingerprint(verifierPair!.publicKeyPem);
    } else {
      verifierLoadError = 'ATTESTATION_VERIFIER_KEY_FILE not configured on this deployment';
    }
  } catch (error) {
    verifierLoadError = (error as Error).message;
  }

  const { hubRelayClient } = deps;
  const abuseCtx = new P2PAbuseDefenseContext(deps.abuseDefenseConfig ?? {});
  const challenges = new Map<string, ChallengeRecord>();

  function sweepExpiredChallenges(now: number): void {
    for (const [id, record] of challenges) {
      if (record.expiresAt <= now) challenges.delete(id);
    }
  }

  app.post('/api/attestation/challenge', async (req, res) => {
    if (!verifierPair || !verifierKeyId) {
      if (hubRelayClient?.postAttestationChallenge) {
        try {
          const relayed = await hubRelayClient.postAttestationChallenge(req.body || {});
          res.status(relayed.status).json(relayed.body);
          return;
        } catch {
          // Hub unreachable (offline embedded node) — fall through to the same 503 a
          // never-configured deployment already returns, not a silent default.
        }
      }
      res.status(503).json({ error: `attestation verifier unavailable: ${verifierLoadError}` });
      return;
    }
    const body = req.body || {};
    const requesterKey = String(body.pub || body.peerId || '');
    if (!requesterKey) {
      res.status(400).json({ error: 'missing pub/peerId' });
      return;
    }
    const abuseCheck = abuseCtx.checkInbound(String(body.peerId || requesterKey), requesterKey);
    if (!abuseCheck.allowed) {
      res.status(429).json({ error: abuseCheck.reason });
      return;
    }

    const now = Date.now();
    sweepExpiredChallenges(now);
    const challengeId = crypto.randomUUID();
    const challenge = crypto.randomBytes(32);
    challenges.set(challengeId, {
      challenge,
      requesterKey,
      issuedAt: now,
      expiresAt: now + challengeTtlMs,
      consumed: false,
    });
    res.json({ challengeId, challenge: challenge.toString('base64'), expiresAt: new Date(now + challengeTtlMs).toISOString() });
  });

  app.post('/api/attestation/verify', async (req, res) => {
    if (!verifierPair || !verifierKeyId) {
      if (hubRelayClient?.postAttestationVerify) {
        try {
          const relayed = await hubRelayClient.postAttestationVerify(req.body || {});
          res.status(relayed.status).json(relayed.body);
          return;
        } catch {
          // Hub unreachable — same reasoning as the challenge route above.
        }
      }
      res.status(503).json({ error: `attestation verifier unavailable: ${verifierLoadError}` });
      return;
    }
    const body = req.body || {};
    const challengeId = String(body.challengeId || '');
    const certChainB64 = Array.isArray(body.certChainDer) ? (body.certChainDer as unknown[]) : null;
    const devicePublicKey = String(body.devicePublicKey || '');
    const appVersion = String(body.appVersion || '');
    const buildNumber = String(body.buildNumber || '');
    const releaseChannel = body.releaseChannel === 'beta' ? 'beta' : 'production';

    // A rejection here has a specific, actionable reason (expired challenge, wrong package,
    // unofficial signing key, malformed chain, …) — worth a real log line, not just the request
    // logger's bare statusCode, so a real-device test failure is diagnosable from server logs
    // alone (found the hard way 2026-09-29: a 400 with no logged reason on the first real-hardware
    // round trip left no way to tell which check failed without instrumenting the client).
    function reject(reason: string): void {
      logger.warn({ reason, challengeId, certChainLength: certChainB64?.length ?? 0 }, 'attestation verify rejected');
      res.status(400).json({ error: reason });
    }

    if (!challengeId || !certChainB64 || certChainB64.length === 0 || !devicePublicKey || !appVersion || !buildNumber) {
      reject('missing challengeId, certChainDer, devicePublicKey, appVersion, or buildNumber');
      return;
    }

    const now = Date.now();
    sweepExpiredChallenges(now);
    const record = challenges.get(challengeId);
    if (!record) {
      reject('unknown or expired challengeId');
      return;
    }
    // Single-use regardless of outcome — a failed attempt must not be retryable against the same
    // challenge (replay/brute-force defense).
    challenges.delete(challengeId);
    if (record.consumed || record.expiresAt <= now) {
      reject('challenge already used or expired');
      return;
    }

    let certChainDer: Buffer[];
    try {
      certChainDer = certChainB64.map((entry) => Buffer.from(String(entry), 'base64'));
    } catch {
      reject('certChainDer contains invalid base64');
      return;
    }

    const chainResult = verifyChainToRoots(certChainDer, trustedRootsPem);
    if (!chainResult.ok) {
      reject(chainResult.reason);
      return;
    }

    const extensionResult = parseKeyAttestationExtension(certChainDer[0]);
    if (!extensionResult.ok) {
      reject(extensionResult.reason);
      return;
    }
    const { attestation } = extensionResult;

    if (!attestation.attestationChallenge.equals(record.challenge)) {
      reject('attestation challenge does not match the one issued for this challengeId');
      return;
    }
    if (!attestation.packageNames.includes(officialApplicationId)) {
      reject(
        `attested package name does not match the official application id (got: ${attestation.packageNames.join(', ')})`,
      );
      return;
    }
    const matchesOfficialSigningKey = attestation.signatureDigestsHex.some(
      (digest) => normalizeHexDigest(digest) === officialSigningIdentityHash,
    );
    if (!matchesOfficialSigningKey) {
      reject(
        `attested signing certificate does not match the official release key (got: ${attestation.signatureDigestsHex.join(', ')}; expected: ${officialSigningIdentityHash})`,
      );
      return;
    }

    const issuedAt = new Date(now);
    const expiresAt = new Date(now + credentialTtlMs);
    const unsigned: Omit<OfficialBuildCredential, 'verifierSignature'> = {
      schemaVersion: 1,
      credentialId: crypto.randomUUID(),
      platform: 'android',
      applicationId: officialApplicationId,
      releaseChannel,
      appVersion,
      buildNumber,
      signingIdentityHash: officialSigningIdentityHash,
      devicePublicKey,
      evidenceType: 'android-key-attestation',
      evidenceTier: attestation.attestationSecurityLevel,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      verifierKeyId,
    };
    const verifierSignature = keyCustody.signWithVerifierKey(
      verifierPair.privateKeyPem,
      canonicalCredentialSigningInput(unsigned),
    );
    const credential: OfficialBuildCredential = { ...unsigned, verifierSignature };
    res.json({ credential });
  });

  app.get('/api/attestation/verifier-keys', async (_req, res) => {
    if (!verifierPair || !verifierKeyId) {
      if (hubRelayClient?.getAttestationVerifierKeys) {
        try {
          const relayed = await hubRelayClient.getAttestationVerifierKeys();
          res.status(relayed.status).json(relayed.body);
          return;
        } catch {
          // Hub unreachable — same reasoning as the other two routes above.
        }
      }
      res.status(503).json({ error: `attestation verifier unavailable: ${verifierLoadError}` });
      return;
    }
    // Single-key list today — rotation (an overlap list of currently-trusted keys) is deliberately
    // deferred, see docs/security/attestation-verifier-key-custody-and-rotation.md.
    res.json({ keys: [{ verifierKeyId, publicKeyPem: verifierPair.publicKeyPem }] });
  });
}
