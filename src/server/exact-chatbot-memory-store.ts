import {
  createEmptyExactChatbotMemoryState,
  type ExactChatbotMemoryState,
} from '../shared/exact-chatbot-memory';
import type { GunService } from './services/gun-service';

type RawExactMemoryNode = Partial<ExactChatbotMemoryState> & { stateJson?: string };

const memoryCacheByGun = new WeakMap<GunService, Map<string, ExactChatbotMemoryState>>();

function cloneExactMemoryState(state: ExactChatbotMemoryState): ExactChatbotMemoryState {
  return JSON.parse(JSON.stringify(state)) as ExactChatbotMemoryState;
}

function cacheForGun(gunService: GunService): Map<string, ExactChatbotMemoryState> {
  let cache = memoryCacheByGun.get(gunService);
  if (!cache) {
    cache = new Map<string, ExactChatbotMemoryState>();
    memoryCacheByGun.set(gunService, cache);
  }
  return cache;
}

function normalizeExactMemoryState(raw: unknown): ExactChatbotMemoryState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const node = raw as RawExactMemoryNode;
  if (typeof node.stateJson === 'string') {
    try {
      const parsed = JSON.parse(node.stateJson) as Partial<ExactChatbotMemoryState>;
      return {
        users: parsed.users || {},
        questions: parsed.questions || {},
        answers: parsed.answers || {},
      };
    } catch {
      // Fall through to the legacy object shape below.
    }
  }

  if (!node.users && !node.questions && !node.answers) {
    return undefined;
  }

  return {
    users: node.users || {},
    questions: node.questions || {},
    answers: node.answers || {},
  };
}

export async function readExactChatbotMemoryForUser(
  gunService: GunService,
  userId: string,
): Promise<ExactChatbotMemoryState | undefined> {
  const raw = (await gunService.getPath(['exactChatbotMemoryByUser', userId])) as RawExactMemoryNode | undefined;
  const normalized = normalizeExactMemoryState(raw);
  const cache = cacheForGun(gunService);
  if (normalized) {
    cache.set(userId, cloneExactMemoryState(normalized));
    return normalized;
  }
  const cached = cache.get(userId);
  return cached ? cloneExactMemoryState(cached) : undefined;
}

export async function readOrCreateExactChatbotMemoryForUser(
  gunService: GunService,
  userId: string,
): Promise<ExactChatbotMemoryState> {
  return (await readExactChatbotMemoryForUser(gunService, userId)) || createEmptyExactChatbotMemoryState();
}

export async function writeExactChatbotMemoryForUser(
  gunService: GunService,
  userId: string,
  state: ExactChatbotMemoryState,
): Promise<void> {
  cacheForGun(gunService).set(userId, cloneExactMemoryState(state));
  await gunService.putPath(['exactChatbotMemoryByUser', userId], {
    stateJson: JSON.stringify({
      users: state.users || {},
      questions: state.questions || {},
      answers: state.answers || {},
    }),
    updatedAt: new Date().toISOString(),
  });
}

export function clearExactChatbotMemoryCacheForTesting(gunService: GunService): void {
  cacheForGun(gunService).clear();
}
