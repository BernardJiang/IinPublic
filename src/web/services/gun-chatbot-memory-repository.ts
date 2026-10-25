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

/**
 * Per store: what each private path last held, and the save in progress. A repository is created
 * for every response, and every response is held until its save finishes, so a save rewrites only
 * the questions that changed and saves run one at a time. Rewriting every question each time made
 * a burst of chatbot replies (one per tag of a broadcast, after 60 starter answers) queue thousands
 * of SEA writes and hold every reply for minutes.
 */
const writtenByStore = new WeakMap<PrivateGunStore, Map<string, string>>();
const savingByStore = new WeakMap<PrivateGunStore, Promise<void>>();

export class GunChatbotMemoryRepository {
  constructor(private readonly gun: PrivateGunStore) {}

  saveState(state: ExactChatbotMemoryState, provenance: ChatbotAnswerProvenance): Promise<void> {
    const save = (): Promise<void> => this.writeChanged(state, provenance);
    const next = (savingByStore.get(this.gun) ?? Promise.resolve()).then(save, save);
    savingByStore.set(this.gun, next.catch(() => {}));
    return next;
  }

  private async writeChanged(state: ExactChatbotMemoryState, provenance: ChatbotAnswerProvenance): Promise<void> {
    let written = writtenByStore.get(this.gun);
    if (!written) {
      written = new Map();
      writtenByStore.set(this.gun, written);
    }
    const putIfChanged = async (path: string, content: object, value: object): Promise<void> => {
      const key = JSON.stringify(content);
      if (written!.get(path) === key) return;
      await this.gun.putPrivate(path, value);
      written!.set(path, key);
    };
    const userQuestions = state.users[LOCAL_EXACT_CHATBOT_USER_ID] ?? {};
    for (const [questionId, memory] of Object.entries(userQuestions)) {
      await putIfChanged(`chatbotMemory/${encodeURIComponent(questionId)}/state`, { memory, provenance }, {
        version: 1, questionId, memory, provenance, sourceVersion: 1, updatedAt: new Date().toISOString(),
      });
    }
    const snapshot: ChatbotMemorySnapshot = { version: 1, state, provenance, sourceVersion: 1, updatedAt: new Date().toISOString() };
    await putIfChanged('chatbotMemory/snapshot', { state, provenance }, snapshot);
  }

  async loadState(): Promise<ExactChatbotMemoryState | null> {
    const value = await this.gun.getPrivate('chatbotMemory/snapshot') as ChatbotMemorySnapshot | null;
    return value?.version === 1 && value.state ? value.state : null;
  }
}

