/**
 * X3 (nightly) — identity linking website ↔ webapp (TODO item I / §10).
 * Requires the linking protocol wired to a real website + webapp on the CI runner.
 * Skipped until the harness boots both sides against the shared hub.
 */
import { test } from '../helpers/fixtures';

test.describe('X3: identity linking website ↔ webapp', () => {
  test.skip('mutual direct attestations, one-sided rejection, and unlink/revoke', async () => {
    // Setup: device A shows a link code (Settings › Identity & devices › Link a device);
    // device B enters it; both write mutual signed attestations to identity-links/*.
    // Assert: both sides show the direct link, a one-sided claim does not create one,
    // and unlink writes a revocation that supersedes the attestation. Contacts,
    // authorship, reputation, blocks, and Q&A remain per SEA identity. See stage1/71
    // for the single-device UI and stage2/73 for the two-browser mutual protocol.
  });
});
