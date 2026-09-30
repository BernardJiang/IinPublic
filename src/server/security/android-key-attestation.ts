/**
 * Parses and verifies an Android hardware Key Attestation certificate chain — the evidence a
 * device submits to `src/server/routes/attestation-routes.ts` to prove it's running an official,
 * unmodified IinPublic build on genuine Android hardware.
 *
 * Schema/OID references: `docs/security/official-build-identifiers.md`. The exact ASN.1 shape
 * used here (`AttestationApplicationId`'s nested SEQUENCE/SET structure, and the tag `709` for
 * locating it inside the Key Attestation extension's AuthorizationList) was confirmed against
 * Google's own reference implementation
 * (github.com/google/android-key-attestation/.../AuthorizationList.java,
 * .../Constants.java: `KM_TAG_ATTESTATION_APPLICATION_ID = 709`) before writing this, not
 * assumed — an earlier automated summary of the same source reported a wrong tag number (261)
 * that a second, literal-verbatim fetch caught and corrected.
 *
 * Uses Node's built-in `crypto.X509Certificate` for standard chain-signature verification, and
 * `asn1js` only for the two things Node doesn't expose: the nonstandard Key Attestation
 * extension (OID 1.3.6.1.4.1.11129.2.1.17) and locating the X.509 `extensions` block itself
 * (Node has no public "get extension by OID" API as of the Node versions this repo targets).
 */

import * as crypto from 'crypto';
import * as asn1js from 'asn1js';

export const KEY_ATTESTATION_EXTENSION_OID = '1.3.6.1.4.1.11129.2.1.17';
const X509_EXTENSIONS_CONTEXT_TAG = 3;
const ATTESTATION_APPLICATION_ID_TAG = 709;

export type SecurityLevel = 'software' | 'tee' | 'strongbox';

function securityLevelFromEnum(value: number): SecurityLevel | null {
  if (value === 0) return 'software';
  if (value === 1) return 'tee';
  if (value === 2) return 'strongbox';
  return null;
}

export interface ParsedKeyAttestation {
  attestationVersion: number;
  attestationSecurityLevel: SecurityLevel;
  attestationChallenge: Buffer;
  packageNames: string[];
  /** SHA-256 hex digests of the signing certificate(s), as reported inside the attestation
   * extension by the device's own hardware — this is the actual "who signed this app" evidence,
   * compared against docs/security/official-build-identifiers.md's pinned digest. */
  signatureDigestsHex: string[];
}

export type ParseResult =
  | { ok: true; attestation: ParsedKeyAttestation }
  | { ok: false; reason: string };

export type ChainVerifyResult = { ok: true } | { ok: false; reason: string };

function isConstructed(node: unknown): node is { valueBlock: { value: unknown[] } } {
  return !!node && typeof node === 'object' && Array.isArray((node as { valueBlock?: { value?: unknown } }).valueBlock?.value);
}

function tagInfo(node: unknown): { tagClass: number; tagNumber: number } | null {
  const n = node as { idBlock?: { tagClass?: number; tagNumber?: number } } | undefined;
  if (!n?.idBlock || typeof n.idBlock.tagClass !== 'number' || typeof n.idBlock.tagNumber !== 'number') return null;
  return { tagClass: n.idBlock.tagClass, tagNumber: n.idBlock.tagNumber };
}

/** Finds a context-specific (tagClass 3) EXPLICIT-tagged child with the given tag number among a
 * constructed node's direct children. EXPLICIT tags parse as ordinary constructed nodes in
 * asn1js's generic BER decode, so the tagged content is already the (first) parsed child. */
function findContextTaggedChild(node: unknown, tagNumber: number): unknown | null {
  if (!isConstructed(node)) return null;
  for (const child of node.valueBlock.value) {
    const tag = tagInfo(child);
    if (tag && tag.tagClass === 3 && tag.tagNumber === tagNumber) return child;
  }
  return null;
}

function octetStringBytes(node: unknown): Buffer | null {
  const n = node as { valueBlock?: { valueHexView?: Uint8Array } } | undefined;
  const view = n?.valueBlock?.valueHexView;
  return view ? Buffer.from(view) : null;
}

function integerValue(node: unknown): number | null {
  const n = node as { valueBlock?: { valueDec?: number } } | undefined;
  return typeof n?.valueBlock?.valueDec === 'number' ? n.valueBlock.valueDec : null;
}

function objectIdString(node: unknown): string | null {
  const n = node as { valueBlock?: { toString?: () => string } } | undefined;
  return typeof n?.valueBlock?.toString === 'function' ? n.valueBlock.toString() : null;
}

/** `Buffer#buffer` is typed as `ArrayBuffer | SharedArrayBuffer` (it can share the underlying
 * pool), but asn1js's `fromBER` wants a concrete `ArrayBuffer`. A copying slice always produces
 * one, at the cost of one extra allocation per parse call — fine, these are small (single
 * certificates), not a hot path. */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return new Uint8Array(buffer).slice().buffer;
}

/**
 * Extracts the Key Attestation extension's raw bytes from a leaf certificate's DER, by walking
 * Certificate -> TBSCertificate -> the [3] EXPLICIT extensions block -> each Extension SEQUENCE
 * (extnID, [critical], extnValue), matching extnID against KEY_ATTESTATION_EXTENSION_OID.
 */
function findKeyAttestationExtensionBytes(certDer: Buffer): Buffer | null {
  const parsed = asn1js.fromBER(toArrayBuffer(certDer));
  if (parsed.offset === -1 || !isConstructed(parsed.result)) return null;
  const certificate = parsed.result;
  const tbsCertificate = certificate.valueBlock.value[0];
  if (!isConstructed(tbsCertificate)) return null;

  const extensionsWrapper = findContextTaggedChild(tbsCertificate, X509_EXTENSIONS_CONTEXT_TAG);
  if (!isConstructed(extensionsWrapper)) return null;
  // extensionsWrapper is the [3] EXPLICIT tag; its own first (and only) child is the actual
  // `Extensions ::= SEQUENCE OF Extension` sequence.
  const extensionsSequence = extensionsWrapper.valueBlock.value[0];
  if (!isConstructed(extensionsSequence)) return null;

  for (const extension of extensionsSequence.valueBlock.value) {
    if (!isConstructed(extension)) continue;
    const [oidNode, ...rest] = extension.valueBlock.value;
    const oid = objectIdString(oidNode);
    if (oid !== KEY_ATTESTATION_EXTENSION_OID) continue;
    // extnValue is the last element (extension may or may not include the optional `critical`
    // BOOLEAN before it) — the OCTET STRING wrapping the actual KeyDescription DER.
    const extnValueNode = rest[rest.length - 1];
    return octetStringBytes(extnValueNode);
  }
  return null;
}

/** Parses `AttestationApplicationId ::= SEQUENCE { packageInfos SET OF AttestationPackageInfo,
 * signatureDigests SET OF OCTET STRING }`, `AttestationPackageInfo ::= SEQUENCE { packageName
 * OCTET STRING, version INTEGER }` — schema confirmed against Google's reference parser (see
 * module doc comment). */
function parseAttestationApplicationId(bytes: Buffer): { packageNames: string[]; signatureDigestsHex: string[] } | null {
  const parsed = asn1js.fromBER(toArrayBuffer(bytes));
  if (parsed.offset === -1 || !isConstructed(parsed.result)) return null;
  const [packageInfos, signatureDigests] = parsed.result.valueBlock.value;
  if (!isConstructed(packageInfos) || !isConstructed(signatureDigests)) return null;

  const packageNames: string[] = [];
  for (const packageInfo of packageInfos.valueBlock.value) {
    if (!isConstructed(packageInfo)) continue;
    const nameBytes = octetStringBytes(packageInfo.valueBlock.value[0]);
    if (nameBytes) packageNames.push(nameBytes.toString('utf8'));
  }

  const signatureDigestsHex: string[] = [];
  for (const digest of signatureDigests.valueBlock.value) {
    const digestBytes = octetStringBytes(digest);
    if (digestBytes) signatureDigestsHex.push(digestBytes.toString('hex'));
  }

  return { packageNames, signatureDigestsHex };
}

/**
 * Parses `KeyDescription ::= SEQUENCE { attestationVersion INTEGER, attestationSecurityLevel
 * ENUMERATED, keymasterVersion INTEGER, keymasterSecurityLevel ENUMERATED, attestationChallenge
 * OCTET STRING, uniqueId OCTET STRING, softwareEnforced AuthorizationList, hardwareEnforced
 * AuthorizationList }`, then locates `attestationApplicationId` (tag 709) inside whichever of
 * softwareEnforced/hardwareEnforced actually carries it (Android places it in softwareEnforced
 * in practice, but this checks both rather than assuming — a wrong assumption here degrades to
 * "not found", never a crash).
 */
export function parseKeyAttestationExtension(leafCertDer: Buffer): ParseResult {
  const extensionBytes = findKeyAttestationExtensionBytes(leafCertDer);
  if (!extensionBytes) return { ok: false, reason: 'leaf certificate has no Key Attestation extension' };

  const parsed = asn1js.fromBER(
    toArrayBuffer(extensionBytes),
  );
  if (parsed.offset === -1 || !isConstructed(parsed.result)) {
    return { ok: false, reason: 'Key Attestation extension is not valid DER' };
  }
  const fields = parsed.result.valueBlock.value;
  if (fields.length < 8) return { ok: false, reason: 'KeyDescription sequence has too few fields' };

  const attestationVersion = integerValue(fields[0]);
  const securityLevelRaw = integerValue(fields[1]); // ENUMERATED decodes the same as INTEGER in asn1js
  const attestationChallenge = octetStringBytes(fields[4]);
  const softwareEnforced = fields[6];
  const hardwareEnforced = fields[7];

  if (attestationVersion === null) return { ok: false, reason: 'missing attestationVersion' };
  if (securityLevelRaw === null) return { ok: false, reason: 'missing attestationSecurityLevel' };
  const attestationSecurityLevel = securityLevelFromEnum(securityLevelRaw);
  if (!attestationSecurityLevel) return { ok: false, reason: `unrecognized attestationSecurityLevel ${securityLevelRaw}` };
  if (!attestationChallenge) return { ok: false, reason: 'missing attestationChallenge' };

  const appIdTagged =
    findContextTaggedChild(softwareEnforced, ATTESTATION_APPLICATION_ID_TAG) ||
    findContextTaggedChild(hardwareEnforced, ATTESTATION_APPLICATION_ID_TAG);
  if (!appIdTagged || !isConstructed(appIdTagged)) {
    return { ok: false, reason: 'attestationApplicationId not present in either AuthorizationList' };
  }
  // appIdTagged is the [709] EXPLICIT wrapper; its child is the OCTET STRING whose bytes are the
  // further DER-encoded AttestationApplicationId SEQUENCE.
  const appIdOctetString = appIdTagged.valueBlock.value[0];
  const appIdBytes = octetStringBytes(appIdOctetString);
  if (!appIdBytes) return { ok: false, reason: 'attestationApplicationId OCTET STRING is empty/malformed' };

  const appId = parseAttestationApplicationId(appIdBytes);
  if (!appId) return { ok: false, reason: 'attestationApplicationId is not valid DER' };

  return {
    ok: true,
    attestation: {
      attestationVersion,
      attestationSecurityLevel,
      attestationChallenge,
      packageNames: appId.packageNames,
      signatureDigestsHex: appId.signatureDigestsHex,
    },
  };
}

/**
 * Verifies a leaf-to-root certificate chain (each cert must be signed by the next, terminating
 * at one of `trustedRootsPem`) using Node's built-in `crypto.X509Certificate` — no ASN.1 parsing
 * needed here, this is exactly what it's designed for. Does not itself check revocation status
 * (docs/security/official-build-identifiers.md notes that's a separate, intentionally-live
 * check against Google's CRL-equivalent endpoint) or the attestation extension's contents (see
 * parseKeyAttestationExtension above) — this function answers only "is this a genuine chain
 * rooted at Google's hardware attestation root."
 */
export function verifyChainToRoots(certChainDer: Buffer[], trustedRootsPem: string[]): ChainVerifyResult {
  if (certChainDer.length === 0) return { ok: false, reason: 'empty certificate chain' };

  let certs: crypto.X509Certificate[];
  try {
    certs = certChainDer.map((der) => new crypto.X509Certificate(der));
  } catch (error) {
    return { ok: false, reason: `chain contains an invalid certificate: ${(error as Error).message}` };
  }

  for (let i = 0; i < certs.length - 1; i += 1) {
    const subject = certs[i];
    const issuer = certs[i + 1];
    if (!subject.checkIssued(issuer) || !subject.verify(issuer.publicKey)) {
      return { ok: false, reason: `chain link ${i}->${i + 1} does not verify (not correctly signed by the next cert)` };
    }
  }

  const topOfChain = certs[certs.length - 1];
  const rootMatch = trustedRootsPem.some((rootPem) => {
    try {
      const root = new crypto.X509Certificate(rootPem);
      // The submitted chain's top cert should equal one of our pinned roots (self-signed, so
      // issuer===subject) — or be directly issued by one, if the device didn't include the root
      // itself in what it sent us.
      if (topOfChain.fingerprint256 === root.fingerprint256) return true;
      return topOfChain.checkIssued(root) && topOfChain.verify(root.publicKey);
    } catch {
      return false;
    }
  });
  if (!rootMatch) return { ok: false, reason: 'chain does not terminate at a trusted Google hardware attestation root' };

  const now = Date.now();
  for (const cert of certs) {
    const validFrom = new Date(cert.validFrom).getTime();
    const validTo = new Date(cert.validTo).getTime();
    if (now < validFrom || now > validTo) {
      return { ok: false, reason: `certificate ${cert.subject} is not currently valid (${cert.validFrom} - ${cert.validTo})` };
    }
  }

  return { ok: true };
}
