import { isPlaceLive, PlaceCreationConflictError, type PlaceLifecycleRow } from '../../shared/place-lifecycle';
import { isPlaceRoomId, parseAnchorCell } from '../../shared/place-rooms';
import type express from 'express';
import { ChatroomManager } from '../services/chatroom-manager';
import { RelayMemberTouchThrottle } from '../services/relay-member-touch-throttle';
import { ROOM_MEMBERSHIP_TTL_SECONDS } from '../../shared/p2p-runtime';
import type { EmbeddedHubRelayClientLike, RelayRoomMember } from '../../node-app/embedded-hub-relay-client';
import { isValidChatroomMapLocation } from '../../shared/chatroom-map-geojson';
import type { ChatroomMapLocation } from '../../shared/chatroom-map-locations';
import { CONFIG } from '../../shared/config';
import { PlaceChatStore } from '../services/place-chat-store';

/** How often a room's hub roster is re-read while it is wanted. */
const RELAY_ROOM_POLL_MS = 5_000;
/**
 * A room nobody here asked about for this long is no longer polled: a page in the room heartbeats
 * at least every TTL / 3 and reads members every 5 s, so one membership TTL is a safe margin.
 */
export const RELAY_ROOM_LEASE_MS = ROOM_MEMBERSHIP_TTL_SECONDS * 1000;

type RegisterChatroomRoutesDeps = {
  chatroomManager: ChatroomManager;
  placeChatStore?: PlaceChatStore;
  /**
   * S3 native explicit relay mode: embedded local nodes keep app graph local,
   * but mirror room-membership metadata to the configured upstream hub.
   */
  hubRelayClient?: EmbeddedHubRelayClientLike;
};

export function registerChatroomRoutes(
  app: express.Application,
  { chatroomManager, hubRelayClient, placeChatStore = new PlaceChatStore(CONFIG.CHATROOM_MAX_CAPACITY * 4) }: RegisterChatroomRoutesDeps,
): void {
  const relayPollTimers = new Map<string, ReturnType<typeof setInterval>>();
  /** When this node's page last asked for each room's members (join, touch or a members read). */
  const relayRoomWantedAt = new Map<string, number>();

  /**
   * A Place is a per-member list (docs/design/nearby-and-place-chatrooms.md §3.7 "Places in v3"):
   * people find each other by Place-scoped cards at `/api/nearby/v3`, and the hub keeps no roster,
   * seats or capacity for it.
   */
  const refusePlaceRoster = (chatroomId: string, res: express.Response): boolean => {
    if (!isPlaceRoomId(chatroomId)) return false;
    res.status(410).json({ error: 'a Place has no hub roster; post a Place-scoped card', code: 'PLACE_HAS_NO_ROSTER' });
    return true;
  };

  const mergeMembers = (
    localMembers: RelayRoomMember[],
    remoteMembers: RelayRoomMember[],
  ): RelayRoomMember[] => {
    const byUser = new Map<string, RelayRoomMember>();
    for (const member of [...localMembers, ...remoteMembers]) {
      if (!member.userId) continue;
      byUser.set(member.userId, {
        userId: member.userId,
        stageName: member.stageName || member.userId,
        ...(typeof member.isTraveler === 'boolean' ? { isTraveler: member.isTraveler } : {}),
      });
    }
    return Array.from(byUser.values());
  };

  // Who each room's last hub roster contained, so members who leave at the hub can be dropped
  // here. Members who joined through this node and never reached the hub are left alone.
  const relayedMemberIds = new Map<string, Set<string>>();
  const relayTouches = new RelayMemberTouchThrottle(Math.floor((ROOM_MEMBERSHIP_TTL_SECONDS * 1000) / 3));
  const syncMembersFromRelay = async (chatroomId: string): Promise<RelayRoomMember[]> => {
    if (!hubRelayClient) return [];
    const remoteMembers = await hubRelayClient.listMembers(chatroomId);
    const remoteIds = new Set(remoteMembers.map((member) => member.userId));
    const previousIds = relayedMemberIds.get(chatroomId);
    if (previousIds) {
      const gone = [...previousIds].filter((id) => !remoteIds.has(id));
      for (const id of gone) relayTouches.forget(chatroomId, id);
      await chatroomManager.dropRelayedMembers(chatroomId, gone);
    }
    relayedMemberIds.set(chatroomId, remoteIds);
    await Promise.all(
      remoteMembers.filter((member) => relayTouches.shouldTouch(chatroomId, member)).map((member) =>
        chatroomManager.touchMemberFast(chatroomId, member.userId, {
          stageName: member.stageName,
          lastSeen: new Date().toISOString(),
          ...(typeof member.isTraveler === 'boolean' ? { isTraveler: member.isTraveler } : {}),
        }),
      ),
    );
    return remoteMembers;
  };

  const syncMembersFromRelayBestEffort = async (chatroomId: string): Promise<RelayRoomMember[]> => {
    try {
      return await syncMembersFromRelay(chatroomId);
    } catch {
      return [];
    }
  };

  /**
   * Poll a room's hub roster only while this node's page still asks for it (OPEN-73): every room
   * ever joined used to be polled every 5 s for the life of the app. A lapsed lease stops the poll
   * and drops the members mirrored from the hub, so the local roster does not keep stale people
   * (stopping on leave alone left them, and the room list read them after leaving).
   */
  const observeRelayRoom = (chatroomId: string): void => {
    if (!hubRelayClient) return;
    relayRoomWantedAt.set(chatroomId, Date.now());
    if (relayPollTimers.has(chatroomId)) return;
    const timer = setInterval(() => {
      if (Date.now() - (relayRoomWantedAt.get(chatroomId) ?? 0) > RELAY_ROOM_LEASE_MS) {
        void stopObservingRelayRoom(chatroomId);
        return;
      }
      void syncMembersFromRelayBestEffort(chatroomId);
    }, RELAY_ROOM_POLL_MS);
    timer.unref?.();
    relayPollTimers.set(chatroomId, timer);
  };

  const stopObservingRelayRoom = async (chatroomId: string): Promise<void> => {
    const timer = relayPollTimers.get(chatroomId);
    if (timer) clearInterval(timer);
    relayPollTimers.delete(chatroomId);
    relayRoomWantedAt.delete(chatroomId);
    const mirrored = relayedMemberIds.get(chatroomId);
    relayedMemberIds.delete(chatroomId);
    relayTouches.forget(chatroomId);
    if (mirrored?.size) await chatroomManager.dropRelayedMembers(chatroomId, [...mirrored]).catch(() => undefined);
  };

  const writeRelayJoin = async (
    chatroomId: string,
    userId: string,
    stageName?: string,
    isTraveler?: boolean,
  ): Promise<void> => {
    if (!hubRelayClient) return;
    if (typeof isTraveler === 'boolean') {
      await hubRelayClient.addMember(chatroomId, userId, stageName, isTraveler);
    } else {
      await hubRelayClient.addMember(chatroomId, userId, stageName);
    }
    observeRelayRoom(chatroomId);
    await syncMembersFromRelayBestEffort(chatroomId);
  };

  const mirrorRelayJoin = async (
    chatroomId: string,
    userId: string,
    stageName?: string,
    isTraveler?: boolean,
  ): Promise<void> => {
    try {
      await writeRelayJoin(chatroomId, userId, stageName, isTraveler);
    } catch {
      // The local embedded node remains usable offline; relay sync is best-effort metadata.
    }
  };

  const mirrorRelayTouch = async (
    chatroomId: string,
    userId: string,
    options: { stageName?: string; lastSeen?: string; isTraveler?: boolean },
  ): Promise<void> => {
    if (!hubRelayClient) return;
    try {
      await hubRelayClient.touchMember(chatroomId, userId, options);
      observeRelayRoom(chatroomId);
      await syncMembersFromRelayBestEffort(chatroomId);
    } catch {
      // Best-effort metadata relay.
    }
  };

  const mirrorRelayLeave = async (chatroomId: string, userId: string): Promise<void> => {
    if (!hubRelayClient) return;
    try {
      await hubRelayClient.removeMember(chatroomId, userId);
    } catch {
      // Best-effort metadata relay.
    }
  };

  app.get('/api/chatrooms', async (req, res) => {
    try {
      // Only live Places are listed (docs/design/nearby-and-place-chatrooms.md §4.2); a creator
      // passing their own key still sees their expired Place.
      const creatorPub = typeof req.query.creatorPub === 'string' ? req.query.creatorPub : '';
      const nowMs = Date.now();
      const listed = (room: unknown): boolean => {
        if (!room || typeof room !== 'object') return false;
        const row = room as PlaceLifecycleRow;
        if (!isPlaceRoomId(String(row.id || ''))) return true;
        return isPlaceLive(row, nowMs) || (!!creatorPub && row.creatorPub === creatorPub);
      };
      // An embedded node also lists the hub's Places, so a phone sees rooms other people created.
      // Both lists are read at once.
      const [local, remoteRooms] = await Promise.all([
        chatroomManager.getAllChatrooms(),
        hubRelayClient?.listChatrooms
          ? hubRelayClient.listChatrooms(creatorPub || undefined).catch(() => [] as unknown[])
          : Promise.resolve([] as unknown[]),
      ]);
      const chatrooms = local.filter(listed);
      const remote = remoteRooms.filter(listed);
      const byId = new Map<string, unknown>();
      for (const room of [...chatrooms, ...remote]) {
        const id = room && typeof room === 'object' ? String((room as { id?: unknown }).id || '') : '';
        if (id && !byId.has(id)) byId.set(id, room);
      }
      res.json(remote.length > 0 ? Array.from(byId.values()) : chatrooms);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/chatrooms/:id/join', async (req, res) => {
    try {
      const { userId } = req.body as { userId?: string };
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      if (refusePlaceRoster(req.params.id, res)) return;
      await chatroomManager.joinChatroom(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/chatrooms/:id', async (req, res) => {
    try {
      const chatroom = await chatroomManager.getChatroom(req.params.id);
      if (!chatroom) {
        res.status(404).json({ error: 'chatroom not found' });
        return;
      }
      res.json(chatroom);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * OPEN-80: a Place feed is a bounded recent page, never the old lifetime Gun map. Native app
   * loopback nodes forward the same endpoint to the hub; offline failure is explicit rather than
   * silently creating a divergent public feed on one phone.
   */
  app.get('/api/chatrooms/:id/messages', async (req, res) => {
    const chatroomId = req.params.id;
    if (!isPlaceRoomId(chatroomId)) {
      res.status(410).json({ error: 'only Places have a public chat feed', code: 'ROOM_HAS_NO_CHAT' });
      return;
    }
    const params = new URLSearchParams();
    if (typeof req.query.after === 'string') params.set('after', req.query.after);
    if (typeof req.query.limit === 'string') params.set('limit', req.query.limit);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    if (hubRelayClient?.forwardHubApi) {
      try {
        const upstream = await hubRelayClient.forwardHubApi(
          `/api/chatrooms/${encodeURIComponent(chatroomId)}/messages${suffix}`,
          'GET',
        );
        res.status(upstream.status).json(upstream.body);
      } catch {
        res.status(503).json({ error: 'Place chat is unavailable while the hub cannot be reached' });
      }
      return;
    }
    res.json(placeChatStore.read(chatroomId, {
      ...(typeof req.query.after === 'string' ? { after: req.query.after } : {}),
      limit: req.query.limit,
    }));
  });

  app.post('/api/chatrooms/:id/messages', async (req, res) => {
    const chatroomId = req.params.id;
    if (!isPlaceRoomId(chatroomId)) {
      res.status(410).json({ error: 'only Places have a public chat feed', code: 'ROOM_HAS_NO_CHAT' });
      return;
    }
    if (hubRelayClient?.forwardHubApi) {
      try {
        const upstream = await hubRelayClient.forwardHubApi(
          `/api/chatrooms/${encodeURIComponent(chatroomId)}/messages`,
          'POST',
          req.body,
        );
        res.status(upstream.status).json(upstream.body);
      } catch {
        res.status(503).json({ error: 'Place chat is unavailable while the hub cannot be reached' });
      }
      return;
    }
    try {
      const message = placeChatStore.append(chatroomId, req.body);
      res.status(201).json({ message });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/chatrooms', async (req, res) => {
    try {
      const { name, type, createdBy, description, businessInfo, location, anchorCell, descriptor } = req.body as {
        name: string;
        type: 'business' | 'custom';
        createdBy: string;
        anchorCell?: string;
        description?: string;
        businessInfo?: unknown;
        location?: unknown;
        descriptor?: unknown;
      };
      if (!name || !type || !createdBy) {
        res.status(400).json({ error: 'name, type, and createdBy are required' });
        return;
      }
      if (type !== 'business' && type !== 'custom') {
        res.status(400).json({ error: 'type must be business or custom' });
        return;
      }
      if (location != null && !isValidChatroomMapLocation(location)) {
        res.status(400).json({ error: 'location must contain valid latitude and longitude' });
        return;
      }
      const anchor = parseAnchorCell(String(anchorCell || ''));
      if (!anchor) {
        res.status(400).json({ error: 'a local room needs the creator\'s blurred location cell (anchorCell)' });
        return;
      }
      // A business pin must lie inside the room's own ~1 km cell (it cannot claim a wider area).
      if (location != null && isValidChatroomMapLocation(location)) {
        const pin = location as ChatroomMapLocation;
        const inCell = Math.floor(pin.latitude * 100) / 100 === anchor.latitude
          && Math.floor(pin.longitude * 100) / 100 === anchor.longitude;
        if (!inCell) {
          res.status(400).json({ error: 'location must lie inside the room\'s anchor cell' });
          return;
        }
      }
      const createPayload: {
        name: string;
        type: 'business' | 'custom';
        createdBy: string;
        anchorCell: string;
        description?: string;
        businessInfo?: unknown;
        location?: ChatroomMapLocation;
        descriptor?: unknown;
      } = { name, type, createdBy, anchorCell: String(anchorCell) };
      if (description != null) createPayload.description = description;
      if (businessInfo != null) createPayload.businessInfo = businessInfo;
      if (location != null) createPayload.location = location;
      if (descriptor != null) createPayload.descriptor = descriptor;
      // An embedded node publishes at the hub first (the hub verifies the signed descriptor), so
      // the room is never left existing only on this phone.
      if (hubRelayClient?.publishChatroom) {
        let upstream: { status: number; body: unknown };
        try {
          upstream = await hubRelayClient.publishChatroom(req.body);
        } catch {
          res.status(503).json({ error: 'could not reach the network to publish the room; try again' });
          return;
        }
        if (upstream.status < 200 || upstream.status >= 300) {
          res.status(upstream.status).json(upstream.body);
          return;
        }
      }
      const created = await chatroomManager.createChatroom(createPayload);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof PlaceCreationConflictError) {
        res.status(409).json({ error: error.conflict.code, ...error.conflict });
        return;
      }
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/chatrooms/:id', async (_req, res) => {
    res.status(410).json({ error: 'room descriptors are immutable; publish a new room descriptor' });
  });

  app.delete('/api/chatrooms/:id', async (_req, res) => {
    res.status(410).json({ error: 'rooms have no owner and cannot be deleted by a participant' });
  });

  app.get('/api/chatrooms/:id/members', async (req, res) => {
    try {
      if (refusePlaceRoster(req.params.id, res)) return;
      observeRelayRoom(req.params.id);
      const remoteMembers = await syncMembersFromRelayBestEffort(req.params.id);
      const members = await chatroomManager.getActiveMembersWithStageName(req.params.id);
      res.json(mergeMembers(members, remoteMembers));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/chatrooms/:id/members', async (req, res) => {
    try {
      const { userId, stageName, isTraveler } = req.body as {
        userId: string;
        stageName?: string;
        isTraveler?: boolean;
      };
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      const chatroomId = req.params.id;
      if (refusePlaceRoster(chatroomId, res)) return;
      if (typeof isTraveler === 'boolean') {
        await chatroomManager.addMemberFast(chatroomId, userId, stageName, isTraveler);
      } else {
        // Keep older clients/test doubles source-compatible; absence means the pre-marker shape.
        await chatroomManager.addMemberFast(chatroomId, userId, stageName);
      }
      await mirrorRelayJoin(chatroomId, userId, stageName, isTraveler);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/chatrooms/:id/members/:userId', async (req, res) => {
    try {
      if (refusePlaceRoster(req.params.id, res)) return;
      const { stageName, lastSeen, isTraveler } = req.body as {
        stageName?: string;
        lastSeen?: string;
        isTraveler?: boolean;
      };
      const options: { stageName?: string; lastSeen?: string; isTraveler?: boolean } = {};
      if (stageName !== undefined) options.stageName = stageName;
      if (lastSeen !== undefined) options.lastSeen = lastSeen;
      if (isTraveler !== undefined) options.isTraveler = isTraveler;
      await chatroomManager.touchMemberFast(req.params.id, req.params.userId, options);
      await mirrorRelayTouch(req.params.id, req.params.userId, options);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/chatrooms/:id/members/:userId', async (req, res) => {
    try {
      await chatroomManager.leaveChatroom(req.params.id, req.params.userId);
      await mirrorRelayLeave(req.params.id, req.params.userId);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/chatrooms/:id/roles/:userId', async (_req, res) => {
    res.status(410).json({ error: 'room roles were retired; all participants are ordinary peers' });
  });

  // E2E only: run the stale-membership sweep now rather than waiting for the next timer tick
  // (OPEN-43 — spec stage2/42 otherwise waits on a 30 s interval plus propagation under load).
  if (process.env.NODE_ENV !== 'production') {
    app.post('/api/test/chatrooms/sweep', async (_req, res) => {
      await chatroomManager.sweepStaleMembersNow();
      res.json({ swept: true });
    });
    // Phone-path journey 03 (Place expiry): age a Place past the 30-day live window.
    app.post('/api/test/chatrooms/:id/backdate', async (req, res) => {
      const days = Number(req.body?.days);
      if (!Number.isFinite(days) || days <= 0) {
        res.status(400).json({ error: 'days must be a positive number' });
        return;
      }
      const atIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const found = await chatroomManager.backdatePlaceForTesting(req.params.id, atIso);
      res.status(found ? 200 : 404).json({ backdated: found, at: atIso });
    });
  }

  /** Retired compatibility endpoint; room participants have no assignable roles. */
  app.put('/api/chatrooms/:id/roles/:userId', async (_req, res) => {
    res.status(410).json({ error: 'room roles were retired; all participants are ordinary peers' });
  });
}
