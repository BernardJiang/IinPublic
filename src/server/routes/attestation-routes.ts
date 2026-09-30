import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type express from 'express';
import { P2PAbuseDefenseContext, type AbuseDefenseConfig } from '../../shared/p2p-abuse-defense';
import { verifyChainToRoots, parseKeyAttestationExtension } from '../security/android-key-attestation';
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
const DEFAULT_ROOTS_PATH = path.join(__dirname, '..', 'security', 'google-hardware-attestation-roots.pem');

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
    deps.trustedRootsPem ?? splitPemCertificates(fs.readFileSync(DEFAULT_ROOTS_PATH, 'utf8'));

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

  const abuseCtx = new P2PAbuseDefenseContext(deps.abuseDefenseConfig ?? {});
  const challenges = new Map<string, ChallengeRecord>();

  function sweepExpiredChallenges(now: number): void {
    for (const [id, record] of challenges) {
      if (record.expiresAt <= now) challenges.delete(id);
    }
  }

  app.post('/api/attestation/challenge', (req, res) => {
    if (!verifierPair || !verifierKeyId) {
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

  app.post('/api/attestation/verify', (req, res) => {
    if (!verifierPair || !verifierKeyId) {
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

    if (!challengeId || !certChainB64 || certChainB64.length === 0 || !devicePublicKey || !appVersion || !buildNumber) {
      res.status(400).json({ error: 'missing challengeId, certChainDer, devicePublicKey, appVersion, or buildNumber' });
      return;
    }

    const now = Date.now();
    sweepExpiredChallenges(now);
    const record = challenges.get(challengeId);
    if (!record) {
      res.status(400).json({ error: 'unknown or expired challengeId' });
      return;
    }
    // Single-use regardless of outcome — a failed attempt must not be retryable against the same
    // challenge (replay/brute-force defense).
    challenges.delete(challengeId);
    if (record.consumed || record.expiresAt <= now) {
      res.status(400).json({ error: 'challenge already used or expired' });
      return;
    }

    let certChainDer: Buffer[];
    try {
      certChainDer = certChainB64.map((entry) => Buffer.from(String(entry), 'base64'));
    } catch {
      res.status(400).json({ error: 'certChainDer contains invalid base64' });
      return;
    }

    const chainResult = verifyChainToRoots(certChainDer, trustedRootsPem);
    if (!chainResult.ok) {
      res.status(400).json({ error: chainResult.reason });
      return;
    }

    const extensionResult = parseKeyAttestationExtension(certChainDer[0]);
    if (!extensionResult.ok) {
      res.status(400).json({ error: extensionResult.reason });
      return;
    }
    const { attestation } = extensionResult;

    if (!attestation.attestationChallenge.equals(record.challenge)) {
      res.status(400).json({ error: 'attestation challenge does not match the one issued for this challengeId' });
      return;
    }
    if (!attestation.packageNames.includes(officialApplicationId)) {
      res.status(400).json({ error: 'attested package name does not match the official application id' });
      return;
    }
    const matchesOfficialSigningKey = attestation.signatureDigestsHex.some(
      (digest) => normalizeHexDigest(digest) === officialSigningIdentityHash,
    );
    if (!matchesOfficialSigningKey) {
      res.status(400).json({ error: 'attested signing certificate does not match the official release key' });
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

  app.get('/api/attestation/verifier-keys', (_req, res) => {
    if (!verifierPair || !verifierKeyId) {
      res.status(503).json({ error: `attestation verifier unavailable: ${verifierLoadError}` });
      return;
    }
    // Single-key list today — rotation (an overlap list of currently-trusted keys) is deliberately
    // deferred, see docs/security/attestation-verifier-key-custody-and-rotation.md.
    res.json({ keys: [{ verifierKeyId, publicKeyPem: verifierPair.publicKeyPem }] });
  });
}
