import SEA from 'gun/sea';
import { canonicalSerialize } from '../../shared/cid';
import {
  announcementSigningPayload,
  announcementAdminAuthorizationPayload,
  createSystemAnnouncement,
  isVerifiedTechSupportIdentity,
  isRenderableSystemAnnouncement,
} from '../../shared/system-announcements';
import { TECHSUPPORT_NETWORK_ROLE, TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { TechSupportAnnouncementService } from '../../server/services/techsupport-announcement-service';

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
