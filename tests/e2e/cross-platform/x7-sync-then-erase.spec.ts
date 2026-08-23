/**
 * X7 (nightly) — website → webapp handoff then erase (TODO item J / §11).
 *
 * The underlying mechanism this test needs — encrypted P2P handoff transfer + receiver
 * import — is wired and E2E-proven for real between two ordinary browser installations:
 * `stage2-two-user/74-device-handoff-transfer.spec.ts` covers the full real send → ack →
 * import round trip (web-device-handoff-service.ts, shared/handoff-protocol.ts), and
 * `stage2-two-user/72-sync-before-erase.spec.ts` covers the negative path (an
 * unreachable device correctly fails the send and keeps Erase disabled). What X7 adds on
 * top is specifically *cross-platform*: one side a hosted website, the other a native
 * webapp (Electron/embedded-node) — that half needs a real native-shell CI runner, not
 * yet connected (docs/TODO.md Priority 3). Still skipped for that reason alone, not
 * because the handoff protocol itself is unbuilt.
 */
import { test } from '../helpers/fixtures';

test.describe('X7: sync-then-erase across platforms', () => {
  test.skip('website syncs to webapp, acks, erases; abort mid-sync leaves device intact', async () => {
    // Setup: linked website + webapp on the shared hub. Website runs the §11.2 handoff
    // (buildHandoffArchive → encrypt to webapp pub → transfer), webapp acknowledges and
    // imports (mergeHandoffArchive: contacts/talks merge, conversations read-only), then
    // website erases (verifiable fresh boot). Aborting the sync mid-transfer must leave
    // the website device intact (erase stays disabled). Same assertions as
    // stage2-two-user/74-device-handoff-transfer.spec.ts, run across a real website +
    // native webapp pair instead of two ordinary browser tabs.
  });
});
