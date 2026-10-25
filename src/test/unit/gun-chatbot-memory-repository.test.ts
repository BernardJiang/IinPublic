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

describe('private Gun chatbot memory backup cost', () => {
  test('a save rewrites only changed questions, and concurrent saves run one at a time', async () => {
    const writes: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const store = {
      putPrivate: async (key: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        writes.push(key);
        inFlight -= 1;
      },
      getPrivate: async () => null,
    };
    const state = createEmptyExactChatbotMemoryState();
    for (let i = 0; i < 60; i++) savePermanentAnswer(state, LOCAL_EXACT_CHATBOT_USER_ID, `Tag ${i}`, `Tag ${i}`, 1);
    await new GunChatbotMemoryRepository(store).saveState(state, 'human');
    expect(writes).toHaveLength(61);

    // A burst of chatbot replies over the same memory: nothing changed, nothing rewritten.
    writes.length = 0;
    await Promise.all(Array.from({ length: 25 }, () => new GunChatbotMemoryRepository(store).saveState(state, 'human')));
    expect(writes).toHaveLength(0);

    // One new answer: that question and the snapshot.
    savePermanentAnswer(state, LOCAL_EXACT_CHATBOT_USER_ID, 'Tag 60', 'Tag 60', 1);
    await Promise.all([1, 2, 3].map(() => new GunChatbotMemoryRepository(store).saveState(state, 'human')));
    expect(writes).toHaveLength(2);
    expect(writes).toContain('chatbotMemory/snapshot');
    expect(maxInFlight).toBe(1);
  });

  test('a failed write is retried by the next save', async () => {
    let fail = true;
    const writes: string[] = [];
    const store = {
      putPrivate: async (key: string) => {
        if (fail) throw new Error('SEA conflict');
        writes.push(key);
      },
      getPrivate: async () => null,
    };
    const state = createEmptyExactChatbotMemoryState();
    savePermanentAnswer(state, LOCAL_EXACT_CHATBOT_USER_ID, 'Tea or coffee?', 'Tea', 1);
    await expect(new GunChatbotMemoryRepository(store).saveState(state, 'human')).rejects.toThrow('SEA conflict');
    fail = false;
    await new GunChatbotMemoryRepository(store).saveState(state, 'human');
    expect(writes).toHaveLength(2);
  });
});
