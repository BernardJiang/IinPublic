import type { P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';
import type { GunKeyValueStore } from './gun-talk-repository';

export type DeliveryState = 'committed' | 'sent' | 'persisted-receipt';
export type DeliveryJournalRecord = {
  version: 1;
  objectId: string;
  recipientId: string;
  objectKind: 'talk-offer' | 'talk-response';
  state: DeliveryState;
  updatedAt: string;
};

export class GunDeliveryRepository {
  constructor(private readonly gun: GunKeyValueStore) {}

  async putPairResponse(localSeaPub: string, payload: P2PMeshTalkResponsePayload): Promise<void> {
    // `~` is reserved by GUN for SEA user souls. Using it as a pair delimiter makes GUN
    // demand a signature for an ordinary application record and reject it as unverified.
    const pairId = [localSeaPub, payload.authorId].sort().map(encodeURIComponent).join('__');
    const soul = `pairs/${pairId}/talkResponses/${encodeURIComponent(payload.talkId)}/${encodeURIComponent(payload.responseId)}`;
    await this.putAndVerify(soul, payload.responseId, { version: 1, responseId: payload.responseId, payload });
  }

  async recordDelivery(input: Omit<DeliveryJournalRecord, 'version' | 'updatedAt'>): Promise<void> {
    const soul = this.deliverySoul(input.objectId, input.recipientId);
    await this.putAndVerify(soul, input.objectId, { version: 1, ...input, updatedAt: new Date().toISOString() });
  }

  async getDelivery(objectId: string, recipientId: string): Promise<DeliveryJournalRecord | null> {
    try {
      const value = await this.gun.get(this.deliverySoul(objectId, recipientId)) as DeliveryJournalRecord | null;
      return value?.version === 1 && value.objectId === objectId ? value : null;
    } catch { return null; }
  }

  private deliverySoul(objectId: string, recipientId: string): string {
    return `deliveryJournal/${encodeURIComponent(objectId)}/${encodeURIComponent(recipientId)}`;
  }

  private async putAndVerify(soul: string, expectedId: string, value: unknown): Promise<void> {
    await this.gun.put(soul, value);
    const readBack = await this.gun.get(soul) as { responseId?: string; objectId?: string } | null;
    if (!readBack || (readBack.responseId !== expectedId && readBack.objectId !== expectedId)) {
      throw new Error(`Gun delivery read-back verification failed: ${soul}`);
    }
  }
}
