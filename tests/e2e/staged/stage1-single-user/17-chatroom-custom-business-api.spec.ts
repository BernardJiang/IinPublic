import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { waitForGunApiReady } from '../../helpers/clear-database';
import { gunBaseURL } from '../../helpers/ports';
import SEA from 'gun/sea';
import { LocationPrivacy } from '../../../../src/shared/location';
import { parseAnchorCell } from '../../../../src/shared/place-rooms';
import { createSignedPlaceDescriptor } from '../../../../src/shared/place-descriptor';

// Rooms are ownerless, content-addressed Places: the creator signs a descriptor and the room id
// is the descriptor's CID (chatroom-manager.ts createChatroom); unsigned creates are refused.
const SERVER_ROOM_ID = /^place_b[a-z2-7]+$/;
// A local room is anchored to its creator's blurred ~1 km cell (San Diego here).
const ANCHOR_CELL = LocationPrivacy.blurLocation({ latitude: 32.7157, longitude: -117.1611 }).region;

async function signedDescriptor(name: string, placeType: 'business' | 'custom', description?: string) {
  const anchor = parseAnchorCell(ANCHOR_CELL)!;
  return createSignedPlaceDescriptor({
    name,
    placeType,
    ...(description !== undefined ? { description } : {}),
    location: { latitude: anchor.latitude, longitude: anchor.longitude },
    pair: await SEA.pair(),
  });
}

test.describe('Chatroom custom/business API scripts', () => {
  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
  });

  test.beforeEach(async () => {
    await clearGunForStage1Spec();
    await waitForGunApiReady(15_000);
  });

  test.afterAll(async () => {
    await clearGunForStage1Spec();
  });

  test('custom chatroom create validates required fields and returns metadata', async ({ request }) => {
    const base = gunBaseURL();
    const invalid = await request.post(`${base}/api/chatrooms`, {
      data: { type: 'custom', createdBy: 'owner_custom_1' },
    });
    expect(invalid.status()).toBe(400);

    const createdBy = 'owner_custom_1';
    const createRes = await request.post(`${base}/api/chatrooms`, {
      data: {
        name: 'Neighborhood Buy/Sell',
        type: 'custom',
        anchorCell: ANCHOR_CELL,
        createdBy,
        description: 'Local custom room',
        capacity: 120,
        descriptor: await signedDescriptor('Neighborhood Buy/Sell', 'custom', 'Local custom room'),
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = (await createRes.json()) as {
      id: string;
      name: string;
      type: string;
      createdBy: string;
      isActive: boolean;
    };
    expect(created.id).toMatch(SERVER_ROOM_ID);
    expect(created.name).toBe('Neighborhood Buy/Sell');
    expect(created.type).toBe('custom');
    expect(created.createdBy).toBe(createdBy);
    expect(created.isActive).toBe(true);
  });

  test('business chatroom create returns business metadata', async ({ request }) => {
    const ownerId = 'business_owner_1';
    const base = gunBaseURL();

    const createRes = await request.post(`${base}/api/chatrooms`, {
      data: {
        name: 'Coffee Shop Live',
        type: 'business',
        anchorCell: ANCHOR_CELL,
        descriptor: await signedDescriptor('Coffee Shop Live', 'business'),
        createdBy: ownerId,
        businessInfo: {
          brandName: 'Coffee Shop',
          address: '123 Main St',
          coordinates: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 20,
            timestamp: new Date().toISOString(),
          },
          description: 'Official business room',
          ownerId,
          verified: true,
        },
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const room = (await createRes.json()) as {
      id: string;
      type: string;
      createdBy?: string;
      businessInfo?: { brandName?: string; ownerId?: string; verified?: boolean };
    };
    expect(room.id).toMatch(SERVER_ROOM_ID);
    expect(room.type).toBe('business');
    expect(room.createdBy).toBe(ownerId);
    expect(room.businessInfo?.brandName).toBe('Coffee Shop');
    expect(room.businessInfo?.ownerId).toBe(ownerId);
    expect(room.businessInfo?.verified).toBe(true);
  });

  test('members add/remove endpoints accept valid payloads and reject invalid payloads', async ({ request }) => {
    const base = gunBaseURL();

    const createRes = await request.post(`${base}/api/chatrooms`, {
      data: {
        name: 'Members Room',
        type: 'custom',
        createdBy: 'owner_members_1',
        anchorCell: ANCHOR_CELL,
        descriptor: await signedDescriptor('Members Room', 'custom'),
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { id } = (await createRes.json()) as { id: string };

    const invalidAdd = await request.post(`${base}/api/chatrooms/${encodeURIComponent(id)}/members`, {
      data: {},
    });
    expect(invalidAdd.status()).toBe(400);

    // A Place is each member's own list (§3.7 "Places in v3"): the hub keeps no roster for it.
    const addRes = await request.post(`${base}/api/chatrooms/${encodeURIComponent(id)}/members`, {
      data: { userId: 'member_user_1', stageName: 'MemberOne' },
    });
    expect(addRes.status()).toBe(410);
    expect(((await addRes.json()) as { code?: string }).code).toBe('PLACE_HAS_NO_ROSTER');

    const removeRes = await request.delete(`${base}/api/chatrooms/${encodeURIComponent(id)}/members/member_user_1`);
    expect(removeRes.ok(), await removeRes.text()).toBeTruthy();
  });
});
