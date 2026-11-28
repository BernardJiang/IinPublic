import type { Talk } from '../shared/types';

export interface BroadcastMember {
  userId: string;
  stageName: string;
}

export interface RoomTalkBroadcastRequest {
  chatroomId?: string;
  members: BroadcastMember[];
  talkIds?: string[];
  talkReceiverIds?: Record<string, string[]>;
  catchUp?: boolean;
}

export interface TalkBroadcastEffectsPorts {
  currentUserId(): string | undefined;
  currentRoomId(): string | undefined;
  broadcastableTalkIds(): string[];
  resolveReceivers(chatroomId: string, members: BroadcastMember[]): Promise<BroadcastMember[]>;
  resolveTalk(talkId: string): Promise<Talk | null>;
  isExpired(talk: Talk): boolean;
  deliver(
    talkId: string,
    talk: Talk,
    receivers: BroadcastMember[],
    eligibleIds?: string[],
    onDelivered?: (count: number) => void,
    batched?: boolean,
  ): Promise<boolean>;
  recordCollectionDelivery(input: {
    talkIds: string[];
    peerIds: string[];
    talkReceiverIds?: Record<string, string[]>;
  }): Promise<void> | void;
  syncBackgroundAgent(): void;
  markInFlight(talkIds: readonly string[]): () => void;
  startProgress(chatroomId: string, talkIds: readonly string[], total: number, recipientIds: readonly string[]): void;
  emitBroadcast(talkId: string, recipientCount: number, chatroomIds: string[]): void;
  setBulkAck(sent: number, targetCount: number): void;
  notify(kind: 'progress' | 'success' | 'failure' | 'no-room' | 'group-success' | 'group-failure', detail?: string, sent?: number, targetCount?: number): void;
  log?(level: 'info' | 'warn' | 'error', message: string, error?: unknown): void;
  batchSize?: number;
  excludedUserIds?: readonly string[];
  now?(): number;
}

/** Owns Talk broadcast orchestration; transports, storage, UI and collection state stay host ports. */
export class TalkBroadcastEffects {
  constructor(private readonly ports: TalkBroadcastEffectsPorts) {}

  async broadcastRoom(data: RoomTalkBroadcastRequest): Promise<void> {
    let releaseInFlight = (): void => {};
    const startedAt = this.ports.now?.() ?? Date.now();
    try {
      const currentUserId = this.ports.currentUserId();
      const chatroomId = data.chatroomId || this.ports.currentRoomId();
      if (!chatroomId || !currentUserId) {
        this.ports.notify('no-room');
        return;
      }
      const talkIds = data.talkIds?.length ? data.talkIds : this.ports.broadcastableTalkIds();
      if (talkIds.length === 0) {
        const receivers = await this.ports.resolveReceivers(chatroomId, data.members ?? []);
        this.ports.setBulkAck(0, receivers.length);
        return;
      }
      if (!data.catchUp) {
        releaseInFlight = this.ports.markInFlight(talkIds);
        this.ports.notify('progress');
      }
      const excluded = new Set([currentUserId, ...(this.ports.excludedUserIds ?? [])]);
      const receivers = data.catchUp
        ? (data.members ?? []).filter((member) => member.userId && !excluded.has(member.userId))
        : await this.ports.resolveReceivers(chatroomId, data.members ?? []);
      await this.ports.recordCollectionDelivery({
        talkIds,
        peerIds: receivers.map((receiver) => receiver.userId),
        ...(data.talkReceiverIds ? { talkReceiverIds: data.talkReceiverIds } : {}),
      });
      this.ports.syncBackgroundAgent();
      const targetCount = receivers.length;
      if (!data.catchUp) {
        this.ports.startProgress(chatroomId, talkIds, targetCount, receivers.map((receiver) => receiver.userId));
      }
      if (targetCount === 0) this.ports.log?.('warn', `No Talk receivers resolved for ${chatroomId}`);

      const payloads: Array<{ talkId: string; talk: Talk }> = [];
      for (const requestedId of talkIds) {
        const resolved = await this.ports.resolveTalk(requestedId);
        if (!resolved) {
          this.ports.log?.('warn', `Skipping ${requestedId}: Talk not found`);
          continue;
        }
        const talkId = String(resolved.id || requestedId);
        const talk = { ...resolved, id: talkId, authorId: resolved.authorId || currentUserId } as Talk;
        if (this.ports.isExpired(talk)) {
          this.ports.log?.('warn', `Skipping ${requestedId}: Talk expired`);
          continue;
        }
        payloads.push({ talkId, talk });
      }

      let sent = 0;
      const reached = new Set<string>();
      const requested = new Set(talkIds);
      const batchSize = Math.max(1, this.ports.batchSize ?? 8);
      for (let index = 0; index < payloads.length; index += batchSize) {
        const batch = payloads.slice(index, index + batchSize);
        const results = await Promise.all(batch.map(async ({ talkId, talk }) => {
          if (!requested.has(talkId)) return false;
          const perTalkReceiverIds = data.talkReceiverIds?.[talkId];
          const eligibleIds = perTalkReceiverIds === undefined
            ? undefined
            : receivers.map((receiver) => receiver.userId).filter((id) => new Set(perTalkReceiverIds).has(id));
          return this.ports.deliver(
            talkId,
            talk,
            receivers,
            eligibleIds,
            (count) => { if (count > 0) reached.add(talkId); },
            payloads.length > 1,
          );
        }));
        sent += results.filter(Boolean).length;
      }
      for (const { talkId } of payloads) {
        if (reached.has(talkId)) this.ports.emitBroadcast(talkId, sent, [chatroomId]);
      }
      if (data.catchUp) {
        const elapsed = (this.ports.now?.() ?? Date.now()) - startedAt;
        this.ports.log?.('info', `Offered ${sent}/${payloads.length} Talk(s) to ${targetCount} peer(s) in ${chatroomId} in ${elapsed} ms`);
      } else {
        this.ports.setBulkAck(sent, targetCount);
        this.ports.notify('success', undefined, sent, targetCount);
      }
    } catch (error) {
      this.ports.log?.('error', 'Broadcast Talks failed', error);
      this.ports.notify('failure', (error as Error).message);
    } finally {
      releaseInFlight();
    }
  }

  async broadcastGroup(data: { talkId: string; members: BroadcastMember[] }): Promise<void> {
    try {
      if (data.members.length === 0) return;
      const currentUserId = this.ports.currentUserId();
      const resolved = await this.ports.resolveTalk(data.talkId);
      if (!resolved || !currentUserId) {
        this.ports.notify('group-failure', 'talk not found');
        return;
      }
      const talk = { ...resolved, authorId: resolved.authorId || currentUserId } as Talk;
      if (this.ports.isExpired(talk)) {
        this.ports.notify('group-failure', 'talk expired');
        return;
      }
      const delivered = await this.ports.deliver(data.talkId, talk, data.members);
      if (delivered) this.ports.emitBroadcast(data.talkId, data.members.length, []);
      this.ports.notify(delivered ? 'group-success' : 'group-failure', delivered ? undefined : 'delivery failed');
    } catch (error) {
      this.ports.log?.('error', 'Broadcast to contact group failed', error);
      this.ports.notify('group-failure', (error as Error).message);
    }
  }
}
