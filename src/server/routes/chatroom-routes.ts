import { isPlaceRoomId, parseAnchorCell } from '../../shared/place-rooms';
import { CONFIG } from '../../shared/config';
import { randomUUID } from 'crypto';
import type express from 'express';
import { ChatroomManager } from '../services/chatroom-manager';
import {
  EmbeddedHubRelayRequestError,
  type EmbeddedHubRelayClientLike,
  type RelayRoomMember,
} from '../../node-app/embedded-hub-relay-client';
import { isValidChatroomMapLocation } from '../../shared/chatroom-map-geojson';
import type { ChatroomMapLocation } from '../../shared/chatroom-map-locations';
import {
  reconcilePlaceAdmissionEvidence,
  verifyPlaceAdmissionClaim,
  type PlaceAdmissionClaim,
} from '../../shared/place-admission-evidence';

type RegisterChatroomRoutesDeps = {
  chatroomManager: ChatroomManager;
  /** Test seam only; production always uses the release-wide global capacity. */
  chatroomCapacity?: number;
  /**
   * S3 native explicit relay mode: embedded local nodes keep app graph local,
   * but mirror room-membership metadata to the configured upstream hub.
   */
  hubRelayClient?: EmbeddedHubRelayClientLike;
};

export function registerChatroomRoutes(
  app: express.Application,
  { chatroomManager, hubRelayClient, chatroomCapacity = CONFIG.CHATROOM_MAX_CAPACITY }: RegisterChatroomRoutesDeps,
): void {
  const relayPollTimers = new Map<string, ReturnType<typeof setInterval>>();
  const placeAdmissionTails = new Map<string, Promise<void>>();
  const placeReservations = new Map<string, Map<string, {
    userId: string;
    token: string;
    expiresAtMs: number;
    claim: PlaceAdmissionClaim;
  }>>();
  const placeReservationTtlMs = 15_000;

  /**
   * Serialize admissions to one Place within this room index. This is not represented as a room
   * owner or moderator: it merely makes the release-wide C check and roster write one operation.
   * Other indexes can temporarily disagree during a partition, as FR-CR-19 already permits.
   */
  const serializePlaceAdmission = async <T>(chatroomId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = placeAdmissionTails.get(chatroomId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    placeAdmissionTails.set(chatroomId, tail);
    try {
      return await result;
    } finally {
      if (placeAdmissionTails.get(chatroomId) === tail) placeAdmissionTails.delete(chatroomId);
    }
  };

  const livePlaceReservations = (chatroomId: string, now = Date.now()) => {
    const reservations = placeReservations.get(chatroomId) ?? new Map();
    for (const [userId, reservation] of reservations) {
      if (reservation.expiresAtMs <= now) reservations.delete(userId);
    }
    if (reservations.size > 0) placeReservations.set(chatroomId, reservations);
    else placeReservations.delete(chatroomId);
    return reservations;
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

  const syncMembersFromRelay = async (chatroomId: string): Promise<RelayRoomMember[]> => {
    if (!hubRelayClient) return [];
    const remoteMembers = await hubRelayClient.listMembers(chatroomId);
    await Promise.all(
      remoteMembers.map((member) =>
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

  const observeRelayRoom = (chatroomId: string): void => {
    if (!hubRelayClient || relayPollTimers.has(chatroomId)) return;
    const timer = setInterval(() => {
      void syncMembersFromRelayBestEffort(chatroomId);
    }, 5_000);
    timer.unref?.();
    relayPollTimers.set(chatroomId, timer);
  };

  const writeRelayJoin = async (
    chatroomId: string,
    userId: string,
    stageName?: string,
    isTraveler?: boolean,
    reservationToken?: string,
  ): Promise<void> => {
    if (!hubRelayClient) return;
    if (typeof isTraveler === 'boolean' || reservationToken) {
      await hubRelayClient.addMember(chatroomId, userId, stageName, isTraveler, reservationToken);
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
    options: { stageName?: string; lastSeen?: string; isTraveler?: boolean; admissionClaim?: PlaceAdmissionClaim },
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

  app.get('/api/chatrooms', async (_req, res) => {
    try {
      const chatrooms = await chatroomManager.getAllChatrooms();
      res.json(chatrooms);
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
      if (isPlaceRoomId(req.params.id)) {
        res.status(410).json({
          error: 'Place admission requires the capacity-aware members endpoint',
          code: 'PLACE_ADMISSION_REQUIRED',
        });
        return;
      }
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
      const created = await chatroomManager.createChatroom(createPayload);
      res.status(201).json(created);
    } catch (error) {
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
      const { userId, stageName, isTraveler, reserveOnly, reservationToken, admissionClaim } = req.body as {
        userId: string;
        stageName?: string;
        isTraveler?: boolean;
        reserveOnly?: boolean;
        reservationToken?: string;
        admissionClaim?: unknown;
      };
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      const chatroomId = req.params.id;
      const addLocalMember = async (): Promise<void> => {
        if (typeof isTraveler === 'boolean') {
          await chatroomManager.addMemberFast(chatroomId, userId, stageName, isTraveler);
        } else {
          // Keep older clients/test doubles source-compatible; absence means the pre-marker shape.
          await chatroomManager.addMemberFast(chatroomId, userId, stageName);
        }
      };
      const addMemberBestEffort = async (): Promise<void> => {
        await addLocalMember();
        await mirrorRelayJoin(chatroomId, userId, stageName, isTraveler);
      };

      if (isPlaceRoomId(chatroomId)) {
        if (reserveOnly === true) {
          const claimResult = await verifyPlaceAdmissionClaim(admissionClaim, {
            roomId: chatroomId,
            capacity: chatroomCapacity,
          });
          if (!claimResult.ok || claimResult.claim.userId !== userId) {
            res.status(400).json({ error: claimResult.ok ? 'Place admission identity mismatch' : claimResult.reason });
            return;
          }
          const admission = claimResult.claim;
          const reservation = await serializePlaceAdmission(chatroomId, async () => {
            let remoteMembers: RelayRoomMember[] = [];
            if (hubRelayClient) {
              try {
                remoteMembers = await syncMembersFromRelay(chatroomId);
              } catch {
                return { status: 'unavailable' as const };
              }
            }
            const localMembers = await chatroomManager.getActiveMembersWithStageName(chatroomId);
            const activeMembers = hubRelayClient ? remoteMembers : localMembers;
            const alreadyPresent = activeMembers.some((member) => member.userId === userId);
            const reservations = livePlaceReservations(chatroomId);
            const existing = reservations.get(userId);
            if (alreadyPresent) {
              if (existing) reservations.delete(userId);
              await chatroomManager.publishPlaceAdmissionClaim(admission);
              return {
                status: 'reserved' as const,
                token: existing?.token || randomUUID(),
                expiresAtMs: existing?.expiresAtMs || Date.now() + placeReservationTtlMs,
                claim: existing?.claim || admission,
              };
            }
            if (existing) {
              // Preserve the original seat order for this reservation, but publish its freshest
              // liveness proof when the client retries the same two-phase move.
              if (existing.claim.pub === admission.pub && existing.claim.enteredAt === admission.enteredAt) {
                existing.claim = admission;
                await chatroomManager.publishPlaceAdmissionClaim(admission);
              }
              return {
                status: 'reserved' as const,
                token: existing.token,
                expiresAtMs: existing.expiresAtMs,
                claim: existing.claim,
              };
            }
            const networkClaims = await chatroomManager.listPlaceAdmissionClaims(chatroomId);
            const reconciliation = await reconcilePlaceAdmissionEvidence({
              roomId: chatroomId,
              capacity: chatroomCapacity,
              evidence: [...networkClaims, ...[...reservations.values()].map((entry) => entry.claim), admission],
            });
            if (!reconciliation.winners.some((claim) => claim.userId === userId)
              || activeMembers.length + reservations.size >= chatroomCapacity) {
              return { status: 'full' as const };
            }

            let token: string = randomUUID();
            let expiresAtMs = Date.now() + placeReservationTtlMs;
            if (hubRelayClient) {
              if (!hubRelayClient.reservePlaceMember) return { status: 'unavailable' as const };
              try {
                const upstream = await hubRelayClient.reservePlaceMember(
                  chatroomId,
                  userId,
                  stageName,
                  isTraveler,
                  admission,
                );
                token = upstream.reservationToken;
                expiresAtMs = Date.parse(upstream.expiresAt);
                if (!token || !Number.isFinite(expiresAtMs)) return { status: 'unavailable' as const };
              } catch (error) {
                return error instanceof EmbeddedHubRelayRequestError && error.status === 409
                  ? { status: 'full' as const }
                  : { status: 'unavailable' as const };
              }
            }
            reservations.set(userId, { userId, token, expiresAtMs, claim: admission });
            placeReservations.set(chatroomId, reservations);
            await chatroomManager.publishPlaceAdmissionClaim(admission);
            return { status: 'reserved' as const, token, expiresAtMs, claim: admission };
          });
          if (reservation.status === 'full') {
            res.status(409).json({ error: 'Place is full', code: 'PLACE_FULL', capacity: chatroomCapacity });
            return;
          }
          if (reservation.status === 'unavailable') {
            res.status(503).json({
              error: 'Place admission could not be verified',
              code: 'PLACE_ADMISSION_UNAVAILABLE',
            });
            return;
          }
          res.json({
            success: true,
            reservationToken: reservation.token,
            expiresAt: new Date(reservation.expiresAtMs).toISOString(),
          });
          return;
        }

        const admission = await serializePlaceAdmission(chatroomId, async () => {
          let remoteMembers: RelayRoomMember[] = [];
          if (hubRelayClient) {
            try {
              // A distributed phone must obtain the hub's current active set before claiming a
              // Place seat. Nearby remains available when the hub cannot be reached.
              remoteMembers = await syncMembersFromRelay(chatroomId);
            } catch {
              return 'unavailable' as const;
            }
          }
          const localMembers = await chatroomManager.getActiveMembersWithStageName(chatroomId);
          const activeMembers = hubRelayClient ? remoteMembers : localMembers;
          const alreadyPresent = activeMembers.some((member) => member.userId === userId);
          const reservation = livePlaceReservations(chatroomId).get(userId);
          if (!alreadyPresent && (!reservation || reservation.token !== reservationToken)) {
            return 'reservation-required' as const;
          }
          try {
            // Commit at the deciding hub before exposing local active presence. The token already
            // occupies capacity but is not room membership, so the client can stop its old room
            // before this point without racing another C+1 entrant.
            await writeRelayJoin(chatroomId, userId, stageName, isTraveler, reservationToken);
          } catch (error) {
            return error instanceof EmbeddedHubRelayRequestError && error.status === 409
              ? 'reservation-required' as const
              : 'unavailable' as const;
          }
          await addLocalMember();
          livePlaceReservations(chatroomId).delete(userId);
          return 'accepted' as const;
        });
        if (admission === 'reservation-required') {
          res.status(409).json({
            error: 'Place admission reservation is missing or expired',
            code: 'PLACE_ADMISSION_REQUIRED',
          });
          return;
        }
        if (admission === 'unavailable') {
          res.status(503).json({
            error: 'Place admission could not be verified',
            code: 'PLACE_ADMISSION_UNAVAILABLE',
          });
          return;
        }
      } else {
        await addMemberBestEffort();
      }
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/chatrooms/:id/members/:userId', async (req, res) => {
    try {
      const { stageName, lastSeen, isTraveler, admissionClaim } = req.body as {
        stageName?: string;
        lastSeen?: string;
        isTraveler?: boolean;
        admissionClaim?: unknown;
      };
      const options: { stageName?: string; lastSeen?: string; isTraveler?: boolean } = {};
      if (stageName !== undefined) options.stageName = stageName;
      if (lastSeen !== undefined) options.lastSeen = lastSeen;
      if (isTraveler !== undefined) options.isTraveler = isTraveler;
      if (isPlaceRoomId(req.params.id)) {
        const refreshed = await serializePlaceAdmission(req.params.id, async () => {
          const members = await chatroomManager.getActiveMembersWithStageName(req.params.id);
          if (!members.some((member) => member.userId === req.params.userId)) return 'missing' as const;
          const claimResult = await verifyPlaceAdmissionClaim(admissionClaim, {
            roomId: req.params.id,
            capacity: chatroomCapacity,
          });
          if (!claimResult.ok || claimResult.claim.userId !== req.params.userId) return 'invalid' as const;
          await chatroomManager.publishPlaceAdmissionClaim(claimResult.claim);
          const networkClaims = await chatroomManager.listPlaceAdmissionClaims(req.params.id);
          const reconciliation = await reconcilePlaceAdmissionEvidence({
            roomId: req.params.id,
            capacity: chatroomCapacity,
            evidence: networkClaims,
          });
          const loserIds = new Set(reconciliation.losers.map((claim) => claim.userId));
          for (const member of members) {
            if (loserIds.has(member.userId)) await chatroomManager.leaveChatroom(req.params.id, member.userId);
          }
          if (loserIds.has(req.params.userId)) return 'lost' as const;
          if (hubRelayClient) {
            try {
              // A phone's embedded index cannot decide against an isolated local graph. The hub
              // evaluates the same portable claim against its merged evidence; propagate its
              // explicit reconciliation result instead of swallowing it as best-effort metadata.
              await hubRelayClient.touchMember(req.params.id, req.params.userId, {
                ...options,
                admissionClaim: claimResult.claim,
              });
            } catch (error) {
              if (error instanceof EmbeddedHubRelayRequestError && error.status === 409) {
                try {
                  const body = JSON.parse(error.responseBody) as { code?: unknown };
                  return body.code === 'PLACE_RECONCILED_OUT' ? 'lost' as const : 'invalid' as const;
                } catch {
                  return 'invalid' as const;
                }
              }
              return 'unavailable' as const;
            }
          }
          await chatroomManager.touchMemberFast(req.params.id, req.params.userId, options);
          return 'accepted' as const;
        });
        if (refreshed === 'lost') {
          res.status(409).json({
            error: 'Place exceeded capacity after admission evidence merged',
            code: 'PLACE_RECONCILED_OUT',
            capacity: chatroomCapacity,
          });
          return;
        }
        if (refreshed === 'unavailable') {
          res.status(503).json({
            error: 'Place admission could not be verified',
            code: 'PLACE_ADMISSION_UNAVAILABLE',
          });
          return;
        }
        if (refreshed !== 'accepted') {
          res.status(409).json({
            error: 'Place admission is required before a membership heartbeat',
            code: 'PLACE_ADMISSION_REQUIRED',
          });
          return;
        }
      } else {
        await chatroomManager.touchMemberFast(req.params.id, req.params.userId, options);
        await mirrorRelayTouch(req.params.id, req.params.userId, options);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/chatrooms/:id/members/:userId', async (req, res) => {
    try {
      if (isPlaceRoomId(req.params.id)) {
        await serializePlaceAdmission(req.params.id, async () => {
          livePlaceReservations(req.params.id).delete(req.params.userId);
          const claims = await chatroomManager.listPlaceAdmissionClaims(req.params.id);
          const ownClaim = claims.find((claim) => claim.userId === req.params.userId);
          if (ownClaim) await chatroomManager.removePlaceAdmissionClaim(req.params.id, ownClaim.pub);
          await chatroomManager.leaveChatroom(req.params.id, req.params.userId);
          await mirrorRelayLeave(req.params.id, req.params.userId);
        });
      } else {
        await chatroomManager.leaveChatroom(req.params.id, req.params.userId);
        await mirrorRelayLeave(req.params.id, req.params.userId);
      }
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
  }

  /** Retired compatibility endpoint; room participants have no assignable roles. */
  app.put('/api/chatrooms/:id/roles/:userId', async (_req, res) => {
    res.status(410).json({ error: 'room roles were retired; all participants are ordinary peers' });
  });
}
