import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import type { ConversationTransport, SendMessageOptions } from './web-conversation-service';
import { GunMessageStore, type ConversationMessageWire } from './gun-message-store';

// Re-exported for existing importers (P2P-messaging Phase 2 moved the type to the store).
export type { ConversationMessageWire };

/**
 * Star-gun transport: the `ConversationTransport` facade over {@link GunMessageStore}.
 *
 * After P2P-messaging Phase 1, this is **no longer the default ordinary-peer
 * transport** (ordinary DMs use direct-p2p only). It remains in-tree as the star leg
 * of `ResilientConversationTransport` (off by default), as the storage base for
 * `TechSupportConversationTransport` (spec §19.7), and for unit coverage. All Gun
 * persistence lives in the base class; this subclass only adds the `star-gun` mode
 * label and the `sendMessage` facade.
 */
export class StarGunConversationTransport extends GunMessageStore implements ConversationTransport {
  override mode: ConversationTransportMode = 'star-gun';

  async sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void> {
    const channel = opts?.channel ?? 'public';
    const wire = await this.buildAndPersistMessage(conversationId, senderId, text, opts);
    console.log(
      `📤 Message sent in conversation ${conversationId} (${channel}, ${this.mode})${wire.prevSeen ? ` prevSeen=${wire.prevSeen}` : ''}`,
    );
  }
}
