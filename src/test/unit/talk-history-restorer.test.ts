import { restoreReceivedTalkHistory } from '../../web/services/talk-history-restorer';
import type { Talk } from '../../shared/types';

const received: Talk = { id: 'talk-1', title: 'Recovered', authorId: 'alice', type: 'tag', isAdult: false, language: 'en', tags: [], questions: [], createdAt: new Date('2026-08-12T00:00:00Z'), isTemplate: false, usageCount: 0 };

describe('received Talk UI restart recovery', () => {
  test('rebuilds one UI row from Gun-only history and deduplicates IDs', async () => {
    const rows: Array<{ id: string; title: string }> = [];
    const count = await restoreReceivedTalkHistory(
      { listReceivedTalksFromGun: async () => [received, { ...received }] },
      (row) => rows.push({ id: row.id, title: row.title }),
    );
    expect(count).toBe(1);
    expect(rows).toEqual([{ id: 'talk-1', title: 'Recovered' }]);
  });
});

