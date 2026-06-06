/**
 * Unit tests for ICE candidate priority configuration (SRS §4.4).
 *
 * §4.4 mandates this connection priority order:
 *   1. local / host candidates   — same-machine or LAN
 *   2. direct IP / srflx         — STUN server-reflexive
 *   3. NAT hole punch            — STUN/ICE traversal
 *   4. relay / TURN fallback     — only when all direct paths fail
 *
 * These tests verify that `defaultIceServers()` produces a config that is
 * consistent with the §4.4 priority order.  Full end-to-end candidate
 * selection requires a real browser and is covered by Playwright E2E tests;
 * here we assert the structural invariants that enable correct priority.
 */
import { defaultIceServers } from '../../web/services/p2p-webrtc-session';

// ─── helpers ──────────────────────────────────────────────────────────────────

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

function urlsOf(servers: RTCIceServer[]): string[] {
  return servers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
}

// ─── §4.4 priority 1: host candidates (no STUN needed in E2E) ────────────────

describe('defaultIceServers() — §4.4 priority ordering', () => {
  it('returns an empty list when DISABLE_HMR=true (E2E same-machine; host candidates only)', () => {
    withEnv({ DISABLE_HMR: 'true', E2E_WEBRTC_ICE_SERVERS: undefined }, () => {
      const servers = defaultIceServers();
      // Priority 1: local/host candidates — browser handles these natively; no ICE server list needed.
      expect(servers).toEqual([]);
    });
  });

  // ─── §4.4 priority 2–3: STUN for srflx / NAT hole punch ──────────────────

  it('returns STUN servers (srflx, priority 2–3) in production mode', () => {
    withEnv({ DISABLE_HMR: undefined, E2E_WEBRTC_ICE_SERVERS: undefined }, () => {
      const servers = defaultIceServers();
      const urls = urlsOf(servers);
      expect(servers.length).toBeGreaterThanOrEqual(1);
      // Every default server must be a STUN entry (no relay/TURN present by default).
      // TURN relay (priority 4) is only added when explicitly configured.
      for (const url of urls) {
        expect(url).toMatch(/^stun:/);
      }
    });
  });

  it('default STUN list contains at least two entries for redundancy', () => {
    withEnv({ DISABLE_HMR: undefined, E2E_WEBRTC_ICE_SERVERS: undefined }, () => {
      expect(defaultIceServers().length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── §4.4 priority 4: relay fallback via custom TURN server ──────────────

  it('accepts a custom TURN relay via E2E_WEBRTC_ICE_SERVERS (priority 4 opt-in)', () => {
    const turnConfig: RTCIceServer[] = [
      { urls: 'stun:stun.example.com:3478' },
      { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' },
    ];
    withEnv({ E2E_WEBRTC_ICE_SERVERS: JSON.stringify(turnConfig), DISABLE_HMR: undefined }, () => {
      const servers = defaultIceServers();
      const urls = urlsOf(servers);
      // When a TURN relay is explicitly provided, it appears in the list.
      expect(urls.some((u) => u.startsWith('turn:'))).toBe(true);
      // STUN is still present alongside TURN.
      expect(urls.some((u) => u.startsWith('stun:'))).toBe(true);
    });
  });

  it('relay (TURN) is NOT present in the default list — used only as fallback when configured', () => {
    withEnv({ DISABLE_HMR: undefined, E2E_WEBRTC_ICE_SERVERS: undefined }, () => {
      const urls = urlsOf(defaultIceServers());
      // Priority 4 relay requires explicit configuration; it must not appear by default.
      expect(urls.some((u) => u.startsWith('turn:'))).toBe(false);
    });
  });

  // ─── Malformed / invalid custom override falls back to defaults ───────────

  it('falls back to defaults when E2E_WEBRTC_ICE_SERVERS is invalid JSON', () => {
    withEnv({ E2E_WEBRTC_ICE_SERVERS: 'not-json', DISABLE_HMR: undefined }, () => {
      const servers = defaultIceServers();
      // Must still return a valid STUN-only list.
      expect(servers.length).toBeGreaterThanOrEqual(1);
      expect(urlsOf(servers).every((u) => u.startsWith('stun:'))).toBe(true);
    });
  });

  it('falls back to defaults when E2E_WEBRTC_ICE_SERVERS is a non-array JSON value', () => {
    withEnv({ E2E_WEBRTC_ICE_SERVERS: '{"urls":"stun:example.com"}', DISABLE_HMR: undefined }, () => {
      // JSON is valid but not an array — should fall through to default STUN list.
      const servers = defaultIceServers();
      expect(Array.isArray(servers)).toBe(true);
      expect(servers.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── RTCIceServer shape ───────────────────────────────────────────────────

  it('each server in the default list has a non-empty urls field', () => {
    withEnv({ DISABLE_HMR: undefined, E2E_WEBRTC_ICE_SERVERS: undefined }, () => {
      for (const server of defaultIceServers()) {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        expect(urls.length).toBeGreaterThan(0);
        for (const url of urls) {
          expect(typeof url).toBe('string');
          expect(url.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
