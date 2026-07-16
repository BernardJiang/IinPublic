/**
 * X7 (nightly) — website → webapp handoff then erase (TODO item J / §11).
 * Requires the encrypted P2P handoff transfer wired end to end + a receiver.
 * Skipped until the archive transfer + receiver import land.
 */
import { test } from '../helpers/fixtures';

test.describe('X7: sync-then-erase across platforms', () => {
  test.skip('website syncs to webapp, acks, erases; abort mid-sync leaves device intact', async () => {
    // Setup: linked website + webapp on the shared hub. Website runs the §11.2 handoff
    // (buildHandoffArchive → encrypt to webapp pub → transfer), webapp acknowledges and
    // imports (mergeHandoffArchive: contacts/talks merge, conversations read-only), then
    // website erases (verifiable fresh boot). Aborting the sync mid-transfer must leave
    // the website device intact (erase stays disabled).
  });
});
