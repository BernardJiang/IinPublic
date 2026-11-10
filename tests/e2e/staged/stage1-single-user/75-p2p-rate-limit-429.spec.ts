/**
 * P2P abuse defense — per-peer rate limiting (spec §3.8 / §9.1).
 *
 * The shared relay/ack/signaling POST routes run P2PAbuseDefenseContext.checkInbound()
 * BEFORE any payload validation, returning 429 once a peer exceeds
 * P2P_RATE_LIMIT_MAX_EVENTS within P2P_RATE_LIMIT_WINDOW_MS. The normal E2E servers
 * raise the cap to 5000 so parallel suites never trip it — which also means the
 * limiter itself was never exercised. This spec boots its OWN server with a tiny
 * budget (5 events / 8s window) on a dedicated port and asserts:
 *   - requests under the budget are not rate-limited,
 *   - the budget-exceeding request gets 429,
 *   - the budget is per-peer (another peer is still allowed),
 *   - the window expiring restores service for the throttled peer.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '../../helpers/fixtures';

const MAX_EVENTS = 5;
// The limiter uses a fixed window: if the burst takes longer than the window (a loaded
// machine during test:all, each ack verifies a signature), the window resets and the
// budget-exceeding request gets a plain 400 instead of 429. Keep the window well above
// the burst time and send the burst at once.
const WINDOW_MS = 8_000;

function rateLimitPort(): number {
  // Own port band well above the per-worker 8080+N servers; unique per worker.
  return 18_300 + Number(process.env.TEST_PARALLEL_INDEX || 0);
}

test.describe('P2P rate limiting — 429 past the per-peer budget (spec §3.8)', () => {
  let server: ChildProcess | undefined;
  const port = rateLimitPort();
  const base = `http://localhost:${port}`;

  test.beforeAll(async ({ request }) => {
    const serverEntry = path.resolve(__dirname, '../../../../dist/server/server/index.js');
    server = spawn('node', [serverEntry], {
      env: {
        ...process.env,
        PORT: String(port),
        E2E_GUN_MEMORY_ONLY: '1',
        P2P_RATE_LIMIT_MAX_EVENTS: String(MAX_EVENTS),
        P2P_RATE_LIMIT_WINDOW_MS: String(WINDOW_MS),
      },
      stdio: 'ignore',
    });
    await expect
      .poll(
        async () => {
          try {
            const res = await request.get(`${base}/health`);
            return res.ok();
          } catch {
            return false;
          }
        },
        { timeout: 30_000, intervals: [250] },
      )
      .toBe(true);
  });

  test.afterAll(async () => {
    server?.kill('SIGKILL');
  });

  test('burst past the budget → 429; other peers unaffected; window recovery', async ({ request }) => {
    const ack = (peer: string) =>
      request.post(`${base}/api/presence/ack`, {
        data: {
          fromPeerId: peer,
          fromPub: `pub_${peer}`,
          fromUserId: `user_${peer}`,
          toUserId: 'user_receiver',
          toPub: 'pub_receiver',
          timestamp: new Date().toISOString(),
          payloadHash: 'e2e-rate-limit-probe',
        },
      });

    // Burst MAX_EVENTS + 1 at once: exactly one is over budget. The others may fail
    // payload validation with 4xx≠429 — the limiter runs first and counts them anyway.
    const startedAt = Date.now();
    const burst = await Promise.all(Array.from({ length: MAX_EVENTS + 1 }, () => ack('burst-peer')));
    const burstMs = Date.now() - startedAt;
    expect(burstMs, 'the burst must fit inside one window for this test to mean anything').toBeLessThan(WINDOW_MS);
    const statuses = burst.map((res) => res.status());
    expect(statuses.filter((status) => status === 429), `burst statuses ${statuses.join(',')}`).toHaveLength(1);
    const throttled = burst.find((res) => res.status() === 429)!;
    const body = (await throttled.json().catch(() => ({}))) as { error?: string };
    expect(String(body.error || '')).not.toBe('');

    // Per-peer isolation: a different peer still has its own budget.
    const other = await ack('polite-peer');
    expect(other.status()).not.toBe(429);

    // Recovery: once the window expires, the throttled peer is served again.
    await new Promise((r) => setTimeout(r, WINDOW_MS + 400));
    const recovered = await ack('burst-peer');
    expect(recovered.status()).not.toBe(429);
  });
});
