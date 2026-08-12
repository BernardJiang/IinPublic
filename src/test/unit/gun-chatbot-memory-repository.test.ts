import { createEmptyExactChatbotMemoryState, LOCAL_EXACT_CHATBOT_USER_ID, savePermanentAnswer } from '../../shared/exact-chatbot-memory';
import { GunChatbotMemoryRepository } from '../../web/services/gun-chatbot-memory-repository';

describe('private Gun chatbot memory', () => {
  test.each(['human', 'chatbot-reuse', 'chatbot-draft', 'human-approval'] as const)(
    'stores exact memory with %s provenance only in private paths', async (provenance) => {
      const values = new Map<string, unknown>();
      const state = createEmptyExactChatbotMemoryState();
      savePermanentAnswer(state, LOCAL_EXACT_CHATBOT_USER_ID, 'Tea or coffee?', 'Tea', 1);
      const repo = new GunChatbotMemoryRepository({ putPrivate: async (key, value) => { values.set(key, value); }, getPrivate: async (key) => values.get(key) ?? null });
      await repo.saveState(state, provenance);
      expect([...values.keys()].some((key) => key.startsWith('chatbotMemory/q_'))).toBe(true);
      expect([...values.keys()].every((key) => !key.startsWith('public/'))).toBe(true);
      await expect(repo.loadState()).resolves.toEqual(state);
      expect(values.get('chatbotMemory/snapshot')).toMatchObject({ provenance, sourceVersion: 1 });
    },
  );
});

