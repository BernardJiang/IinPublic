import * as asn1js from 'asn1js';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  KEY_ATTESTATION_EXTENSION_OID,
  parseKeyAttestationExtension,
  verifyChainToRoots,
} from '../../server/security/android-key-attestation';

/**
 * Builds a synthetic `AttestationApplicationId ::= SEQUENCE { packageInfos SET OF
 * AttestationPackageInfo, signatureDigests SET OF OCTET STRING }` DER buffer — schema confirmed
 * against Google's own reference implementation, see android-key-attestation.ts's doc comment.
 */
function buildAttestationApplicationId(packageNames: string[], signatureDigestsHex: string[]): Buffer {
  const packageInfos = new asn1js.Set({
    value: packageNames.map(
      (name) =>
        new asn1js.Sequence({
          value: [
            new asn1js.OctetString({ valueHex: Buffer.from(name, 'utf8') }),
            new asn1js.Integer({ value: 1 }),
          ],
        }),
    ),
  });
  const signatureDigests = new asn1js.Set({
    value: signatureDigestsHex.map(
      (hex) => new asn1js.OctetString({ valueHex: Buffer.from(hex, 'hex') }),
    ),
  });
  const sequence = new asn1js.Sequence({ value: [packageInfos, signatureDigests] });
  return Buffer.from(sequence.toBER());
}

/** Builds a synthetic KeyDescription ASN.1 SEQUENCE matching the real schema, with
 * attestationApplicationId placed at tag 709 inside softwareEnforced. */
function buildKeyDescription(options: {
  attestationVersion: number;
  attestationSecurityLevel: number;
  attestationChallenge: Buffer;
  attestationApplicationId?: Buffer;
  placeAppIdInHardwareEnforced?: boolean;
}): Buffer {
  const appIdTagged = options.attestationApplicationId
    ? new asn1js.Constructed({
        idBlock: { tagClass: 3, tagNumber: 709 },
        value: [new asn1js.OctetString({ valueHex: options.attestationApplicationId })],
      })
    : null;

  const softwareEnforced = new asn1js.Sequence({
    value: appIdTagged && !options.placeAppIdInHardwareEnforced ? [appIdTagged] : [],
  });
  const hardwareEnforced = new asn1js.Sequence({
    value: appIdTagged && options.placeAppIdInHardwareEnforced ? [appIdTagged] : [],
  });

  const sequence = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: options.attestationVersion }),
      new asn1js.Enumerated({ value: options.attestationSecurityLevel }),
      new asn1js.Integer({ value: 5 }), // keymasterVersion (unused by the parser)
      new asn1js.Enumerated({ value: options.attestationSecurityLevel }), // keymasterSecurityLevel
      new asn1js.OctetString({ valueHex: options.attestationChallenge }),
      new asn1js.OctetString({ valueHex: Buffer.from('') }), // uniqueId
      softwareEnforced,
      hardwareEnforced,
    ],
  });
  return Buffer.from(sequence.toBER());
}

/** Builds a minimal synthetic "certificate-shaped" DER: Certificate ::= SEQUENCE { TBSCertificate,
 * ... } where TBSCertificate's [3] EXPLICIT extensions block contains our Key Attestation
 * extension (plus, optionally, an unrelated extension to prove the OID-matching loop actually
 * discriminates). Not a cryptographically valid certificate (no real signature) — that's fine,
 * parseKeyAttestationExtension never checks the signature, only walks the ASN.1 tree to find and
 * extract one specific extension by OID. verifyChainToRoots (tested separately, below) is what
 * exercises real signature verification, via real openssl-generated certs. */
function buildCertificateWithExtension(extensionOid: string, extensionValueDer: Buffer, extraExtensions: Array<[string, Buffer]> = []): Buffer {
  const extensionEntries = [
    ...extraExtensions.map(
      ([oid, value]) =>
        new asn1js.Sequence({
          value: [new asn1js.ObjectIdentifier({ value: oid }), new asn1js.OctetString({ valueHex: value })],
        }),
    ),
    new asn1js.Sequence({
      value: [
        new asn1js.ObjectIdentifier({ value: extensionOid }),
        new asn1js.OctetString({ valueHex: extensionValueDer }),
      ],
    }),
  ];
  const extensions = new asn1js.Sequence({ value: extensionEntries });
  const extensionsTagged = new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 3 }, value: [extensions] });

  const tbsCertificate = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 1 }), // serialNumber (stand-in; real TBS has version+serial, simplified for this test)
      extensionsTagged,
    ],
  });
  const certificate = new asn1js.Sequence({ value: [tbsCertificate] });
  return Buffer.from(certificate.toBER());
}

describe('parseKeyAttestationExtension', () => {
  it('extracts attestationVersion, securityLevel, challenge, package name, and signature digest', () => {
    const challenge = Buffer.from('test-challenge-bytes');
    const appId = buildAttestationApplicationId(['com.iinpublic.app'], ['a'.repeat(64)]);
    const keyDescription = buildKeyDescription({
      attestationVersion: 300,
      attestationSecurityLevel: 2, // StrongBox
      attestationChallenge: challenge,
      attestationApplicationId: appId,
    });
    const cert = buildCertificateWithExtension(KEY_ATTESTATION_EXTENSION_OID, keyDescription);

    const result = parseKeyAttestationExtension(cert);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attestation.attestationVersion).toBe(300);
    expect(result.attestation.attestationSecurityLevel).toBe('strongbox');
    expect(result.attestation.attestationChallenge.equals(challenge)).toBe(true);
    expect(result.attestation.packageNames).toEqual(['com.iinpublic.app']);
    expect(result.attestation.signatureDigestsHex).toEqual(['a'.repeat(64)]);
  });

  it('maps all three security levels correctly (software=0, tee=1, strongbox=2)', () => {
    const appId = buildAttestationApplicationId(['com.iinpublic.app'], ['a'.repeat(64)]);
    for (const [raw, expected] of [[0, 'software'], [1, 'tee'], [2, 'strongbox']] as const) {
      const keyDescription = buildKeyDescription({
        attestationVersion: 1,
        attestationSecurityLevel: raw,
        attestationChallenge: Buffer.from('c'),
        attestationApplicationId: appId,
      });
      const cert = buildCertificateWithExtension(KEY_ATTESTATION_EXTENSION_OID, keyDescription);
      const result = parseKeyAttestationExtension(cert);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.attestation.attestationSecurityLevel).toBe(expected);
    }
  });

  it('finds the attestation extension among unrelated extensions by OID, not position', () => {
    const appId = buildAttestationApplicationId(['com.iinpublic.app'], ['a'.repeat(64)]);
    const keyDescription = buildKeyDescription({
      attestationVersion: 1,
      attestationSecurityLevel: 1,
      attestationChallenge: Buffer.from('c'),
      attestationApplicationId: appId,
    });
    const cert = buildCertificateWithExtension(KEY_ATTESTATION_EXTENSION_OID, keyDescription, [
      ['2.5.29.15', Buffer.from('unrelated-key-usage-extension')],
      ['2.5.29.19', Buffer.from('unrelated-basic-constraints')],
    ]);
    const result = parseKeyAttestationExtension(cert);
    expect(result.ok).toBe(true);
  });

  it('finds attestationApplicationId when placed in hardwareEnforced instead of softwareEnforced', () => {
    const appId = buildAttestationApplicationId(['com.iinpublic.app'], ['b'.repeat(64)]);
    const keyDescription = buildKeyDescription({
      attestationVersion: 1,
      attestationSecurityLevel: 1,
      attestationChallenge: Buffer.from('c'),
      attestationApplicationId: appId,
      placeAppIdInHardwareEnforced: true,
    });
    const cert = buildCertificateWithExtension(KEY_ATTESTATION_EXTENSION_OID, keyDescription);
    const result = parseKeyAttestationExtension(cert);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attestation.packageNames).toEqual(['com.iinpublic.app']);
  });

  it('fails cleanly (not a crash) when the extension is absent', () => {
    const cert = buildCertificateWithExtension('2.5.29.15', Buffer.from('unrelated'));
    const result = parseKeyAttestationExtension(cert);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no Key Attestation extension/);
  });

  it('fails cleanly when attestationApplicationId is missing from both authorization lists', () => {
    const keyDescription = buildKeyDescription({
      attestationVersion: 1,
      attestationSecurityLevel: 1,
      attestationChallenge: Buffer.from('c'),
      // no attestationApplicationId
    });
    const cert = buildCertificateWithExtension(KEY_ATTESTATION_EXTENSION_OID, keyDescription);
    const result = parseKeyAttestationExtension(cert);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/attestationApplicationId not present/);
  });

  it('fails cleanly (not a crash) on garbage input', () => {
    const result = parseKeyAttestationExtension(Buffer.from('this is not DER at all'));
    expect(result.ok).toBe(false);
  });

  it('reports multiple package names and signature digests when present', () => {
    const appId = buildAttestationApplicationId(
      ['com.iinpublic.app', 'com.iinpublic.app.dev'],
      ['a'.repeat(64), 'b'.repeat(64)],
    );
    const keyDescription = buildKeyDescription({
      attestationVersion: 1,
      attestationSecurityLevel: 1,
      attestationChallenge: Buffer.from('c'),
      attestationApplicationId: appId,
    });
    const cert = buildCertificateWithExtension(KEY_ATTESTATION_EXTENSION_OID, keyDescription);
    const result = parseKeyAttestationExtension(cert);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attestation.packageNames).toEqual(['com.iinpublic.app', 'com.iinpublic.app.dev']);
      expect(result.attestation.signatureDigestsHex).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    }
  });
});

describe('the committed Google hardware attestation root PEM file', () => {
  it('parses as two well-formed, currently-valid, self-signed certificates', () => {
    const pemPath = path.resolve(__dirname, '../../server/security/google-hardware-attestation-roots.pem');
    const combined = fs.readFileSync(pemPath, 'utf8');
    const pems = combined.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    expect(pems).not.toBeNull();
    expect(pems).toHaveLength(2);
    for (const pem of pems ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { X509Certificate } = require('crypto');
      const cert = new X509Certificate(pem);
      expect(cert.subject).toBe(cert.issuer); // self-signed root
      expect(new Date(cert.validFrom).getTime()).toBeLessThan(Date.now());
      expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now());
    }
  });
});

describe('verifyChainToRoots', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-attestation-chain-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function openssl(args: string[]): void {
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  }

  function derOf(pemFile: string): Buffer {
    const derFile = pemFile.replace(/\.pem$/, '.der');
    openssl(['x509', '-in', pemFile, '-outform', 'der', '-out', derFile]);
    return fs.readFileSync(path.join(dir, derFile));
  }

  function makeRootAndLeaf(): { rootPem: string; leafDer: Buffer; otherRootPem: string } {
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key']);
    openssl([
      'req', '-x509', '-new', '-key', 'root.key', '-days', '3650', '-subj', '/CN=Test Attestation Root',
      '-out', 'root.pem',
    ]);
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key']);
    openssl(['req', '-new', '-key', 'leaf.key', '-subj', '/CN=Test Leaf', '-out', 'leaf.csr']);
    openssl([
      'x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial',
      '-days', '365', '-out', 'leaf.pem',
    ]);
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'other-root.key']);
    openssl([
      'req', '-x509', '-new', '-key', 'other-root.key', '-days', '3650', '-subj', '/CN=Unrelated Root',
      '-out', 'other-root.pem',
    ]);
    return {
      rootPem: fs.readFileSync(path.join(dir, 'root.pem'), 'utf8'),
      leafDer: derOf('leaf.pem'),
      otherRootPem: fs.readFileSync(path.join(dir, 'other-root.pem'), 'utf8'),
    };
  }

  it('verifies a real 2-certificate chain against its own trusted root', () => {
    const { rootPem, leafDer } = makeRootAndLeaf();
    const rootDer = derOf('root.pem');
    const result = verifyChainToRoots([leafDer, rootDer], [rootPem]);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a chain that does not terminate at any trusted root', () => {
    const { leafDer, otherRootPem } = makeRootAndLeaf();
    const rootDer = derOf('root.pem');
    const result = verifyChainToRoots([leafDer, rootDer], [otherRootPem]);
    expect(result.ok).toBe(false);
  });

  it('rejects an empty chain', () => {
    expect(verifyChainToRoots([], ['irrelevant'])).toEqual({ ok: false, reason: 'empty certificate chain' });
  });

  it('rejects malformed certificate bytes', () => {
    const result = verifyChainToRoots([Buffer.from('not a cert')], ['irrelevant']);
    expect(result.ok).toBe(false);
  });

  it('rejects a leaf not actually signed by the claimed next cert (broken chain link)', () => {
    // Two independently-generated, unrelated self-signed certs presented as if leaf->root —
    // neither issued the other, so the signature check must fail. Read root.der BEFORE the
    // second makeRootAndLeaf() call, since it reuses the same fixed filenames and would
    // otherwise overwrite the first root/leaf on disk before this test reads them.
    const { rootPem } = makeRootAndLeaf();
    const rootDer = derOf('root.pem');
    const { leafDer: unrelatedLeafDer } = makeRootAndLeaf();
    const result = verifyChainToRoots([unrelatedLeafDer, rootDer], [rootPem]);
    expect(result.ok).toBe(false);
  });
});
