/**
 * X8 (nightly) — same-device linking (TODO item I / §10.3).
 * Requires the URL-fragment (#link=) auto-detect + loopback handshake wired.
 * Skipped until same-device shortcuts land.
 */
import { test } from '../helpers/fixtures';

test.describe('X8: same-device link (app ↔ browser)', () => {
  test.skip('loopback one-click link, single-use fragment, local data copy', async () => {
    // Setup: app + browser on one machine; loopback (IINPUBLIC_LOCAL_PORT) handshake,
    // or #link=<payload> fragment auto-completes after one confirm; opening twice fails
    // with the reused-code error. Data copy uses the §11.2 encrypted archive locally.
  });
});
