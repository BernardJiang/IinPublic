/**
 * X4 (nightly) — mobile-profile ↔ desktop-app matching + threads; narrow overlay live.
 * Requires E2E_DEVICE_PROFILES + a desktop client on the shared hub.
 */
import { test } from '../helpers/fixtures';

test.describe('X4: mobile ↔ desktop matching + threads', () => {
  test.skip('match and per-talk thread replies across a mobile profile and desktop app', async () => {
    // Setup: one client under iphone-webkit (390×844), one desktop chromium, shared hub.
    // Assert: match round-trip + a per-talk thread reply visible on both; the narrow
    // client keeps the User-layout overlay usable (AppBar ⋯ reachable).
  });
});
