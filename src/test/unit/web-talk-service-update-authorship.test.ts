/**
 * TODO §"Resolve metadata-only talk-edit authorship semantics" — locks in the resolution:
 * in-place `updateTalk()` always preserves `authorId`/`createdAt`/`authorLocation` from the
 * existing talk, whether the edit is metadata-only (tags/expiry/locationRadiusMiles) or also
 * touches content fields (questions/type/language). See `updateTalk`'s own doc comment
 * (web-talk-service.ts) for why: authorship only ever transfers by minting a new talk id, and
 * this path never changes the id.
 */
import { WebTalkService } from '../../web/services/web-talk-service';
import type { WebGunService } from '../../web/services/web-gun-service';

function service(graph: Map<string, unknown>): WebTalkService {
  const gun = {
    getStoredPair: () => ({ pub: 'alice-sea', epub: 'alice-epub' }),
    put: async (key: string, value: unknown) => { graph.set(key, value); },
    get: async (key: string) => graph.get(key) ?? null,
  } as unknown as WebGunService;
  return new WebTalkService(gun, undefined, { gunTalkRepository: false });
}

describe('WebTalkService.updateTalk authorship preservation', () => {
  beforeEach(() => localStorage.clear());

  test('a metadata-only edit (tags/expiry/location) preserves authorId/createdAt/authorLocation', async () => {
    const graph = new Map<string, unknown>();
    const svc = service(graph);
    const created = await svc.createTalk({
      authorId: 'alice',
      title: 'Original title',
      type: 'flow',
      questions: [{ id: 'q1', text: 'Q1', answers: [{ id: 'a1', text: 'Yes', isMatch: true }] }],
      authorLocation: { latitude: 1, longitude: 2, accuracy: 10, timestamp: new Date('2026-01-01') } as any,
    });
    const originalCreatedAt = created.createdAt;
    const originalAuthorLocation = created.authorLocation;

    const newTags = [{ id: 't1', name: 'new-tag', category: 'community', popularity: 0 }] as any;
    const updated = await svc.updateTalk(created.id, {
      tags: newTags,
      expiresAt: new Date('2027-01-01') as any,
      locationRadiusMiles: 25,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.authorId).toBe('alice');
    expect(new Date(updated.createdAt).toISOString()).toBe(new Date(originalCreatedAt).toISOString());
    expect(JSON.parse(JSON.stringify(updated.authorLocation))).toEqual(
      JSON.parse(JSON.stringify(originalAuthorLocation)),
    );
    expect(updated.tags).toEqual(newTags);
    expect(updated.locationRadiusMiles).toBe(25);
  });

  test('an edit that also touches content fields (questions) still preserves authorship — no id-transfer event occurred', async () => {
    const graph = new Map<string, unknown>();
    const svc = service(graph);
    const created = await svc.createTalk({
      authorId: 'alice',
      title: 'Original title',
      type: 'flow',
      questions: [{ id: 'q1', text: 'Q1', answers: [{ id: 'a1', text: 'Yes', isMatch: true }] }],
    });
    const originalCreatedAt = created.createdAt;

    const updated = await svc.updateTalk(created.id, {
      questions: [{ id: 'q1', text: 'A different question', answers: [{ id: 'a1', text: 'Yes', isMatch: true }] }] as any,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.authorId).toBe('alice');
    expect(new Date(updated.createdAt).toISOString()).toBe(new Date(originalCreatedAt).toISOString());
    expect(updated.questions[0].text).toBe('A different question');
  });
});
