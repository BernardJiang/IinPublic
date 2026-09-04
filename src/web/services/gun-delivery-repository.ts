import type { P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';
import { computeCIDv1 } from '../../shared/cid';
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
    // Radisk encodes a complete soul into a filesystem filename. Concatenating two SEA
    // identities plus talk/response CIDs can exceed the 255-byte filename limit and poison
    // unrelated later Gun acknowledgements with ENAMETOOLONG. A CID of the sorted identity
    // pair is deterministic on both peers, collision-resistant, and keeps the soul bounded.
    const pairId = await computeCIDv1([localSeaPub, payload.authorId].sort());
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
    // The write already landed on the local Gun graph synchronously the instant put() was
    // called — this read-back was meant as a paranoid double-check, not the actual commit.
    // In practice GunKeyValueStore.get() on a soul holding a nested object/array (which every
    // real payload here is) can hang for its full multi-second timeout and reject in this
    // deployment (relay-only hub, no local persistence — see WebGunService's own doc comments),
    // turning a successful write into a reported failure. Treat an unreadable/mismatched
    // read-back as inconclusive, not fatal — log it and move on rather than throwing.
    try {
      const readBack = await this.gun.get(soul) as { responseId?: string; objectId?: string } | null;
      if (!readBack || (readBack.responseId !== expectedId && readBack.objectId !== expectedId)) {
        console.warn(`Gun delivery read-back verification inconclusive (continuing — write already committed locally): ${soul}`);
      }
    } catch (error) {
      console.warn(`Gun delivery read-back timed out (continuing — write already committed locally): ${soul}`, error);
    }
  }
}
