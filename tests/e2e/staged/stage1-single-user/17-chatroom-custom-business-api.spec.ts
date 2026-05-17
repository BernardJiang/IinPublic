import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { gunBaseURL } from '../../helpers/ports';

function roomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

test.describe('Chatroom custom/business API scripts', () => {
  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await maybeClearGunDatabases();
  });

  test.beforeEach(async () => {
    await maybeClearGunDatabases();
  });

  test.afterAll(async () => {
    await maybeClearGunDatabases();
  });

  test('custom chatroom create validates required fields and returns metadata', async ({ request }) => {
    const base = gunBaseURL();
    const invalid = await request.post(`${base}/api/chatrooms`, {
      data: { type: 'custom', createdBy: 'owner_custom_1' },
    });
    expect(invalid.status()).toBe(400);

    const id = roomId('custom_room');
    const createdBy = 'owner_custom_1';
    const createRes = await request.post(`${base}/api/chatrooms`, {
      data: {
        id,
        name: 'Neighborhood Buy/Sell',
        type: 'custom',
        createdBy,
        description: 'Local custom room',
        capacity: 120,
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
    expect(created.id).toBe(id);
    expect(created.name).toBe('Neighborhood Buy/Sell');
    expect(created.type).toBe('custom');
    expect(created.createdBy).toBe(createdBy);
    expect(created.isActive).toBe(true);
  });

  test('business chatroom create returns business metadata', async ({ request }) => {
    const id = roomId('biz_room');
    const ownerId = 'business_owner_1';
    const base = gunBaseURL();

    const createRes = await request.post(`${base}/api/chatrooms`, {
      data: {
        id,
        name: 'Coffee Shop Live',
        type: 'business',
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
    expect(room.id).toBe(id);
    expect(room.type).toBe('business');
    expect(room.createdBy).toBe(ownerId);
    expect(room.businessInfo?.brandName).toBe('Coffee Shop');
    expect(room.businessInfo?.ownerId).toBe(ownerId);
    expect(room.businessInfo?.verified).toBe(true);
  });

  test('members add/remove endpoints accept valid payloads and reject invalid payloads', async ({ request }) => {
    const id = roomId('members_room');
    const base = gunBaseURL();

    const createRes = await request.post(`${base}/api/chatrooms`, {
      data: { id, name: 'Members Room', type: 'custom', createdBy: 'owner_members_1' },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();

    const invalidAdd = await request.post(`${base}/api/chatrooms/${encodeURIComponent(id)}/members`, {
      data: {},
    });
    expect(invalidAdd.status()).toBe(400);

    const addRes = await request.post(`${base}/api/chatrooms/${encodeURIComponent(id)}/members`, {
      data: { userId: 'member_user_1', stageName: 'MemberOne' },
    });
    expect(addRes.ok(), await addRes.text()).toBeTruthy();

    const removeRes = await request.delete(`${base}/api/chatrooms/${encodeURIComponent(id)}/members/member_user_1`);
    expect(removeRes.ok(), await removeRes.text()).toBeTruthy();
  });
});
