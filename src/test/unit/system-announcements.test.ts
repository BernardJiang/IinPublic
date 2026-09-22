import SEA from 'gun/sea';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { canonicalSerialize } from '../../shared/cid';
import {
  announcementSigningPayload,
  announcementAdminAuthorizationPayload,
  createSystemAnnouncement,
  isVerifiedTechSupportIdentity,
  isRenderableSystemAnnouncement,
  readVerifiedTechSupportIdentity,
  signTechSupportIdentity,
} from '../../shared/system-announcements';
import { TECHSUPPORT_NETWORK_ROLE, TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import {
  configuredTechSupportPair,
  TechSupportAnnouncementService,
} from '../../server/services/techsupport-announcement-service';
import { sealPair } from '../../server/security/techsupport-key-custody';

describe('system announcements', () => {
  it('requires a current signed TechSupport admin authorization before publishing', async () => {
    const pair = await SEA.pair();
    const gunService = { putPath: jest.fn().mockResolvedValue(undefined) };
    const service = new TechSupportAnnouncementService(gunService as any, pair as any);
    const request = {
      text: 'Maintenance',
      expiresAt: '2030-01-01T00:00:00.000Z',
      requestedAt: new Date().toISOString(),
    };
    const authorization = await SEA.sign(announcementAdminAuthorizationPayload(request), pair);

    await expect(service.verifyAdminAuthorization({ ...request, authorization })).resolves.toBe(true);
    await expect(service.verifyAdminAuthorization({ ...request, text: 'Forged', authorization })).resolves.toBe(false);
    await service.createAnnouncement({ text: request.text, expiresAt: request.expiresAt });
    expect(gunService.putPath).toHaveBeenCalledWith(
      ['public', 'announcements', expect.any(String)],
      expect.objectContaining({ text: request.text, authorPub: pair.pub }),
    );
  });

  it('verifies the signed TechSupport bootstrap identity against its pinned public key', async () => {
    const pair = await SEA.pair();
    const identity = {
      userId: TECHSUPPORT_ROOT_USER_ID,
      pub: pair.pub,
      epub: pair.epub,
      role: TECHSUPPORT_NETWORK_ROLE,
    };
    const signature = await SEA.sign(canonicalSerialize(identity), pair);

    await expect(isVerifiedTechSupportIdentity({ ...identity, signature }, pair.pub)).resolves.toBe(true);
    await expect(isVerifiedTechSupportIdentity({ ...identity, pub: 'wrong-key', signature }, pair.pub)).resolves.toBe(false);
    await expect(readVerifiedTechSupportIdentity({ ...identity, signature })).resolves.toEqual({ ...identity, signature });
  });

  it('accepts either trust anchor during a staged key-rotation overlap', async () => {
    const [oldPair, newPair] = await Promise.all([SEA.pair(), SEA.pair()]);
    const oldIdentity = await signTechSupportIdentity(oldPair);
    const newIdentity = await signTechSupportIdentity(newPair);
    const overlap = [newPair.pub, oldPair.pub];

    await expect(readVerifiedTechSupportIdentity(oldIdentity, overlap)).resolves.toEqual(oldIdentity);
    await expect(readVerifiedTechSupportIdentity(newIdentity, overlap)).resolves.toEqual(newIdentity);
    await expect(readVerifiedTechSupportIdentity(oldIdentity, [newPair.pub])).resolves.toBeNull();

    const oldAnnouncement = await createSystemAnnouncement({
      text: 'Overlap notice.',
      createdAt: '2026-09-18T12:00:00.000Z',
      expiresAt: '2026-09-19T12:00:00.000Z',
    }, oldPair);
    await expect(
      isRenderableSystemAnnouncement(oldAnnouncement, overlap, new Date('2026-09-18T13:00:00.000Z')),
    ).resolves.toBe(true);
    await expect(
      isRenderableSystemAnnouncement(oldAnnouncement, [newPair.pub], new Date('2026-09-18T13:00:00.000Z')),
    ).resolves.toBe(false);
  });

  it('signTechSupportIdentity produces a record readVerifiedTechSupportIdentity accepts (docs/TODO.md K3)', async () => {
    const pair = await SEA.pair();
    const identity = await signTechSupportIdentity(pair);
    expect(identity).toMatchObject({
      userId: TECHSUPPORT_ROOT_USER_ID,
      pub: pair.pub,
      epub: pair.epub,
      role: TECHSUPPORT_NETWORK_ROLE,
    });
    await expect(readVerifiedTechSupportIdentity(identity, pair.pub)).resolves.toEqual(identity);
    // Tampering after signing (e.g. swapping in a different epub) must fail verification.
    await expect(readVerifiedTechSupportIdentity({ ...identity, epub: 'swapped' }, pair.pub)).resolves.toBeNull();
  });

  it('publishIdentity republishes a committed blob with no private key configured at all (docs/TODO.md K3)', async () => {
    const gunService = { putPath: jest.fn().mockResolvedValue(undefined) };
    // No pair passed — this is the exact "no private key required at boot" scenario K3 requires.
    const service = new TechSupportAnnouncementService(gunService as any, null);
    expect(service.isConfigured()).toBe(false);
    await expect(service.publishIdentity()).resolves.toBeUndefined();
    expect(gunService.putPath).toHaveBeenCalledWith(
      ['public', 'techsupport-identity'],
      expect.objectContaining({ userId: TECHSUPPORT_ROOT_USER_ID, role: TECHSUPPORT_NETWORK_ROLE }),
    );
  });

  it('fails closed before reading a TechSupport key configured on a production relay (OPEN-27)', () => {
    expect(() => configuredTechSupportPair({
      NODE_ENV: 'production',
      TECHSUPPORT_KEY_FILE: '/must/not/be/read/techsupport.key.json',
    })).toThrow('Refusing to load a TechSupport private key in the production relay');

    expect(() => configuredTechSupportPair({
      NODE_ENV: 'production',
      TECHSUPPORT_SEA_PAIR_JSON: '{not-even-parsed}',
    })).toThrow('Refusing to load a TechSupport private key in the production relay');

    expect(() => configuredTechSupportPair({
      NODE_ENV: 'production',
      TECHSUPPORT_KEY_PASSPHRASE_FILE: '/must/not/be/read/passphrase',
    })).toThrow('Refusing to load a TechSupport private key in the production relay');

    expect(configuredTechSupportPair({ NODE_ENV: 'production' })).toBeNull();
  });

  it('loads the optional announcement signer from an encrypted production vault', async () => {
    const originalFile = process.env.TECHSUPPORT_KEY_FILE;
    const originalPassphrase = process.env.TECHSUPPORT_KEY_PASSPHRASE;
    const originalLegacyPair = process.env.TECHSUPPORT_SEA_PAIR_JSON;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-announcement-vault-'));
    const keyFile = path.join(directory, 'key.json');
    const realPair = process.env.TECHSUPPORT_SEA_PAIR_JSON
      ? JSON.parse(process.env.TECHSUPPORT_SEA_PAIR_JSON)
      : null;
    if (!realPair) {
      fs.rmSync(directory, { recursive: true });
      return;
    }
    fs.writeFileSync(keyFile, JSON.stringify(sealPair(realPair, 'announcement-test-passphrase')), {
      mode: 0o600,
    });
    try {
      process.env.TECHSUPPORT_KEY_FILE = keyFile;
      process.env.TECHSUPPORT_KEY_PASSPHRASE = 'announcement-test-passphrase';
      delete process.env.TECHSUPPORT_SEA_PAIR_JSON;
      const service = new TechSupportAnnouncementService({ putPath: jest.fn() } as any);
      expect(service.isConfigured()).toBe(true);
    } finally {
      if (originalFile === undefined) delete process.env.TECHSUPPORT_KEY_FILE;
      else process.env.TECHSUPPORT_KEY_FILE = originalFile;
      if (originalPassphrase === undefined) delete process.env.TECHSUPPORT_KEY_PASSPHRASE;
      else process.env.TECHSUPPORT_KEY_PASSPHRASE = originalPassphrase;
      if (originalLegacyPair === undefined) delete process.env.TECHSUPPORT_SEA_PAIR_JSON;
      else process.env.TECHSUPPORT_SEA_PAIR_JSON = originalLegacyPair;
      fs.rmSync(directory, { recursive: true });
    }
  });

  it('renders a valid unexpired announcement', async () => {
    const pair = await SEA.pair();
    const announcement = await createSystemAnnouncement({
      text: 'Scheduled maintenance tonight.',
      createdAt: '2026-06-20T12:00:00.000Z',
      expiresAt: '2026-06-21T12:00:00.000Z',
    }, pair);

    expect(canonicalSerialize(await SEA.verify(announcement.signature, pair.pub))).toBe(announcementSigningPayload({
      id: announcement.id,
      authorPub: announcement.authorPub,
      text: announcement.text,
      createdAt: announcement.createdAt,
      expiresAt: announcement.expiresAt,
    }));
    await expect(isRenderableSystemAnnouncement(announcement, pair.pub, new Date('2026-06-20T13:00:00.000Z'))).resolves.toBe(true);
  });

  it('rejects expired or tampered announcements', async () => {
    const pair = await SEA.pair();
    const announcement = await createSystemAnnouncement({
      text: 'Old notice.',
      createdAt: '2026-06-18T12:00:00.000Z',
      expiresAt: '2026-06-19T12:00:00.000Z',
    }, pair);

    await expect(isRenderableSystemAnnouncement(announcement, pair.pub, new Date('2026-06-20T12:00:00.000Z'))).resolves.toBe(false);
    await expect(isRenderableSystemAnnouncement({ ...announcement, text: 'Forged notice.' }, pair.pub, new Date('2026-06-18T13:00:00.000Z'))).resolves.toBe(false);
  });
});
