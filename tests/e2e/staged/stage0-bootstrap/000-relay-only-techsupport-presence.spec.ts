import { test, expect } from '../../helpers/fixtures';
import { isStagePipeline, resetToStage0Empty } from '../../helpers/e2e-stage-pipeline';
import { gunBaseURL } from '../../helpers/ports';
import {
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
} from '../../../../src/shared/techsupport';

type GunGraph = Record<string, any>;

async function exportSnapshotGraph(): Promise<GunGraph> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { gunGraph?: GunGraph };
  return body.gunGraph || {};
}

test.describe('Stage 0 — relay-only contacts-only TechSupport, no browser', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('a bare relay reset publishes the verified identity but no room presence or support DB', async () => {
    // No browser is created: the keyless relay may publish signed identity metadata, but it must
    // never turn the built-in Contact into a room participant.
    await resetToStage0Empty();

    // 1. Signed identity record present (relay republishes it on boot/reset). Chain-written
    // objects directly under `public` reliably round-trip through export-snapshot's raw graph
    // dump (unlike deeper chains — see the member-row check below), so this can read it directly.
    const graph = await exportSnapshotGraph();
    const identity = graph['public/techsupport-identity'];
    expect(identity).toMatchObject({
      userId: TECHSUPPORT_ROOT_USER_ID,
      role: TECHSUPPORT_NETWORK_ROLE,
      pub: expect.any(String),
      epub: expect.any(String),
      signature: expect.any(String),
    });

    // 2. Global has no synthetic TechSupport participant.
    const membersRes = await fetch(`${gunBaseURL()}/api/chatrooms/global/members`);
    expect(membersRes.ok).toBe(true);
    const members = (await membersRes.json()) as Array<{ userId: string; stageName: string }>;
    expect(members).toEqual([]);
    expect(Object.entries(graph).some(([soul, value]) =>
      soul.startsWith('chatrooms/')
        && soul.endsWith(`/users/${TECHSUPPORT_ROOT_USER_ID}`)
        && value?.isActive === true,
    )).toBe(false);

    // 3. No support DB: the relay must not have minted a full user record for TechSupport — that
    // comes from client compiled constants (item 1) and a signed template (K2), never from
    // server-side storage. `GET /api/users/<id>` 404s when no such record exists.
    const userRes = await fetch(`${gunBaseURL()}/api/users/${encodeURIComponent(TECHSUPPORT_ROOT_USER_ID)}`);
    expect(userRes.status).toBe(404);
    // Nor any conversation/greeting soul — those are string-keyed objects that do round-trip
    // through the raw dump, so this check on `graph` is meaningful.
    const conversationSouls = Object.keys(graph).filter((soul) => soul.startsWith('conversations/'));
    expect(conversationSouls).toEqual([]);
    const greetingSouls = Object.keys(graph).filter((soul) => soul.includes('support_welcome_'));
    expect(greetingSouls).toEqual([]);

  });
});
