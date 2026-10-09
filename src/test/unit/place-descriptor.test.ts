import {
  createSignedPlaceDescriptor,
  verifySignedPlaceDescriptor,
} from '../../shared/place-descriptor';
import { isPlaceRoomId } from '../../shared/place-rooms';
import SEA from 'gun/sea';

describe('signed content-addressed Place descriptors', () => {
  test('verifies provenance without granting room authority', async () => {
    const pair = await SEA.pair();
    const descriptor = await createSignedPlaceDescriptor({
      name: 'Bean There Café',
      placeType: 'business',
      description: 'Community-created meeting point',
      location: { latitude: 32.71, longitude: -117.17 },
      pair,
      createdAt: '2026-10-08T12:00:00.000Z',
    });
    expect(isPlaceRoomId(descriptor.id)).toBe(true);
    await expect(verifySignedPlaceDescriptor(descriptor)).resolves.toMatchObject({
      ok: true,
      descriptor: { id: descriptor.id, creatorPub: pair.pub },
    });
    expect(descriptor).not.toHaveProperty('ownerId');
    expect(descriptor).not.toHaveProperty('capacity');
  });

  test('rejects a changed name and copied signature', async () => {
    const pair = await SEA.pair();
    const descriptor = await createSignedPlaceDescriptor({
      name: 'Original',
      placeType: 'custom',
      location: { latitude: 32.71, longitude: -117.17 },
      pair,
    });
    await expect(verifySignedPlaceDescriptor({ ...descriptor, name: 'Impostor' }))
      .resolves.toMatchObject({ ok: false });
  });
});
