import type { ExactChatbotMemoryState } from '../../shared/exact-chatbot-memory';
import { LOCAL_EXACT_CHATBOT_USER_ID } from '../../shared/exact-chatbot-memory';
import type { PrivateGunStore } from './connectivity-binding-store';

export type ChatbotAnswerProvenance = 'human' | 'chatbot-reuse' | 'chatbot-draft' | 'human-approval';

export type ChatbotMemorySnapshot = {
  version: 1;
  state: ExactChatbotMemoryState;
  provenance: ChatbotAnswerProvenance;
  sourceVersion: 1;
  updatedAt: string;
};

export class GunChatbotMemoryRepository {
  constructor(private readonly gun: PrivateGunStore) {}

  async saveState(state: ExactChatbotMemoryState, provenance: ChatbotAnswerProvenance): Promise<void> {
    const userQuestions = state.users[LOCAL_EXACT_CHATBOT_USER_ID] ?? {};
    for (const [questionId, memory] of Object.entries(userQuestions)) {
      await this.gun.putPrivate(`chatbotMemory/${encodeURIComponent(questionId)}/state`, {
        version: 1, questionId, memory, provenance, sourceVersion: 1, updatedAt: new Date().toISOString(),
      });
    }
    const snapshot: ChatbotMemorySnapshot = { version: 1, state, provenance, sourceVersion: 1, updatedAt: new Date().toISOString() };
    await this.gun.putPrivate('chatbotMemory/snapshot', snapshot);
  }

  async loadState(): Promise<ExactChatbotMemoryState | null> {
    const value = await this.gun.getPrivate('chatbotMemory/snapshot') as ChatbotMemorySnapshot | null;
    return value?.version === 1 && value.state ? value.state : null;
  }
}

