/**
 * X3 (nightly) — identity linking website ↔ webapp (TODO item I / §10).
 * Requires the linking protocol wired to a real website + webapp on the CI runner.
 * Skipped until the harness boots both sides against the shared hub.
 */
import { test } from '../helpers/fixtures';

test.describe('X3: identity linking website ↔ webapp', () => {
  test.skip('mutual attestations, merged contact row, unlink/revoke, cluster-block', async () => {
    // Setup: device A shows a link code (Settings › Linked devices › Link a device);
    // device B enters it; both write mutual signed attestations to identity-links/*.
    // Assert: a third user sees the two identities merged into one contact row; unlink
    // writes a revocation that supersedes the attestation. See stage1/71 for the
    // single-device UI coverage that already runs.
  });
});
