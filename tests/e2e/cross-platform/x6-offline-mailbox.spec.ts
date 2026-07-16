/**
 * X6 (nightly) — offline/mailbox across platforms, both directions.
 * Requires taking one platform's client offline past mailbox TTL, then reconnecting.
 */
import { test } from '../helpers/fixtures';

test.describe('X6: offline mailbox across platforms', () => {
  test.skip('messages drain from the encrypted mailbox on reconnect, both directions', async () => {
    // Setup: client B offline while A sends; B reconnects and drains drainMailbox.
    // Assert: delivery in both directions after reconnect across the platform boundary.
  });
});
