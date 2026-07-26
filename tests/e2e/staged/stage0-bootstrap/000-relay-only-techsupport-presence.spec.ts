import { test, expect } from '../../helpers/fixtures';
import { isStagePipeline, resetToStage0Empty } from '../../helpers/e2e-stage-pipeline';
import { gunBaseURL } from '../../helpers/ports';
import {
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../../../src/shared/techsupport';

type GunGraph = Record<string, any>;

async function exportSnapshotGraph(): Promise<GunGraph> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { gunGraph?: GunGraph };
  return body.gunGraph || {};
}

test.describe('Stage 0 — relay-only TechSupport presence, no browser (docs/TODO.md K1 item 6)', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('a bare relay reset produces the identity record + one member row, and no support DB', async () => {
    // No browser is ever created in this test — the point is that the server's own boot/reset
    // seed (K1 item 2, ChatroomManager.seedTechSupportGlobalMembership) is what makes TechSupport
    // present, not a browser having bootstrapped it. seedTechSupportRoot:false also skips the test
    // harness's own full-profile baseline seed, so nothing but the server's minimal seed can be
    // the source of what this test finds.
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

    // 2. Exactly one Global member row, active. Read through the real members API rather than
    // the raw export-snapshot graph: Gun's chain-based `.get().get()...put()` (what
    // `seedTechSupportGlobalMembership` uses, same as ordinary `addMemberFast` joins) does not
    // reliably surface as a literal `chatrooms/global/users/<id>` key in a shallow `_.graph`
    // dump the way pre-built import-snapshot graphs do — but the same data is fully readable
    // through Gun's own `.map()`/`.once()` traversal, which is what this endpoint uses and what
    // every real client relies on. Reading it any other way would test the export dump's
    // idiosyncrasies instead of the actual presence guarantee.
    const membersRes = await fetch(`${gunBaseURL()}/api/chatrooms/global/members`);
    expect(membersRes.ok).toBe(true);
    const members = (await membersRes.json()) as Array<{ userId: string; stageName: string }>;
    expect(members).toEqual([{ userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME }]);

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

    // 4. The public member-count aggregate reads 1. This publish is fire-and-forget on the
    // server, so poll briefly rather than requiring it in the same tick as the reset response.
    await expect
      .poll(async () => {
        const latest = await exportSnapshotGraph();
        return latest['public/room-member-counts/global']?.count;
      }, { timeout: 5_000 })
      .toBe(1);
  });
});
