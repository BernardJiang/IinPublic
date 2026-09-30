import * as asn1js from 'asn1js';
import { execFileSync } from 'child_process';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { registerAttestationRoutes } from '../../server/routes/attestation-routes';
import { canonicalCredentialSigningInput } from '../../shared/official-build-credential';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const keyCustody = require('../../server/security/attestation-verifier-key-custody');

const OFFICIAL_APP_ID = 'com.iinpublic.app';
const OFFICIAL_SIGNING_HASH_HEX = 'aa'.repeat(32); // lowercase, no colons — the normalized form

function buildAttestationApplicationId(packageName: string, signatureDigestHex: string): Buffer {
  const packageInfos = new asn1js.Set({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.OctetString({ valueHex: Buffer.from(packageName, 'utf8') }),
          new asn1js.Integer({ value: 1 }),
        ],
      }),
    ],
  });
  const signatureDigests = new asn1js.Set({
    value: [new asn1js.OctetString({ valueHex: Buffer.from(signatureDigestHex, 'hex') })],
  });
  return Buffer.from(new asn1js.Sequence({ value: [packageInfos, signatureDigests] }).toBER());
}

function buildKeyDescriptionExtensionDer(options: {
  challenge: Buffer;
  securityLevel: number; // 0 software, 1 tee, 2 strongbox
  packageName: string;
  signatureDigestHex: string;
}): Buffer {
  const appId = buildAttestationApplicationId(options.packageName, options.signatureDigestHex);
  const appIdTagged = new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber: 709 },
    value: [new asn1js.OctetString({ valueHex: appId })],
  });
  const softwareEnforced = new asn1js.Sequence({ value: [appIdTagged] });
  const hardwareEnforced = new asn1js.Sequence({ value: [] });
  const keyDescription = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 300 }),
      new asn1js.Enumerated({ value: options.securityLevel }),
      new asn1js.Integer({ value: 5 }),
      new asn1js.Enumerated({ value: options.securityLevel }),
      new asn1js.OctetString({ valueHex: options.challenge }),
      new asn1js.OctetString({ valueHex: Buffer.from('') }),
      softwareEnforced,
      hardwareEnforced,
    ],
  });
  return Buffer.from(keyDescription.toBER());
}

describe('attestation routes (end-to-end)', () => {
  let dir: string;
  let app: express.Express;
  let verifierKeyFile: string;
  let trustedRootPem: string;

  function openssl(args: string[]): void {
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  }

  /** Builds a real, chain-verifiable leaf certificate (signed by a real openssl-generated root)
   * whose Key Attestation extension carries the given attestation data — exercises the entire
   * pipeline (chain verification + ASN.1 extension parsing) against real DER, not mocks. */
  function buildLeafCertDer(attestationExtensionDer: Buffer): Buffer {
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key']);
    openssl(['req', '-new', '-key', 'leaf.key', '-subj', '/CN=Test Device Leaf', '-out', 'leaf.csr']);
    const extFile = path.join(dir, 'ext.cnf');
    fs.writeFileSync(
      extFile,
      `[ v3_ext ]\n1.3.6.1.4.1.11129.2.1.17=DER:${attestationExtensionDer.toString('hex')}\n`,
    );
    openssl([
      'x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial',
      '-days', '365', '-extfile', extFile, '-extensions', 'v3_ext', '-out', 'leaf.pem',
    ]);
    openssl(['x509', '-in', 'leaf.pem', '-outform', 'der', '-out', 'leaf.der']);
    return fs.readFileSync(path.join(dir, 'leaf.der'));
  }

  function rootDer(): Buffer {
    openssl(['x509', '-in', 'root.pem', '-outform', 'der', '-out', 'root.der']);
    return fs.readFileSync(path.join(dir, 'root.der'));
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-attestation-routes-'));
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key']);
    openssl([
      'req', '-x509', '-new', '-key', 'root.key', '-days', '3650', '-subj', '/CN=Test Attestation Root',
      '-out', 'root.pem',
    ]);
    trustedRootPem = fs.readFileSync(path.join(dir, 'root.pem'), 'utf8');

    const pair = keyCustody.generateVerifierKeyPair();
    const passphrase = 'a-sufficiently-long-test-passphrase';
    verifierKeyFile = path.join(dir, 'verifier.key.json');
    keyCustody.writeJsonAtomicSync(verifierKeyFile, keyCustody.sealPair(pair, passphrase));
    process.env.ATTESTATION_VERIFIER_KEY_PASSPHRASE = passphrase;
  });

  afterAll(() => {
    delete process.env.ATTESTATION_VERIFIER_KEY_PASSPHRASE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    registerAttestationRoutes(app, {
      verifierKeyFile,
      trustedRootsPem: [trustedRootPem],
      officialApplicationId: OFFICIAL_APP_ID,
      officialSigningIdentityHash: OFFICIAL_SIGNING_HASH_HEX,
    });
  });

  it('issues a signed, verifiable OfficialBuildCredential for a genuine chain matching the official identity', async () => {
    const challengeRes = await request(app).post('/api/attestation/challenge').send({ pub: 'device-pub-1' });
    expect(challengeRes.status).toBe(200);
    const { challengeId, challenge } = challengeRes.body;
    expect(challengeId).toBeTruthy();

    const extensionDer = buildKeyDescriptionExtensionDer({
      challenge: Buffer.from(challenge, 'base64'),
      securityLevel: 2, // StrongBox
      packageName: OFFICIAL_APP_ID,
      signatureDigestHex: OFFICIAL_SIGNING_HASH_HEX,
    });
    const leafDer = buildLeafCertDer(extensionDer);

    const verifyRes = await request(app).post('/api/attestation/verify').send({
      challengeId,
      certChainDer: [leafDer.toString('base64'), rootDer().toString('base64')],
      devicePublicKey: 'device-pub-1',
      appVersion: '1.0.60',
      buildNumber: '1000060',
    });

    expect(verifyRes.status).toBe(200);
    const { credential } = verifyRes.body;
    expect(credential.applicationId).toBe(OFFICIAL_APP_ID);
    expect(credential.evidenceTier).toBe('strongbox');
    expect(credential.devicePublicKey).toBe('device-pub-1');

    // The credential's signature must actually verify against the published verifier key.
    const keysRes = await request(app).get('/api/attestation/verifier-keys');
    expect(keysRes.status).toBe(200);
    const publishedKey = keysRes.body.keys.find((k: { verifierKeyId: string }) => k.verifierKeyId === credential.verifierKeyId);
    expect(publishedKey).toBeTruthy();
    const { verifierSignature, ...unsigned } = credential;
    const signatureValid = keyCustody.verifyWithVerifierKey(
      publishedKey.publicKeyPem,
      canonicalCredentialSigningInput(unsigned),
      verifierSignature,
    );
    expect(signatureValid).toBe(true);
  });

  it('rejects verification with a wrong/stale challenge (replay defense)', async () => {
    const challengeRes = await request(app).post('/api/attestation/challenge').send({ pub: 'device-pub-2' });
    const { challengeId } = challengeRes.body;

    const extensionDer = buildKeyDescriptionExtensionDer({
      challenge: Buffer.from('not-the-real-challenge'),
      securityLevel: 1,
      packageName: OFFICIAL_APP_ID,
      signatureDigestHex: OFFICIAL_SIGNING_HASH_HEX,
    });
    const leafDer = buildLeafCertDer(extensionDer);

    const verifyRes = await request(app).post('/api/attestation/verify').send({
      challengeId,
      certChainDer: [leafDer.toString('base64'), rootDer().toString('base64')],
      devicePublicKey: 'device-pub-2',
      appVersion: '1.0.60',
      buildNumber: '1000060',
    });
    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.error).toMatch(/does not match/);
  });

  it('rejects a challenge presented twice (single-use)', async () => {
    const challengeRes = await request(app).post('/api/attestation/challenge').send({ pub: 'device-pub-3' });
    const { challengeId, challenge } = challengeRes.body;
    const extensionDer = buildKeyDescriptionExtensionDer({
      challenge: Buffer.from(challenge, 'base64'),
      securityLevel: 2,
      packageName: OFFICIAL_APP_ID,
      signatureDigestHex: OFFICIAL_SIGNING_HASH_HEX,
    });
    const leafDer = buildLeafCertDer(extensionDer);
    const payload = {
      challengeId,
      certChainDer: [leafDer.toString('base64'), rootDer().toString('base64')],
      devicePublicKey: 'device-pub-3',
      appVersion: '1.0.60',
      buildNumber: '1000060',
    };
    const first = await request(app).post('/api/attestation/verify').send(payload);
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/attestation/verify').send(payload);
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/unknown or expired/);
  });

  it('rejects a package name that does not match the official application id', async () => {
    const challengeRes = await request(app).post('/api/attestation/challenge').send({ pub: 'device-pub-4' });
    const { challengeId, challenge } = challengeRes.body;
    const extensionDer = buildKeyDescriptionExtensionDer({
      challenge: Buffer.from(challenge, 'base64'),
      securityLevel: 2,
      packageName: 'com.example.fork',
      signatureDigestHex: OFFICIAL_SIGNING_HASH_HEX,
    });
    const leafDer = buildLeafCertDer(extensionDer);
    const verifyRes = await request(app).post('/api/attestation/verify').send({
      challengeId,
      certChainDer: [leafDer.toString('base64'), rootDer().toString('base64')],
      devicePublicKey: 'device-pub-4',
      appVersion: '1.0.60',
      buildNumber: '1000060',
    });
    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.error).toMatch(/package name/);
  });

  it('rejects a signing-certificate digest that does not match the official release key', async () => {
    const challengeRes = await request(app).post('/api/attestation/challenge').send({ pub: 'device-pub-5' });
    const { challengeId, challenge } = challengeRes.body;
    const extensionDer = buildKeyDescriptionExtensionDer({
      challenge: Buffer.from(challenge, 'base64'),
      securityLevel: 2,
      packageName: OFFICIAL_APP_ID,
      signatureDigestHex: 'bb'.repeat(32), // wrong signing identity
    });
    const leafDer = buildLeafCertDer(extensionDer);
    const verifyRes = await request(app).post('/api/attestation/verify').send({
      challengeId,
      certChainDer: [leafDer.toString('base64'), rootDer().toString('base64')],
      devicePublicKey: 'device-pub-5',
      appVersion: '1.0.60',
      buildNumber: '1000060',
    });
    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.error).toMatch(/signing certificate/);
  });

  it('rejects a chain not rooted at a trusted root', async () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-attestation-other-root-'));
    execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'other-root.key'], { cwd: otherDir });
    execFileSync(
      'openssl',
      ['req', '-x509', '-new', '-key', 'other-root.key', '-days', '3650', '-subj', '/CN=Unrelated Root', '-out', 'other-root.pem'],
      { cwd: otherDir },
    );

    const challengeRes = await request(app).post('/api/attestation/challenge').send({ pub: 'device-pub-6' });
    const { challengeId, challenge } = challengeRes.body;
    const extensionDer = buildKeyDescriptionExtensionDer({
      challenge: Buffer.from(challenge, 'base64'),
      securityLevel: 2,
      packageName: OFFICIAL_APP_ID,
      signatureDigestHex: OFFICIAL_SIGNING_HASH_HEX,
    });

    execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key'], { cwd: otherDir });
    execFileSync('openssl', ['req', '-new', '-key', 'leaf.key', '-subj', '/CN=Test', '-out', 'leaf.csr'], { cwd: otherDir });
    const extFile = path.join(otherDir, 'ext.cnf');
    fs.writeFileSync(extFile, `[ v3_ext ]\n1.3.6.1.4.1.11129.2.1.17=DER:${extensionDer.toString('hex')}\n`);
    execFileSync(
      'openssl',
      ['x509', '-req', '-in', 'leaf.csr', '-CA', 'other-root.pem', '-CAkey', 'other-root.key', '-CAcreateserial', '-days', '365', '-extfile', extFile, '-extensions', 'v3_ext', '-out', 'leaf.pem'],
      { cwd: otherDir },
    );
    execFileSync('openssl', ['x509', '-in', 'leaf.pem', '-outform', 'der', '-out', 'leaf.der'], { cwd: otherDir });
    execFileSync('openssl', ['x509', '-in', 'other-root.pem', '-outform', 'der', '-out', 'other-root.der'], { cwd: otherDir });
    const otherLeafDer = fs.readFileSync(path.join(otherDir, 'leaf.der'));
    const otherRootDer = fs.readFileSync(path.join(otherDir, 'other-root.der'));
    fs.rmSync(otherDir, { recursive: true, force: true });

    const verifyRes = await request(app).post('/api/attestation/verify').send({
      challengeId,
      certChainDer: [otherLeafDer.toString('base64'), otherRootDer.toString('base64')],
      devicePublicKey: 'device-pub-6',
      appVersion: '1.0.60',
      buildNumber: '1000060',
    });
    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.error).toMatch(/trusted/);
  });

  it('routes 503 when the verifier key is not configured', async () => {
    const unconfiguredApp = express();
    unconfiguredApp.use(express.json());
    registerAttestationRoutes(unconfiguredApp, { trustedRootsPem: [trustedRootPem] });
    const res = await request(unconfiguredApp).post('/api/attestation/challenge').send({ pub: 'x' });
    expect(res.status).toBe(503);
  });

  it('missing required fields on /verify returns 400, not a crash', async () => {
    const res = await request(app).post('/api/attestation/verify').send({});
    expect(res.status).toBe(400);
  });
});
