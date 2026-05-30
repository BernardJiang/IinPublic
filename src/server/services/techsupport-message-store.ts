export type TechSupportStoredMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  timestamp: string;
  channel: string;
};

export class TechSupportMessageStore {
  private readonly byConversation = new Map<string, TechSupportStoredMessage[]>();

  append(message: TechSupportStoredMessage): void {
    const bucket = this.byConversation.get(message.conversationId) || [];
    if (bucket.some((m) => m.id === message.id)) return;
    bucket.push(message);
    bucket.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    this.byConversation.set(message.conversationId, bucket);
  }

  list(conversationId: string): TechSupportStoredMessage[] {
    return [...(this.byConversation.get(conversationId) || [])];
  }

  clearForTesting(): void {
    this.byConversation.clear();
  }
}
