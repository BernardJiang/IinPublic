/**
 * X5 (nightly) — three-platform stage-3 network incl. thread isolation.
 * Requires three clients (website, webapp, native) on the shared hub.
 */
import { test } from '../helpers/fixtures';

test.describe('X5: three-platform network + thread isolation', () => {
  test.skip('3 clients; pair-private threads stay isolated across platforms', async () => {
    // Mirrors stage3/71-thread-isolation-multi but with one client per platform.
  });
});
