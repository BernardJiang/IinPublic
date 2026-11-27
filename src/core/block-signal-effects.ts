import {
  BLOCK_SIGNAL_PAYLOAD_KIND,
  recordBlockSignal,
  recordSharedBlockSignal,
  resolveSharedSignalsForContact,
  type BlockSignalPayload,
} from '../shared/block-signal';
import type { KnownPerson, User } from '../shared/types';

/**
 * Host-facing ports for the friend-circle block-signal workflow.
 *
 * The workflow used to live in the browser application's coordinator. Keeping storage and
 * delivery behind ports makes the same policy runnable by the web worker or native device host
 * when OPEN-104 moves the remaining effects out of the GUI.
 */
export interface BlockSignalEffectsPorts {
  currentUser(): User | undefined;
  recordReceived(userId: string, targetIdentity: string, signalId: string): Promise<void>;
  recordShared(userId: string, targetIdentity: string, groupId: string, signalId: string): Promise<void>;
  deliver(payload: BlockSignalPayload, recipientId: string): Promise<void>;
  now?: () => Date;
  signalId?: () => string;
  deliveryFailed?: (context: 'fan-out' | 'catch-up', recipientId: string, targetIdentity: string, error: unknown) => void;
}

/**
 * The durable block-share workflow, independent of DOM, Gun, SEA and mailbox implementations.
 *
 * A share is status, not a one-shot notification: it is persisted before delivery, and a contact
 * that later joins the selected group receives the original signal id. Delivery to one contact is
 * best-effort and never prevents the other recipients from being attempted.
 */
export class BlockSignalEffects {
  constructor(private readonly ports: BlockSignalEffectsPorts) {}

  async ingest(payload: BlockSignalPayload): Promise<boolean> {
    const user = this.ports.currentUser();
    if (!user?.id) return false;
    const targetIdentity = String(payload.targetIdentity || '').trim();
    const signalId = String(payload.signalId || '').trim();
    if (payload.kind !== BLOCK_SIGNAL_PAYLOAD_KIND || !targetIdentity || !signalId) return false;

    await this.ports.recordReceived(user.id, targetIdentity, signalId);
    user.receivedBlockSignals = recordBlockSignal(user.receivedBlockSignals, targetIdentity, signalId);
    return true;
  }

  async fanOut(
    targetIdentity: string,
    groupId: string,
    recipientUserIds: readonly string[],
  ): Promise<BlockSignalPayload | null> {
    const user = this.ports.currentUser();
    const target = String(targetIdentity || '').trim();
    const group = String(groupId || '').trim();
    if (!user?.id || !target || !group) return null;

    const now = this.ports.now?.() ?? new Date();
    const signalId = this.ports.signalId?.()
      ?? `${now.getTime()}_${Math.random().toString(36).slice(2, 9)}`;
    const payload: BlockSignalPayload = {
      kind: BLOCK_SIGNAL_PAYLOAD_KIND,
      targetIdentity: target,
      at: now.toISOString(),
      signalId,
    };

    // Persist before sending. An empty group today must still catch up future group members.
    await this.ports.recordShared(user.id, target, group, signalId);
    user.sharedBlockSignals = recordSharedBlockSignal(user.sharedBlockSignals, target, group, signalId);

    for (const recipientId of new Set(recipientUserIds.map((id) => String(id || '').trim()).filter(Boolean))) {
      try {
        await this.ports.deliver(payload, recipientId);
      } catch (error) {
        this.ports.deliveryFailed?.('fan-out', recipientId, target, error);
      }
    }
    return payload;
  }

  async resendToContact(contact: KnownPerson): Promise<number> {
    const user = this.ports.currentUser();
    if (!user?.id) return 0;
    const matches = resolveSharedSignalsForContact(user.sharedBlockSignals, contact);
    let delivered = 0;
    for (const { targetIdentity, signalId } of matches) {
      const payload: BlockSignalPayload = {
        kind: BLOCK_SIGNAL_PAYLOAD_KIND,
        targetIdentity,
        at: (this.ports.now?.() ?? new Date()).toISOString(),
        signalId,
      };
      try {
        await this.ports.deliver(payload, contact.userId);
        delivered += 1;
      } catch (error) {
        this.ports.deliveryFailed?.('catch-up', contact.userId, targetIdentity, error);
      }
    }
    return delivered;
  }
}
