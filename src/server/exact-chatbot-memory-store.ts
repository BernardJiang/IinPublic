import {
  createEmptyExactChatbotMemoryState,
  type ExactChatbotMemoryState,
} from '../shared/exact-chatbot-memory';
import type { GunService } from './services/gun-service';

type RawExactMemoryNode = Partial<ExactChatbotMemoryState> & { stateJson?: string };

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
  return normalizeExactMemoryState(raw);
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
  await gunService.putPath(['exactChatbotMemoryByUser', userId], {
    stateJson: JSON.stringify({
      users: state.users || {},
      questions: state.questions || {},
      answers: state.answers || {},
    }),
    updatedAt: new Date().toISOString(),
  });
}
