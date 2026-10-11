import {
  createNearbyCohortSeatClaim,
  verifyNearbyCohortSeatClaim,
  type NearbyCohortSeatClaim,
} from '../../shared/nearby-cohort-admission';
import {
  createNearbyManualCohortSelection,
  nearbyCohortRootGroup,
} from '../../shared/nearby-cohort-protocol';
import type {
  NearbyCohortCommit,
  NearbyCohortReservation,
  NearbyCohortSummaryPage,
  NearbyCohortTraversalApi,
  NearbyCohortTraversalContext,
} from './nearby-cohort-traversal-client';

type FetchLike = typeof fetch;

type ActiveResponse = { claim?: NearbyCohortSeatClaim | null };

/**
 * Browser transport for the bounded relay-local cohort index. Every signed claim is created and
 * verified on the client; the relay receives no private key, coordinate, or Talk content.
 */
export class WebNearbyCohortTraversalApi implements NearbyCohortTraversalApi {
  constructor(private readonly options: {
    apiBase: () => string;
    fetch?: FetchLike;
    now?: () => Date;
  }) {}

  async summaries(input: Parameters<NearbyCohortTraversalApi['summaries']>[0]): Promise<NearbyCohortSummaryPage> {
    const params = checkpointParams(input.context);
    params.set('currentRoomId', input.currentGroup.roomId);
    params.set('limit', String(input.limit));
    const response = await this.request(
      `/api/nearby-cohorts/${encodeURIComponent(input.areaBindingId)}/summaries?${params}`,
    ) as {
      cohorts?: Array<{
        group?: unknown;
        activeCount?: unknown;
        reservedCount?: unknown;
        available?: unknown;
        isCurrent?: unknown;
      }>;
      truncated?: unknown;
    };
    const cohorts = (Array.isArray(response.cohorts) ? response.cohorts : [])
      .slice(0, input.limit)
      .map((entry) => ({
        group: entry.group as any,
        activeCount: Number(entry.activeCount),
        reservedCount: Number(entry.reservedCount),
        available: Number(entry.available) > 0,
        isCurrent: entry.isCurrent === true,
      }));
    return { cohorts, truncated: response.truncated === true };
  }

  async active(input: { context: NearbyCohortTraversalContext }): Promise<{
    activeGroup: ReturnType<typeof nearbyCohortRootGroup> | null;
  }> {
    const claim = await this.readActiveClaim(input.context);
    return { activeGroup: claim?.group ?? null };
  }

  async reserve(input: Parameters<NearbyCohortTraversalApi['reserve']>[0]): Promise<NearbyCohortReservation> {
    const active = await this.readActiveClaim(input.context);
    const isInitialDefault = !active
      && input.fromGroup.roomId === input.context.defaultGroup.roomId
      && input.targetGroup.roomId === input.context.defaultGroup.roomId;
    if (!active && !isInitialDefault) throw apiError(409, 'active-conflict', 'No verified active cohort claim');
    if (active && active.group.roomId !== input.fromGroup.roomId) {
      throw apiError(409, 'active-conflict', 'The source group is no longer active');
    }
    const now = this.now();
    const claim = await createNearbyCohortSeatClaim({
      checkpoint: input.context.checkpoint,
      pair: input.context.pair,
      userId: input.context.userId,
      privacyMode: input.context.privacyMode,
      group: input.targetGroup,
      generation: (active?.generation ?? 0) + 1,
      previousClaimHash: active?.claimHash ?? null,
      now,
      enteredAt: now,
    });
    const selection = input.targetGroup.roomId === input.fromGroup.roomId
      ? undefined
      : await createNearbyManualCohortSelection({
        checkpoint: input.context.checkpoint,
        rootRoomId: nearbyCohortRootGroup(input.context.checkpoint).roomId,
        userId: input.context.userId,
        pair: input.context.pair,
        privacyMode: input.context.privacyMode,
        fromGroup: input.fromGroup,
        targetGroup: input.targetGroup,
        visitOrdinal: input.visitOrdinal,
        now,
      });
    const response = await this.request('/api/nearby-cohorts/reservations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim, ...(selection ? { selection } : {}) }),
    }) as { reservationToken?: unknown; expiresAt?: unknown; targetRoomId?: unknown };
    if (typeof response.reservationToken !== 'string'
      || typeof response.expiresAt !== 'string'
      || response.targetRoomId !== input.targetGroup.roomId) {
      throw apiError(502, 'invalid', 'Nearby cohort reservation response is invalid');
    }
    return {
      reservationToken: response.reservationToken,
      expiresAt: response.expiresAt,
      ...(selection ? { selection } : {}),
      claim,
      targetGroup: input.targetGroup,
    };
  }

  async commit(input: Parameters<NearbyCohortTraversalApi['commit']>[0]): Promise<NearbyCohortCommit> {
    if (!input.reservation.claim) throw apiError(400, 'invalid', 'Nearby cohort reservation claim is missing');
    const response = await this.request(
      `/api/nearby-cohorts/reservations/${encodeURIComponent(input.reservation.reservationToken)}/commit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claim: input.reservation.claim }),
      },
    ) as { activeRoomId?: unknown };
    if (response.activeRoomId !== input.reservation.targetGroup.roomId) {
      throw apiError(409, 'active-conflict', 'Nearby cohort commit selected another group');
    }
    return { activeGroup: input.reservation.targetGroup };
  }

  async cancel(input: Parameters<NearbyCohortTraversalApi['cancel']>[0]): Promise<void> {
    await this.request(
      `/api/nearby-cohorts/reservations/${encodeURIComponent(input.reservation.reservationToken)}`,
      { method: 'DELETE' },
      true,
    );
  }

  private async readActiveClaim(context: NearbyCohortTraversalContext): Promise<NearbyCohortSeatClaim | null> {
    const params = checkpointParams(context);
    const response = await this.request(
      `/api/nearby-cohorts/active/${encodeURIComponent(String(context.pair.pub))}?${params}`,
    ) as ActiveResponse;
    if (!response.claim) return null;
    const verified = await verifyNearbyCohortSeatClaim(response.claim, {
      expectedCheckpoint: context.checkpoint,
      now: this.now(),
    });
    if (!verified.ok || verified.claim.pub !== context.pair.pub || verified.claim.userId !== context.userId) {
      throw apiError(409, 'invalid', verified.ok ? 'Nearby active claim identity mismatch' : verified.reason);
    }
    return verified.claim;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async request(path: string, init?: RequestInit, allowEmpty = false): Promise<unknown> {
    const fetcher = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await fetcher(`${this.options.apiBase()}${path}`, init);
    } catch (error) {
      throw apiError(503, 'offline', error instanceof Error ? error.message : 'Nearby cohort index is offline');
    }
    if (allowEmpty && response.status === 204) return null;
    let body: any = null;
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      throw apiError(response.status, String(body?.code || 'error'), String(body?.error || response.statusText));
    }
    if (body == null) throw apiError(502, 'invalid', 'Nearby cohort index returned an empty response');
    return body;
  }
}

function checkpointParams(context: NearbyCohortTraversalContext): URLSearchParams {
  const checkpoint = context.checkpoint;
  return new URLSearchParams({
    networkId: checkpoint.networkId,
    protocolEpoch: String(checkpoint.protocolEpoch),
    manifestSequence: String(checkpoint.manifestSequence),
    manifestHash: checkpoint.manifestHash,
    chatroomCapacity: String(checkpoint.chatroomCapacity),
  });
}

function apiError(status: number, code: string, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}
